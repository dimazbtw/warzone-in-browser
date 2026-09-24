import { C2S, S2C, GAME_EVENTS } from '../../shared/protocol.js';
import { clientConfig } from '../../shared/config.js';
import { MS } from '../systems/MatchStateSystem.js';

/**
 * SessionHub — sessões de jogadores independentes do transporte.
 * Serve tanto o WebSocket (Node) quanto o Web Worker (modo offline no navegador).
 * Responsabilidades: handshake/reconexão por token, limite de taxa, roteamento de
 * eventos com privacidade (involved/squad/near), snapshots, lobby e ping.
 * Nenhuma regra de jogo aqui.
 *
 * Uma sessão é { send(obj), player, tokens, last, pingSent, meta }.
 */

/** Quem recebe cada evento: privacidade (involved/squad) e custo de banda (near). */
export const EVENT_SCOPE = {
  damage: 'involved', pickup: 'involved', pickupFailed: 'involved', purchaseFailed: 'involved', respawnTimer: 'involved',
  plateBroken: 'involved', reviveStarted: 'involved', chestFailed: 'involved', meleeHit: 'involved',
  contractStarted: 'squad', contractUpdate: 'squad', contractCompleted: 'squad', contractFailed: 'squad', purchase: 'squad', ping: 'squad',
  shot: 'near', explosion: 'near', slid: 'near', mantled: 'near', vaulted: 'near', landed: 'near', chestOpened: 'near', smoke: 'near', melee: 'near', footstep: 'near',
};

export class SessionHub {
  constructor({ getMatch, cfg, logger, rateLimit = true }) {
    this.getMatch = getMatch; this.cfg = cfg; this.log = logger.child('hub');
    this.sessions = new Set(); this.rateLimit = rateLimit; this.unbind = [];
  }

  /** Assina os eventos de uma partida (chamado a cada nova partida). */
  bind(match) {
    for (const off of this.unbind) off();
    this.unbind = [
      match.bus.on('*', (type, payload) => { if (GAME_EVENTS.includes(type) || type === 'matchStarted') this.onGameEvent(match, type, payload); }),
      match.bus.on('lobbyChanged', () => this.broadcastLobby()),
    ];
  }

  open(send, meta = {}) {
    const s = { send, player: null, tokens: this.cfg.network.rateLimit.burst, last: Date.now(), pingSent: 0, meta };
    this.sessions.add(s); return s;
  }
  close(s) {
    this.sessions.delete(s);
    if (s.player) this.getMatch().disconnect(s.player);
    this.log.info(`sessão fechada ${s.player?.name ?? s.meta.ip ?? ''}`);
  }

  allow(s) {
    if (!this.rateLimit) return true;
    const rl = this.cfg.network.rateLimit, now = Date.now();
    s.tokens = Math.min(rl.burst, s.tokens + ((now - s.last) / 1000) * rl.perSecond); s.last = now;
    if (s.tokens < 1) return false; s.tokens--; return true;
  }

  /** Mensagem já decodificada (objeto) vinda do transporte. */
  receive(s, msg) {
    if (!this.allow(s)) return;
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return this.send(s, S2C.ERROR, { error: 'json' });
    const match = this.getMatch();
    if (!s.player) {
      if (msg.t !== C2S.HELLO) return;
      const r = match.join({ name: msg.name, token: msg.token, party: msg.party, operator: msg.operator });
      if (r.error) return this.send(s, S2C.ERROR, { error: r.error });
      // o mesmo token com outra sessão aberta: derruba a antiga
      for (const o of this.sessions) if (o !== s && o.player === r.player) { o.player = null; o.meta.kick?.('sessão substituída'); }
      s.player = r.player;
      this.welcome(s, match, r.reconnected);
      if (match.ctx.systems.match.inMatch) this.send(s, S2C.MATCH_START, this.matchStartPayload(match));
      this.broadcastLobby();
      return;
    }
    if (msg.t === C2S.PING) { this.send(s, S2C.PONG, { t0: msg.t0 }); return; }
    if (msg.t === 'pong2') { s.player.latency = Math.min(0.5, Math.max(0, (Date.now() - s.pingSent) / 2000)); return; }
    match.handle(s.player, msg);
  }

  welcome(s, match, reconnected = false) {
    this.send(s, S2C.WELCOME, { id: s.player.id, token: s.player.token, reconnected, config: clientConfig(match.ctx.cfg), map: match.ctx.map.view() });
  }

  matchStartPayload(match) {
    const S = match.ctx.systems;
    return { aircraft: S.match.aircraftInfo(), loot: S.loot.all(), zone: S.zone.view(), squads: S.squad.summary(), boards: S.contracts.boardsView(), stations: S.stations.view(), chests: S.loot.chestsView?.() ?? [] };
  }

  /** Eventos privados só vão para os envolvidos; o resto é broadcast. */
  onGameEvent(match, type, p) {
    if (type === 'matchStarted') { for (const s of this.sessions) if (s.player) this.send(s, S2C.MATCH_START, this.matchStartPayload(match)); return; }
    const players = match.ctx.players, rule = EVENT_SCOPE[type] ?? 'all';
    const origin = p.x !== undefined ? p : players.get(p.playerId)?.pos;
    for (const s of this.sessions) {
      if (!s.player) continue;
      if (rule === 'involved' && ![p.attackerId, p.victimId, p.playerId, p.reviverId, p.targetId].includes(s.player.id)) continue;
      if (rule === 'squad' && s.player.squadId !== p.squadId) continue;
      if (rule === 'near') {
        const vp = match.ctx.systems.spectator.viewpoint(s.player);
        if (!origin || Math.hypot(origin.x - vp.x, origin.z - vp.z) > (type === 'footstep' ? 45 : 240)) continue;
        if (type === 'footstep' && p.playerId === s.player.id) continue;
      }
      this.send(s, S2C.EVENT, { ...p, type });   // `type` do evento sempre vence campos do payload
    }
  }

  broadcastLobby() {
    const match = this.getMatch(); if (match.ctx.systems.match.inMatch) return;
    const view = match.lobbyView();
    for (const s of this.sessions) if (s.player) this.send(s, S2C.LOBBY, view);
  }

  /** Snapshots por jogador (chamado no ritmo snapshotRate). */
  flush() {
    const match = this.getMatch(), st = match.state;
    if (st === MS.LOBBY || st === MS.COUNTDOWN) return;
    for (const s of this.sessions) if (s.player && s.meta.open?.() !== false) this.send(s, S2C.SNAPSHOT, match.snapshotFor(s.player));
  }
  /** Ping servidor → cliente para medir RTT (usado na rebobinagem de hitboxes). */
  pingAll() { const now = Date.now(); for (const s of this.sessions) if (s.player) { s.pingSent = now; this.send(s, 'ping2', {}); } }
  lobbyTick() { if (!this.getMatch().ctx.systems.match.inMatch) this.broadcastLobby(); }

  send(s, t, payload) { try { s.send({ ...payload, t }); } catch (e) { this.log.debug('falha ao enviar', e.message); } }
}
