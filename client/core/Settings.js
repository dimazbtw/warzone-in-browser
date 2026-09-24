/**
 * Settings — preferências do jogador (localStorage). Qualquer mudança dispara
 * 'change' para que áudio, input e renderizador se ajustem na hora.
 */
const KEY = 'zr_settings_v2';
export const DEFAULTS = {
  name: '', operator: 0,
  sensitivity: 0.0022, adsSensitivity: 0.65, fov: 78, invertY: false,
  volume: 0.8, sfxVolume: 1, musicVolume: 0.35,
  quality: 'high',            // 'low' | 'medium' | 'high'
  showFps: false, damageNumbers: true, crouchToggle: false, aimToggle: false,
  lastMode: { squadSize: 2, difficulty: 'normal', players: 40 },
};
export const QUALITY = {
  low:    { pixelRatio: 0.75, shadows: false, shadowMap: 1024, bloom: false, grass: 0,    trees: 0.5, viewDistance: 260, post: false },
  medium: { pixelRatio: 1,    shadows: true,  shadowMap: 1024, bloom: false, grass: 0.5,  trees: 0.8, viewDistance: 340, post: true },
  high:   { pixelRatio: 1.5,  shadows: true,  shadowMap: 2048, bloom: true,  grass: 1,    trees: 1,   viewDistance: 420, post: true },
};

class SettingsStore extends EventTarget {
  constructor() {
    super();
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { saved = {}; }
    this.data = { ...structuredClone(DEFAULTS), ...saved, lastMode: { ...DEFAULTS.lastMode, ...(saved.lastMode ?? {}) } };
  }
  get(k) { return this.data[k]; }
  set(k, v) { this.data[k] = v; this.save(); this.dispatchEvent(new CustomEvent('change', { detail: { key: k, value: v } })); }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* armazenamento indisponível */ } }
  get quality() { return QUALITY[this.data.quality] ?? QUALITY.high; }
  on(fn) { this.addEventListener('change', e => fn(e.detail)); }
}
export const settings = new SettingsStore();
