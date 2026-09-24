import { Terrain } from './terrain.js';

/**
 * MapGeometry — colisão COMPARTILHADA (servidor e cliente).
 * Caixa: { minX, maxX, minZ, maxZ, y0, y1, kind, climb }
 *   y0/y1 = base e topo (permite pisos, tetos, escadas e janelas).
 *   kind: building|wall|floor|stair|roof|container|cover|rock|crate|trunk
 * Terreno opcional (Terrain) somado ao chão. Índice espacial em grade para
 * colisão e raycast rápidos com milhares de caixas.
 */
export const STEP_HEIGHT = 0.35;
export const BODY_HEIGHT = 1.8;
export const KINDS = ['building', 'container', 'cover', 'wall', 'floor', 'stair', 'roof', 'rock', 'crate', 'trunk'];
const CELL = 8;

export class MapGeometry {
  constructor(size, boxes = [], terrainParams = null) {
    this.size = size; this.half = size / 2;
    this.terrain = terrainParams ? new Terrain({ size, ...terrainParams }) : null;
    this.boxes = boxes.map(b => normalize(b));
    this.buildIndex();
  }
  static fromView(v) {
    const boxes = v.boxes.map(([minX, minZ, maxX, maxZ, y0, y1, k, climb, mat]) => ({ minX, minZ, maxX, maxZ, y0, y1, kind: KINDS[k] ?? 'building', climb: !!climb, mat: mat ?? 0 }));
    return new MapGeometry(v.size, boxes, v.terrain ?? null);
  }
  viewBoxes() {
    const r = v => Math.round(v * 100) / 100;
    return this.boxes.map(b => [r(b.minX), r(b.minZ), r(b.maxX), r(b.maxZ), r(b.y0), r(b.y1), KINDS.indexOf(b.kind), b.climb ? 1 : 0, b.mat ?? 0]);
  }

