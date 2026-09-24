import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, startAndLand, run, runUntil, place, aim, shootUntil, PS, MS, DT } from './helpers.js';

// ===================== ETAPA 1: MatchState =====================
test('lobby → contagem → aeronave → partida', () => {
  const m = createMatch();
  m.join({ name: 'A' });
  run(m, 2);
  assert.equal(m.state, MS.LOBBY, 'sem mínimo não conta');
  m.join({ name: 'B' });
  m.tick(DT); assert.equal(m.state, MS.COUNTDOWN);
  runUntil(m, () => m.state === MS.DEPLOYING, 3);
  assert.equal(m.state, MS.DEPLOYING);
  for (const p of m.ctx.players.values()) assert.equal(p.state, PS.AIRCRAFT);
  runUntil(m, () => m.state === MS.IN_PROGRESS, 30);
  for (const p of m.ctx.players.values()) assert.notEqual(p.state, PS.AIRCRAFT, 'ejeção automática no fim da rota');
});

test('não aceita entrar com partida em andamento, mas aceita reconexão por token', () => {
  const m = createMatch();
  const [a] = startAndLand(m, ['A', 'B', 'C', 'D']);
  assert.ok(m.join({ name: 'C' }).error);
  m.disconnect(a);
  assert.equal(a.connected, false);
  const r = m.join({ token: a.token });
  assert.equal(r.player, a); assert.equal(r.reconnected, true);
});

test('desconectado além do tempo de graça é removido da disputa', () => {
  const m = createMatch({ match: { reconnectGrace: 2 }, match2: {} });
  const [a] = startAndLand(m, ['A', 'B', 'C', 'D']);
  m.disconnect(a); run(m, 2.5);
  assert.ok(a.is(PS.AWAITING_RESPAWN, PS.ELIMINATED));
});

// ===================== Squad =====================
test('squads respeitam party e tamanho', () => {
  const m = createMatch({ match: { squadSize: 2 } });
  const ps = startAndLand(m, ['A', 'B', 'C', 'D'], ['X', null, 'X', null]);
  assert.equal(ps[0].squadId, ps[2].squadId, 'party X junta');
  assert.equal(ps[1].squadId, ps[3].squadId);
  assert.notEqual(ps[0].squadId, ps[1].squadId);
});

// ===================== Movimento autoritativo =====================
test('servidor limita velocidade (sem teleporte/speed hack)', () => {
  const m = createMatch();
  const [a] = startAndLand(m, ['A', 'B']);
  place(a, 0, 0);
  m.handle(a, { t: 'input', mx: 50, mz: -50, yaw: 0, sprint: true, tac: true });  // vetor gigante é normalizado
  const x0 = a.pos.x, z0 = a.pos.z; run(m, 1);
  const moved = Math.hypot(a.pos.x - x0, a.pos.z - z0);
  assert.ok(moved <= m.ctx.cfg.movement.tacticalSprint * 1.05, `moveu ${moved.toFixed(2)}m em 1s`);
});

test('input com seq antigo é descartado', () => {
  const m = createMatch();
  const [a] = startAndLand(m, ['A', 'B', 'C', 'D']);
  m.handle(a, { t: 'input', seq: 10, mz: -1 });
  m.handle(a, { t: 'input', seq: 5, mz: 1 });
  assert.equal(a.inputQueue.length, 1);
  m.tick(DT); assert.equal(a.input.mz, -1); assert.equal(a.lastSeq, 10);
});

