import { Logger } from './core/Logger.js';
import { Match } from './Match.js';
import { SessionHub } from './net/SessionHub.js';
import { MS } from './systems/MatchStateSystem.js';

/**
 * GameServer — ciclo de vida das partidas + loop de tempo fixo.
 * Roda igual no Node (servidor online) e num Web Worker (modo offline no navegador).
 *
 *   step(realDt)  acumula tempo real e executa ticks fixos (cfg.match.tickRate)
 *   pause(bool)   congela a simulação (só no modo offline faz sentido)
 *   autoRestart   após ENDED + endScreenTime cria nova partida e religa os humanos
 */
export class GameServer {
  constructor({ cfg, logger = new Logger('srv'), rateLimit = true, autoRestart = true, seed } = {}) {
    this.cfg = cfg; this.log = logger; this.autoRestart = autoRestart; this.seed = seed;
    this.paused = false; this.acc = 0; this.tickN = 0; this.slowTicks = 0;
    this.match = this.createMatch();
    this.hub = new SessionHub({ getMatch: () => this.match, cfg, logger, rateLimit });
    this.hub.bind(this.match);
  }
  createMatch() { return new Match({ cfg: this.cfg, logger: this.log.child('match'), seed: this.seed ?? Date.now() }); }

  /** Conecta um transporte: `send(obj)` entrega mensagens ao cliente. */
  connect(send, meta) { return this.hub.open(send, meta); }
  receive(session, msg) { this.hub.receive(session, msg); }
  disconnect(session) { this.hub.close(session); }
  pause(v) { this.paused = !!v; if (!v) this.acc = 0; }

  step(realDt) {
    if (this.paused) return;
    const dt = 1 / this.cfg.match.tickRate, snapEvery = Math.max(1, Math.round(this.cfg.match.tickRate / this.cfg.match.snapshotRate));
    this.acc += Math.min(0.25, realDt);
    while (this.acc >= dt) {
      const t0 = performance.now();
      this.match.tick(dt); this.acc -= dt; this.tickN++;
      if (this.tickN % snapEvery === 0) this.hub.flush();
      if (this.tickN % this.cfg.match.tickRate === 0) { this.hub.pingAll(); this.hub.lobbyTick(); }
      const cost = performance.now() - t0;
      if (cost > dt * 1000 * 0.8 && ++this.slowTicks % 30 === 1) this.log.warn(`tick lento: ${cost.toFixed(1)}ms`);
    }
    const m = this.match;
    if (this.autoRestart && m.state === MS.ENDED && m.ctx.now() - m.ctx.systems.match.endedAt > this.cfg.match.endScreenTime) this.restart();
  }

  /** Nova partida mantendo os humanos conectados. */
  restart() {
    this.log.info('reiniciando lobby');
    const old = this.match;
    this.match = this.createMatch();
    this.hub.bind(this.match);
    for (const s of this.hub.sessions) {
      const p = s.player; if (!p || p.isBot || !p.connected) { s.player = null; continue; }
      s.player = this.match.join({ name: p.name, party: p.party, operator: p.operator }).player;
      this.hub.welcome(s, this.match, false);
    }
    this.hub.broadcastLobby();
    void old;
  }

  /** Loop automático com setInterval (Node e Worker). */
  start(hz = this.cfg.match.tickRate * 2) {
    let last = performance.now();
    this.timer = setInterval(() => { const now = performance.now(); this.step((now - last) / 1000); last = now; }, 1000 / hz);
    return this;
  }
  stop() { clearInterval(this.timer); }
}
