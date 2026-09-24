import { PS } from '../Player.js';

/**
 * InventorySystem — inventário simples e rápido, 100% no servidor.
 * Slots: primary, secondary. Recursos: munição por tipo, placas, curas, letais, dinheiro.
 * Ações com duração (recarregar, placa, cura) passam por `startAction`, que
 * o servidor conclui no tick — o cliente só pede, nunca "termina" uma ação.
 */
export class InventorySystem {
  constructor(ctx) { this.ctx = ctx; }

  weapon(id, rarity = 'common') { const w = this.ctx.cfg.weapons[id]; return w && { id, rarity, mag: Math.round(w.mag * (this.ctx.cfg.rarity?.[rarity]?.mag ?? 1)), nextFireAt: 0 }; }

  init(p, kind) {
    const cfg = this.ctx.cfg, kit = kind === 'respawn' ? cfg.resurgence.basicKit : null;
    p.inv = {
      primary: null, secondary: this.weapon('sidearm'), active: 'secondary',
      ammo: { pistol: 42, rifle: 0, shell: 0, sniper: 0 },
      plates: kit ? kit.plates : cfg.health.plates.startPlates,
      heals: kit ? 0 : 1,
      lethal: kit ? kit.lethal : 1,
      tactical: kit ? 0 : 1,
      cash: p.inv?.cash ?? 0,              // dinheiro é mantido entre vidas
    };
    if (kit) for (const w of kit.weapons) this.giveWeapon(p, w);
    p.armor = kit ? kit.armorPlates * cfg.health.plates.hpPerPlate : 0;
    p.action = null;
  }

  magSize(w) { return Math.round(this.ctx.cfg.weapons[w.id].mag * (this.ctx.cfg.rarity?.[w.rarity]?.mag ?? 1)); }
  active(p) { return p.inv?.[p.inv.active] ?? null; }

  /** Coloca a arma no slot dela; devolve a arma antiga (vira loot no chão). */
  giveWeapon(p, id, mag, rarity = 'common') {
    const def = this.ctx.cfg.weapons[id]; if (!def) return null;
    const slot = def.slot, old = p.inv[slot];
    p.inv[slot] = this.weapon(id, rarity); if (mag !== undefined) p.inv[slot].mag = mag;
    p.inv.active = slot; this.cancelAction(p, 'reload');
    return old;
  }
  addAmmo(p, type, n) { p.inv.ammo[type] = (p.inv.ammo[type] ?? 0) + n; }
  addPlates(p, n) { const max = this.ctx.cfg.health.plates.maxCarried, can = Math.min(n, max - p.inv.plates); p.inv.plates += Math.max(0, can); return can > 0; }
  addCash(p, n, reason = '') {
    p.inv.cash += n; if (n > 0) p.stats.cashEarned += n;
    this.ctx.bus.emit('cash', { playerId: p.id, amount: n, total: p.inv.cash, reason });
  }
  spendCash(p, n) { if (p.inv.cash < n) return false; p.inv.cash -= n; return true; }

  // ---------- ações com tempo ----------
  startAction(p, type, duration, extra = {}) {
    if (p.action) return false;
    p.action = { type, started: this.ctx.now(), until: this.ctx.now() + duration, ...extra };
    return true;
  }
  cancelAction(p, type) { if (p.action && (!type || p.action.type === type)) p.action = null; }

  requestReload(p) {
    const w = this.active(p); if (!w || !p.is(PS.ALIVE)) return;
    const def = this.ctx.cfg.weapons[w.id];
    if (w.mag >= this.magSize(w) || !p.inv.ammo[def.ammo]) return;
    this.startAction(p, 'reload', def.reload, { slow: 0.8 });
  }
  requestSwitch(p, slot) {
    if (!p.is(PS.ALIVE) || !['primary', 'secondary'].includes(slot) || !p.inv[slot]) return;
    this.cancelAction(p, 'reload'); p.inv.active = slot;
    p.inv[slot].nextFireAt = Math.max(p.inv[slot].nextFireAt, this.ctx.now() + 0.35);
  }
  requestPlate(p) {
    const h = this.ctx.cfg.health.plates;
    if (!p.is(PS.ALIVE) || p.inv.plates <= 0 || p.armor >= h.maxEquipped * h.hpPerPlate) return;
    this.startAction(p, 'plate', h.applyTime, { slow: 0.6, blocksAds: true, blocksFire: true });
  }
  requestHeal(p) {
    if (!p.is(PS.ALIVE) || p.inv.heals <= 0 || p.hp >= this.ctx.cfg.health.max) return;
    this.startAction(p, 'heal', this.ctx.cfg.health.healItem.useTime, { blocksFire: true });
  }

  tick() {
    const now = this.ctx.now();
    for (const p of this.ctx.players.values()) {
      const a = p.action; if (!a) continue;
      if (!p.is(PS.ALIVE)) { p.action = null; continue; }
      if (a.type === 'revive') continue;              // concluída pelo HealthSystem
      if (a.type === 'chest') { if (now >= a.until) { p.action = null; this.ctx.systems.loot.openChest(p, a.chestId); } continue; }
      if (now < a.until) continue;
      p.action = null;
      if (a.type === 'reload') {
        const w = this.active(p), def = this.ctx.cfg.weapons[w.id], take = Math.min(this.magSize(w) - w.mag, p.inv.ammo[def.ammo]);
        w.mag += take; p.inv.ammo[def.ammo] -= take;
      } else if (a.type === 'plate') {
        p.inv.plates--; this.ctx.systems.armor.applyPlate(p);
        if (p.input.interactPlateChain) this.requestPlate(p);
      } else if (a.type === 'heal') {
        p.inv.heals--; p.hp = Math.min(this.ctx.cfg.health.max, p.hp + this.ctx.cfg.health.healItem.heal);
      }
    }
  }

  /** Itens que caem ao morrer. */
  dropList(p) {
    const out = [];
    for (const slot of ['primary', 'secondary']) if (p.inv[slot] && p.inv[slot].id !== 'sidearm') out.push({ type: 'weapon', data: { id: p.inv[slot].id, mag: p.inv[slot].mag, rarity: p.inv[slot].rarity ?? 'common' } });
    for (const [t, n] of Object.entries(p.inv.ammo)) if (n > 0) out.push({ type: 'ammo', data: { ammo: t, amount: n } });
    if (p.inv.plates > 0) out.push({ type: 'plate', data: { amount: p.inv.plates } });
    const cash = Math.floor(p.inv.cash / 2);
    if (cash > 0) { out.push({ type: 'cash', data: { amount: cash } }); p.inv.cash -= cash; }
    return out;
  }
}