// ===================== Loot =====================
test('coleta valida distância e só um jogador pega o item', () => {
  const m = createMatch();
  const [a, b] = startAndLand(m, ['A', 'B', 'C', 'D']);
  const L = m.ctx.systems.loot, fails = [];
  m.bus.on('pickupFailed', e => fails.push(e.reason));
  place(a, 10, 10); place(b, 10.5, 10);
  const it = L.spawn('weapon', { id: 'rifle', mag: 30 }, 50, 50, 'uncommon');
  m.handle(a, { t: 'pickup', lootId: it.id }); assert.deepEqual(fails, ['range']);
  const it2 = L.spawn('weapon', { id: 'battle', mag: 20 }, 10.2, 10, 'rare');
  m.handle(a, { t: 'pickup', lootId: it2.id });
  m.handle(b, { t: 'pickup', lootId: it2.id });
  assert.equal(a.inv.primary.id, 'battle');
  assert.deepEqual(fails, ['range', 'gone']);
});

test('coleta automática de dinheiro', () => {
  const m = createMatch();
  const [a] = startAndLand(m, ['A', 'B', 'C', 'D']);
  place(a, 0, 0);
  m.ctx.systems.loot.spawn('cash', { amount: 500 }, 0.5, 0);
  m.tick(DT);
  assert.equal(a.inv.cash, 500);
});

// ===================== Combate =====================
test('headshot aplica multiplicador; armadura absorve antes da vida', () => {
  const m = createMatch({ match: { squadSize: 1 } });
  const [a, b] = startAndLand(m, ['A', 'B']);
  place(a, 0, 0); place(b, 0, -10); b.armor = 0;
  m.ctx.systems.inventory.giveWeapon(a, 'rifle', 30);
  const dmg = []; m.bus.on('damage', e => dmg.push(e));
  m.handle(a, { t: 'fire', ...aim(a, b, 1.62) }); m.tick(DT);
  assert.equal(dmg[0].part, 'head');
  assert.equal(Math.round(b.hp), Math.round(100 - 27 * 1.6));
  // armadura
  b.hp = 100; b.armor = 100; run(m, 0.2);
  m.handle(a, { t: 'fire', ...aim(a, b, 1.2) }); m.tick(DT);
  assert.equal(b.hp, 100); assert.equal(b.armor, 73);
});

test('dano cai com a distância e parede bloqueia', () => {
  const m = createMatch({ match: { squadSize: 1 } });
  const [a, b] = startAndLand(m, ['A', 'B']);
  const W = m.ctx.systems.weapons, def = m.ctx.cfg.weapons.rifle;
  assert.equal(W.falloff(def, 10), 1); assert.ok(W.falloff(def, 120) < 0.85);
  place(a, 0, 0); place(b, 0, -20);
  m.ctx.map.boxes.push({ minX: -3, maxX: 3, minZ: -11, maxZ: -9, h: 5 });
  m.ctx.systems.inventory.giveWeapon(a, 'rifle', 30);
  m.handle(a, { t: 'fire', ...aim(a, b, 1.2) }); m.tick(DT);
  assert.equal(b.hp, 100);
});

test('cadência: 100 pedidos de tiro no mesmo tick = 1 disparo', () => {
  const m = createMatch({ match: { squadSize: 1 } });
  const [a, b] = startAndLand(m, ['A', 'B']);
  place(a, 0, 0); place(b, 50, 50);
  m.ctx.systems.inventory.giveWeapon(a, 'rifle', 30);
  for (let i = 0; i < 100; i++) m.handle(a, { t: 'fire', yaw: 0, pitch: 0 });
  assert.equal(a.inv.primary.mag, 29);
});

test('fogo amigo desativado', () => {
  const m = createMatch();
  const [a, , c] = startAndLand(m, ['A', 'B', 'C', 'D'], ['X', null, 'X', null]);
  place(a, 0, 0); place(c, 0, -5);
  m.ctx.systems.inventory.giveWeapon(a, 'rifle', 30);
  m.handle(a, { t: 'fire', ...aim(a, c, 1.2) }); m.tick(DT);
  assert.equal(c.hp, 100);
});

