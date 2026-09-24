/** Operadores selecionáveis (retratos gerados no Higgsfield). `tint` colore o uniforme do modelo 3D. */
const IMG = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Jib0BzU3aLdeWOQjrliCwaWdFv/hf_20260924_';
export const OPERATORS = [
  { id: 'caveira', name: 'CAVEIRA', desc: 'Força-tarefa noturna', img: IMG + '172742_fcfe9b2a-ad86-4cbc-8633-a21d62693126.png', tint: 0x8c8c8c, swatch: '#9a9a9a' },
  { id: 'duna',    name: 'DUNA',    desc: 'Especialista do deserto', img: IMG + '172741_fc82033c-57a6-465e-b84f-c4ddbf864b19.png', tint: 0xe0c89c, swatch: '#d8c29a' },
  { id: 'mateiro', name: 'MATEIRO', desc: 'Veterano de mata fechada', img: IMG + '172741_1e19f3c4-8a62-4386-b105-5b0b7106dd7c.png', tint: 0xa9bb86, swatch: '#9fb07a' },
  { id: 'noturno', name: 'NOTURNO', desc: 'Operações urbanas', img: IMG + '172742_67718c5b-9753-4537-ac4e-3dd3276d2cde.png', tint: 0x8a9ec4, swatch: '#7f93b8' },
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
