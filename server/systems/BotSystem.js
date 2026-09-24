import { PS } from '../Player.js';
import { C2S } from '../../shared/protocol.js';
import { NavGrid } from './NavGrid.js';
import { RARITY_ORDER } from './LootSystem.js';

/**
 * BotSystem — bots usam EXATAMENTE a interface de input dos humanos (match.handle),
 * então passam pelas mesmas validações do servidor.
 *
 * Cérebro por bot (máquina de prioridades reavaliada ~4x/s):
 *   salto (escolhe POI) → combate (alvo visível) → reviver aliado → caçar última
 *   posição vista → cura/placas em segurança → comprar na estação → seguir o líder
 *   humano → lootear → rotação da zona → patrulha.
 * Percepção com linha de visão (paredes, terreno, fumaça), tempo de reação e erro
 * de mira dependentes da dificuldade (cfg.bots.presets).
 */
const PRESETS = {
  easy:   { reaction: 0.9,  aimError: 0.1,   headshot: 0.04, view: 80,  burst: [2, 4], pause: [0.6, 1.1], aggression: 0.3, track: 3.5, warmup: 2.2, fov: 1.2, damageVsHuman: 0.6 },
  normal: { reaction: 0.6,  aimError: 0.06,  headshot: 0.1,  view: 115, burst: [3, 6], pause: [0.4, 0.8], aggression: 0.55, track: 6, warmup: 1.5, fov: 1.6, damageVsHuman: 0.8 },
  hard:   { reaction: 0.32, aimError: 0.03,  headshot: 0.25, view: 160, burst: [4, 9], pause: [0.2, 0.45], aggression: 0.8, track: 10, warmup: 0.8, fov: 2.2, damageVsHuman: 1 },
};

export class BotSystem {
  constructor(ctx, match) { this.ctx = ctx; this.match = match; this.brain = new Map(); this.nav = null; }
  get preset() { return PRESETS[this.ctx.cfg.bots?.difficulty] ?? PRESETS.normal; }
  ensureNav() { if (!this.nav) this.nav = this.ctx.nav = new NavGrid(this.ctx.map); return this.nav; }

  brainFor(p) {
    let b = this.brain.get(p.id);
    if (!b) {
      const { rng } = this.ctx;
      b = { dropPoi: null, jumpAt: 0, path: null, pathGoal: null, pathAt: 0, wp: 0, dest: null, nextThink: 0, target: null, seenAt: 0, lastSeen: null,
        reactUntil: 0, aimYaw: 0, aimPitch: 0, burstLeft: 0, pauseUntil: 0, strafe: rng() < 0.5 ? 1 : -1, strafeUntil: 0,
        stuckPos: { x: 0, z: 0 }, stuckAt: 0, jumpTick: 0, lootId: null, chestId: null, mode: 'idle', personalAggro: rng.range(-0.2, 0.2), throwAt: 0, buyAt: 0 };
      this.brain.set(p.id, b);
    }
    return b;
  }

  tick() {
    const { ctx } = this, now = ctx.now();
    for (const p of ctx.players.values()) {
      if (!p.isBot) continue;
      const b = this.brainFor(p);
      const input = { mx: 0, mz: 0, yaw: p.yaw, pitch: 0, sprint: false, tac: false, crouch: false, prone: false, jump: false, interact: false, ads: false };
      if (p.is(PS.AIRCRAFT)) { this.aircraft(p, b, input); this.send(p, C2S.INPUT, input); continue; }
      if (p.is(PS.FREEFALL, PS.PARACHUTE)) { this.skydive(p, b, input); this.send(p, C2S.INPUT, input); continue; }
      if (!p.is(PS.ALIVE, PS.DOWNED)) { b.path = null; continue; }
      if (p.is(PS.DOWNED)) { this.downed(p, b, input); this.send(p, C2S.INPUT, input); continue; }
      if (now >= b.nextThink) { b.nextThink = now + 0.25 + ctx.rng() * 0.1; this.think(p, b, now); }
      this.act(p, b, input, now);
      this.send(p, C2S.INPUT, input);
    }
  }

