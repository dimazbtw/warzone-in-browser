import { PS, IN_PLAY, DAMAGEABLE } from '../Player.js';

/**
 * RespawnSystem — onde e com o quê o jogador volta.
 * Posição segura: dentro da PRÓXIMA zona (fração configurável), fora de
 * obstáculos, a pelo menos `minEnemyDistance` de inimigos. Se nenhuma
 * tentativa passar, usa a que maximiza a distância ao inimigo mais próximo
 * (nunca "dentro" de inimigos). Volta em queda livre, com kit básico.
 * Eventos: respawned
 */
export class RespawnSystem {
  constructor(ctx) { this.ctx = ctx; }

  findSafePosition(p) {
    const { ctx } = this, s = ctx.cfg.resurgence.safeSpawn, z = ctx.systems.zone.targetCircle();
    const enemies = [...ctx.players.values()].filter(o => o !== p && !ctx.systems.squad.areAllies(o, p) && o.is(...DAMAGEABLE));
    const allies = ctx.systems.squad.standingTeammates(p);
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < s.attempts; i++) {
      // tenta perto de um aliado primeiro (metade das tentativas), depois aleatório na zona
      const useAlly = i < s.attempts / 2 && allies.length > 0;
      const anchor = useAlly ? ctx.rng.pick(allies).pos : { x: z.x, z: z.z };
      const radius = useAlly ? 60 : z.r * s.insideZoneFraction;
      const a = ctx.rng() * Math.PI * 2, d = Math.sqrt(ctx.rng()) * radius;
      const x = anchor.x + Math.cos(a) * d, zz = anchor.z + Math.sin(a) * d;
      if (!ctx.systems.zone.isInside(x, zz, z) || ctx.map.isBlocked(x, zz, 1)) continue;
      const nearest = enemies.reduce((m, e) => Math.min(m, Math.hypot(e.pos.x - x, e.pos.z - zz)), Infinity);
      if (nearest >= s.minEnemyDistance) return { x, z: zz, nearest };
      if (nearest > bestScore) { bestScore = nearest; best = { x, z: zz, nearest }; }
    }
    return best ?? { x: z.x, z: z.z, nearest: 0 };
  }

  respawn(p) {
    const { ctx } = this, now = ctx.now(), pos = this.findSafePosition(p);
    ctx.systems.inventory.init(p, 'respawn');
    p.hp = ctx.cfg.health.max; p.bleed = 0; p.lastAttacker = null; p.lastDamageAt = -99;
    p.pos.x = pos.x; p.pos.z = pos.z; p.pos.y = ctx.cfg.resurgence.respawnAltitude;
    p.vel.x = p.vel.y = p.vel.z = 0; p.mantle = p.climb = p.slide = null; p.respawnRemaining = 0; p.spectating = null;
    p.history.fill(undefined);
    p.setState(PS.FREEFALL, now, { respawn: true });
    ctx.log.debug(`respawn ${p.name} em ${pos.x.toFixed(0)},${pos.z.toFixed(0)} (inimigo + próximo ${pos.nearest.toFixed(0)}m)`);
    ctx.bus.emit('respawned', { playerId: p.id, x: pos.x, z: pos.z });
  }
}

export { IN_PLAY };
