import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, startAndLand, run, place, aim, shootUntil, PS, DT } from './helpers.js';

test('corpo a corpo: acerta à frente, erra atrás e finaliza abatido', () => {
  const m = createMatch();
  const [a, b] = startAndLand(m, ['A', 'B'], ['p1', 'p2']);
  place(a, 0, 0); place(b, 0, -1.5); b.armor = 0;
  const hp0 = b.hp;
  m.handle(a, { t: 'melee', yaw: Math.PI }); m.tick(DT);          // de costas: erra
  assert.equal(b.hp, hp0);
  run(m, 1);
  m.handle(a, { t: 'melee', yaw: 0 }); m.tick(DT);                // de frente: acerta
  assert.ok(b.hp < hp0);
  m.handle(a, { t: 'melee', yaw: 0 }); m.tick(DT);                // em cooldown
  const hp1 = b.hp; assert.ok(hp1 > 0);
  run(m, 1); m.handle(a, { t: 'melee', yaw: 0 }); m.tick(DT);
  assert.ok(b.is(PS.DOWNED) || b.is(PS.ELIMINATED) || b.is(PS.AWAITING) || b.hp < hp1);
  if (b.is(PS.DOWNED)) { run(m, 1); m.handle(a, { t: 'melee', yaw: 0 }); m.tick(DT); assert.ok(!b.is(PS.DOWNED)); }
});

test('fumaça bloqueia linha de visão e expira', () => {
  const m = createMatch();
  const [a] = startAndLand(m, ['A', 'B'], ['p1', 'p2']);
  place(a, 0, 0); a.inv.tactical = 1;
  const smokes = []; m.bus.on('smoke', e => smokes.push(e));
  m.handle(a, { t: 'tactical', yaw: 0, pitch: 0 }); run(m, 3);
  assert.equal(smokes.length, 1); assert.equal(a.inv.tactical, 0);
  const s = m.ctx.systems.weapons.smokes[0];
  assert.ok(m.ctx.systems.weapons.smokeBlocks({ x: s.x - 15, y: s.y, z: s.z }, { x: s.x + 15, y: s.y, z: s.z }));
  assert.ok(!m.ctx.systems.weapons.smokeBlocks({ x: s.x - 15, y: s.y, z: s.z + 20 }, { x: s.x + 15, y: s.y, z: s.z + 20 }));
  run(m, m.ctx.cfg.equipment.tactical.duration + 1);
  assert.equal(m.ctx.systems.weapons.smokes.length, 0);
});

test('ping vai só para o esquadrão e tem limite de frequência', () => {
  const m = createMatch();
  const [a] = startAndLand(m, ['A', 'B'], ['p1', 'p2']);
  const pings = []; m.bus.on('ping', e => pings.push(e));
  m.handle(a, { t: 'mark', x: 10, y: 0, z: 5, kind: 'enemy' });
  m.handle(a, { t: 'mark', x: 11, y: 0, z: 5, kind: 'enemy' });   // spam ignorado
  m.handle(a, { t: 'mark', x: 'x', y: 0, z: 5 });                  // inválido
  assert.equal(pings.length, 1); assert.equal(pings[0].squadId, a.squadId); assert.equal(pings[0].kind, 'enemy');
});

test('raridade aumenta o dano da arma', () => {
  const dmg = rarity => {
    const m = createMatch();
    const [a, b] = startAndLand(m, ['A', 'B'], ['p1', 'p2']);
    place(a, 0, 0); place(b, 0, -10); b.armor = 0; b.hp = 100;
    m.ctx.systems.inventory.giveWeapon(a, 'rifle', 30, rarity); a.inv.active = 'primary';
    const hp0 = b.hp; shootUntil(m, a, b, () => b.hp < hp0, 1.2);
    return hp0 - b.hp;
  };
  assert.ok(dmg('legendary') > dmg('common'));
});

test('pente vazio recarrega automaticamente', () => {
  const m = createMatch();
  const [a] = startAndLand(m, ['A', 'B'], ['p1', 'p2']);
  const w = m.ctx.systems.inventory.active(a); w.mag = 1; a.inv.ammo.pistol = 30;
  m.handle(a, { t: 'fire', yaw: 0, pitch: 0 }); m.tick(DT);
  assert.equal(a.action?.type, 'reload');
  run(m, 2);
  assert.ok(w.mag > 0);
});
