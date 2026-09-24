import { PS, IN_PLAY } from '../Player.js';

/**
 * ResurgenceSystem — retorno baseado em tempo.
 *
 * Ao morrer ('died'):
 *   - ativo + (solo OU há companheiro de pé/abatido OU regra desligada) → AGUARDANDO RETORNO
 *   - caso contrário → ELIMINADO
 * Relógio: corre a 1x + `allyAliveSpeedup` por aliado de pé.
 * Eliminações do squad descontam `killReduction` s (respeitando `minTime`).
 * Desativação: ao iniciar a fase `disableAtPhase` da zona (ou manualmente).
 *   onDisable = 'respawn_pending' → quem já aguardava ainda volta
 *   onDisable = 'eliminate_pending' → quem aguardava é eliminado
 * Eventos: awaitingRespawn, respawnTimer (redução), resurgenceDisabled
 */
export class ResurgenceSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.active = ctx.cfg.resurgence.enabled;
    ctx.bus.on('died', e => this.onDied(e));
    ctx.bus.on('zonePhase', ({ phase }) => { if (phase + 1 >= ctx.cfg.resurgence.disableAtPhase) this.disable('zone'); });
  }
  get cfg() { return this.ctx.cfg.resurgence; }

  /** Pode este jogador (que aguarda) ainda voltar? Usado pela checagem de vitória. */
  willRespawn(p) {
    if (!p.is(PS.AWAITING_RESPAWN)) return false;
    if (this.active) return true;
    return this.cfg.onDisable === 'respawn_pending';
  }

  onDied({ victimId, attackerId }) {
    const { ctx } = this, p = ctx.players.get(victimId), now = ctx.now(), sq = ctx.systems.squad;
    if (!p) return;
    const teammateUp = sq.teammates(p).some(m => m.is(...IN_PLAY, PS.DOWNED));
    const eligible = this.active && (sq.isSolo || !this.cfg.requireLivingTeammate || teammateUp);
    if (eligible) {
      p.respawnRemaining = this.cfg.baseTime; p.respawnStartedAt = now;
      p.setState(PS.AWAITING_RESPAWN, now);
      ctx.bus.emit('awaitingRespawn', { playerId: p.id, time: p.respawnRemaining });
    } else {
      p.setState(PS.ELIMINATED, now, { cause: this.active ? 'squadWiped' : 'resurgenceOff' });
    }
    // squad inteiro fora de jogo → todos que aguardavam são eliminados (wipe)
    if (!sq.isSolo && this.cfg.requireLivingTeammate && !sq.members(p.squadId).some(m => m.is(...IN_PLAY, PS.DOWNED))) {
      for (const m of sq.members(p.squadId)) if (m.is(PS.AWAITING_RESPAWN)) m.setState(PS.ELIMINATED, now, { cause: 'squadWiped' });
    }
    // desconto por eliminação feita pelo squad do atacante
    const attacker = attackerId && ctx.players.get(attackerId);
    if (attacker && this.cfg.killReductionEnabled) {
      for (const m of sq.members(attacker.squadId)) if (m.is(PS.AWAITING_RESPAWN)) this.reduce(m, this.cfg.killReduction, 'kill');
    }
  }

  reduce(p, seconds, reason) {
    const elapsed = this.ctx.now() - p.respawnStartedAt;
    const floor = Math.max(0, this.cfg.minTime - elapsed);
    p.respawnRemaining = Math.max(floor, p.respawnRemaining - seconds);
    this.ctx.bus.emit('respawnTimer', { playerId: p.id, remaining: p.respawnRemaining, reason });
  }

  disable(reason = 'manual') {
    if (!this.active) return;
    this.active = false;
    const now = this.ctx.now();
    this.ctx.log.info(`Resurgence desativado (${reason})`);
    if (this.cfg.onDisable === 'eliminate_pending')
      for (const p of this.ctx.players.values()) if (p.is(PS.AWAITING_RESPAWN)) p.setState(PS.ELIMINATED, now, { cause: 'resurgenceOff' });
    this.ctx.bus.emit('resurgenceDisabled', { reason });
  }

  tick(dt) {
    const sq = this.ctx.systems.squad;
    for (const p of this.ctx.players.values()) {
      if (!p.is(PS.AWAITING_RESPAWN)) continue;
      const allies = sq.standingTeammates(p).length;
      p.respawnRemaining -= dt * (1 + this.cfg.allyAliveSpeedup * allies);
      if (p.respawnRemaining <= 0) this.ctx.systems.respawn.respawn(p);
    }
  }
}
