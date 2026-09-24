/**
 * AudioSystem — sons 100% sintetizados (sem assets de terceiros), com
 * posicionamento 3D via PannerNode. O listener acompanha a câmera.
 */
export class AudioSystem {
  constructor() { this.ctx = null; this.master = null; this.volume = Number(localStorage.getItem('zr_vol') ?? 0.6); this.wind = null; }
  unlock() {
    if (this.ctx) { this.ctx.resume(); if (this.wantMusic && !this.musicTimer) this.menuMusic(true); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C(); this.master = this.ctx.createGain(); this.master.gain.value = this.volume * (this.sfx ?? 1); this.master.connect(this.ctx.destination);
    const n = this.ctx.sampleRate; this.noise = this.ctx.createBuffer(1, n, n); const d = this.noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  setVolumes(master, sfx, music) {
    this.volume = master; this.sfx = sfx; this.musicVol = music;
    if (this.master) this.master.gain.value = master * sfx;
    if (this.musicGain) this.musicGain.gain.value = master * music * 0.5;
  }
  /** Música ambiente generativa do menu (acordes lentos sintetizados). */
  menuMusic(on) {
    this.wantMusic = on;
    if (!this.ctx) return;
    if (on && !this.musicTimer) {
      const c = this.ctx; this.musicGain = c.createGain(); this.musicGain.gain.value = (this.volume ?? 0.8) * (this.musicVol ?? 0.35) * 0.5; this.musicGain.connect(c.destination);
      const chords = [[110, 164.8, 220, 261.6], [98, 146.8, 196, 246.9], [87.3, 130.8, 174.6, 220], [103.8, 155.6, 207.7, 261.6]];
      let i = 0;
      const play = () => {
        const t = c.currentTime;
        for (const f of chords[i++ % chords.length]) {
          const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
          o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
          lp.type = 'lowpass'; lp.frequency.value = 600;
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 2); g.gain.linearRampToValueAtTime(0, t + 7.8);
          o.connect(lp).connect(g).connect(this.musicGain); o.start(t); o.stop(t + 8);
        }
      };
      play(); this.musicTimer = setInterval(play, 7000);
    } else if (!on && this.musicTimer) {
      clearInterval(this.musicTimer); this.musicTimer = null;
      const g = this.musicGain; g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4); setTimeout(() => g.disconnect(), 2500);
    }
  }
  listener(pos, yaw) {
    if (!this.ctx) return; const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) { L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(-Math.sin(yaw), t); L.forwardY.setValueAtTime(0, t); L.forwardZ.setValueAtTime(-Math.cos(yaw), t); L.upY.setValueAtTime(1, t); }
  }
  out(pos) {
    if (!pos) return this.master;
    const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.maxDistance = 400; p.rolloffFactor = 1.1;
    p.positionX.value = pos.x; p.positionY.value = pos.y ?? 1; p.positionZ.value = pos.z; p.connect(this.master); return p;
  }
  burst({ freq = 1200, len = 0.18, vol = 0.6, type = 'lowpass', pos } = {}) {
    if (!this.ctx) return; const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + len);
    s.connect(f).connect(g).connect(this.out(pos)); s.start(); s.stop(c.currentTime + len);
  }
  tone(freq, len, vol = 0.12, type = 'square', pos) {
    if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + len);
    o.connect(g).connect(this.out(pos)); o.start(); o.stop(c.currentTime + len);
  }
  shot(weapon, pos, local = false) {
    const p = { sidearm: [1600, 0.14], rifle: [1300, 0.18], battle: [900, 0.24], smg: [1800, 0.12], shotgun: [600, 0.35], marksman: [500, 0.55] }[weapon] ?? [1200, 0.18];
    this.burst({ freq: p[0], len: p[1], vol: local ? 0.5 : 0.9, pos: local ? null : pos });
    if (!local) this.burst({ freq: 300, len: p[1] * 2, vol: 0.25, pos });
  }
  hit(head) { this.tone(head ? 2200 : 1700, 0.05, 0.09); }
  kill() { this.tone(1200, 0.08, 0.12); setTimeout(() => this.tone(1600, 0.12, 0.12), 70); }
  crack() { this.tone(2600, 0.1, 0.08, 'triangle'); }
  explosion(pos) { this.burst({ freq: 260, len: 1.1, vol: 1.4, pos }); this.burst({ freq: 90, len: 1.6, vol: 1, pos }); }
  ui() { this.tone(900, 0.04, 0.05, 'sine'); }
  cash() { this.tone(1400, 0.06, 0.06, 'sine'); setTimeout(() => this.tone(1900, 0.08, 0.06, 'sine'), 60); }
  warn() { this.tone(440, 0.25, 0.08, 'sawtooth'); }
  step(pos) { this.burst({ freq: 400, len: 0.05, vol: 0.12, pos }); }
  setWind(on, strength = 1) {
    if (!this.ctx) return;
    if (on && !this.wind) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; const g = this.ctx.createGain(); g.gain.value = 0.15 * strength; s.connect(f).connect(g).connect(this.master); s.start(); this.wind = { s, g }; }
    else if (on) this.wind.g.gain.value = 0.15 * strength;
    else if (this.wind) { this.wind.s.stop(); this.wind = null; }
  }
}
