/**
 * Career — progressão persistente (localStorage): XP, nível e histórico.
 * O XP de cada partida é calculado a partir das estatísticas finais que o
 * servidor envia (matchEnded.results), nunca de contadores do cliente.
 */
const KEY = 'zr_career_v1';
const EMPTY = { xp: 0, matches: 0, wins: 0, top5: 0, kills: 0, deaths: 0, damage: 0, contracts: 0, revives: 0, timePlayed: 0, bestPlacement: null, history: [] };

export const XP_RULES = { kill: 100, damage10: 1, contract: 250, revive: 75, minute: 30, win: 1500, top5: 500, top10: 200 };

/** XP total necessário para alcançar o nível n (n começa em 1). */
export const xpForLevel = n => Math.round(400 * (n - 1) + 120 * (n - 1) ** 2);
export function levelFromXp(xp) {
  let n = 1; while (xpForLevel(n + 1) <= xp) n++;
  const cur = xpForLevel(n), next = xpForLevel(n + 1);
  return { level: n, into: xp - cur, needed: next - cur, progress: (xp - cur) / (next - cur) };
}

export function matchXp(r, totalSquads = 20) {
  const parts = [
    ['Eliminações', r.kills * XP_RULES.kill],
    ['Dano causado', Math.floor(r.damage / 10) * XP_RULES.damage10],
    ['Contratos', r.contracts * XP_RULES.contract],
    ['Reviver aliados', (r.revives ?? 0) * XP_RULES.revive],
    ['Tempo sobrevivido', Math.floor(r.survived / 60) * XP_RULES.minute],
    ['Colocação', r.placement === 1 ? XP_RULES.win : r.placement <= 5 ? XP_RULES.top5 : r.placement <= Math.max(10, totalSquads / 2) ? XP_RULES.top10 : 0],
  ].filter(([, v]) => v > 0);
  return { total: parts.reduce((s, [, v]) => s + v, 0), parts };
}

class CareerStore {
  constructor() { try { this.data = { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY)) ?? {}) }; } catch { this.data = { ...EMPTY }; } }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* sem armazenamento */ } }
  get level() { return levelFromXp(this.data.xp); }

  /** Registra o resultado de uma partida; retorna { xp, before, after } para a tela final. */
  record(r, meta = {}) {
    const d = this.data, before = levelFromXp(d.xp), xp = matchXp(r, meta.squads);
    d.xp += xp.total; d.matches++; d.kills += r.kills; d.damage += r.damage; d.contracts += r.contracts; d.revives += r.revives ?? 0;
    d.deaths += r.deaths ?? 0; d.timePlayed += r.survived;
    if (r.placement === 1) d.wins++;
    if (r.placement <= 5) d.top5++;
    d.bestPlacement = d.bestPlacement ? Math.min(d.bestPlacement, r.placement) : r.placement;
    d.history.unshift({ at: Date.now(), placement: r.placement, kills: r.kills, damage: r.damage, xp: xp.total, mode: meta.mode ?? '', survived: r.survived });
    d.history.length = Math.min(d.history.length, 20);
    this.save();
    return { xp, before, after: levelFromXp(d.xp) };
  }
  reset() { this.data = { ...EMPTY, history: [] }; this.save(); }
}
export const career = new CareerStore();
