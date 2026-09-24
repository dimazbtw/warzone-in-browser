/**
 * Física de movimento COMPARTILHADA — funções puras usadas pelo servidor
 * (autoridade) e pelo cliente (predição + reconciliação). Mesmo input +
 * mesmo estado inicial = mesmo resultado nos dois lados.
 *
 * "body": { pos, vel, yaw, stance, grounded, stamina, staminaBlockUntil, tacActive,
 *           sprinting, ads, slide, mantle, climb, prevCrouch, prevJump, slideCooldownUntil }
 * Retorna eventos de transição: { landed, mantled, vaulted, slid }
 */
import { clamp } from './math.js';

const FOOT_R = 0.28;   // raio dos pés para subir degraus e ficar em bordas

export const MOVE_DEFAULTS = {
  slide: { speed: 12.5, duration: 0.75, friction: 0.9, cooldown: 1.0 },
  mantle: { maxHeight: 2.8, vaultMaxHeight: 1.3, vaultMaxThickness: 1.6, baseTime: 0.3, perMeter: 0.12 },
  climb: { speed: 3.6 },
};

export function newBody() {
  return { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, stance: 'stand', grounded: true, stamina: 100, staminaBlockUntil: 0,
    tacActive: false, sprinting: false, ads: false, slide: null, mantle: null, climb: null, prevCrouch: false, prevJump: false, slideCooldownUntil: 0 };
}

/** Copia campos de movimento (para snapshot/reconciliação). */
export function copyBody(src, dst = newBody()) {
  Object.assign(dst.pos, src.pos); Object.assign(dst.vel, src.vel);
  for (const k of ['yaw', 'stance', 'grounded', 'stamina', 'staminaBlockUntil', 'tacActive', 'sprinting', 'ads', 'prevCrouch', 'prevJump', 'slideCooldownUntil']) dst[k] = src[k];
  dst.slide = src.slide && { ...src.slide }; dst.mantle = src.mantle && { ...src.mantle }; dst.climb = src.climb && { ...src.climb };
  return dst;
}

export function wishDir(yaw, input) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return { x: s * input.mz + c * input.mx, z: c * input.mz - s * input.mx };
}

