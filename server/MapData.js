import { makeRng } from './core/math.js';
import { MapGeometry } from '../shared/geometry.js';
import { Terrain } from '../shared/terrain.js';

/**
 * MapData — gera a ilha (determinística pela seed):
 *   relevo com platôs nas vilas, prédios com interior (portas, janelas, andares,
 *   escadas até o telhado, divisórias, parapeito), galpões, contêineres empilhados,
 *   sacos de areia, rochas e árvores. Também define pontos de loot, baús,
 *   estações de compra e tablets de contrato.
 */
const FLOOR_H = 3.2, WALL_T = 0.3, SLAB = 0.25;

export class MapData extends MapGeometry {
  constructor(size, seed = 7) {
    super(size, []);
    this.seed = seed;
    const rng = this.rng = makeRng(seed * 7919 + 13), half = size / 2;
    // ---------- POIs e platôs ----------
    const POI_DEFS = [
      { name: 'Vila Serena', style: 'houses', n: 9, s: 40 }, { name: 'Porto Cinza', style: 'port', n: 5, s: 42 },
      { name: 'Usina Velha', style: 'industrial', n: 5, s: 38 }, { name: 'Centro', style: 'city', n: 11, s: 48 },
      { name: 'Mirante', style: 'houses', n: 5, s: 30 }, { name: 'Fazenda Sol', style: 'farm', n: 4, s: 32 },
      { name: 'Quartel', style: 'military', n: 6, s: 36 },
    ];
    const anchors = [[-120, -115], [125, -125], [-120, 110], [15, 10], [135, 120], [-10, 150], [150, 5]];
    const base = new Terrain({ size, seed, amp: 13, flats: [] });
    this.pois = POI_DEFS.map((p, i) => {
      const [ax, az] = anchors[i]; const x = ax + rng.range(-12, 12), z = az + rng.range(-12, 12);
      return { ...p, x, z, r: p.s + 10, h: Math.max(1.2, base.raw(x, z)) };
    });
    const flats = this.pois.map(p => ({ x: p.x, z: p.z, r: p.r, h: p.h }));
    // prédios isolados com platô próprio
    this.lone = [];
    for (let i = 0; i < 12; i++) {
      const x = rng.range(-half + 40, half - 40), z = rng.range(-half + 40, half - 40);
      if (this.pois.some(p => Math.hypot(p.x - x, p.z - z) < p.r + 25)) continue;
      const h = Math.max(1.2, base.raw(x, z)); this.lone.push({ x, z, h }); flats.push({ x, z, r: 11, h });
    }
    this.terrainParams = { seed, amp: 13, cell: 4, flats };
    this.terrain = new Terrain({ size, ...this.terrainParams });

    this.lootSpots = []; this.chestSpots = []; this.trees = []; this.buildings = [];
    // ---------- prédios nos POIs ----------
    for (const p of this.pois) {
      let placed = 0;
      for (let tries = 0; tries < p.n * 12 && placed < p.n; tries++) {
        const spec = this.buildingSpec(p.style);
        const x = p.x + rng.range(-p.s, p.s), z = p.z + rng.range(-p.s, p.s);
        if (Math.hypot(x - p.x, z - p.z) > p.s + 4) continue;
        if (this.placeBuilding(x, z, spec, p.h)) placed++;
      }
      this.decoratePoi(p);
    }
    for (const l of this.lone) this.placeBuilding(l.x, l.z, this.buildingSpec(rng() < 0.5 ? 'farm' : 'houses'), l.h);
    // ---------- natureza e cobertura ----------
    this.scatter();
    this.buildIndex();
    // ---------- pontos de sistemas ----------
    const free = (cx, cz, spread) => {
      for (let i = 0; i < 80; i++) {
        const x = cx + rng.range(-spread, spread), z = cz + rng.range(-spread, spread);
        if (Math.abs(x) < half - 12 && Math.abs(z) < half - 12 && !this.isBlocked(x, z, 2.2)) return { x, z, y: this.terrainHeight(x, z) };
      }
      return { x: cx, z: cz, y: this.terrainHeight(cx, cz) };
    };
    this.stationSpots = [...this.pois.map(p => free(p.x, p.z, p.s * 0.6)), free(-170, 10, 20), free(60, -170, 20), free(-60, -40, 25)];
    this.contractSpots = [...this.pois.map(p => free(p.x, p.z, p.s)), ...Array.from({ length: 16 }, () => free(0, 0, half - 25))];
    for (let i = 0; i < 70; i++) { const s = free(0, 0, half - 15); this.lootSpots.push({ ...s, outdoor: true }); }
  }

