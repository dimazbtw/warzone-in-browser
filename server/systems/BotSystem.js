import { PS } from '../Player.js';
import { C2S } from '../../shared/protocol.js';

/**
 * BotSystem — bots de teste que usam EXATAMENTE a mesma interface de input
 * dos clientes humanos (match.handle). Assim eles exercitam validações do
 * servidor e servem para testar partidas cheias com um só humano.
 */
export class BotSystem {
  constructor(ctx, match) { this.ctx = ctx; this.match = match; this.brain = new Map(); }

  tick() {
    const { ctx } = this, now = ctx.now();
    for (const p of ctx.players.values()) {
      if (!p.isBot) continue;
      let b = this.brain.get(p.id);
      if (!b) { b = { jumpAt: ctx.rng.range(2, 25), dest: null, nextThink: 0, aimErr: ctx.rng.range(0.03, 0.09), target: null }; this.brain.set(p.id, b); }
      const input = { mx: 0, mz: 0, yaw: p.yaw, pitch: 0, sprint: false, jump: false, interact: false, ads: false };
      if (p.is(PS.AIRCRAFT)) { input.jump = ctx.systems.match.aircraft.t > b.jumpAt; this.send(p, C2S.INPUT, input); continue; }
      if (!p.is(PS.ALIVE, PS.FREEFALL, PS.PARACHUTE, PS.DOWNED)) continue;

      if (now >= b.nextThink) {
        b.nextThink = now + 0.4;
        const zone = ctx.systems.zone.targetCircle();
        if (!b.dest || Math.hypot(b.dest.x - p.pos.x, b.dest.z - p.pos.z) < 3 || Math.hypot(b.dest.x - zone.x, b.dest.z - zone.z) > zone.r) {
          const a = ctx.rng() * Math.PI * 2, d = Math.sqrt(ctx.rng()) * zone.r * 0.7;
          b.dest = { x: zone.x + Math.cos(a) * d, z: zone.z + Math.sin(a) * d };
        }
        b.target = null; let bd = 70;
        for (const o of ctx.players.values()) {
          if (o === p || ctx.systems.squad.areAllies(o, p) || !o.is(PS.ALIVE, PS.DOWNED)) continue;
          const d = Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z); if (d < bd) { bd = d; b.target = o; }
        }
        // aliado abatido perto? vai reviver
        b.revive = ctx.systems.squad.teammates(p).find(m => m.is(PS.DOWNED) && Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z) < 25);
      }
      let goal = b.revive?.is(PS.DOWNED) ? b.revive.pos : b.dest;
      if (b.target && !b.revive) {
        const t = b.target, dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, d = Math.hypot(dx, dz);
        input.yaw = Math.atan2(-dx, -dz) + (ctx.rng() - 0.5) * b.aimErr;
        input.pitch = Math.atan2((t.pos.y + 1.2) - (p.pos.y + 1.6), d) + (ctx.rng() - 0.5) * b.aimErr;
        input.ads = d > 20; input.mx = Math.sin(now * 1.3 + p.id.length) > 0 ? 1 : -1;
        this.send(p, C2S.INPUT, input);
        if (p.is(PS.ALIVE)) { if (ctx.rng() < 0.5) this.send(p, C2S.FIRE, { yaw: input.yaw, pitch: input.pitch }); }
        if (p.armor < 50 && p.inv.plates > 0 && d > 30) this.send(p, C2S.USE_PLATE, {});
        continue;
      }
      if (goal) {
        const dx = goal.x - p.pos.x, dz = goal.z - p.pos.z, d = Math.hypot(dx, dz);
        input.yaw = Math.atan2(-dx, -dz); input.mz = d > 1.5 ? -1 : 0; input.sprint = d > 10;
        input.interact = !!(b.revive && d < 2);
      }
      // pega loot próximo
      if (p.is(PS.ALIVE) && ctx.rng() < 0.1) {
        const near = ctx.systems.loot.grid.query(p.pos.x, p.pos.z, 2.2);
        if (near[0]) this.send(p, C2S.PICKUP, { lootId: near[0].id });
      }
      this.send(p, C2S.INPUT, input);
    }
  }
  send(p, type, msg) { this.match.handle(p, { t: type, ...msg }); }
}
