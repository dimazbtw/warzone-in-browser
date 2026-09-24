import { EventBus } from './core/EventBus.js';
import { Logger } from './core/Logger.js';
import { makeRng } from './core/math.js';
import { MapData } from './MapData.js';
import { Player, PS, IN_PLAY } from './Player.js';
import { C2S } from '../shared/protocol.js';
import { CONFIG } from '../shared/config.js';
import { MatchStateSystem, MS } from './systems/MatchStateSystem.js';
import { SquadSystem } from './systems/SquadSystem.js';
import { MovementSystem } from './systems/MovementSystem.js';
import { InventorySystem } from './systems/InventorySystem.js';
import { ArmorSystem } from './systems/ArmorSystem.js';
import { LootSystem } from './systems/LootSystem.js';
import { WeaponSystem } from './systems/WeaponSystem.js';
import { DamageSystem } from './systems/DamageSystem.js';
import { HealthSystem } from './systems/HealthSystem.js';
import { ResurgenceSystem } from './systems/ResurgenceSystem.js';
import { RespawnSystem } from './systems/RespawnSystem.js';
import { SafeZoneSystem } from './systems/SafeZoneSystem.js';
import { SpectatorSystem } from './systems/SpectatorSystem.js';
import { BotSystem } from './systems/BotSystem.js';
import { ContractSystem } from './systems/ContractSystem.js';
import { BuyStationSystem } from './systems/BuyStationSystem.js';

/** UUID que funciona no Node e no navegador (Web Worker). */
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

const BOT_NAMES = ['Aurora', 'Bento', 'Caju', 'Dara', 'Elo', 'Fumaça', 'Guará', 'Hélio', 'Iara', 'Jambo', 'Kiko', 'Lume', 'Maré', 'Nado', 'Onça', 'Pipa', 'Quartzo', 'Raio', 'Sabiá', 'Tupã', 'Urso', 'Vento', 'Xamã', 'Zepa'];

/**
 * Match — uma partida autoritativa.
 * Não conhece WebSocket: recebe mensagens via `handle(player, msg)` e expõe
 * `snapshotFor(player)`. Isso permite testar tudo headless (tests/) e trocar
 * o transporte (NetworkSystem) sem tocar em gameplay.
 *
 * Ordem do tick (importa!):
 *   match → bots → movement → inventory(ações) → weapons(projéteis/granadas)
 *   → health(sangramento/reviver/regen) → zone(dano) → resurgence(relógios)
 *   → loot(auto-pickup) → spectator → desconexões
 */
export class Match {
  constructor({ cfg = CONFIG, seed = Date.now(), logger = new Logger('match'), clock } = {}) {
    this.time = 0;
    const bus = new EventBus(logger.child('bus'));
    const ctx = this.ctx = {
      cfg, bus, log: logger, rng: makeRng(seed), now: clock ?? (() => this.time),
      players: new Map(), map: new MapData(cfg.map.size, seed % 1000), systems: {},
    };
    const S = ctx.systems;
    S.match = new MatchStateSystem(ctx);
    S.squad = new SquadSystem(ctx);
    S.movement = new MovementSystem(ctx);
    S.inventory = new InventorySystem(ctx);
    S.armor = new ArmorSystem(ctx);
    S.loot = new LootSystem(ctx);
    S.weapons = new WeaponSystem(ctx);
    S.damage = new DamageSystem(ctx);
    S.health = new HealthSystem(ctx);
    S.resurgence = new ResurgenceSystem(ctx);
    S.respawn = new RespawnSystem(ctx);
    S.zone = new SafeZoneSystem(ctx);
    S.spectator = new SpectatorSystem(ctx);
    S.contracts = new ContractSystem(ctx);
    S.stations = new BuyStationSystem(ctx);
    S.bots = new BotSystem(ctx, this);
    this.nextId = 1;
    this.tokens = new Map();   // token → playerId (reconexão)
  }
  get bus() { return this.ctx.bus; }
  get state() { return this.ctx.systems.match.state; }

