import { PS, DAMAGEABLE } from '../Player.js';
import { dirFromAngles, raySphere, rayVerticalCapsule, clamp } from '../core/math.js';
import { Pool } from '../core/Pool.js';

/**
 * WeaponSystem
 * - Valida disparo: estado, munição, cadência (com 8% de tolerância de jitter)
 * - Dispersão (hip/ADS/movimento/postura) calculada NO SERVIDOR
 * - Modo 'hitscan': raio contra hitboxes rebobinadas (lag compensation)
 * - Modo 'projectile': projéteis simulados com gravidade (pool de objetos)
 * - Granadas (letal) com pavio e dano radial
 * O resultado vai para o DamageSystem com a parte do corpo atingida.
 */
export class WeaponSystem {
  constructor(ctx) {
    this.ctx = ctx; this.projectiles = []; this.grenades = []; this.smokes = [];
    this.pool = new Pool(() => ({ o: { x: 0, y: 0, z: 0 }, v: { x: 0, y: 0, z: 0 } }), null, 128);
  }

  requestFire(p, msg) {
    const { ctx } = this, now = ctx.now();
    if (!p.is(PS.ALIVE)) return;
    if (p.action?.type === 'plate') { ctx.systems.inventory.cancelPlates(p); return; }   // atirar cancela as placas
    if (p.inv?.active === 'knife') return this.requestMelee(p, msg);                      // faca na mão: clique golpeia
    if (p.action?.blocksFire) return;
    const w = ctx.systems.inventory.active(p); if (!w) return;
    const def = ctx.cfg.weapons[w.id];
    if (w.mag <= 0) { ctx.systems.inventory.requestReload(p); return; }
    const interval = 60 / def.rpm;
    if (now < w.nextFireAt - interval * 0.08) return;              // disparo rápido demais: ignora
    if (p.action?.type === 'reload') ctx.systems.inventory.cancelAction(p, 'reload');
    w.nextFireAt = Math.max(now, w.nextFireAt) + interval; w.mag--;
    const yaw = Number.isFinite(msg.yaw) ? msg.yaw : p.yaw, pitch = clamp(Number.isFinite(msg.pitch) ? msg.pitch : p.pitch, -1.5, 1.5);
    const eyeH = p.stance === 'prone' ? 0.4 : p.stance === 'crouch' ? 1.1 : 1.6;
    const origin = { x: p.pos.x, y: p.pos.y + eyeH, z: p.pos.z };
    const R = ctx.cfg.rarity?.[w.rarity] ?? {};
    let spread = (p.ads ? def.spreadAds : def.spreadHip) * (R.spread ?? 1);
    if (Math.hypot(p.vel.x, p.vel.z) > 1) spread *= 1.5;
    if (!p.grounded) spread *= 2;
    if (p.stance !== 'stand') spread *= 0.75;
    const rewind = now - clamp(p.latency + ctx.cfg.network.interpolationDelay, 0, ctx.cfg.combat.lagCompensationMax);
    const hits = [];
    for (let i = 0; i < (def.pellets || 1); i++) {
      const d = dirFromAngles(yaw + (ctx.rng() - 0.5) * 2 * spread, pitch + (ctx.rng() - 0.5) * 2 * spread);
      if (ctx.cfg.combat.mode === 'projectile') this.spawnProjectile(p, origin, d, w.id, w.rarity);
      else { const h = this.trace(p, origin, d, def.range * (R.range ?? 1), rewind); if (h) { hits.push(h); this.hit(p, h, w.id, w.rarity); } }
    }
    // pente zerou: recarrega sozinho (se houver munição de reserva)
    if (w.mag === 0) ctx.systems.inventory.requestReload(p);
    ctx.bus.emit('shot', { playerId: p.id, weapon: w.id, x: origin.x, y: origin.y, z: origin.z, yaw, pitch, hit: hits[0]?.point });
  }

