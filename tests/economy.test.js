import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, startAndLand, run, place, PS, DT } from './helpers.js';

const setup = (over = {}) => {
  const m = createMatch({ zone: { phases: [{ radius: 400, wait: 999, close: 1, dps: 0 }] }, ...over });
  const ps = startAndLand(m, ['A', 'B', 'C', 'D'], ['X', 'Y', 'X', 'Y']);
  return { m, ps, S: m.ctx.systems };
};
const toBoard = (m, p, type) => { const b = [...m.ctx.systems.contracts.boards.values()].find(x => x.type === type && !x.taken) ?? [...m.ctx.systems.contracts.boards.values()].find(x => !x.taken); b.type = type; place(p, b.x, b.z); return b; };

// ===================== Estações =====================
test('estação: compra placas, debita dinheiro; valida distância e saldo', () => {
  const { m, ps: [a], S } = setup();
  const st = S.stations.stations[0], fails = [];
  m.bus.on('purchaseFailed', e => fails.push(e.reason));
  a.inv.cash = 1000; a.inv.plates = 0;
  place(a, st.x + 20, st.z);
  m.handle(a, { t: 'buy', stationId: st.id, item: 'plates' }); assert.equal(fails.at(-1), 'longe da estação');
  place(a, st.x + 1, st.z);
  m.handle(a, { t: 'buy', stationId: st.id, item: 'plates' });
  assert.equal(a.inv.plates, 3); assert.equal(a.inv.cash, 200);
  m.handle(a, { t: 'buy', stationId: st.id, item: 'plates' }); assert.equal(fails.at(-1), 'dinheiro insuficiente');
  m.handle(a, { t: 'buy', stationId: st.id, item: 'naoexiste' }); assert.equal(fails.at(-1), 'item inválido');
});

test('estação: recompra traz aliado eliminado de volta e respeita limite', () => {
  const { m, ps: [a, b, c], S } = setup({ resurgence: { enabled: false } });
  const st = S.stations.stations[0];
  S.health.kill(c, b, 'x');
  assert.equal(c.state, PS.ELIMINATED);
  a.inv.cash = 100000; place(a, st.x + 1, st.z);
  m.handle(a, { t: 'buy', stationId: st.id, item: 'buyback', targetId: c.id });
  assert.equal(c.state, PS.FREEFALL);
  assert.equal(a.inv.cash, 100000 - m.ctx.cfg.stations.catalog.buyback.price);
});

test('estação: radar marca inimigos no snapshot do squad', () => {
  const { m, ps: [a, b], S } = setup();
  const st = S.stations.stations[0];
  a.inv.cash = 5000; place(a, st.x + 1, st.z); place(b, st.x + 30, st.z + 30);
  assert.ok(!m.snapshotFor(a).others.find(o => o.id === b.id).rv);
  m.handle(a, { t: 'buy', stationId: st.id, item: 'radar' });
  assert.equal(m.snapshotFor(a).others.find(o => o.id === b.id).rv, 1);
});

// ===================== Contratos =====================
test('caçada: eliminar o alvo dá recompensa ao squad todo', () => {
  const { m, ps: [a, b, c], S } = setup();
  const done = []; m.bus.on('contractCompleted', e => done.push(e));
  const bd = toBoard(m, a, 'hunt'); place(b, bd.x + 30, bd.z); place(m.ctx.players.get('P4'), bd.x + 200, bd.z + 200);
  m.handle(a, { t: 'contract', boardId: bd.id });
  const k = S.contracts.viewFor(a);
  assert.equal(k.type, 'hunt'); assert.equal(k.target, b.name);
  assert.ok(Math.hypot(k.lastSeen.x - b.pos.x, k.lastSeen.z - b.pos.z) < 25, 'posição aproximada');
  S.health.onLethal(b, c, {}); S.health.kill(b, c, 'x');
  assert.equal(done.length, 1);
  assert.equal(a.stats.contracts, 1); assert.equal(c.stats.contracts, 1);
  assert.ok(a.inv.cash >= 1500);
});

