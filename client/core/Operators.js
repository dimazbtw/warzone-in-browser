/** Operadores selecionáveis: modelos 3D enviados pelo usuário (assets/models) + retratos renderizados deles. */
export const OPERATORS = [
  { id: 'caveira', name: 'CAVEIRA', desc: 'Força-tarefa noturna', model: 'operator_1', img: 'assets/portraits/operator_1.png', tint: 0x8c8c8c, swatch: '#3a3d42' },
  { id: 'duna',    name: 'DUNA',    desc: 'Especialista do deserto', model: 'operator_2', img: 'assets/portraits/operator_2.png', tint: 0xe0c89c, swatch: '#b8a27a' },
];
export const operatorOf = i => OPERATORS[((i ?? 0) % OPERATORS.length + OPERATORS.length) % OPERATORS.length];

/** Modos e dificuldades do modo offline. */
export const MODES = [
  { size: 1, name: 'SOLO', ic: '▲', desc: 'Cada um por si' },
  { size: 2, name: 'DUO', ic: '▲▲', desc: 'Você + 1 aliado bot' },
  { size: 3, name: 'TRIO', ic: '▲▲▲', desc: 'Você + 2 aliados bots' },
  { size: 4, name: 'QUARTETO', ic: '▲▲▲▲', desc: 'Você + 3 aliados bots' },
];
export const DIFFICULTIES = [
  { id: 'easy', name: 'RECRUTA', desc: 'Reação lenta, erram muito' },
  { id: 'normal', name: 'SOLDADO', desc: 'Equilibrado' },
  { id: 'hard', name: 'VETERANO', desc: 'Precisos e agressivos' },
];
export const PLAYER_COUNTS = [{ n: 24, desc: 'Partida rápida' }, { n: 40, desc: 'Padrão' }, { n: 60, desc: 'Lotado' }];

/** Overrides de configuração para uma partida offline no Web Worker. */
export function offlineOverrides({ squadSize, difficulty, players }) {
  const fast = players <= 24;
  return {
    match: { squadSize, botFillTarget: players, maxPlayers: players, minPlayersToStart: 1, lobbyCountdown: 2, fillWithBots: true,
      reconnectGrace: 3600, snapshotRate: 30, endScreenTime: 3600 },
    bots: { difficulty },
    ...(fast ? { zone: { timeScale: 0.75 } } : {}),
    logLevel: 'warn',
  };
}
