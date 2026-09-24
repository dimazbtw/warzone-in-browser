import { PS, DAMAGEABLE } from '../Player.js';
import { clamp, lerp } from '../core/math.js';

/**
 * SafeZoneSystem — zona que encolhe em fases.
 * Cada fase: centro aleatório dentro da zona atual, raio, espera, fechamento, dano/s.
 * A última fase tem raio 0 → força o confronto final.
 * Dano da zona ignora armadura e é aplicado via DamageSystem (source: 'zone').
 * Eventos: zonePhase { phase, target, wait, close }, zoneClosing, zoneFinal
 */
export class SafeZoneSystem {
  constructor(ctx) { this.ctx = ctx; this.reset(); }
  reset() {
    const half = this.ctx.cfg.map.size / 2;
    this.x = 0; this.z = 0; this.r = half * this.ctx.cfg.zone.startRadiusFactor;
    this.from = { x: 0, z: 0, r: this.r }; this.to = { x: 0, z: 0, r: this.r };
    this.phase = -1; this.state = 'idle'; this.timer = 0; this.dps = 0;
  }
  get phases() {   // timeScale < 1 acelera a partida (modo rápido offline)
    const z = this.ctx.cfg.zone, k = z.timeScale ?? 1;
    if (k === 1) return z.phases;
    return (this._scaled ??= z.phases.map(ph => ({ ...ph, wait: ph.wait * k, close: ph.close * k })));
  }

  start() { this.reset(); this.nextPhase(); }

  nextPhase() {
    this.phase++;
    if (this.phase >= this.phases.length) { this.state = 'final'; this.ctx.bus.emit('zoneFinal', {}); return; }
    const ph = this.phases[this.phase], { rng, cfg } = this.ctx, half = cfg.map.size / 2;
    this.from = { x: this.x, z: this.z, r: this.r };
    const maxOff = Math.max(0, this.r - ph.radius) * cfg.zone.centerBias;
    const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * maxOff;
    const lim = Math.max(0, half - ph.radius - 2);
    this.to = { x: clamp(this.x + Math.cos(a) * d, -lim, lim), z: clamp(this.z + Math.sin(a) * d, -lim, lim), r: ph.radius };
    this.state = 'waiting'; this.timer = ph.wait; this.dps = ph.dps;
    this.ctx.bus.emit('zonePhase', { phase: this.phase, target: this.to, wait: ph.wait, close: ph.close, dps: ph.dps, total: this.phases.length });
  }

  tick(dt) {
    if (this.state === 'idle') return;
    if (this.state !== 'final') {
      this.timer -= dt;
      if (this.state === 'waiting' && this.timer <= 0) {
        this.state = 'closing'; this.timer = this.phases[this.phase].close;
        this.ctx.bus.emit('zoneClosing', { phase: this.phase, duration: this.timer });
      } else if (this.state === 'closing') {
        const k = 1 - Math.max(0, this.timer) / this.phases[this.phase].close;
        this.x = lerp(this.from.x, this.to.x, k); this.z = lerp(this.from.z, this.to.z, k); this.r = lerp(this.from.r, this.to.r, k);
        if (this.timer <= 0) this.nextPhase();
      }
    }
    // dano progressivo: dps da fase + 50% a cada fase adicional fora
    for (const p of this.ctx.players.values()) {
      if (!p.is(...DAMAGEABLE) || this.isInside(p.pos.x, p.pos.z)) continue;
      this.ctx.systems.damage.apply(null, p, this.dps * dt, { source: 'zone' });
    }
  }

  isInside(x, z, c = this) { return Math.hypot(x - c.x, z - c.z) <= c.r; }
  /** Círculo para onde a zona vai (usado no spawn seguro). */
  targetCircle() { return this.state === 'idle' ? { x: this.x, z: this.z, r: this.r } : this.to; }
  /** Distância até a borda segura e direção (para HUD). Negativa = dentro. */
  distanceInfo(pos) {
    const d = Math.hypot(pos.x - this.x, pos.z - this.z);
    return { outside: d - this.r, bearing: Math.atan2(this.x - pos.x, -(this.z - pos.z)) };
  }
  view() {
    return { phase: this.phase, total: this.phases.length, state: this.state, t: Math.max(0, +this.timer.toFixed(1)),
      x: +this.x.toFixed(1), z: +this.z.toFixed(1), r: +this.r.toFixed(1), to: { x: +this.to.x.toFixed(1), z: +this.to.z.toFixed(1), r: this.to.r }, dps: this.dps };
  }
}
