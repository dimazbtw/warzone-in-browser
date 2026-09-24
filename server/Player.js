import { StateMachine } from './core/StateMachine.js';

/** Estados do jogador (ciclo de vida completo numa partida com Resurgence). */
export const PS = Object.freeze({
  LOBBY: 'lobby',
  AIRCRAFT: 'aircraft',
  FREEFALL: 'freefall',
  PARACHUTE: 'parachute',
  ALIVE: 'alive',
  DOWNED: 'downed',
  AWAITING_RESPAWN: 'awaiting',   // morto, mas Resurgence vai trazê-lo de volta
  ELIMINATED: 'eliminated',       // fora da partida (só espectador)
});

const AIR = [PS.AWAITING_RESPAWN, PS.ELIMINATED];
const TRANSITIONS = {
  [PS.LOBBY]: [PS.AIRCRAFT],
  [PS.AIRCRAFT]: [PS.FREEFALL, PS.ELIMINATED],
  [PS.FREEFALL]: [PS.PARACHUTE, PS.ALIVE, ...AIR],
  [PS.PARACHUTE]: [PS.ALIVE, ...AIR],
  [PS.ALIVE]: [PS.DOWNED, ...AIR],
  [PS.DOWNED]: [PS.ALIVE, ...AIR],
  [PS.AWAITING_RESPAWN]: [PS.FREEFALL, PS.ELIMINATED],
  [PS.ELIMINATED]: [],
};

/** Estados em que o jogador ainda conta para a sobrevivência do squad. */
export const IN_PLAY = [PS.AIRCRAFT, PS.FREEFALL, PS.PARACHUTE, PS.ALIVE];
/** Estados em que o jogador pode sofrer dano. */
export const DAMAGEABLE = [PS.FREEFALL, PS.PARACHUTE, PS.ALIVE, PS.DOWNED];

const HISTORY = 40; // ~1.3s a 30Hz, para compensação de lag

export class Player {
  constructor({ id, name, token, isBot = false, onStateChange }) {
    this.id = id; this.name = name; this.token = token; this.isBot = isBot;
    this.squadId = null; this.party = null;
    this.connected = true; this.disconnectedAt = 0; this.ready = false;
    this.pos = { x: 0, y: 0, z: 0 }; this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0; this.stance = 'stand'; this.grounded = true; this.ads = false;
    this.stamina = 100; this.staminaBlockUntil = 0; this.tacActive = false; this.sprinting = false;
    this.slide = null; this.mantle = null; this.climb = null; this.prevCrouch = false; this.prevJump = false; this.slideCooldownUntil = 0;
    this.input = { mx: 0, mz: 0, yaw: 0, pitch: 0, sprint: false, tac: false, crouch: false, prone: false, jump: false, ads: false, interact: false };
    this.lastSeq = 0; this.latency = 0.05;
    this.hp = 100; this.armor = 0; this.bleed = 0; this.lastDamageAt = -99; this.lastAttacker = null;
    this.inv = null;                 // preenchido pelo InventorySystem
    this.action = null;              // { type, until, data } ações com tempo (placa, cura, reviver)
    this.respawnRemaining = 0;
    this.spectating = null;
    this.stats = { kills: 0, downs: 0, damage: 0, revives: 0, deaths: 0, cashEarned: 0, contracts: 0, joinedAt: 0, survived: 0, placement: 0 };
    this.history = new Array(HISTORY); this.historyIdx = 0;
    this.sm = new StateMachine('player', PS.LOBBY, TRANSITIONS, (from, to, info) => onStateChange?.(this, from, to, info));
  }
  get state() { return this.sm.state; }
  is(...s) { return this.sm.is(...s); }
  setState(to, now, info) { return this.sm.set(to, now, info); }

  /** Grava posição para rebobinagem (lag compensation). */
  record(t) { this.history[this.historyIdx++ % HISTORY] = { t, x: this.pos.x, y: this.pos.y, z: this.pos.z, stance: this.stance }; }
  /** Posição no instante t (interpolada). */
  positionAt(t) {
    let before = null, after = null;
    for (const h of this.history) { if (!h) continue; if (h.t <= t && (!before || h.t > before.t)) before = h; if (h.t >= t && (!after || h.t < after.t)) after = h; }
    if (!before) return after ?? { ...this.pos, stance: this.stance };
    if (!after || after === before) return before;
    const k = (t - before.t) / (after.t - before.t);
    return { x: before.x + (after.x - before.x) * k, y: before.y + (after.y - before.y) * k, z: before.z + (after.z - before.z) * k, stance: k < 0.5 ? before.stance : after.stance };
  }
}
