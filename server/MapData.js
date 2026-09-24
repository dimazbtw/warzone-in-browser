import { makeRng } from './core/math.js';
import { MapGeometry } from '../shared/geometry.js';

/**
 * MapData — gera o mapa (determinístico pela seed) sobre a MapGeometry compartilhada.
 * POIs com prédios (alguns escaláveis), contêineres (mantle), muretas (vault),
 * pontos de estações de compra e de contratos.
 */
export class MapData extends MapGeometry {
  constructor(size, seed = 7) {
    super(size, []);
    this.seed = seed;
    const rng = makeRng(seed), half = size / 2;
    const pois = [
      { name: 'Vila Serena', x: -110, z: -110, n: 10, s: 40 }, { name: 'Porto Cinza', x: 120, z: -120, n: 9, s: 38 },
      { name: 'Usina Velha', x: -115, z: 100, n: 7, s: 40 }, { name: 'Centro', x: 20, z: 20, n: 14, s: 50 },
      { name: 'Mirante', x: 130, z: 120, n: 6, s: 30 },
    ];
    this.pois = pois.map(({ name, x, z }) => ({ name, x, z }));
    const inside = b => Math.abs(b.minX) < half - 5 && Math.abs(b.maxX) < half - 5 && Math.abs(b.minZ) < half - 5 && Math.abs(b.maxZ) < half - 5;
    const overlaps = (b, pad) => this.boxes.some(o => b.minX - pad < o.maxX && b.maxX + pad > o.minX && b.minZ - pad < o.maxZ && b.maxZ + pad > o.minZ);
    const add = (b, pad) => { if (inside(b) && !overlaps(b, pad)) { this.boxes.push(b); return true; } return false; };
    for (const p of pois) {
      let placed = 0;
      for (let i = 0; i < p.n * 4 && placed < p.n; i++) {
        const w = rng.range(8, 18), d = rng.range(8, 18), h = rng.range(4, 16);
        const x = p.x + rng.range(-p.s, p.s), z = p.z + rng.range(-p.s, p.s);
        if (add({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h, kind: 'building', climb: h < 11 && rng() < 0.55 }, 4)) placed++;
      }
    }
    for (let i = 0; i < 70; i++) {
      const x = rng.range(-half + 10, half - 10), z = rng.range(-half + 10, half - 10), r = rng() < 0.5;
      add({ minX: x - (r ? 3 : 1.25), maxX: x + (r ? 3 : 1.25), minZ: z - (r ? 1.25 : 3), maxZ: z + (r ? 1.25 : 3), h: 2.6, kind: 'container', climb: false }, 3);
    }
    for (let i = 0; i < 90; i++) {   // muretas / sacos de areia
      const x = rng.range(-half + 10, half - 10), z = rng.range(-half + 10, half - 10), r = rng() < 0.5, len = rng.range(2.5, 6);
      add({ minX: x - (r ? len / 2 : 0.3), maxX: x + (r ? len / 2 : 0.3), minZ: z - (r ? 0.3 : len / 2), maxZ: z + (r ? 0.3 : len / 2), h: 1.05, kind: 'cover', climb: false }, 2);
    }
    // pontos de interesse de sistemas (estações / contratos) em locais livres
    const freeSpot = (cx, cz, spread) => { for (let i = 0; i < 50; i++) { const x = cx + rng.range(-spread, spread), z = cz + rng.range(-spread, spread); if (!this.isBlocked(x, z, 2) && Math.abs(x) < half - 8 && Math.abs(z) < half - 8) return { x, z }; } return { x: cx, z: cz }; };
    this.stationSpots = [...pois.map(p => freeSpot(p.x, p.z, 30)), freeSpot(-20, 150, 30), freeSpot(150, 10, 30), freeSpot(-160, 0, 30)];
    this.contractSpots = Array.from({ length: 22 }, () => freeSpot(0, 0, half - 15));
  }
  view() { return { size: this.size, seed: this.seed, pois: this.pois, boxes: super.view(), stations: this.stationSpots }; }
}
