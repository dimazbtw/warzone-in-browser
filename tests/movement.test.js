import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapGeometry } from '../shared/geometry.js';
import { newBody, stepGround, copyBody } from '../shared/movement.js';
import { makeConfig } from '../shared/config.js';

const cfg = makeConfig();
const DT = 1 / 30;
const I = (o = {}) => ({ mx: 0, mz: 0, yaw: 0, pitch: 0, sprint: false, tac: false, crouch: false, prone: false, jump: false, ads: false, ...o });
function sim(b, geo, inputs, t0 = 0) { let now = t0; const evs = []; for (const inp of inputs) { now += DT; evs.push(stepGround(b, inp, DT, now, cfg, geo)); } return evs; }
const repeat = (n, inp) => Array.from({ length: n }, () => I(inp));
// yaw = 0 → frente é -Z

test('slide: agachar correndo dá impulso e depois desacelera, com recarga', () => {
  const geo = new MapGeometry(420, []), b = newBody();
  sim(b, geo, repeat(40, { mz: -1, sprint: true }));
  const evs = sim(b, geo, [I({ mz: -1, sprint: true, crouch: true })]);
  assert.ok(evs[0].slid);
  const v0 = Math.hypot(b.vel.x, b.vel.z);
  assert.ok(v0 > cfg.movement.sprint, `slide mais rápido que sprint (${v0.toFixed(1)})`);
  sim(b, geo, repeat(30, { mz: -1, crouch: true }));
  assert.equal(b.slide, null); assert.equal(b.stance, 'crouch');
  // recarga: novo slide imediato não acontece
  sim(b, geo, repeat(5, { mz: -1, sprint: true }));
  const e2 = sim(b, geo, [I({ mz: -1, sprint: true, crouch: true })]);
  assert.ok(!e2[0].slid);
});

test('vault por cima de mureta baixa e fina', () => {
  const geo = new MapGeometry(420, [{ minX: -3, maxX: 3, minZ: -5.3, maxZ: -4.7, h: 1.05, kind: 'cover' }]);
  const b = newBody(); b.pos.z = -4.2;
  const evs = sim(b, geo, [I({ mz: -1, jump: true }), ...repeat(25, { mz: -1 })]);
  assert.ok(evs.some(e => e.vaulted)); assert.ok(b.pos.z < -5.4, `passou para o outro lado (z=${b.pos.z.toFixed(2)})`);
  assert.equal(b.pos.y, 0);
});

test('mantle em contêiner e fica em cima (telhado)', () => {
  const geo = new MapGeometry(420, [{ minX: -3, maxX: 3, minZ: -8, maxZ: -5, h: 2.6, kind: 'container' }]);
  const b = newBody(); b.pos.z = -4.5;
  const evs = sim(b, geo, [I({ mz: -1, jump: true }), ...repeat(25, {})]);
  assert.ok(evs.some(e => e.mantled));
  assert.equal(b.pos.y, 2.6); assert.ok(b.grounded);
  sim(b, geo, repeat(10, { mz: -1 }));
  assert.equal(b.pos.y, 2.6, 'anda sobre o telhado');
});

test('escalada em prédio escalável até o topo', () => {
  const geo = new MapGeometry(420, [{ minX: -5, maxX: 5, minZ: -15, maxZ: -5, h: 8, kind: 'building', climb: true }]);
  const b = newBody(); b.pos.z = -4.5;
  sim(b, geo, [I({ mz: -1, jump: true })]);
  assert.ok(b.climb, 'começou a escalar');
  sim(b, geo, repeat(90, { mz: -1 }));
  assert.equal(b.pos.y, 8); assert.equal(b.climb, null);
});

test('parede alta não escalável bloqueia', () => {
  const geo = new MapGeometry(420, [{ minX: -5, maxX: 5, minZ: -15, maxZ: -5, h: 8, kind: 'building', climb: false }]);
  const b = newBody(); b.pos.z = -4.5;
  sim(b, geo, [I({ mz: -1, jump: true }), ...repeat(30, { mz: -1 })]);
  assert.ok(b.pos.z > -5, 'não atravessa'); assert.equal(b.climb, null);
});

test('sprint tático gasta stamina e para ao esgotar', () => {
  const geo = new MapGeometry(420, []), b = newBody();
  sim(b, geo, repeat(30 * 4, { mz: -1, tac: true }));
  assert.ok(b.stamina < 5 || b.staminaBlockUntil > 0); assert.equal(b.tacActive, false);
});

test('determinismo: mesmo input = mesmo resultado (base da predição do cliente)', () => {
  const geo = new MapGeometry(420, [{ minX: -3, maxX: 3, minZ: -12, maxZ: -9, h: 2.6, kind: 'container' }]);
  const seq = [...repeat(20, { mz: -1, sprint: true }), I({ mz: -1, sprint: true, crouch: true }), ...repeat(10, { mz: -1, mx: 0.5 }), I({ mz: -1, jump: true }), ...repeat(20, { mz: -1 })];
  const a = newBody(), b = newBody();
  sim(a, geo, seq); const mid = copyBody(a);
  sim(b, geo, seq);
  assert.deepEqual(a.pos, b.pos);
  // reconciliação: reaplicar a partir de uma cópia chega no mesmo lugar
  const c = copyBody(mid); sim(c, geo, repeat(5, { mz: 1 })); sim(a, geo, repeat(5, { mz: 1 }));
  assert.deepEqual(a.pos, c.pos);
});
