import { classOf } from '../render/Models.js';
/**
 * AudioSystem — sons 100% sintetizados (sem assets de terceiros), com
 * posicionamento 3D via PannerNode. O listener acompanha a câmera.
 */
export class AudioSystem {
  constructor() { this.ctx = null; this.master = null; this.volume = Number(localStorage.getItem('zr_vol') ?? 0.6); this.wind = null; }
  unlock() {
    if (this.ctx) { this.ctx.resume(); if (this.wantMusic) this.menuMusic(true); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C(); this.master = this.ctx.createGain(); this.master.gain.value = this.volume * (this.sfx ?? 1); this.master.connect(this.ctx.destination);
    this.buildReverb();
    const n = this.ctx.sampleRate; this.noise = this.ctx.createBuffer(1, n, n); const d = this.noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  /** Reverb por convolução com resposta ao impulso sintetizada (cauda de ~1.6 s). */
  buildReverb() {
    const c = this.ctx, len = c.sampleRate * 1.6, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    this.verb = c.createConvolver(); this.verb.buffer = ir; this.verbGain = c.createGain(); this.verbGain.gain.value = 0.22;
    this.verb.connect(this.verbGain).connect(this.master);
  }
  setVolumes(master, sfx, music) {
    this.volume = master; this.sfx = sfx; this.musicVol = music;
    if (this.master) this.master.gain.value = master * sfx;
    if (this.music && this.wantMusic) this.music.volume = Math.max(0, Math.min(1, master * music * 1.4));
  }
  /** Música do menu: faixa enviada pelo usuário (assets/audio/menu.mp3), em loop, com fade. */
  menuMusic(on) {
    this.wantMusic = on;
    if (!this.music) {
      this.music = new Audio(new URL('../../assets/audio/menu.mp3', import.meta.url).href);
      this.music.loop = true; this.music.preload = 'auto'; this.music.volume = 0;
    }
    const target = () => Math.max(0, Math.min(1, (this.volume ?? 0.6) * (this.musicVol ?? 0.35) * 1.4));
    clearInterval(this.musicFade);
    if (on) this.music.play().catch(() => { /* sem interação ainda: toca no primeiro clique */ });
    this.musicFade = setInterval(() => {
      const t = on ? target() : 0, v = this.music.volume + Math.sign(t - this.music.volume) * 0.03;
      this.music.volume = Math.abs(t - this.music.volume) < 0.035 ? t : Math.max(0, Math.min(1, v));
      if (this.music.volume === t) { clearInterval(this.musicFade); if (!on) this.music.pause(); }
    }, 60);
  }
  listener(pos, yaw) {
    this.lp = { x: pos.x, z: pos.z };
    if (!this.ctx) return; const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) { L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(-Math.sin(yaw), t); L.forwardY.setValueAtTime(0, t); L.forwardZ.setValueAtTime(-Math.cos(yaw), t); L.upY.setValueAtTime(1, t); }
  }
  out(pos) {
    if (!pos) return this.master;
    // HRTF só para sons próximos (é caro); os distantes usam equalpower
    const p = this.ctx.createPanner(); p.panningModel = this.dist(pos) < 25 ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 4; p.maxDistance = 400; p.rolloffFactor = 1.1;
    p.positionX.value = pos.x; p.positionY.value = pos.y ?? 1; p.positionZ.value = pos.z; p.connect(this.master); return p;
  }
  /** Limite de vozes simultâneas: tiroteio com dezenas de bots criava centenas de nós de áudio por segundo. */
  voice(pos, len) {
    if (pos && this.dist(pos) > 260) return false;                 // inaudível mesmo
    if ((this.voices ?? 0) > (pos ? 28 : 40)) return false;         // sons locais têm prioridade
    this.voices = (this.voices ?? 0) + 1; setTimeout(() => { this.voices--; }, (len + 0.1) * 1000); return true;
  }
  burst({ freq = 1200, len = 0.18, vol = 0.6, type = 'lowpass', pos, verb = 0, q = 0.7, attack = 0, delay = 0 } = {}) {
    if (!this.ctx || !this.voice(pos, len + delay)) return; const c = this.ctx, s = c.createBufferSource(), t = c.currentTime + delay; s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); } else g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    const out = this.out(pos); s.connect(f).connect(g).connect(out);
    if (verb && this.verb) { const vg = c.createGain(); vg.gain.value = verb; g.connect(vg).connect(this.verb); }
    s.start(t, Math.random() * 0.5); s.stop(t + len + 0.05);
  }
  dist(pos) { return pos && this.lp ? Math.hypot(pos.x - this.lp.x, pos.z - this.lp.z) : 0; }
  tone(freq, len, vol = 0.12, type = 'square', pos) {
    if (!this.ctx || !this.voice(pos, len)) return; const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + len);
    o.connect(g).connect(this.out(pos)); o.start(); o.stop(c.currentTime + len);
  }
  /** Tiro em camadas: estalo (transiente), corpo, grave e cauda com reverb; distância abafa os agudos. */
  shot(weapon, pos, local = false) {
    const PROF = { pistol: [1700, 0.12, 0.7], pistol45: [1250, 0.17, 1.05], smg: [1900, 0.1, 0.8], smg2: [2100, 0.08, 0.7], ar: [1400, 0.16, 1], battle: [1050, 0.2, 1.2], shotgun: [700, 0.3, 1.5], dmr: [600, 0.45, 1.6], sniper: [450, 0.65, 1.9] };
    const p = PROF[weapon] ?? PROF[classOf(weapon)] ?? [1200, 0.16, 1];
    const d = local ? 0 : this.dist(pos), far = Math.min(1, d / 180), P = local ? null : pos;
    const v = local ? 0.55 : 0.95;
    this.burst({ freq: 4200 * (1 - far * 0.85), len: 0.035, vol: v * 0.9 * (1 - far * 0.7), type: 'highpass', pos: P });
    this.burst({ freq: p[0] * (1 - far * 0.6), len: p[1], vol: v, pos: P, verb: 0.5 + far * 0.8 });
    this.burst({ freq: 140, len: p[1] * 1.8, vol: v * 0.7 * p[2], pos: P, q: 1.2 });
    if (local) this.tone(70, 0.08, 0.18, 'sine');
    if (far > 0.3) this.burst({ freq: 380, len: 0.9, vol: 0.25 * far, pos: P, delay: 0.06, verb: 0.8 });
  }
  /** Passo: terra (grave, arenoso) ou piso duro (clique). */
  step(pos, vol = 0.6, surface = 'dirt') {
    if (surface === 'hard') { this.burst({ freq: 1800, len: 0.04, vol: 0.14 * vol, type: 'bandpass', q: 2, pos }); this.burst({ freq: 300, len: 0.06, vol: 0.12 * vol, pos }); }
    else { this.burst({ freq: 700, len: 0.09, vol: 0.16 * vol, type: 'bandpass', q: 0.8, pos, attack: 0.01 }); this.burst({ freq: 200, len: 0.07, vol: 0.1 * vol, pos }); }
  }
  whoosh(pos) { this.burst({ freq: 900, len: 0.22, vol: 0.35, type: 'bandpass', q: 1.5, attack: 0.08, pos }); }
  stab() { this.burst({ freq: 400, len: 0.12, vol: 0.5 }); this.tone(160, 0.1, 0.15, 'sine'); }
  smokePop(pos) { this.burst({ freq: 600, len: 0.25, vol: 0.5, pos }); this.burst({ freq: 3000, len: 2.2, vol: 0.18, type: 'highpass', pos, attack: 0.2 }); }
  ping(kind) { this.tone(kind === 'enemy' ? 1320 : 990, 0.08, 0.08, 'sine'); setTimeout(() => this.tone(kind === 'enemy' ? 1760 : 1320, 0.1, 0.07, 'sine'), 80); }
  land(speed) { const k = Math.min(1, speed / 12); this.burst({ freq: 260, len: 0.18, vol: 0.3 + 0.4 * k }); this.burst({ freq: 900, len: 0.06, vol: 0.15 + 0.2 * k, type: 'bandpass' }); }
  reloadClick(stage) { this.tone(stage ? 1500 : 900, 0.03, 0.06, 'square'); this.burst({ freq: 2500, len: 0.03, vol: 0.12, type: 'highpass' }); }
  hit(head) { this.tone(head ? 2200 : 1700, 0.05, 0.09); }
  kill() { this.tone(1200, 0.08, 0.12); setTimeout(() => this.tone(1600, 0.12, 0.12), 70); }
  crack() { this.tone(2600, 0.1, 0.08, 'triangle'); }
  explosion(pos) { this.burst({ freq: 260, len: 1.1, vol: 1.4, pos }); this.burst({ freq: 90, len: 1.6, vol: 1, pos }); }
  ui() { this.tone(900, 0.04, 0.05, 'sine'); }
  cash() { this.tone(1400, 0.06, 0.06, 'sine'); setTimeout(() => this.tone(1900, 0.08, 0.06, 'sine'), 60); }
  warn() { this.tone(440, 0.25, 0.08, 'sawtooth'); }
  setWind(on, strength = 1) {
    if (!this.ctx) return;
    if (on && !this.wind) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; const g = this.ctx.createGain(); g.gain.value = 0.15 * strength; s.connect(f).connect(g).connect(this.master); s.start(); this.wind = { s, g }; }
    else if (on) this.wind.g.gain.value = 0.15 * strength;
    else if (this.wind) { this.wind.s.stop(); this.wind = null; }
  }
}
