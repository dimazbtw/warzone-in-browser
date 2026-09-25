import { career } from './Career.js';

/**
 * Challenges — desafios diários (3) e semanais (4), sorteados de forma determinística
 * pela data (todo mundo recebe os mesmos no mesmo dia). O progresso vem das estatísticas
 * da partida coletadas pela GameSession; ao concluir, o XP entra na carreira.
 */
const KEY = 'zr_challenges_v1';
const POOL = [
  { id: 'kills_ar',     text: n => `Elimine <b>${n}</b> operadores com fuzis de assalto`, n: 5,  stat: s => s.killsByClass.ar ?? 0 },
  { id: 'kills_smg',    text: n => `Elimine <b>${n}</b> operadores com submetralhadoras`, n: 5, stat: s => s.killsByClass.smg ?? 0 },
  { id: 'kills_pistol', text: n => `Elimine <b>${n}</b> operadores com pistolas`,         n: 3,  stat: s => s.killsByClass.pistol ?? 0 },
  { id: 'kills_scope',  text: n => `Elimine <b>${n}</b> operadores com armas de precisão`, n: 3, stat: s => (s.killsByClass.dmr ?? 0) + (s.killsByClass.sniper ?? 0) },
  { id: 'kills',        text: n => `Elimine <b>${n}</b> operadores`,                      n: 10, stat: s => s.kills },
  { id: 'revives',      text: n => `Reviva <b>${n}</b> aliados`,                          n: 3,  stat: s => s.revives },
  { id: 'contracts',    text: n => `Conclua <b>${n}</b> contratos`,                       n: 2,  stat: s => s.contracts },
  { id: 'chests',       text: n => `Abra <b>${n}</b> baús de suprimentos`,                n: 5,  stat: s => s.chests },
  { id: 'damage',       text: n => `Cause <b>${n}</b> de dano`,                           n: 2500, stat: s => s.damage },
  { id: 'top5',         text: n => `Termine no <b>top 5</b> ${n} vez(es)`,                n: 2,  stat: s => (s.placement && s.placement <= 5 ? 1 : 0) },
  { id: 'survive',      text: n => `Sobreviva <b>${n}</b> minutos no total`,              n: 20, stat: s => Math.floor((s.survived ?? 0) / 60) },
];
export const REWARD = { daily: 2500, weekly: 10000 };
const DAY = 86400000;
const dayNum = (t = Date.now()) => Math.floor((t - new Date().getTimezoneOffset() * 60000) / DAY);
const hash = n => { let x = (n * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; return (x ^ (x >>> 13)) >>> 0; };
function pick(seed, count, exclude = []) {
  const ids = POOL.filter(p => !exclude.includes(p.id)).map(p => p.id), out = [];
  for (let i = 0; out.length < count && i < 50; i++) { const id = ids[hash(seed * 31 + i) % ids.length]; if (!out.includes(id)) out.push(id); }
  return out;
}

class ChallengeStore {
  constructor() { try { this.data = JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { this.data = {}; } this.refresh(); }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* sem armazenamento */ } }
  /** Renova as listas quando vira o dia/semana. */
  refresh() {
    const d = dayNum(), w = Math.floor((d + 3) / 7), D = this.data;
    for (const k of ['daily', 'weekly']) if (D[k] && Object.keys(D[k]).some(id => !POOL.find(p => p.id === id))) { D.day = D.week = null; }
    if (D.day !== d) { D.day = d; D.daily = Object.fromEntries(pick(d, 3).map(id => [id, { p: 0, done: false }])); }
    if (D.week !== w) { D.week = w; D.weekly = Object.fromEntries(pick(w * 7919, 4).map(id => [id, { p: 0, done: false }])); }
    this.save();
  }
  list(kind) {
    this.refresh(); const mult = kind === 'weekly' ? 4 : 1;
    return Object.entries(this.data[kind]).map(([id, st]) => { const c = POOL.find(p => p.id === id), n = c.n * mult; return { id, text: c.text(n), n, p: Math.min(n, st.p), done: st.done, xp: REWARD[kind] }; });
  }
  /** Tempo até a renovação: { daily: ms, weekly: ms }. */
  resetIn() {
    const now = Date.now(), off = new Date().getTimezoneOffset() * 60000, d = dayNum();
    return { daily: (d + 1) * DAY + off - now, weekly: (Math.floor((d + 3) / 7) * 7 + 4) * DAY + off - now };
  }
  /** Aplica as estatísticas de uma partida; devolve os desafios concluídos agora (com XP). */
  record(stats) {
    this.refresh(); const done = [];
    for (const kind of ['daily', 'weekly']) {
      const mult = kind === 'weekly' ? 4 : 1;
      for (const [id, st] of Object.entries(this.data[kind])) {
        if (st.done) continue;
        const c = POOL.find(p => p.id === id), n = c.n * mult;
        st.p = Math.min(n, st.p + c.stat(stats));
        if (st.p >= n) { st.done = true; done.push({ text: c.text(n), xp: REWARD[kind] }); career.addXp(REWARD[kind]); }
      }
    }
    this.save(); return done;
  }
}
export const challenges = new ChallengeStore();
