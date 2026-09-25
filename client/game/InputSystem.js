import { settings } from '../core/Settings.js';

/**
 * InputSystem — teclado/mouse → intenção. Nada de regra de jogo aqui.
 * KEYMAP pode ter uma tecla ou uma lista de teclas por ação.
 */
export const KEYMAP = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  sprint: 'ShiftLeft', crouch: 'KeyC', prone: 'KeyZ', jump: 'Space', interact: 'KeyE',
  reload: 'KeyR', primary: 'Digit1', secondary: 'Digit2', knife: 'Digit3', plate: 'KeyQ', heal: 'KeyH',
  lethal: 'KeyG', tactical: 'KeyT', melee: 'KeyV', ping: 'KeyX',
  contract: 'KeyF', shop: 'KeyB', map: 'KeyM', inventory: 'Tab', specNext: 'BracketRight', specPrev: 'BracketLeft',
};
/** Mapa padrão (para "restaurar padrão"). */
export const DEFAULT_KEYMAP = { ...KEYMAP };
/**
 * Aplica as teclas personalizadas (settings.keys) por cima do padrão. Muda o KEYMAP exportado
 * no lugar, então dicas de tecla no HUD e no menu refletem a configuração do jogador.
 */
export function applyBindings(custom = settings.get('keys') ?? {}) {
  for (const k of Object.keys(KEYMAP)) KEYMAP[k] = DEFAULT_KEYMAP[k];
  for (const [a, code] of Object.entries(custom)) if (a in KEYMAP && typeof code === 'string') KEYMAP[a] = code;
}
applyBindings();
export const KEY_LABELS = {
  forward: 'Frente', back: 'Trás', left: 'Esquerda', right: 'Direita', sprint: 'Correr', crouch: 'Agachar / cortar paraquedas', prone: 'Deitar (prone)',
  jump: 'Pular / mantle / abrir paraquedas', interact: 'Pegar / abrir baú / segurar p/ reviver', reload: 'Recarregar',
  primary: 'Arma 1', secondary: 'Arma 2', knife: 'Faca na mão', plate: 'Placas de armadura (aplica até cancelar)', heal: 'Adrenalina (cura)',
  lethal: 'Granada', tactical: 'Granada de fumaça', melee: 'Faca (equipa / golpeia / finaliza)', ping: 'Marcar (ping) · botão do meio',
  contract: 'Aceitar contrato', shop: 'Estação de compra', map: 'Mapa', inventory: 'Inventário / placar',
  specNext: 'Espectador: próximo', specPrev: 'Espectador: anterior',
};
const NAMES = { ShiftRight: 'Shift D', ControlRight: 'Ctrl D', AltLeft: 'Alt', CapsLock: 'Caps', Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backslash: '\\', Space: 'Espaço', ShiftLeft: 'Shift', ControlLeft: 'Ctrl', Tab: 'Tab', BracketRight: ']', BracketLeft: '[', Escape: 'Esc' };
export const keyName = code => NAMES[code] ?? code.replace(/^Key|^Digit/, '');

export class InputSystem extends EventTarget {
  constructor(canvas) {
    super();
    this.canvas = canvas; this.keys = new Set(); this.yaw = 0; this.pitch = 0;
    this.fire = false; this.ads = false; this.adsToggled = false; this.crouchToggled = false; this.proneToggled = false;
    this.lastSprintTap = 0; this.tacToggle = false; this.enabled = false; this.mouseDX = 0; this.mouseDY = 0;
    this.rebind();
    settings.on(({ key }) => { if (key === 'keys') this.rebind(); });
    addEventListener('keydown', e => this.onKey(e, true));
    addEventListener('keyup', e => this.onKey(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.fire = false; this.ads = false; });
    addEventListener('mousedown', e => {
      if (!this.enabled || document.pointerLockElement !== canvas) return;
      if (e.button === 0) { this.fire = true; this.emit('fireDown'); }
      if (e.button === 2) { if (settings.get('aimToggle')) this.adsToggled = !this.adsToggled; else this.ads = true; }
      if (e.button === 1) { e.preventDefault(); this.emit('action', 'ping'); }
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.fire = false; if (e.button === 2) this.ads = false; });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (document.pointerLockElement !== canvas || !this.enabled) return;
      const s = settings.get('sensitivity') * (this.aiming ? settings.get('adsSensitivity') : 1) * this.zoomScale;
      const dx = Math.max(-400, Math.min(400, e.movementX)), dy = Math.max(-400, Math.min(400, e.movementY));
      this.mouseDX += dx; this.mouseDY += dy; this.lastDX = (this.lastDX ?? 0) + dx; this.lastDY = (this.lastDY ?? 0) + dy;
      this.yaw -= dx * s; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * s * (settings.get('invertY') ? -1 : 1)));
    });
    addEventListener('wheel', () => { if (this.enabled) this.emit('swap'); }, { passive: true });
    this.zoomScale = 1;
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, e => fn(e.detail)); }
  /** Reconstrói o índice tecla → ação (após o jogador remapear). */
  rebind() { applyBindings(); this.byCode = new Map(); for (const [action, keys] of Object.entries(KEYMAP)) for (const k of [].concat(keys)) this.byCode.set(k, action); }
  down(action) { for (const k of [].concat(KEYMAP[action])) if (this.keys.has(k)) return true; return false; }
  get aiming() { return this.ads || this.adsToggled; }
  resetToggles() { this.adsToggled = false; this.crouchToggled = false; this.proneToggled = false; this.ads = false; this.fire = false; }

  onKey(e, pressed) {
    if (e.target?.tagName === 'INPUT') return;
    if (['Space', 'Tab'].includes(e.code) && this.enabled) e.preventDefault();
    const action = this.byCode.get(e.code);
    if (pressed) {
      if (this.keys.has(e.code)) return;                   // autorepeat
      this.keys.add(e.code);
      if (!this.enabled) return;
      if (action === 'sprint') { const now = performance.now(); this.tacToggle = now - this.lastSprintTap < 320; this.lastSprintTap = now; this.crouchToggled = false; this.proneToggled = false; }
      if (action === 'crouch' && settings.get('crouchToggle')) { this.crouchToggled = !this.crouchToggled; this.proneToggled = false; }
      if (action === 'prone') { this.proneToggled = !this.proneToggled; this.crouchToggled = false; }
      if (action === 'jump') { this.proneToggled = false; this.crouchToggled = false; }
      if (action) this.emit('action', action);
    } else {
      this.keys.delete(e.code);
      if (action === 'sprint') this.tacToggle = false;
      if (action) this.emit('release', action);
    }
  }

  /** Intenção de movimento para um passo fixo. */
  sample(seq, dt) {
    const f = (this.down('back') ? 1 : 0) - (this.down('forward') ? 1 : 0), r = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    const l = Math.hypot(f, r) || 1;
    const crouch = settings.get('crouchToggle') ? this.crouchToggled : this.down('crouch');
    return {
      t: 'input', seq, dt, mx: r / l, mz: f / l, yaw: this.yaw, pitch: this.pitch,
      sprint: this.down('sprint'), tac: this.down('sprint') && this.tacToggle, crouch, prone: this.proneToggled,
      jump: this.down('jump'), ads: this.aiming, interact: this.down('interact'), plateChain: this.down('plate'),
    };
  }
  consumeMouse() { const d = [this.mouseDX, this.mouseDY]; this.mouseDX = 0; this.mouseDY = 0; return d; }
}
