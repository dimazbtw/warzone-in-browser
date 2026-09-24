import { PS, IN_PLAY } from '../Player.js';

/**
 * HealthSystem
 * - Vida letal → ABATIDO (se permitido) ou eliminação
 * - Sangramento, reviver por aliado (segurar interagir perto), regeneração
 * - Wipe do squad: abatidos morrem se ninguém sobrou de pé
 * - `kill()` NÃO decide se o jogador volta: emite 'died' e o ResurgenceSystem decide.
 * Eventos: downed, revived, reviveStarted, reviveCancelled, died, killfeed
 */
export class HealthSystem {
  constructor(ctx) { this.ctx = ctx; }
  get cfg() { return this.ctx.cfg; }

  canBeDowned(p) {
    const sq = this.ctx.systems.squad;
    return this.cfg.downed.enabled && !sq.isSolo && p.is(PS.ALIVE) && sq.standingTeammates(p).length > 0;
  }

  onLethal(victim, attacker, info = {}) {
    const now = this.ctx.now();
    if (this.canBeDowned(victim)) {
      victim.hp = 0; victim.bleed = this.cfg.downed.health; victim.action = null;
      victim.setState(PS.DOWNED, now, { attackerId: attacker?.id });
      if (attacker) attacker.stats.downs++;
      this.ctx.bus.emit('downed', { victimId: victim.id, attackerId: attacker?.id ?? null, part: info.part });
      this.checkWipe(victim.squadId, attacker);
    } else {
      this.kill(victim, attacker, info.source === 'zone' ? 'zone' : info.part === 'head' ? 'headshot' : 'weapon');
    }
  }

  /** Morte. Crédito vai para quem atacou por último (até 15 s atrás) se morreu no gás/sangramento. */
  kill(victim, attacker, cause) {
    const { ctx } = this, now = ctx.now();
    if (victim.is(PS.AWAITING_RESPAWN, PS.ELIMINATED)) return;
    if (!attacker && victim.lastAttacker && now - victim.lastDamageAt < 15) attacker = ctx.players.get(victim.lastAttacker) ?? null;
    if (attacker === victim) attacker = null;
    victim.hp = 0; victim.armor = 0; victim.bleed = 0; victim.action = null; victim.stats.deaths++;
    if (attacker && !ctx.systems.squad.areAllies(attacker, victim)) {
      attacker.stats.kills++;
      ctx.systems.inventory.addCash(attacker, ctx.cfg.loot.killCash, 'kill');
    }
    ctx.bus.emit('killfeed', { attackerId: attacker?.id ?? null, attacker: attacker?.name ?? null, victimId: victim.id, victim: victim.name, cause });
    ctx.bus.emit('died', { victimId: victim.id, attackerId: attacker?.id ?? null, cause });   // → Resurgence / Loot / Contracts
    this.checkWipe(victim.squadId, attacker);
  }

  checkWipe(squadId, attacker) {
    const sq = this.ctx.systems.squad;
    if (!sq.isWiped(squadId) || !this.cfg.downed.wipeEliminatesDowned) return;
    for (const m of sq.members(squadId)) if (m.is(PS.DOWNED)) this.kill(m, attacker, 'squadWipe');
  }

  tick(dt) {
    const { ctx } = this, now = ctx.now(), d = this.cfg.downed, h = this.cfg.health;
    for (const p of ctx.players.values()) {
      if (p.is(PS.DOWNED)) {
        p.bleed -= (d.health / d.bleedoutTime) * dt;
        if (p.bleed <= 0) this.kill(p, null, 'bleedout');
      } else if (p.is(PS.ALIVE)) {
        if (now - p.lastDamageAt > h.regenDelay && p.hp < h.max) p.hp = Math.min(h.max, p.hp + h.regenPerSecond * dt);
        this.tickRevive(p, now);
      }
    }
  }

  /** Reviver: aliado ALIVE segurando "interagir" perto de um companheiro abatido. */
  tickRevive(p, now) {
    const d = this.cfg.downed, a = p.action;
    if (a?.type === 'revive') {
      const t = this.ctx.players.get(a.targetId);
      const ok = p.input.interact && t?.is(PS.DOWNED) && Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) <= d.reviveRange + 0.5;
      if (!ok) { p.action = null; this.ctx.bus.emit('reviveCancelled', { playerId: p.id, targetId: a.targetId }); return; }
      if (now >= a.until) {
        p.action = null; p.stats.revives++;
        t.hp = 30; t.bleed = 0; t.lastDamageAt = now;
        t.setState(PS.ALIVE, now, { reviverId: p.id });
        this.ctx.bus.emit('revived', { playerId: t.id, reviverId: p.id });
      }
      return;
    }
    if (!p.input.interact || p.action) return;
    const target = this.ctx.systems.squad.teammates(p).find(m => m.is(PS.DOWNED) && Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z) <= d.reviveRange);
    if (target) {
      this.ctx.systems.inventory.startAction(p, 'revive', d.reviveTime, { targetId: target.id, slow: 0, blocksFire: true, blocksAds: true });
      this.ctx.bus.emit('reviveStarted', { playerId: p.id, targetId: target.id, duration: d.reviveTime });
    }
  }
}

export { IN_PLAY };
