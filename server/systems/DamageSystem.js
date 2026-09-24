import { PS, DAMAGEABLE } from '../Player.js';

/**
 * DamageSystem — único ponto de entrada para dano.
 * Ordem: validação → fogo amigo → abatido (sangramento) → armadura → vida → HealthSystem.
 * `info.source === 'zone'` ignora armadura (gás atravessa placas).
 * Eventos: damage (para hitmarker/indicador de direção)
 */
export class DamageSystem {
  constructor(ctx) { this.ctx = ctx; this.friendlyFire = false; }

  apply(attacker, victim, amount, info = {}) {
    const { ctx } = this, now = ctx.now();
    if (!victim?.is(...DAMAGEABLE) || !(amount > 0)) return 0;
    if (attacker && attacker !== victim && !this.friendlyFire && ctx.systems.squad.areAllies(attacker, victim)) return 0;
    if (attacker && attacker !== victim) victim.lastAttacker = attacker.id;
    victim.lastDamageAt = now;
    ctx.systems.inventory.cancelAction(victim, 'plate');

    // abatido: dano consome o "sangramento"; zerou = eliminado (finalizado)
    if (victim.is(PS.DOWNED)) {
      victim.bleed -= amount;
      this.report(attacker, victim, amount, info, false);
      if (victim.bleed <= 0) ctx.systems.health.kill(victim, attacker, info.source === 'zone' ? 'zone' : 'finished');
      return amount;
    }
    const toHealth = info.source === 'zone' ? amount : ctx.systems.armor.absorb(victim, amount);
    victim.hp -= toHealth;
    this.report(attacker, victim, amount, info, victim.armor <= 0 && toHealth > 0);
    if (victim.hp <= 0) ctx.systems.health.onLethal(victim, attacker, info);
    return amount;
  }

  report(attacker, victim, amount, info, armorBroken) {
    if (attacker && attacker !== victim) attacker.stats.damage += amount;
    this.ctx.bus.emit('damage', {
      attackerId: attacker?.id ?? null, victimId: victim.id, amount: Math.round(amount * 10) / 10,
      part: info.part, weapon: info.weapon, source: info.source ?? 'weapon', armorBroken,
      fromX: attacker?.pos.x, fromZ: attacker?.pos.z,
    });
  }
}
