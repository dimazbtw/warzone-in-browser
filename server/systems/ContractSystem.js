import { PS, IN_PLAY } from '../Player.js';

/**
 * ContractSystem — objetivos opcionais por squad.
 *   hunt      (Caçada)       eliminar um jogador específico; posição revelada periodicamente
 *   scavenger (Suprimentos)  encontrar N esconderijos em sequência; o último tem loot épico
 *   capture   (Domínio)      ficar na área sem inimigos até completar o tempo
 *   survive   (Resistência)  o squad sobreviver X segundos
 *   collect   (Inteligência) coletar N itens de inteligência exclusivos do squad
 * Recompensas: dinheiro por membro, XP, loot, e desconto no retorno de aliados.
 * Tudo decidido no servidor; o cliente só pede "ativar tablet X".
 * Eventos: contractBoard, contractStarted, contractUpdate, contractCompleted, contractFailed
 */
export class ContractSystem {
  constructor(ctx) {
    this.ctx = ctx; this.boards = new Map(); this.active = new Map(); this.nextId = 1;
    ctx.bus.on('died', e => this.onDied(e));
    ctx.bus.on('pickup', e => this.onPickup(e));
    ctx.bus.on('squadEliminated', ({ squadId }) => { const c = this.active.get(squadId); if (c) this.fail(c, 'squad eliminado'); });
  }
  get cfg() { return this.ctx.cfg.contracts; }

  spawnBoards() {
    const { ctx } = this; this.boards.clear(); this.active.clear();
    if (!this.cfg.enabled) return;
    const spots = [...ctx.map.contractSpots]; const types = Object.entries(this.cfg.types).map(([id, t]) => ({ id, weight: t.weight }));
    for (let i = 0; i < Math.min(this.cfg.boards, spots.length); i++) {
      const s = spots[i], type = ctx.rng.weighted(types).id;
      this.boards.set(`C${i + 1}`, { id: `C${i + 1}`, type, x: s.x, z: s.z, taken: false });
    }
  }
  boardsView() { return [...this.boards.values()].map(b => ({ id: b.id, type: b.type, name: this.cfg.types[b.type].name, x: +b.x.toFixed(1), z: +b.z.toFixed(1), taken: b.taken })); }

  // ------------------------------------------------------------ ativar
  requestStart(p, boardId) {
    const { ctx } = this, b = this.boards.get(String(boardId));
    const fail = reason => ctx.bus.emit('contractFailed', { squadId: p.squadId, playerId: p.id, reason, start: true });
    if (!this.cfg.enabled || !p.is(PS.ALIVE)) return fail('estado');
    if (!b || b.taken) return fail('indisponível');
    if (Math.hypot(b.x - p.pos.x, b.z - p.pos.z) > this.cfg.interactRange) return fail('longe');
    if (this.active.has(p.squadId)) return fail('squad já tem contrato');
    const def = this.cfg.types[b.type], now = ctx.now();
    const c = { id: `K${this.nextId++}`, type: b.type, name: def.name, squadId: p.squadId, startedBy: p.id, startedAt: now, expiresAt: now + def.duration, progress: 0, goal: 1, data: {} };
    if (!this.setup(c, b, p)) return fail('sem alvo disponível');
    b.taken = true; this.active.set(p.squadId, c);
    ctx.bus.emit('contractBoard', { id: b.id, taken: true });
    ctx.bus.emit('contractStarted', { squadId: c.squadId, contract: this.view(c) });
  }

  pointAround(x, z, minD, maxD) {
    const { ctx } = this, h = ctx.cfg.map.size / 2 - 8;
    for (let i = 0; i < 40; i++) {
      const a = ctx.rng() * Math.PI * 2, d = ctx.rng.range(minD, maxD);
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (Math.abs(px) < h && Math.abs(pz) < h && !ctx.map.isBlocked(px, pz, 1.5) && ctx.systems.zone.isInside(px, pz, ctx.systems.zone.targetCircle())) return { x: px, z: pz };
    }
    return { x: Math.max(-h, Math.min(h, x)), z: Math.max(-h, Math.min(h, z)) };
  }