// ===================== Abatido / Reviver =====================
test('duo: jogador é abatido, aliado revive segurando interagir', () => {
  const m = createMatch();
  const [a, b, c] = startAndLand(m, ['A', 'B', 'C', 'D'], ['X', 'Y', 'X', 'Y']);
  place(b, 0, 0); place(a, 0, -15); place(c, 1, -15); a.armor = 0;
  m.ctx.systems.inventory.giveWeapon(b, 'rifle', 30);
  assert.ok(shootUntil(m, b, a, () => a.is(PS.DOWNED)));
  assert.equal(b.stats.downs, 1);
  c.input.interact = true;
  run(m, m.ctx.cfg.downed.reviveTime + 0.2);
  assert.equal(a.state, PS.ALIVE); assert.equal(c.stats.revives, 1);
});

test('abatido sangra até morrer; wipe do squad mata abatidos', () => {
  const m = createMatch({ downed: { bleedoutTime: 2 } });
  const [a] = startAndLand(m, ['A', 'B', 'C', 'D'], ['X', 'Y', 'X', 'Y']);
  place(a, 100, 100);
  m.ctx.systems.health.onLethal(a, null, {});
  assert.equal(a.state, PS.DOWNED);
  run(m, 2.5);
  assert.ok(a.is(PS.AWAITING_RESPAWN), 'aliado vivo → aguardando retorno');
});

// ===================== Resurgence =====================
test('morto com aliado vivo aguarda e volta em queda livre com kit básico, longe de inimigos', () => {
  const m = createMatch({ resurgence: { baseTime: 6, allyAliveSpeedup: 0 } });
  const [a, b] = startAndLand(m, ['A', 'B', 'C', 'D'], ['X', 'Y', 'X', 'Y']);
  const H = m.ctx.systems.health;
  a.inv.cash = 1000;
  H.onLethal(a, b, {}); H.kill(a, b, 'finished');
  assert.equal(a.state, PS.AWAITING_RESPAWN);
  assert.equal(b.stats.kills, 1); assert.equal(b.inv.cash, m.ctx.cfg.loot.killCash);
  run(m, 6.2);
  assert.equal(a.state, PS.FREEFALL);
  assert.equal(a.inv.secondary.id, 'sidearm'); assert.equal(a.inv.primary, null);
  assert.equal(a.inv.cash, 500, 'metade do dinheiro caiu no chão, metade ficou');
  for (const e of [b, m.ctx.players.get('P4')]) if (e.is(PS.ALIVE)) assert.ok(Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z) >= 1);
});

test('aliados vivos aceleram o relógio e abates do squad descontam tempo', () => {
  const m = createMatch({ resurgence: { baseTime: 30, allyAliveSpeedup: 1, killReduction: 5, minTime: 0 } });
  const [a, b, c, d] = startAndLand(m, ['A', 'B', 'C', 'D'], ['X', 'Y', 'X', 'Y']);
  const H = m.ctx.systems.health;
  H.kill(a, b, 'x');
  run(m, 1);
  assert.ok(a.respawnRemaining < 28.2 && a.respawnRemaining > 27.8, `relógio 2x: ${a.respawnRemaining}`);
  const before = a.respawnRemaining;
  H.onLethal(d, c, {}); H.kill(d, c, 'x');    // aliado C elimina D
  assert.ok(a.respawnRemaining <= before - 4.9);
});

test('squad inteiro morto = eliminação definitiva e vitória do outro', () => {
  const m = createMatch();
  const [a, b, c, d] = startAndLand(m, ['A', 'B', 'C', 'D'], ['X', 'Y', 'X', 'Y']);
  const H = m.ctx.systems.health, ended = [];
  m.bus.on('matchEnded', e => ended.push(e));
  H.onLethal(a, b, {});                        // A abatido (C de pé)
  H.onLethal(c, b, {});                        // C cai → wipe → A e C morrem
  assert.equal(a.state, PS.ELIMINATED); assert.equal(c.state, PS.ELIMINATED);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].winnerSquad, b.squadId);
  const res = ended[0].results;
  assert.equal(res.find(r => r.id === b.id).placement, 1);
  assert.equal(res.find(r => r.id === a.id).placement, 2);
  assert.equal(b.stats.kills, 2);
});

