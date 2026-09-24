import { PS } from '../Player.js';
import { clamp } from '../core/math.js';
import { stepGround, stepAir, stepCrawl } from '../../shared/movement.js';

/**
 * MovementSystem (autoritativo)
 * O cliente envia apenas intenção (mx/mz, botões, yaw/pitch). O servidor
 * integra a física usando `shared/movement.js` — o MESMO código que o cliente
 * usa para predição. Speed hack/teleporte não são possíveis.
 *
 * Suporta: andar, sprint, sprint tático (stamina), agachar, prone, slide,
 * pulo, mantle, vault, escalada, telhados, queda livre, paraquedas, rastejar abatido.
 * Eventos: landed, slid, mantled, vaulted
 */
export class MovementSystem {
  constructor(ctx) { this.ctx = ctx; }

  /** Sanitiza o input recebido da rede (nunca confie no formato). */
  static sanitize(raw, prev) {
    const b = v => v === true;
    let mx = Number(raw.mx) || 0, mz = Number(raw.mz) || 0;
    const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    return {
      mx, mz,
      yaw: Number.isFinite(raw.yaw) ? raw.yaw % (Math.PI * 2) : prev.yaw,
      pitch: Number.isFinite(raw.pitch) ? clamp(raw.pitch, -1.5, 1.5) : prev.pitch,
      sprint: b(raw.sprint), tac: b(raw.tac), crouch: b(raw.crouch), prone: b(raw.prone),
      jump: b(raw.jump), ads: b(raw.ads), interact: b(raw.interact),
    };
  }

  /**
   * Cada input do cliente carrega seu próprio dt e vira UM passo de física (igual à
   * predição do cliente). O "orçamento" de tempo só cresce com o relógio do servidor:
   * mandar inputs mais rápido não faz ninguém andar mais rápido (anti speed-hack).
   */
  tick(dt) {
    const now = this.ctx.now();
    for (const p of this.ctx.players.values()) {
      p.moveBudget = Math.min(0.3, (p.moveBudget ?? 0) + dt);
      let steps = 0;
      while (p.inputQueue?.length && p.moveBudget >= p.inputQueue[0].dt - 1e-4 && steps < 8) {
        const inp = p.inputQueue.shift();
        p.moveBudget -= inp.dt; p.input = inp; if (inp.seq) p.lastSeq = inp.seq;
        this.step(p, inp, inp.dt, now); steps++;
      }
      // sem inputs chegando (lag/idle/desconectado): continua simulando com o último
      if (!steps && !p.inputQueue?.length && p.moveBudget >= 0.15) { p.moveBudget -= dt; this.step(p, p.input, dt, now); }
      p.record(now);
    }
  }

  step(p, input, dt, now) {
    const { ctx } = this, m = ctx.cfg.movement, geo = ctx.map;
    p.pitch = input.pitch;
    let ev = {};
    switch (p.state) {
      case PS.AIRCRAFT: p.yaw = input.yaw; break;
      case PS.FREEFALL:
        ev = stepAir(p, input, dt, m.freefallSpeed, m.freefallHorizontal, ctx.cfg, geo);
        if (!ev.landed && ((input.jump && now - p.sm.enteredAt > 0.5) || p.pos.y - geo.groundHeight(p.pos.x, p.pos.z, p.pos.y) <= m.autoChuteHeight)) p.setState(PS.PARACHUTE, now);
        break;
      case PS.PARACHUTE: ev = stepAir(p, input, dt, m.parachuteSpeed, m.parachuteHorizontal, ctx.cfg, geo); break;
      case PS.ALIVE: ev = stepGround(p, input, dt, now, ctx.cfg, geo, { slow: p.action?.slow, blocksAds: p.action?.blocksAds }); break;
      case PS.DOWNED: stepCrawl(p, input, dt, ctx.cfg.downed.moveSpeed, ctx.cfg, geo); break;
    }
    if (ev.landed && p.is(PS.FREEFALL, PS.PARACHUTE)) { p.setState(PS.ALIVE, now); p.prevJump = true; }
    for (const k of ['landed', 'slid', 'mantled', 'vaulted']) if (ev[k]) ctx.bus.emit(k, { playerId: p.id });
  }
}