  /** Raio contra todos os jogadores atingíveis na posição rebobinada. */
  trace(shooter, o, d, range, atTime) {
    const hb = this.ctx.cfg.combat.hitbox;
    let best = null;
    const wall = this.ctx.map.raycast(o, d, range);
    const maxT = wall ?? range;
    for (const t of this.ctx.players.values()) {
      if (t === shooter || !t.is(...DAMAGEABLE)) continue;
      const pos = atTime !== undefined ? t.positionAt(atTime) : { ...t.pos, stance: t.stance };
      if (Math.abs(pos.x - o.x) > maxT + 2 || Math.abs(pos.z - o.z) > maxT + 2) continue;
      const scale = pos.stance === 'prone' || t.is(PS.DOWNED) ? hb.proneScale : pos.stance === 'crouch' ? hb.crouchScale : 1;
      const headY = pos.y + hb.headHeight * scale;
      const th = raySphere(o, d, { x: pos.x, y: headY, z: pos.z }, hb.headRadius);
      const tb = rayVerticalCapsule(o, d, pos.x, pos.z, pos.y + hb.bodyRadius * scale, headY - hb.headRadius - hb.bodyRadius * 0.8, hb.bodyRadius);
      let hit = null;
      if (th >= 0 && (!tb || th <= tb.t)) hit = { t: th, part: 'head' };
      else if (tb) hit = { t: tb.t, part: tb.y - pos.y < 0.8 * scale ? 'limbs' : 'torso' };
      if (hit && hit.t <= maxT && (!best || hit.t < best.t)) best = { ...hit, target: t };
    }
    if (best) best.point = { x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t };
    return best;
  }

  /** Dano por distância (interpolação linear entre os pontos de falloff). */
  falloff(def, dist) {
    const f = def.falloff; if (dist <= f[0][0]) return f[0][1];
    for (let i = 1; i < f.length; i++) if (dist <= f[i][0]) { const [d0, m0] = f[i - 1], [d1, m1] = f[i]; return m0 + (m1 - m0) * (dist - d0) / (d1 - d0); }
    return f[f.length - 1][1];
  }

  hit(shooter, h, weaponId, rarity) {
    const def = this.ctx.cfg.weapons[weaponId], mult = this.ctx.cfg.combat.bodyMultipliers, R = this.ctx.cfg.rarity?.[rarity] ?? {};
    const partMult = h.part === 'head' ? (def.headMultiplier ?? mult.head) : mult[h.part];
    const dmg = def.damage * (R.damage ?? 1) * this.falloff(def, h.t / (R.range ?? 1)) * partMult;
    this.ctx.systems.damage.apply(shooter, h.target, dmg, { part: h.part, weapon: weaponId, distance: h.t });
  }