  // ---------------- lobby / conexão ----------------
  /** Entra ou reconecta. Retorna { player, reconnected } ou { error }. */
  join({ name, token, party, isBot = false, operator }) {
    const { ctx } = this;
    if (token && this.tokens.has(token)) {
      const p = ctx.players.get(this.tokens.get(token));
      if (p) { p.connected = true; p.disconnectedAt = 0; ctx.log.info(`${p.name} reconectou`); ctx.bus.emit('reconnected', { playerId: p.id }); return { player: p, reconnected: true }; }
    }
    if (this.state !== MS.LOBBY && this.state !== MS.COUNTDOWN) return { error: 'partida em andamento' };
    if (ctx.players.size >= ctx.cfg.match.maxPlayers) return { error: 'lobby cheio' };
    const p = new Player({
      id: `P${this.nextId++}`, name: String(name || 'Jogador').replace(/[<>&"]/g, '').slice(0, 16) || 'Jogador', token: uuid(), isBot,
      onStateChange: (pl, from, to, info) => { ctx.log.debug(`${pl.name}: ${from} → ${to}`, info); ctx.bus.emit('playerState', { playerId: pl.id, from, to, info }); },
    });
    p.party = party ? String(party).slice(0, 12).toUpperCase() : null;
    p.operator = Number.isInteger(operator) && operator >= 0 && operator < 16 ? operator : null;
    ctx.players.set(p.id, p); this.tokens.set(p.token, p.id);
    ctx.log.info(`${p.name}${isBot ? ' (bot)' : ''} entrou (${ctx.players.size})`);
    ctx.bus.emit('lobbyChanged', {});
    return { player: p, reconnected: false };
  }

  /** Desconexão: no lobby remove; em partida mantém o corpo até reconnectGrace. */
  disconnect(p) {
    const { ctx } = this;
    if (this.state === MS.LOBBY || this.state === MS.COUNTDOWN || this.state === MS.ENDED) {
      ctx.players.delete(p.id); this.tokens.delete(p.token); ctx.bus.emit('lobbyChanged', {}); return;
    }
    p.connected = false; p.disconnectedAt = ctx.now();
    Object.assign(p.input, { mx: 0, mz: 0, sprint: false, tac: false, jump: false, interact: false, ads: false });
    ctx.log.info(`${p.name} desconectou (aguardando ${ctx.cfg.match.reconnectGrace}s)`);
  }

  fillBots() {
    const { cfg } = this.ctx;
    if (!cfg.match.fillWithBots || ![...this.ctx.players.values()].some(p => !p.isBot)) return;
    let i = 0;
    while (this.ctx.players.size < cfg.match.botFillTarget) this.join({ name: `${BOT_NAMES[i++ % BOT_NAMES.length]}${i > BOT_NAMES.length ? i : ''}`, isBot: true });
  }

  // ---------------- mensagens ----------------
  handle(p, msg) {
    const S = this.ctx.systems;
    if (!msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case C2S.READY: p.ready = !!msg.ready; break;
      case C2S.INPUT: {
        // seq precisa crescer; inputs vão para a fila e são consumidos pelo MovementSystem
        if (Number.isFinite(msg.seq)) { if (msg.seq <= (p.lastQueuedSeq ?? 0)) return; p.lastQueuedSeq = msg.seq; }
        const inp = MovementSystem.sanitize(msg, p.input);
        inp.seq = Number.isFinite(msg.seq) ? msg.seq : 0;
        inp.dt = Math.min(1 / 15, Math.max(0.001, Number(msg.dt) || 1 / 30));
        inp.interactPlateChain = msg.plateChain === true;
        (p.inputQueue ??= []).push(inp);
        if (p.inputQueue.length > 30) p.inputQueue.shift();
        break;
      }
      case C2S.FIRE: S.weapons.requestFire(p, msg); break;
      case C2S.THROW: S.weapons.requestThrow(p, msg); break;
      case C2S.RELOAD: S.inventory.requestReload(p); break;
      case C2S.SWITCH: S.inventory.requestSwitch(p, msg.slot); break;
      case C2S.PICKUP: S.loot.requestPickup(p, msg.lootId); break;
      case C2S.USE_PLATE: S.inventory.requestPlate(p); break;
      case C2S.USE_HEAL: S.inventory.requestHeal(p); break;
      case C2S.DEPLOY_CHUTE: if (p.is(PS.FREEFALL)) p.setState(PS.PARACHUTE, this.ctx.now()); break;
      case C2S.CONTRACT: S.contracts.requestStart(p, msg.boardId); break;
      case C2S.BUY: S.stations.requestBuy(p, { stationId: String(msg.stationId), item: String(msg.item), targetId: msg.targetId ? String(msg.targetId) : undefined }); break;
      case C2S.SPECTATE: S.spectator.cycle(p, msg.dir === -1 ? -1 : 1); break;
      default: this.ctx.log.debug(`mensagem desconhecida ${msg.t}`);
    }
  }

  // ---------------- simulação ----------------
  tick(dt) {
    this.time += dt;
    const S = this.ctx.systems, st = this.state;
    if (st === MS.LOBBY || st === MS.COUNTDOWN) this.fillBots();
    S.match.tick(dt);
    if (!S.match.inMatch) return;
    S.bots.tick(dt);
    S.movement.tick(dt);
    S.inventory.tick(dt);
    S.weapons.tick(dt);
    S.health.tick(dt);
    S.zone.tick(dt);
    S.resurgence.tick(dt);
    S.contracts.tick(dt);
    S.loot.tick(dt);
    S.spectator.tick(dt);
    this.tickDisconnects();
  }

  tickDisconnects() {
    const { ctx } = this, grace = ctx.cfg.match.reconnectGrace;
    for (const p of ctx.players.values()) {
      if (p.connected || p.isBot || !p.disconnectedAt || ctx.now() - p.disconnectedAt < grace) continue;
      if (p.is(PS.ELIMINATED)) continue;
      ctx.log.info(`${p.name} excedeu o tempo de reconexão`);
      if (p.is(PS.AWAITING_RESPAWN)) p.setState(PS.ELIMINATED, ctx.now(), { cause: 'disconnect' });
      else if (p.is(PS.AIRCRAFT)) p.setState(PS.ELIMINATED, ctx.now(), { cause: 'disconnect' });
      else { ctx.systems.health.kill(p, null, 'disconnect'); if (p.is(PS.AWAITING_RESPAWN)) p.setState(PS.ELIMINATED, ctx.now(), { cause: 'disconnect' }); }
    }
  }

  // ---------------- visão de rede ----------------
  lobbyView() {
    const S = this.ctx.systems;
    return { state: this.state, countdown: Math.ceil(S.match.countdown), squadSize: this.ctx.cfg.match.squadSize,
      players: [...this.ctx.players.values()].map(p => ({ id: p.id, name: p.name, bot: p.isBot, party: p.party, ready: p.ready })) };
  }

  /** Snapshot filtrado por interesse: dados privados só do próprio jogador. */
  snapshotFor(p) {
    const { ctx } = this, S = ctx.systems, r = ctx.cfg.network.interestRadius, vp = S.spectator.viewpoint(p), radar = S.stations.radarFor(p.squadId);
    const others = [];
    for (const o of ctx.players.values()) {
      if (o === p || !o.is(...IN_PLAY, PS.DOWNED)) continue;
      const ally = S.squad.areAllies(o, p);
      if (!ally && Math.hypot(o.pos.x - vp.x, o.pos.z - vp.z) > r) continue;
      others.push({ id: o.id, n: o.name, sq: o.squadId, a: ally ? 1 : 0, s: o.state, x: +o.pos.x.toFixed(2), y: +o.pos.y.toFixed(2), z: +o.pos.z.toFixed(2),
        yaw: +o.yaw.toFixed(3), pitch: +o.pitch.toFixed(3), st: o.stance, w: S.inventory.active(o)?.id ?? null, sl: o.slide ? 1 : 0, mt: o.mantle || o.climb ? 1 : 0, ...(!ally && radar && Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) <= radar ? { rv: 1 } : {}), ...(ally ? { hp: Math.round(o.hp), ar: Math.round(o.armor) } : {}) });
    }
    const w = p.inv && S.inventory.active(p);
    const alive = [...ctx.players.values()].filter(o => o.is(...IN_PLAY, PS.DOWNED)).length;
    const squadsLeft = [...S.squad.squads.values()].filter(s => S.match.isSquadEligible(s)).length;
    return {
      time: +ctx.now().toFixed(3),
      you: {
        id: p.id, s: p.state, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), vx: +p.vel.x.toFixed(2), vz: +p.vel.z.toFixed(2),
        hp: Math.round(p.hp), ar: Math.round(p.armor), bleed: Math.round(p.bleed), st: p.stance, stam: Math.round(p.stamina), sprint: !!p.sprinting,
        seq: p.lastSeq, action: p.action && { type: p.action.type, left: +(p.action.until - ctx.now()).toFixed(2), total: +(p.action.until - p.action.started).toFixed(2) },
        inv: p.inv && { primary: p.inv.primary, secondary: p.inv.secondary, active: p.inv.active, ammo: p.inv.ammo, plates: p.inv.plates, heals: p.inv.heals, lethal: p.inv.lethal, cash: p.inv.cash },
        weapon: w?.id ?? null, mag: w?.mag ?? 0,
        respawnIn: p.is(PS.AWAITING_RESPAWN) ? +p.respawnRemaining.toFixed(1) : null,
        spectating: p.spectating, stats: p.stats, squad: p.squadId,
        zone: S.zone.distanceInfo(p.pos),
        contract: S.contracts.viewFor(p), radar: radar > 0,
        vy: +p.vel.y.toFixed(3), grounded: p.grounded, slide: p.slide, mantle: p.mantle, climb: p.climb, stamBlock: +(p.staminaBlockUntil - ctx.now()).toFixed(2), slideCd: +(p.slideCooldownUntil - ctx.now()).toFixed(2), tac: p.tacActive, pj: p.prevJump, pc: p.prevCrouch, yaw: +p.yaw.toFixed(3), sprinting: p.sprinting,
      },
      squad: p.squadId ? S.squad.statusFor(p) : [],
      others,
      zone: S.zone.view(),
      match: { state: this.state, alive, squadsLeft, resurgence: S.resurgence.active, aircraft: S.match.aircraft && this.state === MS.DEPLOYING ? S.match.aircraftInfo() : null },
    };
  }
}
