import { StateMachine } from '../core/StateMachine.js';
import { PS, IN_PLAY } from '../Player.js';

export const MS = Object.freeze({ LOBBY: 'lobby', COUNTDOWN: 'countdown', DEPLOYING: 'deploying', IN_PROGRESS: 'inProgress', ENDED: 'ended' });

/**
 * MatchStateSystem
 * - Ciclo LOBBY → COUNTDOWN → DEPLOYING (aeronave) → IN_PROGRESS → ENDED
 * - Controla a aeronave e a ejeção automática
 * - Detecta equipes elegíveis, colocações e vitória
 *
 * Eventos emitidos: matchState, matchStarted, squadEliminated, matchEnded
 */
export class MatchStateSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.countdown = 0;
    this.aircraft = null;
    this.startedAt = 0;
    this.winnerSquad = null;
    this.eliminatedSquads = new Set();
    this.sm = new StateMachine('match', MS.LOBBY, {
      [MS.LOBBY]: [MS.COUNTDOWN],
      [MS.COUNTDOWN]: [MS.LOBBY, MS.DEPLOYING],
      [MS.DEPLOYING]: [MS.IN_PROGRESS, MS.ENDED],
      [MS.IN_PROGRESS]: [MS.ENDED],
      [MS.ENDED]: [],
    }, (from, to) => { ctx.log.info(`partida ${from} → ${to}`); ctx.bus.emit('matchState', { from, to }); });

    // qualquer mudança de estado de jogador pode encerrar a partida
    ctx.bus.on('playerState', () => this.checkVictory());
  }
  get state() { return this.sm.state; }
  get inMatch() { return this.sm.is(MS.DEPLOYING, MS.IN_PROGRESS); }

  tick(dt) {
    const { cfg, now } = this.ctx;
    if (this.sm.is(MS.LOBBY)) {
      if (this.ctx.players.size >= cfg.match.minPlayersToStart) { this.countdown = cfg.match.lobbyCountdown; this.sm.set(MS.COUNTDOWN, now()); }
    } else if (this.sm.is(MS.COUNTDOWN)) {
      if (this.ctx.players.size < cfg.match.minPlayersToStart) { this.sm.set(MS.LOBBY, now()); return; }
      this.countdown -= dt;
      if (this.countdown <= 0) this.startMatch();
    } else if (this.sm.is(MS.DEPLOYING)) {
      this.updateAircraft(dt);
    }
  }

  /** Início: forma squads, spawna loot, cria zona e coloca todos na aeronave. */
  startMatch() {
    const { ctx } = this, now = ctx.now();
    ctx.systems.squad.assignAll([...ctx.players.values()]);
    ctx.systems.loot.spawnInitial();
    ctx.systems.contracts.spawnBoards();
    ctx.systems.stations.spawnStations();
    ctx.systems.zone.start();
    this.createAircraft();
    for (const p of ctx.players.values()) {
      ctx.systems.inventory.init(p, 'start');
      p.hp = ctx.cfg.health.max; p.stats.joinedAt = now;
      p.setState(PS.AIRCRAFT, now);
      Object.assign(p.pos, this.aircraft.pos);
    }
    this.startedAt = now;
    this.sm.set(MS.DEPLOYING, now);
    ctx.bus.emit('matchStarted', { aircraft: this.aircraftInfo(), squads: ctx.systems.squad.summary() });
  }

  createAircraft() {
    const { cfg, rng } = this.ctx, half = cfg.map.size / 2;
    const a = rng() * Math.PI * 2, through = { x: rng.range(-half * 0.3, half * 0.3), z: rng.range(-half * 0.3, half * 0.3) };
    const start = { x: through.x + Math.cos(a) * half * 1.3, z: through.z + Math.sin(a) * half * 1.3 };
    const end = { x: through.x - Math.cos(a) * half * 1.3, z: through.z - Math.sin(a) * half * 1.3 };
    const len = Math.hypot(end.x - start.x, end.z - start.z);
    this.aircraft = { start, end, duration: len / cfg.map.aircraftSpeed, t: 0, pos: { x: start.x, y: cfg.map.aircraftAltitude, z: start.z }, dir: { x: (end.x - start.x) / len, z: (end.z - start.z) / len } };
  }
  aircraftInfo() { const a = this.aircraft; return a && { start: a.start, end: a.end, duration: a.duration, t: a.t, altitude: this.ctx.cfg.map.aircraftAltitude }; }

  updateAircraft(dt) {
    const a = this.aircraft, { ctx } = this;
    a.t += dt;
    const k = Math.min(1, a.t / a.duration);
    a.pos.x = a.start.x + (a.end.x - a.start.x) * k; a.pos.z = a.start.z + (a.end.z - a.start.z) * k;
    const inside = Math.abs(a.pos.x) < ctx.cfg.map.size / 2 && Math.abs(a.pos.z) < ctx.cfg.map.size / 2;
    for (const p of ctx.players.values()) {
      if (!p.is(PS.AIRCRAFT)) continue;
      Object.assign(p.pos, a.pos);
      // pular só é permitido sobre o mapa (evita cair no mar)
      if (p.input.jump && inside) this.eject(p);
    }
    if (k >= 1) {
      for (const p of ctx.players.values()) if (p.is(PS.AIRCRAFT)) { p.pos.x *= 0.7; p.pos.z *= 0.7; this.eject(p); }
      this.sm.set(MS.IN_PROGRESS, ctx.now());
    }
  }
  eject(p) {
    p.vel.x = this.aircraft.dir.x * 20; p.vel.z = this.aircraft.dir.z * 20; p.vel.y = 0;
    p.setState(PS.FREEFALL, this.ctx.now());
    this.ctx.bus.emit('jumped', { playerId: p.id, x: p.pos.x, z: p.pos.z });
  }

  /**
   * Uma equipe é ELEGÍVEL se tem alguém em jogo/abatido, ou aguardando
   * retorno que ainda pode acontecer (Resurgence ativo ou 'respawn_pending').
   */
  isSquadEligible(squad) {
    const res = this.ctx.systems.resurgence;
    return squad.members.some(id => {
      const p = this.ctx.players.get(id);
      if (!p) return false;
      if (p.is(...IN_PLAY, PS.DOWNED)) return true;
      return p.is(PS.AWAITING_RESPAWN) && res.willRespawn(p);
    });
  }

  checkVictory() {
    if (!this.inMatch) return;
    const { ctx } = this, squads = [...ctx.systems.squad.squads.values()];
    const eligible = squads.filter(s => this.isSquadEligible(s));
    // colocação para as equipes que acabaram de cair
    for (const s of squads) {
      if (eligible.includes(s) || this.eliminatedSquads.has(s.id)) continue;
      this.eliminatedSquads.add(s.id);
      s.placement = eligible.length + 1;
      for (const id of s.members) {
        const p = ctx.players.get(id); if (!p) continue;
        p.stats.placement = s.placement; p.stats.survived = ctx.now() - p.stats.joinedAt;
        if (!p.is(PS.ELIMINATED)) p.setState(PS.ELIMINATED, ctx.now(), { cause: 'squadEliminated' });
      }
      ctx.bus.emit('squadEliminated', { squadId: s.id, placement: s.placement });
    }
    if (eligible.length <= 1) this.endMatch(eligible[0] ?? null);
  }

  endMatch(winner) {
    const { ctx } = this;
    if (this.sm.is(MS.ENDED)) return;
    this.winnerSquad = winner?.id ?? null;
    if (winner) {
      winner.placement = 1;
      for (const id of winner.members) { const p = ctx.players.get(id); if (p) { p.stats.placement = 1; p.stats.survived = ctx.now() - p.stats.joinedAt; } }
    }
    this.sm.set(MS.ENDED, ctx.now());
    this.endedAt = ctx.now();
    ctx.bus.emit('matchEnded', { winnerSquad: this.winnerSquad, results: this.results() });
  }

  /** Estatísticas finais por jogador (tela de vitória). */
  results() {
    return [...this.ctx.players.values()].map(p => ({
      id: p.id, name: p.name, squadId: p.squadId, placement: p.stats.placement,
      kills: p.stats.kills, damage: Math.round(p.stats.damage), survived: Math.round(p.stats.survived),
      contracts: p.stats.contracts, cash: p.stats.cashEarned, revives: p.stats.revives, deaths: p.stats.deaths,
    })).sort((a, b) => a.placement - b.placement || b.kills - a.kills);
  }
}
