/**
 * CONFIGURAÇÃO DO GAME DESIGNER
 * ------------------------------------------------------------
 * Todos os números de balanceamento ficam aqui. O servidor é a fonte
 * da verdade: o cliente recebe apenas o subconjunto exposto em
 * `clientConfig()` para prever animações/HUD, nunca para decidir
 * resultado de gameplay.
 *
 * Unidades: metros, segundos, pontos de vida.
 */

export const CONFIG = {
  // ---------------- PARTIDA ----------------
  match: {
    maxPlayers: 60,
    minPlayersToStart: 2,       // humanos + bots
    squadSize: 2,               // 1 = solo, 2 = duo, 3 = trio, 4 = squad
    lobbyCountdown: 15,         // s depois de atingir o mínimo
    fillWithBots: true,         // completa o lobby até `botFillTarget`
    botFillTarget: 16,
    tickRate: 30,               // simulação por segundo
    snapshotRate: 15,           // envios de estado por segundo
    endScreenTime: 20,          // s antes de reiniciar o lobby
    reconnectGrace: 60,         // s que um jogador desconectado continua na partida
  },

  // ---------------- MAPA / AERONAVE ----------------
  map: {
    size: 420,                  // quadrado de -size/2 a +size/2
    aircraftAltitude: 180,
    aircraftSpeed: 55,          // m/s
    autoEjectAtEnd: true,
  },

  // ---------------- MOVIMENTO (autoritativo) ----------------
  movement: {
    walk: 6.0, sprint: 8.6, tacticalSprint: 10.8, crouch: 3.2, prone: 1.4, ads: 3.6,
    jumpVelocity: 7.5,
    gravity: 22,
    freefallSpeed: 48, freefallHorizontal: 26,
    parachuteSpeed: 9, parachuteHorizontal: 14,
    autoChuteHeight: 45,         // abre sozinho abaixo desta altura
    stamina: { max: 100, tacticalDrain: 45, regen: 22, regenDelay: 1.2, minToStart: 25 },
    speedTolerance: 1.35,        // margem anti-teleporte na validação
  },

  // ---------------- VIDA / ARMADURA ----------------
  health: {
    max: 100,
    regenDelay: 5, regenPerSecond: 30,
    plates: { maxEquipped: 3, hpPerPlate: 50, maxCarried: 8, applyTime: 1.1, startPlates: 3 },
    healItem: { name: 'Adrenalina', heal: 100, useTime: 0.6, maxCarried: 3 },
  },

  // ---------------- ABATIDO / REVIVER ----------------
  downed: {
    enabled: true,              // em solo é ignorado automaticamente
    health: 100,                // "vida de sangramento" enquanto abatido
    bleedoutTime: 30,
    reviveTime: 4,
    reviveRange: 2.2,
    moveSpeed: 1.2,
    wipeEliminatesDowned: true, // se o squad inteiro cair, os abatidos morrem
  },

  // ---------------- RESURGENCE ----------------
  resurgence: {
    enabled: true,
    baseTime: 30,               // s até voltar
    minTime: 5,
    allyAliveSpeedup: 0.25,     // +25% de velocidade do relógio por aliado vivo
    killReduction: 5,           // s descontados por eliminação feita pelo squad
    killReductionEnabled: true,
    requireLivingTeammate: true,// em solo é ignorado
    disableAtPhase: 4,          // quando essa fase de zona começa, desliga
    onDisable: 'respawn_pending', // 'respawn_pending' | 'eliminate_pending'
    respawnAltitude: 110,
    safeSpawn: { minEnemyDistance: 45, attempts: 40, insideZoneFraction: 0.8 },
    basicKit: { weapons: ['sidearm'], plates: 1, armorPlates: 0, cash: 0, lethal: 0 },
  },

  // ---------------- ZONA SEGURA ----------------
  // [raio final, espera, fechamento, dano por segundo]
  zone: {
    startRadiusFactor: 1.45,    // multiplica o meio-mapa
    phases: [
      { radius: 150, wait: 45, close: 40, dps: 2 },
      { radius: 100, wait: 40, close: 35, dps: 4 },
      { radius: 65,  wait: 35, close: 30, dps: 7 },
      { radius: 38,  wait: 30, close: 25, dps: 11 },
      { radius: 18,  wait: 25, close: 22, dps: 16 },
      { radius: 0,   wait: 15, close: 20, dps: 25 }, // fase final força confronto
    ],
    centerBias: 0.85,           // quão longe do centro atual o novo pode cair (0..1)
  },

  // ---------------- COMBATE ----------------
  combat: {
    mode: 'hitscan',            // 'hitscan' | 'projectile'
    lagCompensationMax: 0.25,   // s máximos de rebobinagem
    bodyMultipliers: { head: 1.6, torso: 1.0, limbs: 0.85 },
    hitbox: { headRadius: 0.17, bodyRadius: 0.32, headHeight: 1.62, crouchScale: 0.68, proneScale: 0.3 },
    projectileGravity: 9.8,
  },

  // Armas originais (nomes fictícios)
  weapons: {
    sidearm: { name: 'Vespa 9',     slot: 'secondary', ammo: 'pistol', damage: 24, rpm: 400, mag: 14, reserve: 42,  reload: 1.3, range: 70,  falloff: [[15, 1], [35, 0.8], [70, 0.6]], spreadHip: 0.03, spreadAds: 0.008, recoil: 0.9, projectileSpeed: 380, rarity: 'common' },
    rifle:   { name: 'Carcará AR',  slot: 'primary',   ammo: 'rifle',  damage: 27, rpm: 720, mag: 30, reserve: 90,  reload: 1.9, range: 180, falloff: [[40, 1], [80, 0.85], [180, 0.7]], spreadHip: 0.045, spreadAds: 0.006, recoil: 1.0, projectileSpeed: 750, rarity: 'uncommon' },
    battle:  { name: 'Jaguar BR',   slot: 'primary',   ammo: 'rifle',  damage: 38, rpm: 480, mag: 20, reserve: 60,  reload: 2.2, range: 220, falloff: [[50, 1], [120, 0.9], [220, 0.75]], spreadHip: 0.05, spreadAds: 0.004, recoil: 1.4, projectileSpeed: 800, rarity: 'rare' },
    smg:     { name: 'Colibri SMG', slot: 'primary',   ammo: 'pistol', damage: 21, rpm: 900, mag: 34, reserve: 102, reload: 1.6, range: 80,  falloff: [[12, 1], [25, 0.8], [80, 0.55]], spreadHip: 0.035, spreadAds: 0.012, recoil: 0.7, projectileSpeed: 420, rarity: 'uncommon' },
    shotgun: { name: 'Tatu 12',     slot: 'primary',   ammo: 'shell',  damage: 16, pellets: 8, rpm: 80, mag: 6, reserve: 24, reload: 2.6, range: 35, falloff: [[8, 1], [16, 0.6], [35, 0.2]], spreadHip: 0.09, spreadAds: 0.07, recoil: 2.5, projectileSpeed: 350, rarity: 'rare' },
    marksman:{ name: 'Harpia DMR',  slot: 'primary',   ammo: 'sniper', damage: 95, rpm: 60,  mag: 5,  reserve: 20,  reload: 2.8, range: 400, falloff: [[150, 1], [400, 0.9]], spreadHip: 0.08, spreadAds: 0.0008, recoil: 3.0, projectileSpeed: 900, rarity: 'epic', headMultiplier: 2.4 },
  },

  // ---------------- LOOT ----------------
  loot: {
    spawnPoints: 180,
    pickupRange: 2.5,
    autoPickup: { enabled: true, types: ['cash', 'ammo', 'plate'], radius: 1.4 },
    rarityWeights: { common: 50, uncommon: 30, rare: 14, epic: 5, legendary: 1 },
    // tabela de loot por tipo: [peso, fábrica]
    table: [
      { weight: 30, type: 'weapon' },
      { weight: 25, type: 'ammo' },
      { weight: 18, type: 'plate' },
      { weight: 14, type: 'cash' },
      { weight: 7,  type: 'heal' },
      { weight: 6,  type: 'lethal' },
    ],
    ammoPack: { pistol: 28, rifle: 30, shell: 8, sniper: 5 },
    cashRange: [100, 800],
    killCash: 350,
    dropOnDeath: true,
  },

  // ---------------- EQUIPAMENTO ----------------
  equipment: {
    lethal: { name: 'Granada de Fragmentação', fuse: 2.2, radius: 8, maxDamage: 140, maxCarried: 2, throwSpeed: 19 },
  },

  // ---------------- CONTRATOS (objetivos opcionais) ----------------
  contracts: {
    enabled: true,
    boards: 18,                 // tablets espalhados no mapa
    interactRange: 2.5,
    maxActivePerSquad: 1,
    respawnReduction: 10,       // s descontados de aliados aguardando retorno ao completar
    types: {
      hunt:      { name: 'Caçada',        weight: 3, duration: 120, reward: { cash: 1500, xp: 400 }, revealEvery: 8, searchRadius: 250 },
      scavenger: { name: 'Suprimentos',   weight: 3, duration: 150, reward: { cash: 800, xp: 250, loot: 'epic' }, caches: 3, cacheRadius: 3, minDist: 35, maxDist: 80 },
      capture:   { name: 'Domínio',       weight: 2, duration: 150, reward: { cash: 1200, xp: 350 }, radius: 10, time: 25, minDist: 40, maxDist: 90 },
      survive:   { name: 'Resistência',   weight: 2, duration: 95,  reward: { cash: 1000, xp: 300 }, time: 90 },
      collect:   { name: 'Inteligência',  weight: 2, duration: 150, reward: { cash: 900, xp: 300 }, items: 3, radius: 55 },
    },
  },

  // ---------------- ESTAÇÕES DE COMPRA ----------------
  stations: {
    enabled: true,
    interactRange: 3,
    buybackUntilPhase: 5,       // recompra de aliado permitida até esta fase (1-based)
    catalog: {
      plates:  { name: 'Pacote de Placas (3)', price: 800,  desc: '+3 placas' },
      ammo:    { name: 'Munição',              price: 400,  desc: 'Recarrega munição das armas' },
      heal:    { name: 'Adrenalina',           price: 500,  desc: '+1 item de cura' },
      lethal:  { name: 'Granada',              price: 600,  desc: '+1 granada' },
      radar:   { name: 'Radar Portátil',       price: 3000, desc: 'Revela inimigos próximos ao squad por 30s', duration: 30, radius: 150 },
      weapon:  { name: 'Carcará AR',           price: 2000, desc: 'Fuzil de assalto', weaponId: 'rifle' },
      buyback: { name: 'Kit de Retorno',       price: 4500, desc: 'Traz um aliado de volta agora', perMatchLimit: 3 },
    },
  },

  // ---------------- REDE / ANTI-ABUSO ----------------
  network: {
    port: Number(globalThis.process?.env?.PORT) || 8080,
    maxMessageBytes: 2048,
    rateLimit: { perSecond: 90, burst: 150 },
    interestRadius: 250,        // outros jogadores além disso não são enviados
    interpolationDelay: 0.1,
  },
};

/** Subconjunto seguro enviado ao cliente (visual/HUD). */
export function clientConfig(cfg = CONFIG) {
  return {
    match: { squadSize: cfg.match.squadSize, tickRate: cfg.match.tickRate, snapshotRate: cfg.match.snapshotRate },
    map: cfg.map,
    movement: cfg.movement,
    health: cfg.health,
    downed: cfg.downed,
    resurgence: { enabled: cfg.resurgence.enabled, disableAtPhase: cfg.resurgence.disableAtPhase },
    contracts: cfg.contracts, stations: cfg.stations, loot: { pickupRange: cfg.loot.pickupRange },
    weapons: cfg.weapons,
    network: { interpolationDelay: cfg.network.interpolationDelay },
  };
}

/** Clona a config e aplica overrides (útil em testes e modos customizados). */
export function makeConfig(overrides = {}) {
  const out = structuredClone({ ...CONFIG, network: { ...CONFIG.network } });
  const merge = (t, s) => { for (const k in s) (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) ? merge(t[k] ??= {}, s[k]) : (t[k] = s[k]); };
  merge(out, overrides);
  return out;
}