  // ---------- modo projétil ----------
  spawnProjectile(p, o, d, weaponId, rarity) {
    const pr = this.pool.acquire(), s = this.ctx.cfg.weapons[weaponId].projectileSpeed;
    Object.assign(pr.o, o); pr.v.x = d.x * s; pr.v.y = d.y * s; pr.v.z = d.z * s;
    pr.owner = p; pr.weapon = weaponId; pr.rarity = rarity; pr.traveled = 0; this.projectiles.push(pr);
  }
  tickProjectiles(dt) {
    const g = this.ctx.cfg.combat.projectileGravity;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i], def = this.ctx.cfg.weapons[pr.weapon];
      const sp = Math.hypot(pr.v.x, pr.v.y, pr.v.z), step = sp * dt, d = { x: pr.v.x / sp, y: pr.v.y / sp, z: pr.v.z / sp };
      const h = this.trace(pr.owner, pr.o, d, step);
      if (h) { h.t += pr.traveled; this.hit(pr.owner, h, pr.weapon, pr.rarity); }
      pr.o.x += pr.v.x * dt; pr.o.y += pr.v.y * dt; pr.o.z += pr.v.z * dt; pr.v.y -= g * dt; pr.traveled += step;
      if (h || pr.traveled > def.range || pr.o.y < this.ctx.map.groundHeight(pr.o.x, pr.o.z, pr.o.y)) { this.projectiles.splice(i, 1); this.pool.release(pr); }
    }
  }

  // ---------- granadas ----------
  requestThrow(p, msg) {
    const L = this.ctx.cfg.equipment.lethal;
    if (!p.is(PS.ALIVE) || p.inv.lethal <= 0 || p.action?.blocksFire) return;
    p.inv.lethal--;
    const d = dirFromAngles(Number(msg.yaw) || p.yaw, clamp(Number(msg.pitch) || p.pitch, -1.5, 1.5));
    this.grenades.push({ owner: p, x: p.pos.x, y: p.pos.y + 1.5, z: p.pos.z, vx: d.x * L.throwSpeed, vy: d.y * L.throwSpeed + 4, vz: d.z * L.throwSpeed, fuse: L.fuse });
  }
  tickGrenades(dt) {
    const L = this.ctx.cfg.equipment.lethal, G = this.ctx.cfg.movement.gravity;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.vy -= G * dt; g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      const ground = this.ctx.map.groundHeight(g.x, g.z, g.y);
      if (g.y < ground + 0.1) { g.y = ground + 0.1; g.vy *= -0.35; g.vx *= 0.6; g.vz *= 0.6; }
      g.fuse -= dt;
      if (g.fuse <= 0 && g.smoke) { this.grenades.splice(i, 1); this.popSmoke(g); continue; }
      if (g.fuse <= 0) {
        this.grenades.splice(i, 1);
        this.ctx.bus.emit('explosion', { x: g.x, y: g.y, z: g.z, radius: L.radius, ownerId: g.owner.id });
        for (const t of this.ctx.players.values()) {
          if (!t.is(...DAMAGEABLE)) continue;
          const dist = Math.hypot(t.pos.x - g.x, t.pos.y + 0.9 - g.y, t.pos.z - g.z);
          if (dist < L.radius) this.ctx.systems.damage.apply(g.owner, t, L.maxDamage * (1 - dist / L.radius), { part: 'torso', weapon: 'grenade', distance: dist });
        }
      }
    }
  }

  // ---------- corpo a corpo ----------
  /** Golpe à frente (arco); em inimigo abatido é finalização. */
  requestMelee(p, msg) {
    const { ctx } = this, M = ctx.cfg.equipment.melee, now = ctx.now();
    if (p.action?.type === 'plate') ctx.systems.inventory.cancelPlates(p);
    if (!p.is(PS.ALIVE) || p.action?.blocksFire || now < (p.meleeReadyAt ?? 0)) return;
    p.meleeReadyAt = now + M.cooldown;
    const yaw = Number.isFinite(msg.yaw) ? msg.yaw : p.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bd = M.range;
    for (const t of ctx.players.values()) {
      if (t === p || !t.is(...DAMAGEABLE) || ctx.systems.squad.areAllies(t, p)) continue;
      const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(t.pos.y - p.pos.y) > 1.6) continue;
      if (d > 0.4 && (dx * fx + dz * fz) / d < Math.cos(M.arc)) continue;
      const e = { x: p.pos.x, y: p.pos.y + 1.2, z: p.pos.z }, dir = { x: dx / (d || 1), y: 0, z: dz / (d || 1) };
      const wall = ctx.map.raycast(e, dir, d); if (wall !== null && wall < d - 0.3) continue;
      best = t; bd = d;
    }
    ctx.bus.emit('melee', { playerId: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, hit: !!best });
    if (!best) return;
    const finisher = best.is(PS.DOWNED);
    ctx.bus.emit('meleeHit', { attackerId: p.id, victimId: best.id, finisher });
    ctx.systems.damage.apply(p, best, finisher ? 999 : M.damage, { part: 'torso', weapon: 'melee', distance: bd });
  }

  // ---------- tático: fumaça ----------
  requestTactical(p, msg) {
    const T = this.ctx.cfg.equipment.tactical;
    if (!p.is(PS.ALIVE) || !(p.inv.tactical > 0) || p.action?.blocksFire) return;
    p.inv.tactical--;
    const d = dirFromAngles(Number(msg.yaw) || p.yaw, clamp(Number(msg.pitch) || p.pitch, -1.5, 1.5));
    this.grenades.push({ owner: p, smoke: true, x: p.pos.x, y: p.pos.y + 1.5, z: p.pos.z, vx: d.x * T.throwSpeed, vy: d.y * T.throwSpeed + 4, vz: d.z * T.throwSpeed, fuse: T.fuse });
  }
  popSmoke(g) {
    const T = this.ctx.cfg.equipment.tactical, now = this.ctx.now();
    this.smokes.push({ x: g.x, y: g.y + 1.5, z: g.z, r: T.radius, until: now + T.duration });
    this.ctx.bus.emit('smoke', { x: g.x, y: g.y, z: g.z, radius: T.radius, duration: T.duration, ownerId: g.owner.id });
  }
  /** O segmento a→b atravessa alguma fumaça ativa? (usado na percepção dos bots) */
  smokeBlocks(a, b) {
    if (!this.smokes.length) return false;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L2 = dx * dx + dy * dy + dz * dz || 1;
    for (const s of this.smokes) {
      const t = clamp(((s.x - a.x) * dx + (s.y - a.y) * dy + (s.z - a.z) * dz) / L2, 0, 1);
      const px = a.x + dx * t - s.x, py = (a.y + dy * t - s.y) * 1.6, pz = a.z + dz * t - s.z;
      if (px * px + py * py + pz * pz < s.r * s.r * 0.8) return true;
    }
    return false;
  }

  tick(dt) {
    this.tickProjectiles(dt); this.tickGrenades(dt);
    if (this.smokes.length) { const now = this.ctx.now(); this.smokes = this.smokes.filter(s => s.until > now); }
  }
}
