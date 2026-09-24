import { WebSocketServer } from 'ws';
import { C2S, S2C, GAME_EVENTS } from '../../shared/protocol.js';
import { clientConfig } from '../../shared/config.js';
import { MS } from '../systems/MatchStateSystem.js';

/**
 * NetworkSystem — transporte WebSocket (JSON).
 * Responsabilidades: handshake/reconexão por token, limite de taxa (token bucket),
 * tamanho máximo de mensagem, broadcast de eventos com filtro de privacidade,
 * snapshots periódicos por jogador, medição de latência (para lag compensation).
 * Nenhuma regra de jogo aqui.
 */
/** Quem recebe cada evento: privacidade (involved/squad) e custo de banda (near). */
const EVENT_SCOPE = {
  damage: 'involved', pickup: 'involved', pickupFailed: 'involved', purchaseFailed: 'involved', respawnTimer: 'involved',
  plateBroken: 'involved', reviveStarted: 'involved',
  contractStarted: 'squad', contractUpdate: 'squad', contractCompleted: 'squad', contractFailed: 'squad', purchase: 'squad',
  shot: 'near', explosion: 'near', slid: 'near', mantled: 'near', vaulted: 'near', landed: 'near',
};

export class NetworkSystem {
  constructor({ server, getMatch, cfg, logger }) {
    this.getMatch = getMatch; this.cfg = cfg; this.log = logger.child('net');
    this.sessions = new Set();
    this.wss = new WebSocketServer({ server, maxPayload: cfg.network.maxMessageBytes });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    this.boundMatch = null;
  }

  /** Reassina os eventos quando uma nova partida é criada. */
  bind(match) {
    this.boundMatch = match;
    match.bus.on('*', (type, payload) => { if (GAME_EVENTS.includes(type) || type === 'matchStarted') this.onGameEvent(match, type, payload); });
    match.bus.on('lobbyChanged', () => this.broadcastLobby());
  }

  onConnection(ws, req) {
    const s = { ws, player: null, tokens: this.cfg.network.rateLimit.burst, last: Date.now(), ip: req.socket.remoteAddress, pingSent: 0 };
    this.sessions.add(s);
    ws.on('message', data => this.onMessage(s, data));
    ws.on('close', () => { this.sessions.delete(s); if (s.player) this.getMatch().disconnect(s.player); this.log.info(`conexão fechada ${s.player?.name ?? s.ip}`); });
    ws.on('error', e => this.log.warn('ws erro', e.message));
  }

  allow(s) {
    const rl = this.cfg.network.rateLimit, now = Date.now();
    s.tokens = Math.min(rl.burst, s.tokens + ((now - s.last) / 1000) * rl.perSecond); s.last = now;
    if (s.tokens < 1) return false; s.tokens--; return true;
  }

  onMessage(s, data) {
    if (!this.allow(s)) return;
    let msg; try { msg = JSON.parse(data); } catch { return this.send(s, S2C.ERROR, { error: 'json' }); }
    const match = this.getMatch();
    if (!s.player) {
      if (msg.t !== C2S.HELLO) return;
      const r = match.join({ name: msg.name, token: msg.token, party: msg.party });
      if (r.error) return this.send(s, S2C.ERROR, { error: r.error });
      // se o mesmo token já tinha outra sessão aberta, derruba a antiga
      for (const o of this.sessions) if (o !== s && o.player === r.player) { o.player = null; o.ws.close(4000, 'sessão substituída'); }
      s.player = r.player;
      this.send(s, S2C.WELCOME, { id: r.player.id, token: r.player.token, reconnected: r.reconnected, config: clientConfig(this.cfg), map: match.ctx.map.view() });
      if (match.ctx.systems.match.inMatch) this.send(s, S2C.MATCH_START, this.matchStartPayload(match));
      this.broadcastLobby();
      return;
    }
    if (msg.t === C2S.PING) { this.send(s, S2C.PONG, { t: msg.t0 }); return; }
    if (msg.t === 'pong2') { s.player.latency = Math.min(0.5, Math.max(0, (Date.now() - s.pingSent) / 2000)); return; }
    match.handle(s.player, msg);
  }

  matchStartPayload(match) {
    const S = match.ctx.systems;
    return { aircraft: S.match.aircraftInfo(), loot: S.loot.all(), zone: S.zone.view(), squads: S.squad.summary(), boards: S.contracts.boardsView(), stations: S.stations.view() };
  }

  /** Eventos privados só vão para os envolvidos; o resto é broadcast. */
  onGameEvent(match, type, p) {
    if (type === 'matchStarted') { for (const s of this.sessions) if (s.player) this.send(s, S2C.MATCH_START, this.matchStartPayload(match)); return; }
    const players = match.ctx.players;
    const involves = s => [p.attackerId, p.victimId, p.playerId, p.reviverId, p.targetId].includes(s.player.id);
    const origin = p.x !== undefined ? p : players.get(p.playerId)?.pos;
    for (const s of this.sessions) {
      if (!s.player) continue;
      const rule = EVENT_SCOPE[type] ?? 'all';
      if (rule === 'involved' && !involves(s)) continue;
      if (rule === 'squad' && s.player.squadId !== p.squadId) continue;
      if (rule === 'near') {
        const vp = match.ctx.systems.spectator.viewpoint(s.player);
        if (!origin || Math.hypot(origin.x - vp.x, origin.z - vp.z) > 220) continue;
      }
      this.send(s, S2C.EVENT, { type, ...p });
    }
  }

  broadcastLobby() {
    const match = this.getMatch(); if (match.ctx.systems.match.inMatch) return;
    const view = match.lobbyView();
    for (const s of this.sessions) if (s.player) this.send(s, S2C.LOBBY, view);
  }

  /** Chamado pelo loop no ritmo snapshotRate. */
  flush() {
    const match = this.getMatch(), st = match.state;
    for (const s of this.sessions) {
      if (!s.player || s.ws.readyState !== 1) continue;
      if (st === MS.LOBBY || st === MS.COUNTDOWN) continue;
      this.send(s, S2C.SNAPSHOT, match.snapshotFor(s.player));
    }
  }
  /** Ping servidor → cliente para medir RTT (usado na rebobinagem de hitboxes). */
  pingAll() { const now = Date.now(); for (const s of this.sessions) if (s.player) { s.pingSent = now; this.send(s, 'ping2', {}); } }
  lobbyTick() { const m = this.getMatch(); if (!m.ctx.systems.match.inMatch) this.broadcastLobby(); }

  send(s, t, payload) { try { s.ws.send(JSON.stringify({ t, ...payload })); } catch (e) { this.log.debug('falha ao enviar', e.message); } }
}