  // ------------------------------------------------------------ fases aéreas
  aircraft(p, b, input) {
    const { ctx } = this, a = ctx.systems.match.aircraft; if (!a) return;
    if (!b.dropPoi) {
      const leader = this.leaderOf(p);
      const pois = ctx.map.pois ?? [];
      b.dropPoi = leader?.isBot === false && ctx.rng() < 0.85 ? null : (pois.length ? ctx.rng.pick(pois) : { x: ctx.rng.range(-120, 120), z: ctx.rng.range(-120, 120) });
      b.followJump = !b.dropPoi;
      if (b.dropPoi) {
        // salta quando a aeronave passa mais perto do POI (+ variação)
        const t = ((b.dropPoi.x - a.start.x) * a.dir.x + (b.dropPoi.z - a.start.z) * a.dir.z) / ctx.cfg.map.aircraftSpeed;
        b.jumpAt = Math.max(1.5, Math.min(a.duration - 1, t + ctx.rng.range(-3, 1)));
        b.dropTarget = { x: b.dropPoi.x + ctx.rng.range(-25, 25), z: b.dropPoi.z + ctx.rng.range(-25, 25) };
      }
    }
    if (b.followJump) {                                  // aliado de humano: salta junto com ele
      const leader = this.leaderOf(p);
      input.jump = !leader || !leader.is(PS.AIRCRAFT) || a.t > a.duration - 1.5;
      if (input.jump && !b.dropTarget) b.dropTarget = null;
    } else input.jump = a.t >= b.jumpAt;
  }
  skydive(p, b, input) {
    const leader = this.leaderOf(p);
    const tgt = b.dropTarget ?? (leader && !leader.isBot ? { x: leader.pos.x + 4, z: leader.pos.z + 4 } : null);
    if (!tgt) { input.mz = 0; return; }
    const dx = tgt.x - p.pos.x, dz = tgt.z - p.pos.z;
    input.yaw = Math.atan2(-dx, -dz); input.mz = Math.hypot(dx, dz) > 4 ? -1 : 0;
  }
  downed(p, b, input) {
    // rasteja em direção ao aliado mais próximo
    const m = this.ctx.systems.squad.standingTeammates(p)[0];
    if (!m) return;
    const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z;
    if (Math.hypot(dx, dz) > 2) { input.yaw = Math.atan2(-dx, -dz); input.mz = -1; }
  }

  // ------------------------------------------------------------ percepção / decisão
  leaderOf(p) { return this.ctx.systems.squad.teammates(p).find(m => !m.isBot) ?? null; }
  eye(p) { return { x: p.pos.x, y: p.pos.y + (p.stance === 'crouch' ? 1.1 : p.stance === 'prone' ? 0.4 : 1.6), z: p.pos.z }; }
  canSee(p, o, maxD) {
    const e = this.eye(p), t = { x: o.pos.x, y: o.pos.y + (o.is(PS.DOWNED) || o.stance === 'prone' ? 0.3 : o.stance === 'crouch' ? 0.9 : 1.3), z: o.pos.z };
    const dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z, d = Math.hypot(dx, dy, dz);
    if (d > maxD) return false;
    const dir = { x: dx / d, y: dy / d, z: dz / d };
    const wall = this.ctx.map.raycast(e, dir, d);
    if (wall !== null && wall < d - 0.6) return false;
    if (this.ctx.systems.weapons.smokeBlocks?.(e, t)) return false;
    return true;
  }

  think(p, b, now) {
    const { ctx } = this, P = this.preset, sq = ctx.systems.squad;
    // alvo: inimigo visível mais ameaçador (perto + atirando em mim)
    let best = null, bestScore = Infinity;
    for (const o of ctx.players.values()) {
      if (o === p || sq.areAllies(o, p) || !o.is(PS.ALIVE, PS.DOWNED, PS.PARACHUTE)) continue;
      const d = Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z);
      if (d > P.view) continue;
      const threat = d * (p.lastAttacker === o.id && now - p.lastDamageAt < 4 ? 0.4 : 1) * (o.is(PS.DOWNED) ? 1.8 : 1);
      // campo de visão: só nota quem está à frente (ou muito perto / quem o atacou / o alvo atual)
      let da = Math.atan2(-(o.pos.x - p.pos.x), -(o.pos.z - p.pos.z)) - p.yaw; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      const aware = Math.abs(da) < P.fov / 2 + 0.2 || d < 6 || o === b.target || (p.lastAttacker === o.id && now - p.lastDamageAt < 3);
      if (aware && threat < bestScore && this.canSee(p, o, P.view)) { bestScore = threat; best = o; }
    }
    if (best) {
      if (b.target !== best) { b.target = best; b.engagedAt = now; b.reactUntil = now + P.reaction * ctx.rng.range(0.7, 1.3) * (best.isBot ? 1 : 1.25); b.aimYaw = p.yaw; b.aimPitch = 0; }
      b.seenAt = now; b.lastSeen = { x: best.pos.x, y: best.pos.y, z: best.pos.z, id: best.id };
    } else if (b.target && now - b.seenAt > 0.8) b.target = null;
    // atacado por alguém que não vejo: vira para a direção do dano
    if (!best && p.lastAttacker && now - p.lastDamageAt < 2) { const a = ctx.players.get(p.lastAttacker); if (a) b.lastSeen = { x: a.pos.x, y: a.pos.y, z: a.pos.z, id: a.id }, b.seenAt = now - 0.5; }