  // ------------------------------------------------ prédios
  buildingSpec(style) {
    const r = this.rng;
    switch (style) {
      case 'city': return { type: 'apartment', w: r.range(10, 15), d: r.range(10, 14), floors: r.int(2, 4), mat: r.int(0, 2) };
      case 'industrial': return r() < 0.6 ? { type: 'warehouse', w: r.range(16, 24), d: r.range(12, 18), floors: 1, mat: 3 } : { type: 'apartment', w: r.range(9, 12), d: r.range(9, 12), floors: 2, mat: 3 };
      case 'port': return r() < 0.5 ? { type: 'warehouse', w: r.range(18, 26), d: r.range(12, 16), floors: 1, mat: 4 } : { type: 'house', w: r.range(8, 10), d: r.range(8, 10), floors: 1, mat: 4 };
      case 'military': return r() < 0.4 ? { type: 'warehouse', w: r.range(14, 18), d: r.range(10, 13), floors: 1, mat: 5 } : { type: 'house', w: r.range(9, 12), d: r.range(8, 10), floors: r.int(1, 2), mat: 5 };
      case 'farm': return r() < 0.35 ? { type: 'warehouse', w: r.range(12, 16), d: r.range(9, 12), floors: 1, mat: 1 } : { type: 'house', w: r.range(8, 11), d: r.range(8, 10), floors: r.int(1, 2), mat: 1 };
      default: return { type: 'house', w: r.range(8, 12), d: r.range(8, 11), floors: r.int(1, 2), mat: r.int(0, 2) };
    }
  }

  placeBuilding(cx, cz, spec, h) {
    const { w, d } = spec, half = this.size / 2;
    const bb = { minX: cx - w / 2 - 3, maxX: cx + w / 2 + 3, minZ: cz - d / 2 - 3, maxZ: cz + d / 2 + 3 };
    if (Math.abs(bb.minX) > half - 20 || Math.abs(bb.maxX) > half - 20 || Math.abs(bb.minZ) > half - 20 || Math.abs(bb.maxZ) > half - 20) return false;
    if (this.buildings.some(o => bb.minX < o.maxX && bb.maxX > o.minX && bb.minZ < o.maxZ && bb.maxZ > o.minZ)) return false;
    const y = h;   // platô
    this.buildings.push({ ...bb, cx, cz, spec, y });
    if (spec.type === 'warehouse') this.warehouse(cx, cz, spec, y); else this.house(cx, cz, spec, y);
    return true;
  }

  box(minX, maxX, minZ, maxZ, y0, y1, kind, mat = 0, climb = false) {
    if (maxX - minX < 0.05 || maxZ - minZ < 0.05 || y1 - y0 < 0.05) return;
    this.boxes.push({ minX, maxX, minZ, maxZ, y0, y1, h: y1, kind, mat, climb });
  }

  /** Parede ao longo de X (z fixo) com aberturas [{a,b,lo,hi}] relativas ao piso. */
  wallX(z, x0, x1, y, height, openings, mat, climbSeg = false) {
    const t = WALL_T / 2; let cur = x0;
    for (const o of [...openings].sort((a, b) => a.a - b.a)) {
      this.box(cur, o.a, z - t, z + t, y, y + height, 'wall', mat, climbSeg);
      if (o.lo > 0.05) this.box(o.a, o.b, z - t, z + t, y, y + o.lo, 'wall', mat);
      if (o.hi < height - 0.05) this.box(o.a, o.b, z - t, z + t, y + o.hi, y + height, 'wall', mat);
      cur = o.b;
    }
    this.box(cur, x1, z - t, z + t, y, y + height, 'wall', mat);
  }
  wallZ(x, z0, z1, y, height, openings, mat, climbSeg = false) {
    const t = WALL_T / 2; let cur = z0;
    for (const o of [...openings].sort((a, b) => a.a - b.a)) {
      this.box(x - t, x + t, cur, o.a, y, y + height, 'wall', mat, climbSeg);
      if (o.lo > 0.05) this.box(x - t, x + t, o.a, o.b, y, y + o.lo, 'wall', mat);
      if (o.hi < height - 0.05) this.box(x - t, x + t, o.a, o.b, y + o.hi, y + height, 'wall', mat);
      cur = o.b;
    }
    this.box(x - t, x + t, cur, z1, y, y + height, 'wall', mat);
  }
  windows(a0, a1, spacing = 3.4) {
    const out = [], n = Math.max(0, Math.floor((a1 - a0 - 1.6) / spacing));
    const start = a0 + (a1 - a0 - (n - 1) * spacing) / 2;
    for (let i = 0; i < n; i++) { const c = start + i * spacing; out.push({ a: c - 0.6, b: c + 0.6, lo: 1.0, hi: 2.15 }); }
    return out;
  }

