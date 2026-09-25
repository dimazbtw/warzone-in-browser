import { Pool } from '../core/Pool.js';
import { SpatialGrid } from '../core/SpatialGrid.js';
import { PS } from '../Player.js';

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/**
 * LootSystem — loot e baús são estado do servidor.
 * - Spawn inicial nos pontos do mapa (cômodos, telhados, áreas externas)
 * - Baús de suprimento: segurar interagir (ação de 0,7 s) → solta 4-6 itens
 * - Coleta validada (estado, distância 3D, existência). Dois jogadores no mesmo
 *   item: o primeiro pedido processado vence, o outro recebe 'pickupFailed'.
 * - Coleta automática opcional (dinheiro, munição, placas); drop ao morrer.
 * Eventos: lootSpawned, lootRemoved, pickup, pickupFailed, chestOpened, chestFailed
 */
export class LootSystem {
  constructor(ctx) {
    this.ctx = ctx; this.items = new Map(); this.chests = new Map(); this.nextId = 1; this.grid = new SpatialGrid(16);
    this.pool = new Pool(() => ({}), o => { for (const k in o) delete o[k]; }, 64);
    ctx.bus.on('died', ({ victimId }) => this.dropInventory(ctx.players.get(victimId)));
  }

  spawn(type, data, x, z, rarity = 'common', y = null) {
    const it = this.pool.acquire();
    const gy = y ?? this.ctx.map.groundHeight(x, z, 500);
    Object.assign(it, { id: `L${this.nextId++}`, type, data, rarity, x, y: gy, z });
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
  chestsView() { return [...this.chests.values()].map(c => ({ id: c.id, x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2), rot: c.rot, opened: c.opened })); }

  rollRarity(boost = 0) {
    const w = Object.entries(this.ctx.cfg.loot.rarityWeights).map(([r, weight], i) => ({ r, weight: weight * (1 + boost * i) }));
    return this.ctx.rng.weighted(w).r;
  }
  /** Arma primária aleatória com raridade (a raridade vira acessórios no WeaponSystem). */
  rollWeapon(boost = 0) {
    const { cfg, rng } = this.ctx, rarity = this.rollRarity(boost);
    // primárias sempre; pistolas também aparecem, com menos frequência
    const pool = Object.entries(cfg.weapons).filter(([, w]) => w.slot === 'primary' || rng() < 0.35);
    const [id, w] = rng.pick(pool);
    const mag = Math.round(w.mag * (cfg.rarity?.[rarity]?.mag ?? 1));
    return { type: 'weapon', data: { id, mag, rarity }, rarity };
  }
  /** Item aleatório pela tabela. */
  roll(boost = 0) {
    const { cfg, rng } = this.ctx, L = cfg.loot, t = rng.weighted(L.table).type;
    if (t === 'weapon') return this.rollWeapon(boost);
    if (t === 'ammo') { const ammo = rng.pick(Object.keys(L.ammoPack)); return { type: 'ammo', data: { ammo, amount: L.ammoPack[ammo] * 2 } }; }
    if (t === 'plate') return { type: 'plate', data: { amount: rng.int(1, 3) }, rarity: 'uncommon' };
    if (t === 'cash') return { type: 'cash', data: { amount: Math.round(rng.range(...L.cashRange) / 50) * 50 } };
    if (t === 'heal') return { type: 'heal', data: { amount: 1 }, rarity: 'rare' };
    if (t === 'tactical') return { type: 'tactical', data: { amount: 1 }, rarity: 'uncommon' };
    return { type: 'lethal', data: { amount: 1 }, rarity: 'uncommon' };
  }

  spawnInitial() {
    const { ctx } = this, { cfg, rng, map } = ctx;
    for (const it of [...this.items.values()]) this.remove(it);
    const spots = [...(map.lootSpots ?? [])];
    // embaralha e usa até spawnPoints pontos
    for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
    for (const s of spots.slice(0, cfg.loot.spawnPoints)) { const r = this.roll(); this.spawn(r.type, r.data, s.x, s.z, r.rarity, s.y); }
    this.chests.clear();
    (map.chestSpots ?? []).forEach((c, i) => this.chests.set(`B${i + 1}`, { id: `B${i + 1}`, x: c.x, y: c.y, z: c.z, rot: c.rot ?? 0, opened: false }));
    ctx.log.info(`loot inicial: ${this.items.size} itens, ${this.chests.size} baús`);
  }

  near(p, it, range) { return Math.hypot(it.x - p.pos.x, it.z - p.pos.z) <= range && Math.abs(it.y - p.pos.y) < 1.8; }

