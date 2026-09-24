/**
 * Interpolation — outros jogadores são desenhados levemente no passado
 * (interpolationDelay) entre dois snapshots, eliminando tremidas de rede.
 */
export class Interpolation {
  constructor(delay = 0.1) { this.delay = delay; this.buffers = new Map(); }

  push(time, others) {
    const seen = new Set();
    for (const o of others) {
      seen.add(o.id);
      let buf = this.buffers.get(o.id); if (!buf) { buf = []; this.buffers.set(o.id, buf); }
      buf.push({ time, ...o });
      while (buf.length > 20) buf.shift();
    }
    for (const [id, buf] of this.buffers) if (!seen.has(id)) { buf.missing = (buf.missing ?? 0) + 1; if (buf.missing > 15) this.buffers.delete(id); } else buf.missing = 0;
  }

  /** Estado interpolado de todos no tempo `serverNow - delay`. */
  sample(serverNow) {
    const t = serverNow - this.delay, out = [];
    for (const [id, buf] of this.buffers) {
      if (buf.missing > 0 || !buf.length) continue;
      let a = buf[0], b = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i++) if (buf[i].time <= t && buf[i + 1].time >= t) { a = buf[i]; b = buf[i + 1]; break; }
      const k = b.time > a.time ? Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time))) : 1;
      const lerpAng = (x, y) => { let d = y - x; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return x + d * k; };
      out.push({ ...b, id, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: lerpAng(a.yaw, b.yaw), vx: (b.x - a.x) / Math.max(0.001, b.time - a.time), vz: (b.z - a.z) / Math.max(0.001, b.time - a.time), speed: Math.hypot(b.x - a.x, b.z - a.z) / Math.max(0.001, b.time - a.time) });
    }
    return out;
  }
}
