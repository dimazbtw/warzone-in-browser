/**
 * Servidor autoritativo dentro do navegador (Web Worker).
 * É o MESMO código do servidor online (server/*): regras, bots, zona, loot...
 * Só o transporte muda (postMessage em vez de WebSocket). Isso permite jogar
 * offline contra bots abrindo apenas a página, sem `npm start`.
 */
import { GameServer } from '../../server/GameServer.js';
import { Logger } from '../../server/core/Logger.js';
import { makeConfig } from '../../shared/config.js';

let game = null, session = null;

self.onmessage = e => {
  const m = e.data;
  try {
    if (m.kind === 'init') {
      const cfg = makeConfig(m.overrides ?? {});
      game = new GameServer({ cfg, logger: new Logger('offline', m.overrides?.logLevel ?? 'warn'), rateLimit: false, autoRestart: false });
      session = game.connect(obj => self.postMessage({ kind: 'msg', data: obj }), { ip: 'local' });
      game.start();
      self.postMessage({ kind: 'ready' });
    } else if (m.kind === 'msg' && game) {
      game.receive(session, m.data);
    } else if (m.kind === 'pause' && game) {
      game.pause(m.value);
    }
  } catch (err) {
    self.postMessage({ kind: 'error', message: String(err?.stack ?? err) });
  }
};