  /** Aplica o item ao inventário. false = não coube (fica no chão). */
  apply(p, it) {
    const inv = this.ctx.systems.inventory, d = it.data, cfg = this.ctx.cfg;
    switch (it.type) {
      case 'weapon': {
        const old = inv.giveWeapon(p, d.id, d.mag, d.rarity ?? it.rarity);
        if (old && old.id !== 'sidearm') this.spawn('weapon', { id: old.id, mag: old.mag, rarity: old.rarity }, p.pos.x + 0.6, p.pos.z + 0.6, old.rarity ?? 'common', p.pos.y);
        const ammo = cfg.weapons[d.id].ammo; inv.addAmmo(p, ammo, cfg.loot.ammoPack[ammo]);
        return true;
      }
      case 'ammo': inv.addAmmo(p, d.ammo, d.amount); return true;
      case 'plate': return inv.addPlates(p, d.amount);
      case 'cash': inv.addCash(p, d.amount, 'loot'); return true;
      case 'heal': if (p.inv.heals >= cfg.health.healItem.maxCarried) return false; p.inv.heals++; return true;
      case 'intel': return this.ctx.systems.contracts.canPickIntel(p, d);
      case 'tactical': if ((p.inv.tactical ?? 0) >= (cfg.equipment.tactical?.maxCarried ?? 2)) return false; p.inv.tactical = (p.inv.tactical ?? 0) + 1; return true;
      case 'lethal': if (p.inv.lethal >= cfg.equipment.lethal.maxCarried) return false; p.inv.lethal++; return true;
    }
    return false;
  }

  requestPickup(p, lootId) {
    const it = this.items.get(String(lootId));
    const fail = reason => this.ctx.bus.emit('pickupFailed', { playerId: p.id, lootId, reason });
    if (!p.is(PS.ALIVE)) return fail('state');
    if (!it) return fail('gone');                          // alguém pegou antes
    if (!this.near(p, it, this.ctx.cfg.loot.pickupRange)) return fail('range');
    if (!this.apply(p, it)) return fail('full');
    this.ctx.bus.emit('pickup', { playerId: p.id, kind: it.type, data: it.data, rarity: it.rarity });
    this.remove(it);
  }

  // ------------------------------------------------ baús
  requestChest(p, chestId) {
    const c = this.chests.get(String(chestId));
    const fail = reason => this.ctx.bus.emit('chestFailed', { playerId: p.id, chestId, reason });
    if (!p.is(PS.ALIVE) || p.action) return fail('state');
    if (!c || c.opened) return fail('opened');
    if (!this.near(p, c, this.ctx.cfg.loot.chestRange ?? 2.4)) return fail('range');
    this.ctx.systems.inventory.startAction(p, 'chest', this.ctx.cfg.loot.chestTime ?? 0.7, { chestId: c.id, slow: 0, blocksFire: true, blocksAds: true });
  }
  openChest(p, chestId) {
    const c = this.chests.get(chestId); if (!c || c.opened) return;
    c.opened = true;
    const { rng } = this.ctx, items = [this.rollWeapon(0.6), { type: 'plate', data: { amount: 2 }, rarity: 'rare' }, { type: 'cash', data: { amount: rng.int(3, 9) * 100 } }];
    for (let i = 0, n = rng.int(1, 3); i < n; i++) items.push(this.roll(0.4));
    items.forEach((r, i) => {
      const a = (i / items.length) * Math.PI * 2 + c.rot;
      this.spawn(r.type, r.data, c.x + Math.cos(a) * 1.0, c.z + Math.sin(a) * 1.0, r.rarity, c.y);
    });
    this.ctx.bus.emit('chestOpened', { chestId: c.id, playerId: p.id, x: c.x, y: c.y, z: c.z });
  }

  tick() {
    const a = this.ctx.cfg.loot.autoPickup; if (!a.enabled) return;
    const near = [];
    for (const p of this.ctx.players.values()) {
      if (!p.is(PS.ALIVE)) continue;
      near.length = 0; this.grid.query(p.pos.x, p.pos.z, a.radius, near);
      for (const it of near) {
        if (!a.types.includes(it.type) || !this.near(p, it, a.radius)) continue;
        if (this.apply(p, it)) { this.ctx.bus.emit('pickup', { playerId: p.id, kind: it.type, data: it.data, auto: true }); this.remove(it); }
      }
    }
  }

  dropInventory(p) {
    if (!p?.inv || !this.ctx.cfg.loot.dropOnDeath) return;
    const list = this.ctx.systems.inventory.dropList(p);
    list.forEach((d, i) => {
      const a = (i / list.length) * Math.PI * 2;
      this.spawn(d.type, d.data, p.pos.x + Math.cos(a) * 1.1, p.pos.z + Math.sin(a) * 1.1, d.type === 'weapon' ? (d.data.rarity ?? 'common') : 'common', this.ctx.map.groundHeight(p.pos.x, p.pos.z, p.pos.y + 0.5));
    });
    p.inv.primary = null; p.inv.ammo = { pistol: 0, rifle: 0, shell: 0, sniper: 0 }; p.inv.plates = 0;
  }
}