  /** Casa/prédio de N andares com escada interna até o telhado. */
  house(cx, cz, spec, y0) {
    const r = this.rng, { w, d, floors, mat } = spec;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const stepRise = FLOOR_H / 12, run = 0.3, stairW = 1.2, stairL = 12 * run;
    const sx = x0 + WALL_T + 0.4, sz0 = z0 + WALL_T / 2 + 0.05, sz1 = sz0 + stairW;   // escada encostada na parede de trás
    const partition = w > 12.5 ? cx + r.range(-1, 1.5) : null;
    const ladder = r() < 0.35;
    this.box(x0, x1, z0, z1, y0 - 0.6, y0 + 0.1, 'floor', 6 + (mat % 2));        // piso térreo
    for (let f = 0; f <= floors; f++) {
      const y = y0 + 0.1 + f * FLOOR_H, roof = f === floors;
      // laje deste nível (menos o térreo) com vão da escada que chega aqui
      if (f > 0) {
        const hx0 = sx - 0.1, hx1 = sx + stairL + 0.5;
        this.box(x0, hx0, z0, z1, y - SLAB, y, roof ? 'roof' : 'floor', roof ? 8 : 6);
        this.box(hx1, x1, z0, z1, y - SLAB, y, roof ? 'roof' : 'floor', roof ? 8 : 6);
        this.box(hx0, hx1, sz1 + 0.05, z1, y - SLAB, y, roof ? 'roof' : 'floor', roof ? 8 : 6);
      }
      if (roof) {
        // parapeito (mantle/vault possível) + casinha da escada
        const ph = 0.95;
        this.wallX(z0 + WALL_T / 2, x0, x1, y, ph, [], mat); this.wallX(z1 - WALL_T / 2, x0, x1, y, ph, [], mat);
        this.wallZ(x0 + WALL_T / 2, z0, z1, y, ph, [], mat); this.wallZ(x1 - WALL_T / 2, z0, z1, y, ph, [], mat);
        this.lootSpots.push({ x: cx + r.range(-w / 4, w / 4), z: cz + r.range(0, d / 4), y });
        break;
      }
      // paredes externas com janelas; portas no térreo
      const openF = this.windows(x0 + 0.5, x1 - 0.5), openB = this.windows(x0 + stairL + 1.2, x1 - 0.5), openL = this.windows(z0 + 0.5, z1 - 0.5), openR = this.windows(z0 + 0.5, z1 - 0.5);
      if (f === 0) {
        const dc = cx + r.range(-w / 4, w / 4);
        for (const list of [openF]) { for (let i = list.length - 1; i >= 0; i--) if (Math.abs((list[i].a + list[i].b) / 2 - dc) < 1.6) list.splice(i, 1); list.push({ a: dc - 0.7, b: dc + 0.7, lo: 0, hi: 2.3 }); }
        if (r() < 0.7) { const side = r() < 0.5 ? openL : openR, c = cz + r.range(-d / 5, d / 5); for (let i = side.length - 1; i >= 0; i--) if (Math.abs((side[i].a + side[i].b) / 2 - c) < 1.6) side.splice(i, 1); side.push({ a: c - 0.65, b: c + 0.65, lo: 0, hi: 2.3 }); }
      }
      this.wallX(z1 - WALL_T / 2, x0, x1, y, FLOOR_H - SLAB, openF, mat);
      this.wallX(z0 + WALL_T / 2, x0, x1, y, FLOOR_H - SLAB, openB, mat);
      this.wallZ(x0 + WALL_T / 2, z0 + WALL_T, z1 - WALL_T, y, FLOOR_H - SLAB, openL, mat, ladder);
      this.wallZ(x1 - WALL_T / 2, z0 + WALL_T, z1 - WALL_T, y, FLOOR_H - SLAB, openR, mat);
      if (partition) { const dz = cz + r.range(-d / 6, d / 6); this.wallZ(partition, sz1 + 0.3, z1 - WALL_T, y, FLOOR_H - SLAB, [{ a: dz - 0.6, b: dz + 0.6, lo: 0, hi: 2.2 }], 9); }
      // escada deste andar para o próximo (degraus sólidos)
      for (let i = 0; i < 12; i++) this.box(sx + i * run, sx + (i + 1) * run, sz0, sz1, y, y + (i + 1) * stepRise, 'stair', 7);
      // loot e baú nos cômodos
      const spots = 2 + r.int(0, 1);
      for (let k = 0; k < spots; k++) this.lootSpots.push({ x: r.range(x0 + 1.2, x1 - 1.2), z: r.range(sz1 + 0.8, z1 - 1.2), y });
      if (f === floors - 1 || r() < 0.3) { if (!this.chestFor?.has(cx)) { (this.chestFor ??= new Set()).add(cx); this.chestSpots.push({ x: r.range(x0 + 1.5, x1 - 1.5), z: z1 - 1.1, y, rot: 0 }); } }
    }
  }

