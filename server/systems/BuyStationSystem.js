import { PS } from '../Player.js';

/**
 * BuyStationSystem — estações onde se gasta dinheiro.
 * Catálogo em cfg.stations.catalog (o game designer adiciona itens ali e o
 * efeito aqui em `effects`). Validação: estado, distância, preço, limites e
 * regras (ex.: recompra só até a fase configurada). O dinheiro só é debitado
 * se o efeito for aplicado.
 * Eventos: purchase, purchaseFailed
 */
export class BuyStationSystem {
  constructor(ctx) {
    this.ctx = ctx; this.stations = []; this.buybacksUsed = new Map(); this.radar = new Map();
    this.effects = {
      plates: p => this.ctx.systems.inventory.addPlates(p, 3) || 'placas cheias',
      ammo: p => { for (const s of ['primary', 'secondary']) { const w = p.inv[s]; if (w) { const def = this.ctx.cfg.weapons[w.id]; this.ctx.systems.inventory.addAmmo(p, def.ammo, def.mag * 3); } } return true; },
      heal: p => p.inv.heals < this.ctx.cfg.health.healItem.maxCarried ? (p.inv.heals++, true) : 'curas cheias',
      lethal: p => p.inv.lethal < this.ctx.cfg.equipment.lethal.maxCarried ? (p.inv.lethal++, true) : 'granadas cheias',
      weapon: (p, item) => { const old = this.ctx.systems.inventory.giveWeapon(p, item.weaponId);
        if (old && old.id !== 'sidearm') this.ctx.systems.loot.spawn('weapon', { id: old.id, mag: old.mag }, p.pos.x + 0.7, p.pos.z, this.ctx.cfg.weapons[old.id].rarity);
        const ammo = this.ctx.cfg.weapons[item.weaponId].ammo; this.ctx.systems.inventory.addAmmo(p, ammo, this.ctx.cfg.weapons[item.weaponId].mag * 2); return true; },
      radar: (p, item) => { this.radar.set(p.squadId, { until: this.ctx.now() + item.duration, radius: item.radius }); return true; },
      buyback: (p, item, msg) => this.buyback(p, item, msg),
    };
  }
  get cfg() { return this.ctx.cfg.stations; }

  spawnStations() {
    this.stations = this.cfg.enabled ? this.ctx.map.stationSpots.map((s, i) => ({ id: `E${i + 1}`, x: s.x, y: s.y ?? 0, z: s.z })) : [];
    this.buybacksUsed.clear(); this.radar.clear();
  }
  view() { return this.stations.map(s => ({ id: s.id, x: +s.x.toFixed(1), y: +s.y.toFixed(2), z: +s.z.toFixed(1) })); }

  requestBuy(p, msg) {
    const { ctx } = this, st = this.stations.find(s => s.id === msg.stationId), item = this.cfg.catalog[msg.item];
    const fail = reason => { ctx.bus.emit('purchaseFailed', { playerId: p.id, item: msg.item, reason }); return false; };
    if (!p.is(PS.ALIVE)) return fail('estado');
    if (!st) return fail('estação inválida');
    if (!item || !this.effects[msg.item]) return fail('item inválido');
    if (Math.hypot(st.x - p.pos.x, st.z - p.pos.z) > this.cfg.interactRange) return fail('longe da estação');
    if (p.inv.cash < item.price) return fail('dinheiro insuficiente');
    const r = this.effects[msg.item](p, item, msg);
    if (r !== true) return fail(typeof r === 'string' ? r : 'não aplicável');
    ctx.systems.inventory.spendCash(p, item.price);
    ctx.log.info(`${p.name} comprou ${item.name}`);
    ctx.bus.emit('purchase', { playerId: p.id, squadId: p.squadId, item: msg.item, name: item.name, price: item.price, targetId: msg.targetId ?? null });
    return true;
  }

  /** Recompra: traz um aliado aguardando ou eliminado de volta imediatamente. */
  buyback(p, item, msg) {
    const { ctx } = this, zone = ctx.systems.zone;
    if (zone.phase + 1 > this.cfg.buybackUntilPhase) return 'recompra encerrada nesta fase';
    const used = this.buybacksUsed.get(p.squadId) ?? 0;
    if (used >= item.perMatchLimit) return 'limite de recompras';
    const mates = ctx.systems.squad.teammates(p).filter(m => m.is(PS.AWAITING_RESPAWN, PS.ELIMINATED) && m.connected !== false);
    const t = msg.targetId ? mates.find(m => m.id === msg.targetId) : mates[0];
    if (!t) return 'nenhum aliado para trazer';
    this.buybacksUsed.set(p.squadId, used + 1);
    ctx.systems.respawn.respawn(t, { bought: true, near: p });
    return true;
  }

  /** Radar ativo? Retorna raio ou 0. */
  radarFor(squadId) { const r = this.radar.get(squadId); return r && r.until > this.ctx.now() ? r.radius : 0; }
}
