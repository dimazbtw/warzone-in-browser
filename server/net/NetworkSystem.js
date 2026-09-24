import { WebSocketServer } from 'ws';
import { SessionHub } from './SessionHub.js';

/**
 * NetworkSystem — transporte WebSocket (JSON) sobre o SessionHub.
 * Cuida apenas de: aceitar conexões, tamanho máximo de mensagem, parse de JSON,
 * encaminhar ao hub e fechar sessões. Regras de sessão/eventos ficam no hub.
 *
 * Pode receber um hub pronto (GameServer) ou criar o próprio (testes).
 */
export class NetworkSystem {
  constructor({ server, getMatch, cfg, logger, hub }) {
    this.cfg = cfg; this.log = logger.child('net');
    this.hub = hub ?? new SessionHub({ getMatch, cfg, logger });
    this.wss = new WebSocketServer({ server, maxPayload: cfg.network.maxMessageBytes });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
  }
  get sessions() { return this.hub.sessions; }
  bind(match) { this.hub.bind(match); }

  onConnection(ws, req) {
    const s = this.hub.open(obj => ws.send(JSON.stringify(obj)), {
      ip: req.socket.remoteAddress, open: () => ws.readyState === 1, kick: reason => ws.close(4000, reason),
    });
    s.ws = ws;
    ws.on('message', data => {
      let msg; try { msg = JSON.parse(data); } catch { msg = null; }
      this.hub.receive(s, msg);
    });
    ws.on('close', () => this.hub.close(s));
    ws.on('error', e => this.log.warn('ws erro', e.message));
  }

  flush() { this.hub.flush(); }
  pingAll() { this.hub.pingAll(); }
  lobbyTick() { this.hub.lobbyTick(); }
  broadcastLobby() { this.hub.broadcastLobby(); }
  send(s, t, payload) { this.hub.send(s, t, payload); }
}