    const zone = ctx.systems.zone, tc = zone.targetCircle(), inZone = zone.isInside(p.pos.x, p.pos.z, { x: zone.x, z: zone.z, r: zone.r - 4 });
    const safeFromZone = zone.isInside(p.pos.x, p.pos.z, { ...tc, r: Math.max(8, tc.r * 0.9) });
    const downedMate = sq.teammates(p).find(m => m.is(PS.DOWNED) && Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z) < 45);
    const leader = this.leaderOf(p);
    const armorMax = ctx.systems.armor.max;
    b.mode = 'patrol'; b.dest = null;
    if (b.target) { b.mode = 'fight'; return; }
    if (!inZone) { b.mode = 'rotate'; b.dest = this.zonePoint(tc, 0.55); return; }
    if (downedMate) { b.mode = 'revive'; b.dest = downedMate.pos; b.reviveId = downedMate.id; return; }
    if (b.lastSeen && now - b.seenAt < 6 && this.preset.aggression + b.personalAggro > 0.45) { b.mode = 'hunt'; b.dest = b.lastSeen; return; }
    if (now - p.lastDamageAt > 3 && (p.armor < armorMax && p.inv.plates > 0 || p.hp < 60 && p.inv.heals > 0)) { b.mode = 'heal'; return; }
    if (now >= b.buyAt) { const st = this.shopping(p); if (st) { b.mode = 'buy'; b.dest = st; return; } }
    if (!safeFromZone && zone.state === 'closing' || (!safeFromZone && zone.timer < 25)) { b.mode = 'rotate'; b.dest = this.zonePoint(tc, 0.6); return; }
    // loot / baú próximo e útil
    const loot = this.findLoot(p, b);
    if (loot) { b.mode = 'loot'; b.dest = loot; return; }
    if (leader && Math.hypot(leader.pos.x - p.pos.x, leader.pos.z - p.pos.z) > 18 && leader.is(PS.ALIVE)) { b.mode = 'follow'; b.dest = { x: leader.pos.x + ctx.rng.range(-5, 5), y: leader.pos.y, z: leader.pos.z + ctx.rng.range(-5, 5) }; return; }
    if (!b.patrol || Math.hypot(b.patrol.x - p.pos.x, b.patrol.z - p.pos.z) < 3 || !zone.isInside(b.patrol.x, b.patrol.z, tc)) b.patrol = this.zonePoint(tc, 0.7);
    b.dest = b.patrol;
  }

  zonePoint(c, frac) { const { rng } = this.ctx, a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * Math.max(4, c.r * frac); return { x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d }; }

  /** Item útil mais próximo (arma melhor, placas, munição, dinheiro, baú). */
  findLoot(p, b) {
    const { ctx } = this, L = ctx.systems.loot, inv = p.inv;
    let best = null, bestD = 38;
    const cur = inv.primary ? RARITY_ORDER.indexOf(inv.primary.rarity ?? 'common') : -1;
    for (const it of L.grid.query(p.pos.x, p.pos.z, 38)) {
      if (Math.abs(it.y - p.pos.y) > 1.8 && Math.abs(it.y - ctx.map.terrainHeight(it.x, it.z)) > 0.5) continue; // andares altos: bots não sobem escadas
      let want = false;
      if (it.type === 'weapon') want = !inv.primary || RARITY_ORDER.indexOf(it.rarity) > cur;
      else if (it.type === 'plate') want = inv.plates < 6;
      else if (it.type === 'ammo') want = inv.primary && ctx.cfg.weapons[inv.primary.id].ammo === it.data.ammo && inv.ammo[it.data.ammo] < 120;
      else if (it.type === 'cash') want = true;
      else if (it.type === 'heal') want = inv.heals < 2;
      else if (it.type === 'lethal') want = inv.lethal < 2;
      if (!want) continue;
      const d = Math.hypot(it.x - p.pos.x, it.z - p.pos.z);
      if (d < bestD) { bestD = d; best = { x: it.x, y: it.y, z: it.z, lootId: it.id }; }
    }
    for (const c of L.chests.values()) {
      if (c.opened || Math.abs(c.y - ctx.map.terrainHeight(c.x, c.z)) > 1) continue;
      const d = Math.hypot(c.x - p.pos.x, c.z - p.pos.z);
      if (d < bestD * 1.3) { bestD = d; best = { x: c.x, y: c.y, z: c.z, chestId: c.id }; }
    }
    return best;
  }
  /** Vale a pena ir a uma estação? (recompra de aliado, placas) */
  shopping(p) {
    const { ctx } = this, S = ctx.systems, cat = ctx.cfg.stations.catalog;
    if (!S.stations.stations.length) return null;
    const needBuyback = p.inv.cash >= cat.buyback.price && S.squad.teammates(p).some(m => m.is(PS.ELIMINATED, PS.AWAITING_RESPAWN) && (m.is(PS.ELIMINATED) || m.respawnRemaining > 12));
    const needPlates = p.inv.cash >= cat.plates.price + 400 && p.inv.plates < 3;
    if (!needBuyback && !needPlates) return null;
    let best = null, bd = needBuyback ? 140 : 70;
    for (const s of S.stations.stations) { const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z); if (d < bd) { bd = d; best = s; } }
    return best && { x: best.x, y: best.y ?? 0, z: best.z, stationId: best.id, buyback: needBuyback };
  }

  // ------------------------------------------------------------ ação
  act(p, b, input, now) {
    const { ctx } = this, P = this.preset;
    if (b.mode === 'fight' && b.target) return this.fight(p, b, input, now, P);
    if (b.mode === 'heal') {
      input.crouch = true;
      if (!p.action) { if (p.armor < ctx.systems.armor.max && p.inv.plates > 0) this.send(p, C2S.USE_PLATE, {}); else if (p.hp < 60 && p.inv.heals > 0) this.send(p, C2S.USE_HEAL, {}); }
      return;
    }
    const dest = b.dest; if (!dest) return;
    const d = Math.hypot(dest.x - p.pos.x, dest.z - p.pos.z);
    if (b.mode === 'revive' && d < 1.8) { input.interact = true; this.face(input, p, dest); return; }
    if (b.mode === 'loot' && d < 2.0) {
      if (dest.lootId) this.send(p, C2S.PICKUP, { lootId: dest.lootId });
      if (dest.chestId && !p.action) this.send(p, C2S.CHEST, { chestId: dest.chestId });
      b.nextThink = Math.min(b.nextThink, now + 0.8);
      return;
    }
    if (b.mode === 'buy' && d < 2.6) {
      this.send(p, C2S.BUY, { stationId: dest.stationId, item: dest.buyback ? 'buyback' : 'plates' });
      b.buyAt = now + 25; b.nextThink = now; return;
    }
    const sprint = d > 8 && b.mode !== 'hunt';
    this.moveTo(p, b, dest, input, now, sprint);
    if (b.mode === 'hunt' && d < 25) { input.sprint = false; input.crouch = ctx.rng() < 0.02 ? !input.crouch : input.crouch; }
  }

  fight(p, b, input, now, P) {
    const { ctx } = this, t = b.target, w = ctx.systems.inventory.active(p);
    const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, dist = Math.hypot(dx, dz);
    const aimH = t.is(PS.DOWNED) || t.stance === 'prone' ? 0.3 : t.stance === 'crouch' ? 0.85 : (ctx.rng() < P.headshot ? 1.62 : 1.2);
    const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(t.pos.y + aimH - (p.pos.y + 1.6), dist);
    // mira acompanha com atraso (tracking) + erro que diminui com o tempo mirando no mesmo alvo
    const k = Math.min(1, P.track / 30);
    let dyaw = wantYaw - b.aimYaw; while (dyaw > Math.PI) dyaw -= Math.PI * 2; while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    b.aimYaw += dyaw * k; b.aimPitch += (wantPitch - b.aimPitch) * k;
    // erro: distância, alvo se movendo, alvo recém-visto (aquecimento) e bot se movendo
    const tSpeed = Math.hypot(t.vel?.x ?? 0, t.vel?.z ?? 0), warm = Math.max(0, 1 - (now - (b.engagedAt ?? now)) / P.warmup);
    const err = P.aimError * (1 + Math.min(1.5, dist / 60)) * (now - b.seenAt > 0.3 ? 2 : 1) * (1 + Math.min(1, tSpeed / 6) * 0.8) * (1 + warm * 2.2) * (t.stance === 'crouch' ? 1.15 : 1);
    input.yaw = b.aimYaw + (ctx.rng() - 0.5) * err; input.pitch = b.aimPitch + (ctx.rng() - 0.5) * err;
    const def = w && ctx.cfg.weapons[w.id];
    input.ads = dist > 12;
    // movimento de combate: strafe + manter distância ideal da arma
    if (now > b.strafeUntil) { b.strafe = -b.strafe; b.strafeUntil = now + ctx.rng.range(0.6, 1.6); if (ctx.rng() < 0.15) input.crouch = true; }
    const ideal = def ? Math.min(def.range * 0.45, def.falloff[0][0] * 1.4) : 25;
    const toward = dist > ideal * 1.3 ? 1 : dist < ideal * 0.5 ? -1 : 0;
    const wx = (dx / (dist || 1)) * toward + (-dz / (dist || 1)) * b.strafe * 0.9, wz = (dz / (dist || 1)) * toward + (dx / (dist || 1)) * b.strafe * 0.9;
    const s = Math.sin(input.yaw), c = Math.cos(input.yaw);
    input.mx = wx * c - wz * s; input.mz = wx * s + wz * c;
    const len = Math.hypot(input.mx, input.mz); if (len > 1) { input.mx /= len; input.mz /= len; }
    this.unstick(p, b, input, now);
    // fumaça para se cobrir quando está apanhando
    if (p.inv.tactical > 0 && p.hp < 45 && now > (b.smokeAt ?? 0) && dist > 8) { b.smokeAt = now + 20; this.send(p, C2S.TACTICAL, { yaw: wantYaw, pitch: -0.6 }); }
    if (now < b.reactUntil) return;
    // corpo a corpo / finalização quando colado no alvo
    if (dist < 1.9 && Math.abs(t.pos.y - p.pos.y) < 1.2 && (t.is(PS.DOWNED) || !w || (w.mag === 0 && ctx.rng() < 0.3))) { this.send(p, C2S.MELEE, { yaw: wantYaw }); return; }
    // disparo em rajadas depois do tempo de reação
    if (!def || p.action?.blocksFire) return;
    if (w.mag === 0) { this.send(p, C2S.RELOAD, {}); return; }
    if (now < b.pauseUntil) return;
    if (b.burstLeft <= 0) b.burstLeft = ctx.rng.int(...P.burst);
    this.send(p, C2S.FIRE, { yaw: input.yaw, pitch: input.pitch });
    if (--b.burstLeft <= 0) b.pauseUntil = now + ctx.rng.range(...P.pause) * (def.rpm < 200 ? 2.2 : 1);
    // granada em alvo que acabou de se esconder
    if (p.inv.lethal > 0 && now > b.throwAt && dist > 10 && dist < 28 && ctx.rng() < 0.01) {
      b.throwAt = now + 12;
      this.send(p, C2S.THROW, { yaw: wantYaw, pitch: Math.min(0.9, Math.max(0.15, dist / 60)) });
    }
  }

  face(input, p, dest) { input.yaw = Math.atan2(-(dest.x - p.pos.x), -(dest.z - p.pos.z)); }

  /** Segue um caminho A* até dest (replaneja se o destino mudou ou travou). */
  moveTo(p, b, dest, input, now, sprint) {
    const nav = this.ensureNav();
    const goalMoved = !b.pathGoal || Math.hypot(b.pathGoal.x - dest.x, b.pathGoal.z - dest.z) > 4;
    if (!b.path || goalMoved || now - b.pathAt > 8) {
      b.path = nav.path(p.pos, dest) ?? [{ x: dest.x, z: dest.z }]; b.pathGoal = { x: dest.x, z: dest.z }; b.pathAt = now; b.wp = 0;
    }
    let wp = b.path[b.wp];
    while (wp && Math.hypot(wp.x - p.pos.x, wp.z - p.pos.z) < 1.3 && b.wp < b.path.length - 1) wp = b.path[++b.wp];
    if (!wp) return;
    this.face(input, p, wp); input.mz = -1; input.sprint = sprint;
    this.unstick(p, b, input, now);
  }
  unstick(p, b, input, now) {
    if (now - b.stuckAt > 1.6) {
      const moved = Math.hypot(p.pos.x - b.stuckPos.x, p.pos.z - b.stuckPos.z);
      if (moved < 0.6 && (Math.abs(input.mz) > 0.5 || Math.abs(input.mx) > 0.5)) {
        input.jump = true; b.path = null; b.strafe = -b.strafe;   // pula (vault/mantle) e replaneja
        b.jumpTick = 3;
      }
      b.stuckPos = { x: p.pos.x, z: p.pos.z }; b.stuckAt = now;
    }
    if (b.jumpTick > 0) { input.jump = true; b.jumpTick--; }
  }

  send(p, type, msg) { this.match.handle(p, { ...msg, t: type }); }
}
