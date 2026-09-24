/** Utilitários matemáticos + RNG com seed (partidas reproduzíveis em testes). */
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist3D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const lerp = (a, b, t) => a + (b - a) * t;
export function dirFromAngles(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}
export function makeRng(seed = Date.now()) {
  let s = (seed >>> 0) || 1;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  rng.range = (a, b) => a + rng() * (b - a);
  rng.int = (a, b) => Math.floor(rng.range(a, b + 1));
  rng.pick = arr => arr[Math.floor(rng() * arr.length)];
  rng.weighted = (items, w = i => i.weight) => { const tot = items.reduce((s, i) => s + w(i), 0); let r = rng() * tot; for (const i of items) { r -= w(i); if (r <= 0) return i; } return items[items.length - 1]; };
  return rng;
}
/** Interseção raio x esfera. Retorna distância t ou -1. */
export function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, h = b * b - cc;
  if (h < 0) return -1; const t = -b - Math.sqrt(h); return t >= 0 ? t : -1;
}
/** Raio x cápsula vertical (segmento y0..y1 em (cx,cz), raio r). Retorna {t, y} ou null. */
export function rayVerticalCapsule(o, d, cx, cz, y0, y1, r) {
  let best = null;
  const ox = o.x - cx, oz = o.z - cz, a = d.x * d.x + d.z * d.z;
  if (a > 1e-9) {
    const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - r * r, h = b * b - a * c;
    if (h >= 0) { const t = (-b - Math.sqrt(h)) / a; const y = o.y + d.y * t; if (t >= 0 && y >= y0 && y <= y1) best = { t, y }; }
  }
  for (const yc of [y0, y1]) { const t = raySphere(o, d, { x: cx, y: yc, z: cz }, r); if (t >= 0 && (!best || t < best.t)) best = { t, y: o.y + d.y * t }; }
  return best;
}