  /** Galpão alto de um andar, portões largos, escada externa até o telhado. */
  warehouse(cx, cz, spec, y0) {
    const r = this.rng, { w, d, mat } = spec, H = 6.5;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    this.box(x0, x1, z0, z1, y0 - 0.6, y0 + 0.1, 'floor', 7);
    const y = y0 + 0.1;
    const gate = c => ({ a: c - 2.2, b: c + 2.2, lo: 0, hi: 4.2 });
    const hi = this.windows(x0 + 1, x1 - 1, 4).map(o => ({ ...o, lo: 4.4, hi: 5.4 }));
    this.wallX(z1 - WALL_T / 2, x0, x1, y, H, [gate(cx + r.range(-w / 5, w / 5)), ...hi.filter(o => Math.abs(o.a - cx) > 3)], mat);
    this.wallX(z0 + WALL_T / 2, x0, x1, y, H, r() < 0.5 ? [gate(cx)] : hi, mat);
    this.wallZ(x0 + WALL_T / 2, z0 + WALL_T, z1 - WALL_T, y, H, [{ a: cz - 0.7, b: cz + 0.7, lo: 0, hi: 2.3 }], mat, true);
    this.wallZ(x1 - WALL_T / 2, z0 + WALL_T, z1 - WALL_T, y, H, [], mat);
    this.box(x0, x1, z0, z1, y + H, y + H + SLAB, 'roof', 8);
    // mezanino com escada
    const mz = z0 + WALL_T + 3, my = y + 3.2;
    this.box(x0 + WALL_T, x1 - WALL_T, z0 + WALL_T, mz, my - SLAB, my, 'floor', 7);
    for (let i = 0; i < 12; i++) this.box(x1 - WALL_T - 1.3, x1 - WALL_T - 0.1, mz + (11 - i) * 0.3, mz + (12 - i) * 0.3, y, y + (i + 1) * (3.2 / 12), 'stair', 7);
    this.box(x0 + WALL_T, x1 - WALL_T - 1.4, mz - 0.1, mz + 0.05, my, my + 1.0, 'wall', 9);   // guarda-corpo
    // caixas e contêineres internos (cobertura)
    for (let i = 0; i < 4; i++) { const px = r.range(x0 + 2, x1 - 3.5), pz = r.range(mz + 1.5, z1 - 3); if (Math.abs(px - (x1 - 1.3)) > 2.5) this.crate(px, pz, y); }
    for (let k = 0; k < 4; k++) this.lootSpots.push({ x: r.range(x0 + 1.5, x1 - 1.5), z: r.range(mz + 1, z1 - 1.5), y });
    this.lootSpots.push({ x: r.range(x0 + 2, x1 - 3), z: (z0 + mz) / 2 + 0.3, y: my });
    this.chestSpots.push({ x: r.range(x0 + 2, x1 - 4), z: (z0 + mz) / 2, y: my, rot: 0 });
  }

  crate(x, z, y) { const s = this.rng.range(1.1, 1.6); this.box(x, x + s, z, z + s, y, y + s * 0.85, 'crate', 10); }