/** Passo em solo (inclui slide, mantle/vault, escalada, stamina). */
export function stepGround(b, input, dt, now, cfg, geo, opts = {}) {
  const m = cfg.movement, M = { ...MOVE_DEFAULTS, ...(m.advanced || {}) }, ev = {};
  b.yaw = input.yaw;
  const crouchPressed = input.crouch && !b.prevCrouch, jumpPressed = input.jump && !b.prevJump;
  b.prevCrouch = input.crouch; b.prevJump = input.jump;
  const fwd = { x: -Math.sin(b.yaw), z: -Math.cos(b.yaw) };

  // ---------- mantle / vault em andamento (transição suave, sem input) ----------
  if (b.mantle) {
    const mt = b.mantle; mt.t += dt;
    const k = Math.min(1, mt.t / mt.dur), e = k * k * (3 - 2 * k);           // smoothstep
    b.pos.x = mt.sx + (mt.tx - mt.sx) * e; b.pos.z = mt.sz + (mt.tz - mt.sz) * e;
    b.pos.y = mt.sy + (mt.ty - mt.sy) * Math.min(1, e * 1.6) + (mt.vault ? Math.sin(e * Math.PI) * 0.4 : 0);
    b.vel.x = b.vel.y = b.vel.z = 0;
    if (k >= 1) { b.mantle = null; b.grounded = true; b.pos.y = geo.groundHeight(b.pos.x, b.pos.z, b.pos.y + 0.05); ev[mt.vault ? 'vaulted' : 'mantled'] = true; }
    return ev;
  }

  // ---------- escalada ----------
  if (b.climb) {
    const c = b.climb;
    if (input.mz > -0.3) { b.climb = null; b.vel.y = 0; }                       // soltou: cai
    else {
      b.pos.y += M.climb.speed * dt; b.vel.x = b.vel.z = b.vel.y = 0;
      if (b.pos.y >= c.top - 1.2) startMantle(b, { x: c.x, z: c.z }, c.top, false, M, fwd);
      return ev;
    }
  }

  // ---------- início de mantle / vault / escalada ----------
  if (jumpPressed && input.mz < -0.3) {
    const ob = geo.obstacleAhead(b.pos, fwd.x, fwd.z, b.grounded ? 0.9 : 0.7);
    if (ob) {
      const top = ob.box.y1, dh = top - b.pos.y;
      if (dh <= M.mantle.maxHeight) {
        const thick = geo.thickness(ob.box, ob.x, ob.z, fwd.x, fwd.z);
        if (dh <= M.mantle.vaultMaxHeight && thick <= M.mantle.vaultMaxThickness) {
          const tx = ob.x + fwd.x * (thick + 0.55), tz = ob.z + fwd.z * (thick + 0.55), ty = geo.groundHeight(tx, tz, top + 0.1);
          if (ty <= top && geo.clearAt(tx, ty, tz)) { startMantle(b, { x: tx, z: tz }, ty, true, M, fwd); return ev; }
        }
        const tx = ob.x + fwd.x * 0.45, tz = ob.z + fwd.z * 0.45;
        if (geo.clearAt(tx, top, tz, 0.3)) { startMantle(b, { x: tx, z: tz }, top, false, M, fwd); return ev; }
      } else if (ob.box.climb) { b.climb = { top, x: ob.x + fwd.x * 0.45, z: ob.z + fwd.z * 0.45 }; b.slide = null; return ev; }
    }
  }

  // ---------- postura / slide ----------
  const moving = Math.hypot(input.mx, input.mz) > 0.1, forward = input.mz < -0.3;
  if (b.slide) {
    b.slide.t += dt;
    const k = 1 - b.slide.t / M.slide.duration;
    if (k <= 0 || jumpPressed || !b.grounded) { b.slide = null; b.slideCooldownUntil = now + M.slide.cooldown; }
    else {
      b.stance = 'crouch';
      const sp = M.slide.speed * (0.35 + 0.65 * k);
      b.vel.x = b.slide.dx * sp; b.vel.z = b.slide.dz * sp;
    }
  }
  if (!b.slide) {
    if (crouchPressed && b.sprinting && b.grounded && now >= b.slideCooldownUntil) {
      const l = Math.hypot(b.vel.x, b.vel.z) || 1;
      b.slide = { t: 0, dx: b.vel.x / l, dz: b.vel.z / l }; b.stance = 'crouch'; b.sprinting = false; ev.slid = true;
      b.vel.x = b.slide.dx * M.slide.speed; b.vel.z = b.slide.dz * M.slide.speed;
    } else b.stance = input.prone ? 'prone' : input.crouch ? 'crouch' : 'stand';
  }
  b.ads = input.ads && !opts.blocksAds;

  // ---------- velocidade / stamina ----------
  if (!b.slide) {
    let tac = input.tac && forward && b.stance === 'stand' && !b.ads && now >= b.staminaBlockUntil && (b.stamina > m.stamina.minToStart || b.tacActive);
    if (tac) { b.stamina -= m.stamina.tacticalDrain * dt; if (b.stamina <= 0) { b.stamina = 0; tac = false; b.staminaBlockUntil = now + m.stamina.regenDelay; } }
    else if (now >= b.staminaBlockUntil) b.stamina = Math.min(m.stamina.max, b.stamina + m.stamina.regen * dt);
    b.tacActive = tac;
    const sprint = !tac && input.sprint && forward && b.stance !== 'prone' && !b.ads;
    if (sprint || tac) b.stance = 'stand';
    b.sprinting = sprint || tac;
    let speed = tac ? m.tacticalSprint : sprint ? m.sprint : b.stance === 'prone' ? m.prone : b.stance === 'crouch' ? m.crouch : b.ads ? m.ads : m.walk;
    if (opts.slow !== undefined) speed *= opts.slow;
    const w = wishDir(b.yaw, input), accel = b.grounded ? 14 : 3;
    b.vel.x += (w.x * speed * (moving ? 1 : 0) - b.vel.x) * Math.min(1, accel * dt);
    b.vel.z += (w.z * speed * (moving ? 1 : 0) - b.vel.z) * Math.min(1, accel * dt);
  }
  if (jumpPressed && b.grounded && b.stance !== 'prone') { b.vel.y = m.jumpVelocity; b.grounded = false; if (b.stance === 'crouch') b.stance = 'stand'; }

  // ---------- integração ----------
  b.vel.y -= m.gravity * dt;
  b.pos.x += b.vel.x * dt; b.pos.z += b.vel.z * dt; b.pos.y += b.vel.y * dt;
  geo.resolve(b);
  const g = geo.groundHeight(b.pos.x, b.pos.z, b.pos.y - b.vel.y * dt, FOOT_R);
  if (b.pos.y <= g) { if (!b.grounded && b.vel.y < -2) ev.landed = true; b.pos.y = g; b.vel.y = 0; b.grounded = true; }
  else if (b.pos.y > g + 0.05) b.grounded = false;
  clampToMap(b, cfg);
  return ev;
}

function startMantle(b, to, top, vault, M, fwd) {
  const dh = Math.max(0, top - b.pos.y);
  b.mantle = { sx: b.pos.x, sy: b.pos.y, sz: b.pos.z, tx: to.x, ty: top, tz: to.z, t: 0, dur: M.mantle.baseTime + dh * M.mantle.perMeter + (vault ? 0.15 : 0), vault };
  b.slide = null; b.climb = null; b.sprinting = false;
}

/** Passo aéreo (queda livre ou paraquedas). Retorna { landed } */
export function stepAir(b, input, dt, fall, horiz, cfg, geo) {
  b.yaw = input.yaw;
  const w = wishDir(b.yaw, input);
  b.vel.x += (w.x * horiz - b.vel.x) * Math.min(1, 2 * dt);
  b.vel.z += (w.z * horiz - b.vel.z) * Math.min(1, 2 * dt);
  b.vel.y = -fall;
  b.pos.x += b.vel.x * dt; b.pos.z += b.vel.z * dt; b.pos.y += b.vel.y * dt;
  clampToMap(b, cfg);
  const g = geo.groundHeight(b.pos.x, b.pos.z, b.pos.y - b.vel.y * dt);
  if (b.pos.y <= g) { b.pos.y = g; b.vel.y = 0; b.grounded = true; return { landed: true }; }
  return {};
}

export function stepCrawl(b, input, dt, speed, cfg, geo) {
  b.yaw = input.yaw;
  const w = wishDir(b.yaw, input);
  b.stance = 'prone'; b.vel.x = w.x * speed; b.vel.z = w.z * speed;
  b.pos.x += b.vel.x * dt; b.pos.z += b.vel.z * dt;
  geo.resolve(b); clampToMap(b, cfg);
  b.pos.y = geo.groundHeight(b.pos.x, b.pos.z, b.pos.y, FOOT_R);
}

export function clampToMap(b, cfg) { const h = cfg.map.size / 2 - 1; b.pos.x = clamp(b.pos.x, -h, h); b.pos.z = clamp(b.pos.z, -h, h); }
