import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { NetworkSystem } from '../server/net/NetworkSystem.js';
import { Logger } from '../server/core/Logger.js';
import { createMatch, run, MS, DT } from './helpers.js';

/** Sobe servidor real (porta aleatória) com uma partida controlada manualmente. */
async function boot(over = {}) {
  const m = createMatch(over);
  const server = http.createServer(); await new Promise(r => server.listen(0, r));
  const net = new NetworkSystem({ server, getMatch: () => m, cfg: m.ctx.cfg, logger: new Logger('t', 'silent') });
  net.bind(m);
  const url = `ws://localhost:${server.address().port}`;
  const close = () => { for (const s of net.sessions) s.ws.terminate(); net.wss.close(); server.close(); };
  return { m, net, url, close };
}
function client(url, hello) {
  const ws = new WebSocket(url), msgs = [];
  ws.on('message', d => msgs.push(JSON.parse(d)));
  const ready = new Promise(r => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', ...hello })); r(); }));
  const wait = async (pred, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const f = msgs.find(pred); if (f) return f; await new Promise(r => setTimeout(r, 10)); } return null; };
  return { ws, msgs, ready, wait, send: o => ws.send(JSON.stringify(o)) };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const closers = []; after(() => closers.forEach(c => c()));

test('handshake: welcome com token, mapa e config; lobby para todos', async () => {
  const S = await boot(); closers.push(S.close);
  const a = client(S.url, { name: 'Ana' }); await a.ready;
  const w = await a.wait(m => m.t === 'welcome');
  assert.ok(w.token && w.id && w.map.size === 420 && Array.isArray(w.map.boxes) && w.config.weapons);
  assert.equal(w.config.combat, undefined, 'config interna do servidor não vaza');
  const b = client(S.url, { name: 'Beto' }); await b.ready;
  const l = await a.wait(m => m.t === 'lobby' && m.players.length === 2);
  assert.ok(l);
});

test('reconexão por token durante a partida recupera o mesmo jogador', async () => {
  const S = await boot(); closers.push(S.close);
  const cs = ['A', 'B', 'C', 'D'].map(n => client(S.url, { name: n }));
  await Promise.all(cs.map(c => c.ready)); await Promise.all(cs.map(c => c.wait(m => m.t === 'welcome')));
  run(S.m, 2); assert.ok(S.m.ctx.systems.match.inMatch);
  const w = cs[0].msgs.find(m => m.t === 'welcome');
  cs[0].ws.close(); await sleep(80);
  assert.equal(S.m.ctx.players.get(w.id).connected, false);
  const back = client(S.url, { name: 'A', token: w.token }); await back.ready;
  const w2 = await back.wait(m => m.t === 'welcome');
  assert.equal(w2.id, w.id); assert.equal(w2.reconnected, true);
  assert.ok(await back.wait(m => m.t === 'matchStart'), 'recebe estado da partida ao voltar');
  // quem não tem token não entra no meio
  const late = client(S.url, { name: 'Z' }); await late.ready;
  assert.equal((await late.wait(m => m.t === 'err')).error, 'partida em andamento');
});

test('limite de taxa descarta flood de mensagens', async () => {
  const S = await boot(); closers.push(S.close);
  const cs = ['A', 'B', 'C', 'D'].map(n => client(S.url, { name: n }));
  await Promise.all(cs.map(c => c.ready)); await Promise.all(cs.map(c => c.wait(m => m.t === 'welcome')));
  run(S.m, 2);
  for (let i = 1; i <= 1000; i++) cs[0].send({ t: 'input', seq: i, mz: -1 });
  await sleep(150);
  const p = [...S.m.ctx.players.values()].find(x => x.name === 'A');
  assert.ok(p.lastQueuedSeq < 400, `processou ${p.lastQueuedSeq} de 1000`);
});

test('evento de dano só chega aos envolvidos; killfeed chega a todos', async () => {
  const S = await boot(); closers.push(S.close);
  const cs = ['A', 'B', 'C'].map(n => client(S.url, { name: n }));
  await Promise.all(cs.map(c => c.ready)); const ws = await Promise.all(cs.map(c => c.wait(m => m.t === 'welcome')));
  S.m.bus.emit('damage', { attackerId: ws[0].id, victimId: ws[1].id, amount: 10 });
  S.m.bus.emit('killfeed', { attackerId: ws[0].id, victimId: ws[1].id, attacker: 'A', victim: 'B' });
  await sleep(100);
  const got = c => c.msgs.filter(m => m.t === 'ev').map(m => m.type);
  assert.ok(got(cs[0]).includes('damage')); assert.ok(got(cs[1]).includes('damage'));
  assert.ok(!got(cs[2]).includes('damage'));
  assert.ok(cs.every(c => got(c).includes('killfeed')));
});

test('JSON inválido e mensagens desconhecidas não derrubam o servidor', async () => {
  const S = await boot(); closers.push(S.close);
  const a = client(S.url, { name: 'A' }); await a.ready; await a.wait(m => m.t === 'welcome');
  a.ws.send('{{{'); a.send({ t: 'fire', yaw: 'x' }); a.send({ t: 'buy', stationId: {}, item: [] }); a.send({ nada: 1 });
  assert.equal((await a.wait(m => m.t === 'err')).error, 'json');
  run(S.m, 0.5);
});

test('desempenho: 60 jogadores, tick médio abaixo de 8 ms', () => {
  const m = createMatch({ match: { fillWithBots: true, botFillTarget: 60, maxPlayers: 60, squadSize: 3 }, loot: { spawnPoints: 180 } });
  m.join({ name: 'Humano' });
  run(m, 3);
  const t0 = performance.now(); let n = 0;
  for (let t = 0; t < 20 && m.state !== MS.ENDED; t += DT) { m.tick(DT); for (const p of m.ctx.players.values()) if (!p.isBot) m.snapshotFor(p); n++; }
  const avg = (performance.now() - t0) / n;
  assert.ok(avg < 8, `tick médio ${avg.toFixed(2)} ms`);
});