test('Resurgence desliga na fase configurada: mortes passam a ser definitivas', () => {
  const m = createMatch({ match: { squadSize: 1 }, resurgence: { disableAtPhase: 2 } });
  const [a, b, c] = startAndLand(m, ['A', 'B', 'C']);
  const Z = m.ctx.systems.zone, R = m.ctx.systems.resurgence;
  assert.equal(R.active, true);
  runUntil(m, () => Z.phase >= 1, 400);
  assert.equal(R.active, false);
  m.ctx.systems.health.kill(a, b, 'x');
  assert.equal(a.state, PS.ELIMINATED);
});

test('solo: volta sempre enquanto ativo (não exige companheiro)', () => {
  const m = createMatch({ match: { squadSize: 1 } });
  const [a, b] = startAndLand(m, ['A', 'B', 'C']);
  m.ctx.systems.health.kill(a, b, 'x');
  assert.equal(a.state, PS.AWAITING_RESPAWN);
});

// ===================== Zona =====================
test('zona: fases avançam e fora dela há dano (ignora armadura)', () => {
  const m = createMatch({ match: { squadSize: 1 }, zone: { phases: [{ radius: 20, wait: 1, close: 1, dps: 10 }, { radius: 0, wait: 1, close: 1, dps: 20 }] } });
  const [a] = startAndLand(m, ['A', 'B']);
  const Z = m.ctx.systems.zone;
  runUntil(m, () => Z.phase === 1, 20);
  place(a, Z.x + 150, Z.z); a.armor = 150; const hp0 = a.hp;
  run(m, 1);
  assert.equal(a.armor, 150); assert.ok(a.hp < hp0 - 15);
});

// ===================== Espectador =====================
test('espectador segue aliado vivo e troca quando ele cai', () => {
  const m = createMatch({ match: { squadSize: 3 } });
  const [a, b, c] = startAndLand(m, ['A', 'B', 'C', 'D', 'E', 'F'], ['X', 'X', 'X', 'Y', 'Y', 'Y']);
  m.ctx.systems.health.kill(a, null, 'x');
  m.tick(DT);
  assert.ok([b.id, c.id].includes(a.spectating));
  m.handle(a, { t: 'spectate', dir: 1 }); const first = a.spectating;
  m.handle(a, { t: 'spectate', dir: 1 }); assert.notEqual(a.spectating, first);
});

// ===================== Snapshot / privacidade =====================
test('snapshot não vaza vida/armadura de inimigos nem jogadores fora do raio', () => {
  const m = createMatch({ match: { squadSize: 1 } });
  const [a, b, c] = startAndLand(m, ['A', 'B', 'C']);
  place(a, 0, 0); place(b, 10, 0); place(c, 200, 200);
  const s = m.snapshotFor(a);
  const ob = s.others.find(o => o.id === b.id);
  assert.ok(ob && ob.hp === undefined);
  assert.ok(!s.others.find(o => o.id === c.id));
});

// ===================== Partida completa com bots =====================
test('partida inteira com bots termina com um vencedor', () => {
  const m = createMatch({ match: { fillWithBots: true, botFillTarget: 12, squadSize: 2 }, loot: { spawnPoints: 60 },
    zone: { phases: [{ radius: 80, wait: 5, close: 10, dps: 5 }, { radius: 30, wait: 5, close: 10, dps: 10 }, { radius: 0, wait: 5, close: 10, dps: 40 }] },
    resurgence: { disableAtPhase: 2, baseTime: 8 } });
  const h = m.join({ name: 'Humano' }).player;
  h.connected = true;
  let ended = null; m.bus.on('matchEnded', e => { ended = e; });
  runUntil(m, () => ended, 400);
  assert.ok(ended, 'partida terminou');
  assert.ok(ended.winnerSquad);
  assert.equal(ended.results[0].placement, 1);
});
