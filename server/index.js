import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../shared/config.js';
import { Logger } from './core/Logger.js';
import { Match } from './Match.js';
import { NetworkSystem } from './net/NetworkSystem.js';
import { MS } from './systems/MatchStateSystem.js';

/**
 * Ponto de entrada: servidor HTTP (arquivos estáticos) + WebSocket na mesma porta.
 *   npm start  → http://localhost:8080          (jogo 3D single-player atual)
 *                http://localhost:8080/client-debug/  (cliente multiplayer de debug)
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const log = new Logger('srv');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary' };

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || file.includes('node_modules') || file.includes(`${ROOT}server`)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(data);
  } catch { res.writeHead(404).end('not found'); }
});

let match = new Match({ cfg: CONFIG, logger: log.child('match') });
const net = new NetworkSystem({ server, getMatch: () => match, cfg: CONFIG, logger: log });
net.bind(match);

// ---------- loop de tempo fixo ----------
const dt = 1 / CONFIG.match.tickRate, snapEvery = Math.round(CONFIG.match.tickRate / CONFIG.match.snapshotRate);
let tickN = 0, last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now(); acc += Math.min(0.25, (now - last) / 1000); last = now;
  while (acc >= dt) {
    const t0 = performance.now();
    match.tick(dt); acc -= dt; tickN++;
    if (tickN % snapEvery === 0) net.flush();
    if (tickN % CONFIG.match.tickRate === 0) { net.pingAll(); net.lobbyTick(); }
    const cost = performance.now() - t0;
    if (cost > dt * 1000 * 0.8) log.warn(`tick lento: ${cost.toFixed(1)}ms`);
  }
  // nova partida após a tela final
  if (match.state === MS.ENDED && match.ctx.now() - match.ctx.systems.match.endedAt > CONFIG.match.endScreenTime) {
    log.info('reiniciando lobby');
    const humans = [...match.ctx.players.values()].filter(p => !p.isBot && p.connected);
    match = new Match({ cfg: CONFIG, logger: log.child('match') });
    net.bind(match);
    for (const s of net.sessions) if (s.player && humans.includes(s.player)) { s.player = match.join({ name: s.player.name, party: s.player.party }).player; net.send(s, 'welcome', { id: s.player.id, token: s.player.token, reconnected: false, map: match.ctx.map.view() }); }
    net.broadcastLobby();
  }
}, 1000 / CONFIG.match.tickRate / 2);

server.listen(CONFIG.network.port, () => log.info(`servidor em http://localhost:${CONFIG.network.port}  (debug: /client-debug/)`));
