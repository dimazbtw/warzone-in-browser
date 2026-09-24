/**
 * MapGeometry — geometria de colisão COMPARTILHADA (servidor e cliente).
 * O servidor usa para autoridade; o cliente usa a mesma lista de caixas para
 * prever o próprio movimento sem divergir.
 *
 * Caixa: { minX, maxX, minZ, maxZ, h, kind, climb }
 *   kind: 'building' | 'container' | 'cover' (mureta, dá para pular por cima)
 *   climb: superfície escalável (escadas/tubulações pintadas no cliente)
 */
export const STEP_HEIGHT = 0.35;

export class MapGeometry {
  constructor(size, boxes = []) { this.size = size; this.boxes = boxes; }

  static fromView(v) {
    return new MapGeometry(v.size, v.boxes.map(([minX, minZ, maxX, maxZ, h, k, climb]) => ({ minX, minZ, maxX, maxZ, h, kind: ['building', 'container', 'cover'][k] ?? 'building', climb: !!climb })));
  }
  view() {
    return this.boxes.map(b => [+b.minX.toFixed(2), +b.minZ.toFixed(2), +b.maxX.toFixed(2), +b.maxZ.toFixed(2), +b.h.toFixed(2), ['building', 'container', 'cover'].indexOf(b.kind), b.climb ? 1 : 0]);
  }

  contains(b, x, z, r = 0) { return x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r; }

  /** Altura do chão sob (x,z) para quem está na altura y (permite ficar em telhados). */
  groundHeight(x, z, y = 0) {
    let g = 0;
    for (const b of this.boxes) if (b.h <= y + STEP_HEIGHT && b.h > g && this.contains(b, x, z)) g = b.h;
    return g;
  }
  isBlocked(x, z, r = 0) { return this.boxes.some(b => this.contains(b, x, z, r)); }

  /** Empurra um corpo (cilindro raio r) para fora das caixas mais altas que seus pés. */
  resolve(body, r = 0.4) {
    const p = body.pos;
    for (const b of this.boxes) {
      if (p.y >= b.h - STEP_HEIGHT) continue;
      const nx = Math.max(b.minX, Math.min(p.x, b.maxX)), nz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      const dx = p.x - nx, dz = p.z - nz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = nx + dx / d * r; p.z = nz + dz / d * r; }
      else {
        const pen = [p.x - b.minX, b.maxX - p.x, p.z - b.minZ, b.maxZ - p.z], i = pen.indexOf(Math.min(...pen));
        if (i === 0) p.x = b.minX - r; else if (i === 1) p.x = b.maxX + r; else if (i === 2) p.z = b.minZ - r; else p.z = b.maxZ + r;
      }
    }
  }

  /** Primeira caixa à frente (até `reach` m) na direção (dx,dz), na altura dos pés+0.3. */
  obstacleAhead(pos, dx, dz, reach = 0.9) {
    for (let s = 0.3; s <= reach; s += 0.15) {
      const x = pos.x + dx * s, z = pos.z + dz * s;
      for (const b of this.boxes) if (b.h > pos.y + STEP_HEIGHT && this.contains(b, x, z)) return { box: b, x, z, dist: s };
    }
    return null;
  }

  /** Espessura da caixa ao longo da direção, a partir do ponto de entrada. */
  thickness(b, x, z, dx, dz) {
    let t = 0; while (t < 20 && this.contains(b, x + dx * t, z + dz * t)) t += 0.1; return t;
  }

  /** Distância até a primeira parede ao longo do raio (slab test), ou null. */
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
}