test('contrato: não pode ter dois ao mesmo tempo; tablet só uma vez', () => {
  const { m, ps: [a, b, c], S } = setup();
  const fails = []; m.bus.on('contractFailed', e => fails.push(e.reason));
  const bd = toBoard(m, a, 'survive');
  m.handle(a, { t: 'contract', boardId: bd.id });
  const bd2 = toBoard(m, c, 'survive'); m.handle(c, { t: 'contract', boardId: bd2.id });
  assert.equal(fails.at(-1), 'squad já tem contrato');
  place(b, bd.x, bd.z); m.handle(b, { t: 'contract', boardId: bd.id });
  assert.equal(fails.at(-1), 'indisponível');
});

test('domínio: progride só sem inimigos na área e conclui', () => {
  const { m, ps: [a, b], S } = setup({ contracts: { types: { capture: { time: 3 } } } });
  const bd = toBoard(m, a, 'capture'); place(b, 150, 150);
  m.handle(a, { t: 'contract', boardId: bd.id });
  const area = S.contracts.viewFor(a).area;
  place(a, area.x, area.z); place(b, area.x + 1, area.z);
  run(m, 1.5); assert.equal(S.contracts.viewFor(a).progress, 0, 'contestado');
  assert.ok(S.contracts.viewFor(a).contested);
  place(b, 150, 150); run(m, 3.3);
  assert.equal(S.contracts.viewFor(a), null); assert.equal(a.stats.contracts, 1);
});

test('suprimentos: esconderijos em sequência, último solta loot épico', () => {
  const { m, ps: [a], S } = setup();
  const bd = toBoard(m, a, 'scavenger');
  m.handle(a, { t: 'contract', boardId: bd.id });
  for (let i = 0; i < 3; i++) { const c = S.contracts.viewFor(a).cache; place(a, c.x, c.z); m.tick(DT); }
  assert.equal(a.stats.contracts, 1);
  assert.ok([...S.loot.items.values()].some(it => it.type === 'weapon' && it.rarity === 'epic'));
});

test('inteligência: itens exclusivos do squad; coletar todos conclui', () => {
  const { m, ps: [a, b], S } = setup();
  const bd = toBoard(m, a, 'collect');
  m.handle(a, { t: 'contract', boardId: bd.id });
  const intel = [...S.loot.items.values()].filter(it => it.type === 'intel');
  assert.equal(intel.length, 3);
  place(b, intel[0].x, intel[0].z); m.handle(b, { t: 'pickup', lootId: intel[0].id });
  assert.ok(S.loot.items.has(intel[0].id), 'inimigo não pega');
  for (const it of intel) { place(a, it.x, it.z); m.handle(a, { t: 'pickup', lootId: it.id }); }
  assert.equal(a.stats.contracts, 1);
});

test('resistência + contrato expira', () => {
  const { m, ps: [a, b, c], S } = setup({ contracts: { types: { survive: { time: 2, duration: 60 }, hunt: { duration: 1 } } } });
  const failed = []; m.bus.on('contractFailed', e => failed.push(e.reason));
  const bd = toBoard(m, a, 'survive'); m.handle(a, { t: 'contract', boardId: bd.id });
  run(m, 2.2); assert.equal(a.stats.contracts, 1);
  const bd2 = toBoard(m, c, 'hunt'); place(b, bd2.x + 20, bd2.z); m.handle(c, { t: 'contract', boardId: bd2.id });
  run(m, 1.2); assert.equal(failed.at(-1), 'tempo esgotado');
});

test('completar contrato reduz retorno de aliado aguardando', () => {
  const { m, ps: [a, b, c], S } = setup({ contracts: { types: { survive: { time: 1 } } }, resurgence: { allyAliveSpeedup: 0, minTime: 0 } });
  S.health.kill(c, b, 'x'); assert.equal(c.state, PS.AWAITING_RESPAWN);
  const before = c.respawnRemaining;
  const bd = toBoard(m, a, 'survive'); m.handle(a, { t: 'contract', boardId: bd.id });
  run(m, 1.1);
  assert.ok(c.respawnRemaining < before - 10);
});
