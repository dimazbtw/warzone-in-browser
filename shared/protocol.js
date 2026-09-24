/**
 * Protocolo cliente <-> servidor (JSON sobre WebSocket).
 * Cliente só envia INTENÇÕES (inputs/pedidos). O servidor decide o resultado.
 */
export const C2S = {
  HELLO: 'hello',         // { name, token?, party? }
  READY: 'ready',         // { ready: bool }
  INPUT: 'input',         // { seq, mx, mz, yaw, pitch, sprint, tac, crouch, prone, jump, ads, interact }
  FIRE: 'fire',           // { seq, yaw, pitch }
  RELOAD: 'reload',
  SWITCH: 'switch',       // { slot: 'primary'|'secondary' }
  PICKUP: 'pickup',       // { lootId }
  USE_PLATE: 'usePlate',
  USE_HEAL: 'useHeal',
  THROW: 'throw',         // { yaw, pitch }
  DEPLOY_CHUTE: 'chute',
  SPECTATE: 'spectate',   // { dir: 1|-1 }
  PING: 'ping',           // { t }
};

export const S2C = {
  WELCOME: 'welcome',     // { id, token, config, reconnected }
  LOBBY: 'lobby',         // { players, countdown, state }
  MATCH_START: 'matchStart', // { aircraft, loot, zone }
  SNAPSHOT: 'snap',       // { t, you, others, zone, match }
  EVENT: 'ev',            // { type, ... }
  PONG: 'pong',
  ERROR: 'err',
};

/** Eventos de jogo propagados ao cliente (subset do EventBus do servidor). */
export const GAME_EVENTS = [
  'damage', 'downed', 'revived', 'eliminated', 'awaitingRespawn', 'respawned', 'resurgenceDisabled',
  'zonePhase', 'zoneClosing', 'lootSpawned', 'lootRemoved', 'squadEliminated', 'matchEnded', 'jumped', 'killfeed',
  'explosion', 'announce',
];
