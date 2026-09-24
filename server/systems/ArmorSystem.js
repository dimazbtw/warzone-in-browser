/**
 * ArmorSystem — placas de proteção.
 * `armor` é um número de pontos; cada placa vale cfg.health.plates.hpPerPlate.
 */
export class ArmorSystem {
  constructor(ctx) { this.ctx = ctx; }
  get plateHp() { return this.ctx.cfg.health.plates.hpPerPlate; }
  get max() { return this.ctx.cfg.health.plates.maxEquipped * this.plateHp; }

  /** Absorve dano e devolve o que sobra para a vida. */
  absorb(p, amount) {
    if (p.armor <= 0) return amount;
    const before = p.armor, taken = Math.min(p.armor, amount);
    p.armor -= taken;
    // quebra de placa (feedback para quem atirou)
    if (Math.ceil(before / this.plateHp) > Math.ceil(p.armor / this.plateHp)) this.ctx.bus.emit('plateBroken', { playerId: p.id, attackerId: p.lastAttacker, remaining: Math.ceil(p.armor / this.plateHp) });
    return amount - taken;
  }
  applyPlate(p) { p.armor = Math.min(this.max, p.armor + this.plateHp); this.ctx.bus.emit('plateApplied', { playerId: p.id, armor: p.armor }); }
}
