import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MapGeometry } from '../shared/geometry.js';
import { newBody, stepGround } from '../shared/movement.js';
import { makeConfig } from '../shared/config.js';
import { MapData } from '../server/MapData.js';
import { NavGrid } from '../server/systems/NavGrid.js';
import { Match } from '../server/Match.js';
import { Logger } from '../server/core/Logger.js';

const cfg = makeConfig(), DT = 1 / 30;
const I = (o = {}) => ({ mx: 0, mz: 0, yaw: 0, pitch: 0, sprint: false, tac: false, crouch: false, prone: false, jump: false, ads: false, ...o });
const walk = (b, geo, n, o) => { for (let i = 0; i < n; i++) stepGround(b, I(o), DT, i * DT, cfg, geo); };

test('sobe escada de 12 degraus até o andar de cima', () => {
  const boxes = [];
  for (let i = 0; i < 12; i++) boxes.push({ minX: -0.6, maxX: 0.6, minZ: -1 - (i + 1) * 0.3, maxZ: -1 - i * 0.3, y0: 0, y1: (i + 1) * 3.2 / 12, kind: 'stair' });
  boxes.push({ minX: -3, maxX: 3, minZ: -30, maxZ: -4.6, y0: 2.95, y1: 3.2, kind: 'floor' });
  const geo = new MapGeometry(420, boxes), b = newBody();
  walk(b, geo, 90, { mz: -1 });
  assert.ok(Math.abs(b.pos.y - 3.2) < 0.05, `chegou em y=${b.pos.y.toFixed(2)}`);
  assert.ok(b.pos.z < -5);
});

test('teto impede atravessar a laje ao pular', () => {
  const geo = new MapGeometry(420, [{ minX: -5, maxX: 5, minZ: -5, maxZ: 5, y0: 2.2, y1: 2.45, kind: 'floor' }]), b = newBody();
  stepGround(b, I({ jump: true }), DT, 0, cfg, geo);
  walk(b, geo, 40, {});
  assert.ok(b.pos.y < 0.5, `ficou abaixo da laje (y=${b.pos.y.toFixed(2)})`);
});

test('vault pela janela (parapeito a 1 m) e parede sem abertura bloqueia', () => {
  const t = 0.15, boxes = [
    { minX: -3, maxX: -0.6, minZ: -5 - t, maxZ: -5 + t, y0: 0, y1: 3 }, { minX: 0.6, maxX: 3, minZ: -5 - t, maxZ: -5 + t, y0: 0, y1: 3 },
    { minX: -0.6, maxX: 0.6, minZ: -5 - t, maxZ: -5 + t, y0: 0, y1: 1.0 }, { minX: -0.6, maxX: 0.6, minZ: -5 - t, maxZ: -5 + t, y0: 2.15, y1: 3 },
  ];
  const geo = new MapGeometry(420, boxes), b = newBody(); b.pos.z = -4.4;
  stepGround(b, I({ mz: -1, jump: true }), DT, 0, cfg, geo); walk(b, geo, 25, { mz: -1 });
  assert.ok(b.pos.z < -5.3, `passou pela janela (z=${b.pos.z.toFixed(2)})`);
  const c = newBody(); c.pos.x = 2; c.pos.z = -4.4;
  stepGround(c, I({ mz: -1, jump: true }), DT, 0, cfg, geo); walk(c, geo, 25, { mz: -1 });
  assert.ok(c.pos.z > -5, 'parede cheia bloqueia');
});

test('relevo: chão acompanha o terreno e morro bloqueia tiro', () => {
  const geo = new MapGeometry(420, [], { seed: 3, amp: 30, cell: 4, flats: [] });
  const h = geo.groundHeight(10, 10, 100);
  assert.ok(Math.abs(h - geo.terrainHeight(10, 10)) < 1e-6);
  // raio horizontal abaixo do topo do relevo acaba batendo no chão
  const hit = geo.raycast({ x: -150, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 300);
  assert.ok(hit !== null && hit < 300);
});

test('mapa gerado é determinístico e tem interiores, baús e navegação', () => {
  const a = new MapData(420, 99), b = new MapData(420, 99);
  assert.equal(a.boxes.length, b.boxes.length); assert.deepEqual(a.boxes[100], b.boxes[100]);
  assert.ok(a.buildings.length > 25, `${a.buildings.length} prédios`);
  assert.ok(a.boxes.some(x => x.kind === 'stair') && a.boxes.some(x => x.kind === 'floor' && x.y1 > 3));
  assert.ok(a.chestSpots.length > 20 && a.lootSpots.length > 150);
  // o cliente reconstrói a mesma geometria a partir da view
  const v = MapGeometry.fromView(JSON.parse(JSON.stringify(a.view())));
  assert.equal(v.boxes.length, a.boxes.length);
  assert.ok(Math.abs(v.groundHeight(12.3, -40.7, 50) - a.groundHeight(12.3, -40.7, 50)) < 0.02);
  const nav = new NavGrid(a), p = nav.path({ x: a.pois[0].x, z: a.pois[0].z }, { x: a.pois[3].x, z: a.pois[3].z });
  assert.ok(p && p.length > 1);
});

test('partida completa com bots no mapa real termina com vencedor', () => {
  const c = makeConfig({ match: { fillWithBots: true, botFillTarget: 20, squadSize: 2, lobbyCountdown: 1, minPlayersToStart: 1 },
    zone: { phases: [{ radius: 90, wait: 10, close: 20, dps: 4 }, { radius: 35, wait: 10, close: 20, dps: 10 }, { radius: 0, wait: 5, close: 20, dps: 40 }] },
    resurgence: { disableAtPhase: 2, baseTime: 10 }, bots: { difficulty: 'hard' } });
  const m = new Match({ cfg: c, seed: 5, logger: new Logger('t', 'silent') });
  m.join({ name: 'Humano' });
  let ended = null, kills = 0; m.bus.on('matchEnded', e => { ended = e; }); m.bus.on('killfeed', e => { if (e.attackerId) kills++; });
  for (let t = 0; t < 600 && !ended; t += DT) m.tick(DT);
  assert.ok(ended, 'terminou'); assert.ok(ended.winnerSquad);
  assert.ok(kills >= 3, `bots eliminaram ${kills}`);
});
