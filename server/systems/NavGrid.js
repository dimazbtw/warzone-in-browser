/**
 * NavGrid — grade de navegação ao nível do chão (1 m) + A* com heap binário.
 * Portas contam como passagem; paredes, contêineres e rochas bloqueiam.
 * Construída uma vez por partida a partir da MapGeometry (servidor/worker).
 */
export class NavGrid {
  constructor(map, cell = 1) {
    this.map = map; this.cell = cell; this.half = map.size / 2; this.n = Math.floor(map.size / cell);
    const n = this.n; this.walk = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -this.half + (i + 0.5) * cell, z = -this.half + (j + 0.5) * cell;
      const edge = Math.max(Math.abs(x), Math.abs(z)) > this.half - 3;
      this.walk[j * n + i] = !edge && !map.isBlocked(x, z, 0.3) ? 1 : 0;
    }
    this.g = new Float32Array(n * n); this.from = new Int32Array(n * n); this.stamp = new Uint32Array(n * n); this.closed = new Uint32Array(n * n); this.gen = 0;
  }
  idx(x, z) { const i = Math.floor((x + this.half) / this.cell), j = Math.floor((z + this.half) / this.cell); return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i; }
  center(k) { const i = k % this.n, j = (k / this.n) | 0; return { x: -this.half + (i + 0.5) * this.cell, z: -this.half + (j + 0.5) * this.cell }; }
  walkable(x, z) { const k = this.idx(x, z); return k >= 0 && this.walk[k] === 1; }
  /** Célula caminhável mais próxima (espiral até r células). */
  nearestWalkable(x, z, r = 6) {
    const k0 = this.idx(x, z); if (k0 >= 0 && this.walk[k0]) return k0;
    const i0 = Math.floor((x + this.half) / this.cell), j0 = Math.floor((z + this.half) / this.cell);
    for (let d = 1; d <= r; d++) for (let dj = -d; dj <= d; dj++) for (let di = -d; di <= d; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== d) continue;
      const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= this.n || j >= this.n) continue;
      if (this.walk[j * this.n + i]) return j * this.n + i;
    }
    return -1;
  }
  /** Linha livre na grade (para suavizar o caminho). */
  lineClear(a, b) {
    const n = this.n; let x0 = a % n, y0 = (a / n) | 0; const x1 = b % n, y1 = (b / n) | 0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx - dy;
    for (let guard = 0; guard < 2000; guard++) {
      if (!this.walk[y0 * n + x0]) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    return false;
  }
  /** A*: lista de pontos {x,z} ou null. `maxNodes` limita o custo por pedido. */
  path(from, to, maxNodes = 6000) {
    const s = this.nearestWalkable(from.x, from.z), t = this.nearestWalkable(to.x, to.z);
    if (s < 0 || t < 0) return null;
    if (s === t) return [this.center(t)];
    const n = this.n, gen = ++this.gen, g = this.g, from_ = this.from, stamp = this.stamp, closed = this.closed;
    const tx = t % n, ty = (t / n) | 0;
    const h = k => { const dx = Math.abs(k % n - tx), dy = Math.abs(((k / n) | 0) - ty); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    const heap = [], push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    stamp[s] = gen; g[s] = 0; from_[s] = -1; push(s, h(s));
    let expanded = 0, best = s, bestH = h(s);
    while (heap.length && expanded < maxNodes) {
      const [, k] = pop(); if (closed[k] === gen) continue; closed[k] = gen; expanded++;
      if (k === t) { best = t; break; }
      const hk = h(k); if (hk < bestH) { bestH = hk; best = k; }
      const x = k % n, y = (k / n) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const nk = ny * n + nx; if (!this.walk[nk] || closed[nk] === gen) continue;
        if (dx && dy && (!this.walk[y * n + nx] || !this.walk[ny * n + x])) continue;   // sem cortar quina
        const ng = g[k] + (dx && dy ? 1.414 : 1);
        if (stamp[nk] !== gen || ng < g[nk]) { stamp[nk] = gen; g[nk] = ng; from_[nk] = k; push(nk, ng + h(nk)); }
      }
    }
    // reconstrói (até o melhor nó alcançado se o alvo não foi atingido)
    const cells = []; for (let k = best; k !== -1; k = from_[k]) { cells.push(k); if (cells.length > 5000) break; }
    cells.reverse();
    // suavização por linha de visão na grade
    const out = []; let i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1; while (j > i + 1 && !this.lineClear(cells[i], cells[j])) j = Math.max(i + 1, j - Math.max(1, ((j - i) / 3) | 0));
      out.push(this.center(cells[j])); i = j;
    }
    return out.length ? out : [this.center(best)];
  }
}
