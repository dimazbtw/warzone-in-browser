import { makeRng } from './core/math.js';

/**
 * MapData — geometria mínima autoritativa do mapa (caixas AABB).
 * O cliente recebe a MESMA lista (gerada pela mesma seed) para desenhar,
 * mas colisão, linha de visão das balas e spawn seguro são calculados aqui.
 * Etapa 2 (movimento) usa `boxes` para mantle/vault/escalada.
 */
export class MapData {
  constructor(size, seed = 7) {
    this.size = size; this.seed = seed; this.boxes = [];
    const rng = makeRng(seed), half = size / 2;
    const pois = [
      { name: 'Vila Serena', x: -110, z: -110, n: 10, s: 40 }, { name: 'Porto Cinza', x: 120, z: -120, n: 9, s: 38 },
      { name: 'Usina Velha', x: -115, z: 100, n: 7, s: 40 }, { name: 'Centro', x: 20, z: 20, n: 14, s: 50 },
      { name: 'Mirante', x: 130, z: 120, n: 6, s: 30 },
    ];
    this.pois = pois.map(({ name, x, z }) => ({ name, x, z }));
    const overlaps = (b, pad) => this.boxes.some(o => b.minX - pad < o.maxX && b.maxX + pad > o.minX && b.minZ - pad < o.maxZ && b.maxZ + pad > o.minZ);
    for (const p of pois) for (let i = 0; i < p.n * 3 && i < 60; i++) {
      const w = rng.range(8, 18), d = rng.range(8, 18), h = rng.range(5, 18);
      const x = p.x + rng.range(-p.s, p.s), z = p.z + rng.range(-p.s, p.s);
      const b = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h, kind: 'building' };
      if (Math.abs(b.minX) > half - 5 || Math.abs(b.maxX) > half - 5 || Math.abs(b.minZ) > half - 5 || Math.abs(b.maxZ) > half - 5 || overlaps(b, 4)) continue;
      this.boxes.push(b);
      if (this.boxes.filter(o => o.kind === 'building').length >= pois.reduce((s, q) => s + q.n, 0)) break;
    }
    for (let i = 0; i < 60; i++) {
      const x = rng.range(-half + 10, half - 10), z = rng.range(-half + 10, half - 10), r = rng() < 0.5;
      const b = { minX: x - (r ? 3 : 1.25), maxX: x + (r ? 3 : 1.25), minZ: z - (r ? 1.25 : 3), maxZ: z + (r ? 1.25 : 3), h: 2.6, kind: 'container' };
      if (!overlaps(b, 3)) this.boxes.push(b);
    }
  }
  groundHeight() { return 0; }
  isBlocked(x, z, r = 0) { return this.boxes.some(b => x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r); }

  /** Empurra um jogador (cilindro r=0.4) para fora das caixas. */
  resolve(p, r = 0.4) {
    for (const b of this.boxes) {
      if (p.pos.y >= b.h) continue;
      const nx = Math.max(b.minX, Math.min(p.pos.x, b.maxX)), nz = Math.max(b.minZ, Math.min(p.pos.z, b.maxZ));
      const dx = p.pos.x - nx, dz = p.pos.z - nz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); p.pos.x = nx + dx / d * r; p.pos.z = nz + dz / d * r; }
      else {
        const pen = [p.pos.x - b.minX, b.maxX - p.pos.x, p.pos.z - b.minZ, b.maxZ - p.pos.z], i = pen.indexOf(Math.min(...pen));
        if (i === 0) p.pos.x = b.minX - r; else if (i === 1) p.pos.x = b.maxX + r; else if (i === 2) p.pos.z = b.minZ - r; else p.pos.z = b.maxZ + r;
      }
    }
  }

  /** Distância até a primeira parede no raio (slab test), ou null. */
  raycast(o, d, maxDist) {
    let best = null;
    for (const b of this.boxes) {
      let t0 = 0, t1 = maxDist;
      for (const [oa, da, mn, mx] of [[o.x, d.x, b.minX, b.maxX], [o.y, d.y, 0, b.h], [o.z, d.z, b.minZ, b.maxZ]]) {
        if (Math.abs(da) < 1e-9) { if (oa < mn || oa > mx) { t0 = Infinity; break; } continue; }
        let ta = (mn - oa) / da, tb = (mx - oa) / da; if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) break;
      }
      if (t0 <= t1 && t0 < maxDist && (best === null || t0 < best)) best = t0;
    }
    return best;
  }
  view() { return { size: this.size, seed: this.seed, pois: this.pois, boxes: this.boxes.map(b => [+b.minX.toFixed(2), +b.minZ.toFixed(2), +b.maxX.toFixed(2), +b.maxZ.toFixed(2), +b.h.toFixed(2), b.kind === 'container' ? 1 : 0]) }; }
}
