/**
 * InputSystem — teclado/mouse → intenção. Nada de regra de jogo aqui.
 * Mapeamento editável em KEYMAP.
 */
export const KEYMAP = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  sprint: 'ShiftLeft', crouch: 'KeyC', prone: 'KeyZ', jump: 'Space', interact: 'KeyE',
  reload: 'KeyR', primary: 'Digit1', secondary: 'Digit2', plate: 'KeyQ', heal: 'KeyH', lethal: 'KeyG',
  contract: 'KeyF', shop: 'KeyB', map: 'KeyM', specNext: 'BracketRight', specPrev: 'BracketLeft', scoreboard: 'Tab',
};

export class InputSystem extends EventTarget {
  constructor(canvas) {
    super();
    this.canvas = canvas; this.keys = new Set(); this.yaw = 0; this.pitch = 0; this.fire = false; this.ads = false;
    this.sensitivity = Number(localStorage.getItem('zr_sens') || 0.0022);
    this.lastSprintTap = 0; this.tacToggle = false; this.enabled = false;
    addEventListener('keydown', e => this.onKey(e, true));
    addEventListener('keyup', e => this.onKey(e, false));
    addEventListener('mousedown', e => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
      if (e.button === 0) { this.fire = true; this.emit('fireDown'); }
      if (e.button === 2) this.ads = true;
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.fire = false; if (e.button === 2) this.ads = false; });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (document.pointerLockElement !== canvas) return;
      const s = this.sensitivity * (this.ads ? 0.55 : 1);
      this.yaw -= e.movementX * s; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * s));
    });
    addEventListener('wheel', () => this.emit('swap'));
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, e => fn(e.detail)); }
  down(action) { return this.keys.has(KEYMAP[action]); }

  onKey(e, pressed) {
    if (e.target?.tagName === 'INPUT') return;
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    if (pressed) {
      if (this.keys.has(e.code)) return;       // autorepeat
      this.keys.add(e.code);
      // sprint tático: toque duplo no Shift enquanto anda
      if (e.code === KEYMAP.sprint) { const now = performance.now(); this.tacToggle = now - this.lastSprintTap < 300; this.lastSprintTap = now; }
      const action = Object.entries(KEYMAP).find(([, k]) => k === e.code)?.[0];
      if (action) this.emit('action', action);
    } else {
      this.keys.delete(e.code);
      if (e.code === KEYMAP.sprint) this.tacToggle = false;
    }
  }

  /** Intenção de movimento para um passo. */
  sample(seq, dt) {
    const f = (this.down('back') ? 1 : 0) - (this.down('forward') ? 1 : 0), r = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    const l = Math.hypot(f, r) || 1;
    return {
      t: 'input', seq, dt, mx: r / l, mz: f / l, yaw: this.yaw, pitch: this.pitch,
      sprint: this.down('sprint'), tac: this.down('sprint') && this.tacToggle, crouch: this.down('crouch'), prone: this.down('prone'),
      jump: this.down('jump'), ads: this.ads, interact: this.down('interact'), plateChain: this.down('plate'),
    };
  }
}
