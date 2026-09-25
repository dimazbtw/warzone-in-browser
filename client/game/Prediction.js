import { newBody, copyBody, stepGround, stepAir, stepCrawl } from '../../shared/movement.js';

/**
 * Prediction — predição do jogador local + reconciliação com o servidor.
 * 1) cada passo de input (dt fixo) é aplicado localmente e guardado com seq
 * 2) ao chegar snapshot: volta ao estado autoritativo (seq confirmado) e
 *    reaplica os inputs ainda não confirmados
 * 3) o erro visual é suavizado (não "teleporta" a câmera em correções pequenas)
 */
export class Prediction {
  constructor(cfg, geo) {
    this.cfg = cfg; this.geo = geo; this.body = newBody(); this.pending = []; this.state = 'lobby';
    this.renderOffset = { x: 0, y: 0, z: 0 }; this.prev = { x: 0, y: 0, z: 0 }; this.corrections = 0;
  }

  step(input, dt, now, opts = {}) {
    const b = this.body, m = this.cfg.movement;
    Object.assign(this.prev, b.pos);
    if (this.state === 'alive') stepGround(b, input, dt, now, this.cfg, this.geo, opts);
    else if (this.state === 'freefall') stepAir(b, input, dt, m.freefallSpeed, m.freefallHorizontal, this.cfg, this.geo);
    else if (this.state === 'parachute') stepAir(b, input, dt, m.parachuteSpeed, m.parachuteHorizontal, this.cfg, this.geo);
    else if (this.state === 'downed') stepCrawl(b, input, dt, this.cfg.downed.moveSpeed, this.cfg, this.geo);
    else b.yaw = input.yaw;
    this.pending.push({ input, dt, now, opts });
    if (this.pending.length > 120) this.pending.shift();
  }

  reconcile(you, serverNow) {
    const predictedStates = ['alive', 'freefall', 'parachute', 'downed'];
    const stateChanged = you.s !== this.state;
    this.state = you.s;
    const b = this.body, before = { ...b.pos };
    // estado autoritativo
    b.pos.x = you.x; b.pos.y = you.y; b.pos.z = you.z; b.vel.x = you.vx; b.vel.z = you.vz; b.vel.y = you.vy ?? 0;
    b.stance = you.st; b.grounded = you.grounded ?? true; b.stamina = you.stam; b.tacActive = !!you.tac; b.sprinting = !!you.sprinting;
    b.slide = you.slide ? { ...you.slide } : null; b.mantle = you.mantle ? { ...you.mantle } : null; b.climb = you.climb ? { ...you.climb } : null;
    b.prevJump = !!you.pj; b.prevCrouch = !!you.pc;
    b.clock = you.clk ?? b.clock ?? 0; b.staminaBlockUntil = b.clock + (you.stamBlock ?? -1); b.slideCooldownUntil = b.clock + (you.slideCd ?? -1);   // relativos ao relógio do corpo
    this.pending = this.pending.filter(p => p.input.seq > you.seq);
    if (!predictedStates.includes(you.s)) { this.pending.length = 0; this.renderOffset = { x: 0, y: 0, z: 0 }; return; }
    for (const p of this.pending) this.replay(p);
    // mantém a interpolação entre passos coerente após a correção
    this.prev.x += b.pos.x - before.x; this.prev.y += b.pos.y - before.y; this.prev.z += b.pos.z - before.z;
    // suavização do erro
    const ex = before.x - b.pos.x, ey = before.y - b.pos.y, ez = before.z - b.pos.z, err = Math.hypot(ex, ey, ez);
    if (stateChanged || err > 4) this.renderOffset = { x: 0, y: 0, z: 0 };
    else if (err > 0.05) { this.renderOffset.x += ex; this.renderOffset.y += ey; this.renderOffset.z += ez; this.corrections++; }
  }
  replay(p) {
    const b = this.body, m = this.cfg.movement;
    if (this.state === 'alive') stepGround(b, p.input, p.dt, p.now, this.cfg, this.geo, p.opts);
    else if (this.state === 'freefall') stepAir(b, p.input, p.dt, m.freefallSpeed, m.freefallHorizontal, this.cfg, this.geo);
    else if (this.state === 'parachute') stepAir(b, p.input, p.dt, m.parachuteSpeed, m.parachuteHorizontal, this.cfg, this.geo);
    else if (this.state === 'downed') stepCrawl(b, p.input, p.dt, this.cfg.downed.moveSpeed, this.cfg, this.geo);
  }

  /** Posição para desenhar: interpola entre passos fixos + decai o offset de correção. */
  renderPos(alpha, dt) {
    const k = Math.exp(-dt * 12);
    this.renderOffset.x *= k; this.renderOffset.y *= k; this.renderOffset.z *= k;
    const p = this.body.pos, q = this.prev;
    return { x: q.x + (p.x - q.x) * alpha + this.renderOffset.x, y: q.y + (p.y - q.y) * alpha + this.renderOffset.y, z: q.z + (p.z - q.z) * alpha + this.renderOffset.z };
  }
  snapshotBody() { return copyBody(this.body); }
}