  setup(c, b, p) {
    const { ctx } = this, def = this.cfg.types[c.type];
    switch (c.type) {
      case 'hunt': {
        let best = null, bd = def.searchRadius;
        for (const o of ctx.players.values()) {
          if (o.squadId === p.squadId || !o.is(PS.ALIVE, PS.DOWNED, PS.PARACHUTE, PS.FREEFALL)) continue;
          const d = Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z); if (d < bd) { bd = d; best = o; }
        }
        if (!best) return false;
        c.data.targetId = best.id; c.data.targetName = best.name; c.data.nextReveal = 0; this.reveal(c);
        return true;
      }
      case 'scavenger': c.goal = def.caches; c.data.cache = this.pointAround(b.x, b.z, def.minDist, def.maxDist); return true;
      case 'capture': c.goal = def.time; c.data.area = { ...this.pointAround(b.x, b.z, def.minDist, def.maxDist), r: def.radius }; return true;
      case 'survive': c.goal = def.time; return true;
      case 'collect': {
        c.goal = def.items; c.data.items = [];
        for (let i = 0; i < def.items; i++) {
          const pt = this.pointAround(b.x, b.z, 15, def.radius);
          const it = ctx.systems.loot.spawn('intel', { contractId: c.id, squadId: c.squadId }, pt.x, pt.z, 'legendary');
          c.data.items.push(it.id);
        }
        return true;
      }
    }
    return false;
  }

  reveal(c) {
    const t = this.ctx.players.get(c.data.targetId); if (!t) return;
    // posição aproximada (±15 m) para não virar wallhack
    c.data.lastSeen = { x: t.pos.x + this.ctx.rng.range(-15, 15), z: t.pos.z + this.ctx.rng.range(-15, 15) };
    c.data.nextReveal = this.ctx.now() + this.cfg.types.hunt.revealEvery;
  }

  // ------------------------------------------------------------ progresso
  tick(dt) {
    const { ctx } = this, now = ctx.now();
    for (const c of [...this.active.values()]) {
      if (now >= c.expiresAt) { this.fail(c, 'tempo esgotado'); continue; }
      const members = ctx.systems.squad.members(c.squadId), up = members.filter(m => m.is(PS.ALIVE));
      const def = this.cfg.types[c.type];
      switch (c.type) {
        case 'hunt': if (now >= c.data.nextReveal) { this.reveal(c); this.update(c); } break;
        case 'scavenger': {
          const cache = c.data.cache;
          if (up.some(m => Math.hypot(m.pos.x - cache.x, m.pos.z - cache.z) <= def.cacheRadius)) {
            c.progress++;
            if (c.progress >= c.goal) { this.complete(c, cache); break; }
            ctx.systems.inventory.addCash(up[0], 150, 'contract');
            c.data.cache = this.pointAround(cache.x, cache.z, def.minDist, def.maxDist); this.update(c);
          }
          break;
        }
        case 'capture': {
          const a = c.data.area;
          const mine = up.some(m => Math.hypot(m.pos.x - a.x, m.pos.z - a.z) <= a.r);
          const enemy = [...ctx.players.values()].some(o => o.squadId !== c.squadId && o.is(PS.ALIVE) && Math.hypot(o.pos.x - a.x, o.pos.z - a.z) <= a.r);
          c.data.contested = mine && enemy;
          if (mine && !enemy) { c.progress += dt; if (Math.floor(c.progress) !== Math.floor(c.progress - dt)) this.update(c); }
          if (c.progress >= c.goal) this.complete(c);
          break;
        }
        case 'survive':
          if (members.some(m => m.is(...IN_PLAY, PS.DOWNED))) c.progress += dt;
          if (c.progress >= c.goal) this.complete(c);
          break;
      }
    }
  }

  onDied({ victimId, attackerId }) {
    const { ctx } = this;
    for (const c of [...this.active.values()]) {
      if (c.type !== 'hunt' || c.data.targetId !== victimId) continue;
      const attacker = attackerId && ctx.players.get(attackerId);
      if (attacker?.squadId === c.squadId) this.complete(c); else this.fail(c, 'alvo eliminado por outro');
    }
  }
  onPickup({ playerId, type, data }) {
    if (type !== 'intel') return;
    const c = [...this.active.values()].find(k => k.id === data.contractId); if (!c) return;
    c.progress++; if (c.progress >= c.goal) this.complete(c); else this.update(c);
  }
  /** Itens de inteligência só podem ser pegos pelo squad dono do contrato. */
  canPickIntel(p, data) { return p.squadId === data.squadId && this.active.get(p.squadId)?.id === data.contractId; }

  complete(c, at) {
    const { ctx } = this, def = this.cfg.types[c.type], members = ctx.systems.squad.members(c.squadId);
    this.active.delete(c.squadId);
    for (const m of members) {
      ctx.systems.inventory.addCash(m, def.reward.cash, 'contract');
      m.stats.xp = (m.stats.xp ?? 0) + def.reward.xp; m.stats.contracts++;
      if (m.is(PS.AWAITING_RESPAWN)) ctx.systems.resurgence.reduce(m, this.cfg.respawnReduction, 'contract');
    }
    if (def.reward.loot && at) {
      const pool = Object.entries(ctx.cfg.weapons).filter(([, w]) => w.rarity === def.reward.loot);
      if (pool.length) { const [id, w] = ctx.rng.pick(pool); ctx.systems.loot.spawn('weapon', { id, mag: w.mag }, at.x, at.z, w.rarity); }
      ctx.systems.loot.spawn('plate', { amount: 3 }, at.x + 1, at.z, 'rare');
    }
    this.cleanupIntel(c);
    ctx.log.info(`contrato ${c.name} concluído por ${c.squadId}`);
    ctx.bus.emit('contractCompleted', { squadId: c.squadId, contract: this.view(c), reward: def.reward });
  }
  fail(c, reason) {
    this.active.delete(c.squadId); this.cleanupIntel(c);
    this.ctx.bus.emit('contractFailed', { squadId: c.squadId, contract: this.view(c), reason });
  }
  cleanupIntel(c) {
    for (const id of c.data.items ?? []) { const it = this.ctx.systems.loot.items.get(id); if (it) this.ctx.systems.loot.remove(it); }
  }
  update(c) { this.ctx.bus.emit('contractUpdate', { squadId: c.squadId, contract: this.view(c) }); }

  view(c) {
    const now = this.ctx.now(), d = c.data;
    return { id: c.id, type: c.type, name: c.name, progress: +c.progress.toFixed(1), goal: c.goal, timeLeft: Math.max(0, Math.round(c.expiresAt - now)),
      target: d.targetName, lastSeen: d.lastSeen && { x: Math.round(d.lastSeen.x), z: Math.round(d.lastSeen.z) },
      cache: d.cache && { x: Math.round(d.cache.x), z: Math.round(d.cache.z) }, area: d.area && { x: Math.round(d.area.x), z: Math.round(d.area.z), r: d.area.r }, contested: !!d.contested };
  }
  viewFor(p) { const c = p.squadId && this.active.get(p.squadId); return c ? this.view(c) : null; }
}
