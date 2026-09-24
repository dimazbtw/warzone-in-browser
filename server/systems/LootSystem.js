import { Pool } from '../core/Pool.js';
import { SpatialGrid } from '../core/SpatialGrid.js';
import { PS } from '../Player.js';

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/**
 * LootSystem — loot é estado do servidor.
 * - Spawn inicial por tabela ponderada + raridade
 * - Pedido de coleta validado (estado, distância, existência). Como a simulação
 *   é single-thread por tick, dois jogadores pegando o mesmo item: o primeiro
 *   pedido processado vence, o segundo recebe 'pickupFailed'.
 * - Coleta automática opcional (dinheiro, munição, placas)
 * - Drop de inventário ao morrer
 * Eventos: lootSpawned, lootRemoved, pickup, pickupFailed
 */
export class LootSystem {
  constructor(ctx) {
    this.ctx = ctx; this.items = new Map(); this.nextId = 1; this.grid = new SpatialGrid(16);
    this.pool = new Pool(() => ({}), o => { for (const k in o) delete o[k]; }, 64);
    ctx.bus.on('died', ({ victimId }) => this.dropInventory(ctx.players.get(victimId)));
  }

  spawn(type, data, x, z, rarity = 'common') {
    const it = this.pool.acquire();
    Object.assign(it, { id: `L${this.nextId++}`, type, data, rarity, x, y: this.ctx.map.groundHeight(x, z), z });
    this.items.set(it.id, it); this.grid.update(it, x, z);
    this.ctx.bus.emit('lootSpawned', { item: this.view(it) });
    return it;
  }
  remove(it) {
    this.items.delete(it.id); this.grid.remove(it);
    this.ctx.bus.emit('lootRemoved', { id: it.id });
    this.pool.release(it);
  }
  view(it) { return { id: it.id, type: it.type, data: it.data, rarity: it.rarity, x: +it.x.toFixed(2), y: +it.y.toFixed(2), z: +it.z.toFixed(2) }; }
  all() { return [...this.items.values()].map(it => this.view(it)); }

  /** Gera um item aleatório pela tabela. */
  roll() {
    const { cfg, rng } = this.ctx, L = cfg.loot, t = rng.weighted(L.table).type;
    if (t === 'weapon') {
      const rarity = rng.weighted(Object.entries(L.rarityWeights).map(([r, w]) => ({ r, weight: w }))).r;
      // arma com raridade <= sorteada (fallback para qualquer)
      const idx = RARITY_ORDER.indexOf(rarity);
      const pool = Object.entries(cfg.weapons).filter(([, w]) => RARITY_ORDER.indexOf(w.rarity) <= idx && w.slot === 'primary');
      const [id, w] = rng.pick(pool.length ? pool : Object.entries(cfg.weapons));
      return { type: 'weapon', data: { id, mag: w.mag }, rarity: w.rarity };
    }
    if (t === 'ammo') { const ammo = rng.pick(Object.keys(L.ammoPack)); return { type: 'ammo', data: { ammo, amount: L.ammoPack[ammo] * 2 } }; }
    if (t === 'plate') return { type: 'plate', data: { amount: rng.int(1, 3) }, rarity: 'uncommon' };
    if (t === 'cash') return { type: 'cash', data: { amount: Math.round(rng.range(...L.cashRange) / 50) * 50 } };
    if (t === 'heal') return { type: 'heal', data: { amount: 1 }, rarity: 'rare' };
    return { type: 'lethal', data: { amount: 1 }, rarity: 'uncommon' };
  }

  spawnInitial() {
    const { cfg, rng } = this.ctx, h = cfg.map.size / 2 - 5;
    for (const it of this.items.values()) this.remove(it);
    for (let i = 0; i < cfg.loot.spawnPoints; i++) {
      const x = rng.range(-h, h), z = rng.range(-h, h);
      if (this.ctx.map.isBlocked(x, z, 0.5)) continue;
      const r = this.roll(); this.spawn(r.type, r.data, x, z, r.rarity);
    }
    this.ctx.log.info(`loot inicial: ${this.items.size} itens`);
  }

  /** Aplica o item ao inventário. Retorna false se não couber (item fica no chão). */
  apply(p, it) {
    const inv = this.ctx.systems.inventory, d = it.data;
    switch (it.type) {
      case 'weapon': {
        const old = inv.giveWeapon(p, d.id, d.mag);
        if (old && old.id !== 'sidearm') this.spawn('weapon', { id: old.id, mag: old.mag }, p.pos.x + 0.6, p.pos.z + 0.6, this.ctx.cfg.weapons[old.id].rarity);
        const ammo = this.ctx.cfg.weapons[d.id].ammo; inv.addAmmo(p, ammo, this.ctx.cfg.loot.ammoPack[ammo]);
        return true;
      }
      case 'ammo': inv.addAmmo(p, d.ammo, d.amount); return true;
      case 'plate': return inv.addPlates(p, d.amount);
      case 'cash': inv.addCash(p, d.amount, 'loot'); return true;
      case 'heal': if (p.inv.heals >= this.ctx.cfg.health.healItem.maxCarried) return false; p.inv.heals++; return true;
      case 'lethal': if (p.inv.lethal >= this.ctx.cfg.equipment.lethal.maxCarried) return false; p.inv.lethal++; return true;
    }
    return false;
  }

  requestPickup(p, lootId) {
    const it = this.items.get(String(lootId));
    const fail = reason => this.ctx.bus.emit('pickupFailed', { playerId: p.id, lootId, reason });
    if (!p.is(PS.ALIVE)) return fail('state');
    if (!it) return fail('gone');                          // alguém pegou antes
    if (Math.hypot(it.x - p.pos.x, it.z - p.pos.z) > this.ctx.cfg.loot.pickupRange) return fail('range');
    if (!this.apply(p, it)) return fail('full');
    this.ctx.bus.emit('pickup', { playerId: p.id, type: it.type, data: it.data });
    this.remove(it);
  }

  tick() {
    const a = this.ctx.cfg.loot.autoPickup; if (!a.enabled) return;
    const near = [];
    for (const p of this.ctx.players.values()) {
      if (!p.is(PS.ALIVE)) continue;
      near.length = 0; this.grid.query(p.pos.x, p.pos.z, a.radius, near);
      for (const it of near) {
        if (!a.types.includes(it.type) || Math.hypot(it.x - p.pos.x, it.z - p.pos.z) > a.radius) continue;
        if (this.apply(p, it)) { this.ctx.bus.emit('pickup', { playerId: p.id, type: it.type, data: it.data, auto: true }); this.remove(it); }
      }
    }
  }

  dropInventory(p) {
    if (!p?.inv || !this.ctx.cfg.loot.dropOnDeath) return;
    const list = this.ctx.systems.inventory.dropList(p);
    list.forEach((d, i) => {
      const a = (i / list.length) * Math.PI * 2;
      this.spawn(d.type, d.data, p.pos.x + Math.cos(a) * 1.1, p.pos.z + Math.sin(a) * 1.1, d.type === 'weapon' ? this.ctx.cfg.weapons[d.data.id].rarity : 'common');
    });
    p.inv.primary = null; p.inv.ammo = { pistol: 0, rifle: 0, shell: 0, sniper: 0 }; p.inv.plates = 0;
  }
}