  // ------------------------------------------------ índice espacial
  buildIndex() {
    this.cells = new Map();
    this.boxes.forEach((b, i) => {
      for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++)
        for (let cz = Math.floor(b.minZ / CELL); cz <= Math.floor(b.maxZ / CELL); cz++) {
          const k = key(cx, cz); let arr = this.cells.get(k); if (!arr) this.cells.set(k, arr = []); arr.push(i);
        }
    });
    this.stamp = 0; this.marks = new Uint32Array(this.boxes.length);
  }
  addBox(b) { this.boxes.push(normalize(b)); this.buildIndex(); }
  /** Caixas cujo retângulo XZ toca o círculo (x,z,r). */
  near(x, z, r, out = []) {
    out.length = 0; const s = ++this.stamp;
    if (this.marks.length < this.boxes.length) this.marks = new Uint32Array(this.boxes.length);
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const arr = this.cells.get(key(cx, cz)); if (!arr) continue;
        for (const i of arr) if (this.marks[i] !== s) { this.marks[i] = s; out.push(this.boxes[i]); }
      }
    return out;
  }

  contains(b, x, z, r = 0) { return x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r; }
  terrainHeight(x, z) { return this.terrain ? this.terrain.heightAt(x, z) : 0; }

  /** Altura do chão sob (x,z) para quem está na altura y (terreno, pisos, telhados, degraus). */
  groundHeight(x, z, y = 0, r = 0) {
    let g = this.terrainHeight(x, z);
    for (const b of this.near(x, z, r, this.tmp ??= [])) if (b.y1 <= y + STEP_HEIGHT && b.y1 > g && this.contains(b, x, z, r)) g = b.y1;
    return g;
  }
  /** Bloqueado ao nível do chão (para spawn de loot, estações, navegação). */
  isBlocked(x, z, r = 0, y = null) {
    const gy = y ?? this.terrainHeight(x, z);
    for (const b of this.near(x, z, r, this.tmp2 ??= [])) if (b.y0 < gy + 1.6 && b.y1 > gy + 0.3 && this.contains(b, x, z, r)) return true;
    return false;
  }
  /** Espaço livre para um corpo em pé em (x,y,z)? */
  clearAt(x, y, z, r = 0.35) {
    for (const b of this.near(x, z, r, this.tmp2 ??= [])) if (b.y0 < y + BODY_HEIGHT && b.y1 > y + STEP_HEIGHT && this.contains(b, x, z, r)) return false;
    return true;
  }

  /** Empurra o corpo (cilindro r, altura BODY_HEIGHT) para fora das caixas; trata tetos. */
  resolve(body, r = 0.4, height = BODY_HEIGHT) {
    const p = body.pos;
    for (const b of this.near(p.x, p.z, r + 0.5, this.tmp3 ??= [])) {
      if (p.y >= b.y1 - STEP_HEIGHT || b.y0 >= p.y + height) continue;          // abaixo dos pés ou acima da cabeça
      const nx = Math.max(b.minX, Math.min(p.x, b.maxX)), nz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      const dx = p.x - nx, dz = p.z - nz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      // teto: a caixa começa acima da cintura → bateu a cabeça
      if (b.y0 > p.y + height * 0.55 && (body.vel?.y ?? 0) > 0) { p.y = Math.min(p.y, b.y0 - height); if (body.vel) body.vel.y = 0; continue; }
      if (b.y0 > p.y + height * 0.55) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = nx + dx / d * r; p.z = nz + dz / d * r; }
      else {
        const pen = [p.x - b.minX, b.maxX - p.x, p.z - b.minZ, b.maxZ - p.z], i = pen.indexOf(Math.min(...pen));
        if (i === 0) p.x = b.minX - r; else if (i === 1) p.x = b.maxX + r; else if (i === 2) p.z = b.minZ - r; else p.z = b.maxZ + r;
      }
    }
  }

  /** Primeiro obstáculo à frente na altura do corpo (para mantle/vault/escalada). */
  obstacleAhead(pos, dx, dz, reach = 0.9) {
    for (let s = 0.3; s <= reach; s += 0.15) {
      const x = pos.x + dx * s, z = pos.z + dz * s;
      for (const b of this.near(x, z, 0, this.tmp4 ??= []))
        if (b.y1 > pos.y + STEP_HEIGHT && b.y0 < pos.y + 1.4 && this.contains(b, x, z)) return { box: this.topOfStack(b, x, z), x, z, dist: s };
    }
    return null;
  }
  /** Se houver outra caixa encostada em cima (parede + parapeito), devolve a mais alta contígua. */
  topOfStack(b, x, z) {
    let top = b, changed = true;
    while (changed) {
      changed = false;
      for (const o of this.near(x, z, 0, this.tmp5 ??= [])) if (o !== top && this.contains(o, x, z) && Math.abs(o.y0 - top.y1) < 0.05) { top = o; changed = true; break; }
    }
    return top === b ? b : { ...b, y1: top.y1, climb: b.climb || top.climb };
  }
  thickness(b, x, z, dx, dz) { let t = 0; while (t < 20 && this.contains(b, x + dx * t, z + dz * t)) t += 0.1; return t; }

  /** Distância até a primeira parede/terreno ao longo do raio, ou null. */
  raycast(o, d, maxDist) {
    let best = null;
    const seen = new Set(), step = CELL * 0.5, len = Math.hypot(d.x, d.z);
    for (let t = 0; t <= maxDist + step; t += step) {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      for (const b of this.near(x, z, CELL * 0.75, this.tmp6 ??= [])) {
        if (seen.has(b)) continue; seen.add(b);
        const h = slab(o, d, b, maxDist); if (h !== null && (best === null || h < best)) best = h;
      }
      if (best !== null && best < t - CELL) break;
      if (len < 1e-6) break;
    }
    if (this.terrain) {
      const lim = best ?? maxDist;
      let prev = 0;
      for (let t = 1; t <= lim; t += 1.5) {
        if (o.y + d.y * t < this.terrain.heightAt(o.x + d.x * t, o.z + d.z * t)) {
          let a = prev, c = t; for (let k = 0; k < 8; k++) { const m = (a + c) / 2; if (o.y + d.y * m < this.terrain.heightAt(o.x + d.x * m, o.z + d.z * m)) c = m; else a = m; }
          best = c; break;
        }
        prev = t;
      }
    }
    return best;
  }
}

function key(cx, cz) { return (cx + 4096) * 8192 + (cz + 4096); }
function normalize(b) {
  const y0 = b.y0 ?? 0, y1 = b.y1 ?? b.h ?? 1;
  return { ...b, y0, y1, h: y1, kind: b.kind ?? 'building', climb: !!b.climb };
}
function slab(o, d, b, maxDist) {
  let t0 = 0, t1 = maxDist;
  for (const [oa, da, mn, mx] of [[o.x, d.x, b.minX, b.maxX], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.minZ, b.maxZ]]) {
    if (Math.abs(da) < 1e-9) { if (oa < mn || oa > mx) return null; continue; }
    let ta = (mn - oa) / da, tb = (mx - oa) / da; if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return null;
  }
  return t0 < maxDist ? t0 : null;
}
