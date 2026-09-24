import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../shared/config.js';
import { Logger } from './core/Logger.js';
import { GameServer } from './GameServer.js';
import { NetworkSystem } from './net/NetworkSystem.js';

/**
 * Servidor online: arquivos estáticos + WebSocket na mesma porta.
 *   npm start → http://localhost:8080   (o jogo; "Multiplayer" conecta aqui)
 * O modo offline não precisa deste processo: roda num Web Worker no navegador.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const log = new Logger('srv');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };
const BLOCKED = ['node_modules', '.git', '.shots'].map(d => `${sep}${d}`);

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || BLOCKED.some(b => file.includes(b))) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(data);
  } catch { res.writeHead(404).end('not found'); }
});

const game = new GameServer({ cfg: CONFIG, logger: log }).start();
new NetworkSystem({ server, cfg: CONFIG, logger: log, hub: game.hub });

server.listen(CONFIG.network.port, () => log.info(`servidor em http://localhost:${CONFIG.network.port}`));