  decoratePoi(p) {
    const r = this.rng;
    const n = p.style === 'port' ? 16 : p.style === 'military' ? 10 : 6;
    for (let i = 0; i < n; i++) {
      const x = p.x + r.range(-p.s, p.s), z = p.z + r.range(-p.s, p.s), rot = r() < 0.5;
      const w = rot ? 6.1 : 2.45, d = rot ? 2.45 : 6.1;
      if (this.overlapsBuilding(x - w / 2 - 1, x + w / 2 + 1, z - d / 2 - 1, z + d / 2 + 1)) continue;
      const y = this.terrainHeight(x, z) - 0.05, col = r.int(0, 3);
      this.box(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y, y + 2.6, 'container', 11 + col);
      if (p.style === 'port' && r() < 0.35) this.box(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y + 2.6, y + 5.2, 'container', 11 + ((col + 1) % 4));
      if (r() < 0.4) this.lootSpots.push({ x: x + (rot ? 0 : w / 2 + 0.8), z: z + (rot ? d / 2 + 0.8 : 0), y: this.terrainHeight(x, z), outdoor: true });
    }
    for (let i = 0; i < (p.style === 'military' ? 14 : 6); i++) this.sandbag(p.x + r.range(-p.s, p.s), p.z + r.range(-p.s, p.s));
  }
  sandbag(x, z) {
    const r = this.rng, rot = r() < 0.5, len = r.range(2.5, 5);
    const b = rot ? [x - len / 2, x + len / 2, z - 0.35, z + 0.35] : [x - 0.35, x + 0.35, z - len / 2, z + len / 2];
    if (this.overlapsBuilding(b[0] - 0.8, b[1] + 0.8, b[2] - 0.8, b[3] + 0.8)) return;
    const y = this.terrainHeight(x, z) - 0.05;
    this.box(b[0], b[1], b[2], b[3], y, y + 1.05, 'cover', 15);
  }
  overlapsBuilding(minX, maxX, minZ, maxZ) {
    return this.buildings.some(o => minX < o.maxX - 2 && maxX > o.minX + 2 && minZ < o.maxZ - 2 && maxZ > o.minZ + 2)
      || this.boxes.some(o => (o.kind === 'container' || o.kind === 'cover' || o.kind === 'rock') && minX < o.maxX && maxX > o.minX && minZ < o.maxZ && maxZ > o.minZ);
  }

  scatter() {
    const r = this.rng, half = this.size / 2;
    // árvores (tronco colide; copa é só visual)
    for (let i = 0; i < 420; i++) {
      const x = r.range(-half + 10, half - 10), z = r.range(-half + 10, half - 10);
      const edge = Math.max(Math.abs(x), Math.abs(z)) / half; if (edge > 0.93) continue;
      if (this.pois.some(p => Math.hypot(p.x - x, p.z - z) < p.s * 0.8) && r() < 0.8) continue;
      if (this.overlapsBuilding(x - 1.5, x + 1.5, z - 1.5, z + 1.5)) continue;
      const y = this.terrainHeight(x, z), h = r.range(6, 11), kind = r() < 0.65 ? 'pine' : 'broad';
      this.box(x - 0.25, x + 0.25, z - 0.25, z + 0.25, y - 0.2, y + h * 0.75, 'trunk', 16);
      this.trees.push([+x.toFixed(2), +y.toFixed(2), +z.toFixed(2), +h.toFixed(1), kind === 'pine' ? 0 : 1, r.int(0, 999)]);
    }
    // rochas
    for (let i = 0; i < 110; i++) {
      const x = r.range(-half + 15, half - 15), z = r.range(-half + 15, half - 15), s = r.range(1.4, 4.2);
      if (this.overlapsBuilding(x - s, x + s, z - s, z + s)) continue;
      const y = this.terrainHeight(x, z);
      this.box(x - s / 2, x + s / 2, z - s * 0.4, z + s * 0.4, y - 0.4, y + s * r.range(0.35, 0.7), 'rock', 17);
    }
    // cobertura espalhada
    for (let i = 0; i < 70; i++) this.sandbag(r.range(-half + 20, half - 20), r.range(-half + 20, half - 20));
    for (let i = 0; i < 35; i++) {
      const x = r.range(-half + 20, half - 20), z = r.range(-half + 20, half - 20);
      if (!this.overlapsBuilding(x - 2, x + 2, z - 2, z + 2)) this.crate(x, z, this.terrainHeight(x, z) - 0.05);
    }
  }

  view() {
    return { size: this.size, seed: this.seed, terrain: this.terrainParams, pois: this.pois.map(p => ({ name: p.name, x: p.x, z: p.z, r: p.s })),
      boxes: this.viewBoxes(), trees: this.trees, stations: this.stationSpots };
  }
}
