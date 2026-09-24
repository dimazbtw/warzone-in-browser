import { Match } from '../server/Match.js';
import { makeConfig } from '../shared/config.js';
import { Logger } from '../server/core/Logger.js';
import { PS } from '../server/Player.js';
import { MS } from '../server/systems/MatchStateSystem.js';

export { PS, MS };

/** Cria partida determinística, sem bots, com contagem curta e armas sem dispersão. */
export function createMatch(overrides = {}, seed = 42) {
  const base = {
    match: { fillWithBots: false, lobbyCountdown: 1, minPlayersToStart: 2, squadSize: 2 },
    loot: { spawnPoints: 0 },
  };
  const cfg = makeConfig(deepMerge(base, overrides));
  for (const w of Object.values(cfg.weapons)) { w.spreadHip = 0; w.spreadAds = 0; }
  cfg.map.size = 420;
  const m = new Match({ cfg, seed, logger: new Logger('test', process.env.LOG_LEVEL || 'silent') });
  const map = m.ctx.map;                // mapa limpo e plano: testes de combate sem paredes
  map.boxes = []; map.terrain = null; map.buildIndex(); map.lootSpots = []; map.chestSpots = [];
  return m;
}
function deepMerge(a, b) { const o = structuredClone(a); for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) ? deepMerge(o[k] ?? {}, b[k]) : b[k]; return o; }

export const DT = 1 / 30;
export function run(m, seconds, each) { for (let t = 0; t < seconds; t += DT) { m.tick(DT); each?.(); } }
export function runUntil(m, cond, max = 120) { for (let t = 0; t < max; t += DT) { if (cond()) return true; m.tick(DT); } return cond(); }

/** Entra N jogadores, inicia e pousa todos no chão. */
export function startAndLand(m, names, parties = []) {
  const players = names.map((n, i) => m.join({ name: n, party: parties[i] }).player);
  runUntil(m, () => m.state === MS.DEPLOYING, 5);
  for (const p of players) p.input.jump = true;
  runUntil(m, () => players.every(p => !p.is(PS.AIRCRAFT)), 30);
  for (const p of players) p.input.jump = false;
  runUntil(m, () => players.every(p => p.is(PS.ALIVE)), 60);
  return players;
}

export function place(p, x, z) { p.pos.x = x; p.pos.z = z; p.pos.y = 0; p.vel.x = p.vel.z = 0; p.history.fill(undefined); }

/** yaw/pitch mirando na altura `h` do alvo. */
export function aim(from, to, h = 1.62) {
  const dx = to.pos.x - from.pos.x, dz = to.pos.z - from.pos.z, d = Math.hypot(dx, dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(to.pos.y + h - (from.pos.y + 1.6), d) };
}

/** Atira até `cond` ou esgotar tentativas (respeita cadência passando o tempo). */
export function shootUntil(m, shooter, target, cond, h = 1.2, max = 200) {
  for (let i = 0; i < max && !cond(); i++) {
    const w = m.ctx.systems.inventory.active(shooter); if (w.mag <= 1) w.mag = 30;
    m.handle(shooter, { t: 'fire', ...aim(shooter, target, h) }); m.tick(DT);
  }
  return cond();
}
