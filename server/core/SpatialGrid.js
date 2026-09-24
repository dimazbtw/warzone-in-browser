/**
 * Grade espacial uniforme (XZ). Usada para: interesse de rede (quem enviar
 * para quem), consultas de hit, auto-pickup e spawn seguro. O(1) por célula
 * em vez de O(n²) com muitos jogadores.
 */
export class SpatialGrid {
  constructor(cell = 32) { this.cell = cell; this.cells = new Map(); this.where = new Map(); }
  #key(x, z) { return ((Math.floor(x / this.cell) + 512) << 10) | (Math.floor(z / this.cell) + 512); }
  update(obj, x, z) {
    const k = this.#key(x, z), old = this.where.get(obj);
    if (old === k) return;
    if (old !== undefined) this.cells.get(old)?.delete(obj);
    if (!this.cells.has(k)) this.cells.set(k, new Set());
    this.cells.get(k).add(obj); this.where.set(obj, k);
  }
  remove(obj) { const k = this.where.get(obj); if (k !== undefined) { this.cells.get(k)?.delete(obj); this.where.delete(obj); } }
  query(x, z, r, out = []) {
    const c = this.cell, x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const s = this.cells.get(((i + 512) << 10) | (j + 512)); if (s) for (const o of s) out.push(o);
    }
    return out;
  }
}
