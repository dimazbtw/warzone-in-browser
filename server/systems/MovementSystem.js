import { PS } from '../Player.js';
import { clamp } from '../core/math.js';

/**
 * MovementSystem (autoritativo)
 * O cliente envia apenas intenção (mx/mz, botões, yaw/pitch). O servidor
 * integra a física, então speed-hack/teleporte não são possíveis: o máximo
 * que um cliente malicioso consegue é "apertar as teclas" perfeitamente.
 *
 * Estado atual (etapa 1): andar, sprint, sprint tático com stamina,
 * agachar, prone, pular, queda livre e paraquedas.
 * Etapa 2 adiciona slide, mantle/vault e escalada usando `ctx.map`.
 */
export class MovementSystem {
  constructor(ctx) { this.ctx = ctx; }

  /** Sanitiza o input recebido da rede (nunca confie no formato). */
  static sanitize(raw, prev) {
    const b = v => v === true;
    let mx = Number(raw.mx) || 0, mz = Number(raw.mz) || 0;
    const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    return {
      mx, mz,
      yaw: Number.isFinite(raw.yaw) ? raw.yaw % (Math.PI * 2) : prev.yaw,
      pitch: Number.isFinite(raw.pitch) ? clamp(raw.pitch, -1.5, 1.5) : prev.pitch,
      sprint: b(raw.sprint), tac: b(raw.tac), crouch: b(raw.crouch), prone: b(raw.prone),
      jump: b(raw.jump), ads: b(raw.ads), interact: b(raw.interact),
    };
  }

  tick(dt) {
    const now = this.ctx.now();
    for (const p of this.ctx.players.values()) {
      p.yaw = p.input.yaw; p.pitch = p.input.pitch;
      switch (p.state) {
        case PS.FREEFALL: this.air(p, dt, this.ctx.cfg.movement.freefallSpeed, this.ctx.cfg.movement.freefallHorizontal); break;
        case PS.PARACHUTE: this.air(p, dt, this.ctx.cfg.movement.parachuteSpeed, this.ctx.cfg.movement.parachuteHorizontal); break;
        case PS.ALIVE: this.ground(p, dt, now); break;
        case PS.DOWNED: this.crawl(p, dt); break;
        default: break;
      }
      if (p.is(PS.FREEFALL, PS.PARACHUTE, PS.ALIVE, PS.DOWNED)) this.clampToMap(p);
      p.record(now);
    }
  }

  wishDir(p) {
    const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
    // frente = (-sin, -cos); direita = (cos, -sin)
    return { x: -s * -p.input.mz + c * p.input.mx, z: -c * -p.input.mz - s * p.input.mx };
  }

  air(p, dt, fall, horiz) {
    const m = this.ctx.cfg.movement, w = this.wishDir(p);
    p.vel.x += (w.x * horiz - p.vel.x) * Math.min(1, 2 * dt);
    p.vel.z += (w.z * horiz - p.vel.z) * Math.min(1, 2 * dt);
    p.vel.y = -fall;
    p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt; p.pos.y += p.vel.y * dt;
    if (p.is(PS.FREEFALL) && (p.input.jump && p.sm.enteredAt < this.ctx.now() - 0.5 || p.pos.y <= m.autoChuteHeight)) p.setState(PS.PARACHUTE, this.ctx.now());
    const ground = this.ctx.map.groundHeight(p.pos.x, p.pos.z);
    if (p.pos.y <= ground) { p.pos.y = ground; p.vel.y = 0; p.grounded = true; p.setState(PS.ALIVE, this.ctx.now()); this.ctx.bus.emit('landed', { playerId: p.id }); }
  }

  ground(p, dt, now) {
    const m = this.ctx.cfg.movement, i = p.input;
    p.stance = i.prone ? 'prone' : i.crouch ? 'crouch' : 'stand';
    p.ads = i.ads && !p.action?.blocksAds;
    const moving = Math.hypot(i.mx, i.mz) > 0.1, forward = i.mz < -0.3;
    // stamina do sprint tático
    let tac = i.tac && forward && p.stance === 'stand' && !p.ads && now >= p.staminaBlockUntil && (p.stamina > m.stamina.minToStart || p.tacActive);
    if (tac) { p.stamina -= m.stamina.tacticalDrain * dt; if (p.stamina <= 0) { p.stamina = 0; tac = false; p.staminaBlockUntil = now + m.stamina.regenDelay; } }
    else if (now >= p.staminaBlockUntil) p.stamina = Math.min(m.stamina.max, p.stamina + m.stamina.regen * dt);
    p.tacActive = tac;
    const sprint = !tac && i.sprint && forward && p.stance !== 'prone' && !p.ads;
    if (sprint || tac) p.stance = 'stand';
    let speed = tac ? m.tacticalSprint : sprint ? m.sprint : p.stance === 'prone' ? m.prone : p.stance === 'crouch' ? m.crouch : p.ads ? m.ads : m.walk;
    if (p.action?.slow) speed *= p.action.slow;
    p.sprinting = sprint || tac;
    const w = this.wishDir(p), accel = p.grounded ? 14 : 3;
    p.vel.x += (w.x * speed * (moving ? 1 : 0) - p.vel.x) * Math.min(1, accel * dt);
    p.vel.z += (w.z * speed * (moving ? 1 : 0) - p.vel.z) * Math.min(1, accel * dt);
    if (i.jump && p.grounded && p.stance === 'stand') { p.vel.y = m.jumpVelocity; p.grounded = false; }
    p.vel.y -= m.gravity * dt;
    p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt; p.pos.y += p.vel.y * dt;
    this.ctx.map.resolve(p);
    const g = this.ctx.map.groundHeight(p.pos.x, p.pos.z);
    if (p.pos.y <= g) { p.pos.y = g; p.vel.y = 0; p.grounded = true; }
  }

  crawl(p, dt) {
    const w = this.wishDir(p), s = this.ctx.cfg.downed.moveSpeed;
    p.stance = 'prone'; p.vel.x = w.x * s; p.vel.z = w.z * s;
    p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
    this.ctx.map.resolve(p);
    p.pos.y = this.ctx.map.groundHeight(p.pos.x, p.pos.z);
  }

  clampToMap(p) { const h = this.ctx.cfg.map.size / 2 - 1; p.pos.x = clamp(p.pos.x, -h, h); p.pos.z = clamp(p.pos.z, -h, h); }
}
