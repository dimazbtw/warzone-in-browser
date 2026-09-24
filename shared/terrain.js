/**
 * Terrain — relevo determinístico compartilhado (servidor e cliente geram o mesmo).
 * Usa só aritmética (+ - * / floor), sem sin/cos/exp, para dar resultado idêntico
 * em qualquer motor JavaScript. Grade com interpolação bilinear.
 *
 * params: { seed, size, cell, amp, flats: [{x, z, r, h}] }
 *   flats = áreas aplanadas (vilas, bases de prédios, estradas) na altura h.
 */
function hash(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class Terrain {
  constructor(params) {
    this.params = params;
    const { size, cell = 4 } = params;
    this.size = size; this.cell = cell; this.n = Math.round(size / cell) + 1; this.half = size / 2;
    this.h = new Float32Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) this.h[j * this.n + i] = this.raw(-this.half + i * cell, -this.half + j * cell);
  }
  /** Altura "crua" (sem grade). */
  raw(x, z) {
    const { seed = 1, amp = 12, flats = [] } = this.params, half = this.half;
    let n = 0, a = 1, f = 1 / 90, tot = 0;
    for (let o = 0; o < 4; o++) { n += valueNoise(x * f, z * f, seed + o * 17) * a; tot += a; a *= 0.5; f *= 2.1; }
    let h = (n / tot) * amp * 1.35 - amp * 0.2;
    // borda da ilha desce até a praia
    const edge = Math.max(Math.abs(x), Math.abs(z)) / half;
    h *= 1 - smooth((edge - 0.78) / 0.2);
    h = Math.max(0.15, h);
    for (const p of flats) {
      const d = Math.sqrt((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z));
      if (d < p.r + 14) { const k = smooth((d - p.r) / 14); h = p.h + (h - p.h) * k; }
    }
    return h;
  }
  heightAt(x, z) {
    const c = this.cell, fx = (x + this.half) / c, fz = (z + this.half) / c;
    const i = Math.max(0, Math.min(this.n - 2, Math.floor(fx))), j = Math.max(0, Math.min(this.n - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j)), n = this.n, H = this.h;
    const a = H[j * n + i], b = H[j * n + i + 1], cc = H[(j + 1) * n + i], d = H[(j + 1) * n + i + 1];
    return a + (b - a) * tx + (cc - a) * tz + (a - b - cc + d) * tx * tz;
  }
}
