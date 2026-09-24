import { PS, IN_PLAY } from '../Player.js';

/**
 * SpectatorSystem — quem está fora de jogo (aguardando ou eliminado) assiste alguém.
 * Prioridade: companheiros de pé → companheiros abatidos → qualquer jogador em jogo.
 * Alvo morreu? troca automaticamente. O servidor decide o alvo, então o cliente
 * espectador só recebe dados do ponto de vista permitido (anti ghosting de squad).
 */
export class SpectatorSystem {
  constructor(ctx) { this.ctx = ctx; }

  candidates(p) {
    const sq = this.ctx.systems.squad, mates = sq.teammates(p);
    const up = mates.filter(m => m.is(...IN_PLAY, PS.DOWNED));
    if (up.length) return up;
    // squad fora: se eliminado de vez, pode assistir qualquer um em jogo
    if (p.is(PS.ELIMINATED)) return [...this.ctx.players.values()].filter(o => o.is(...IN_PLAY, PS.DOWNED));
    return [];
  }

  cycle(p, dir = 1) {
    const list = this.candidates(p); if (!list.length) { p.spectating = null; return; }
    const i = list.findIndex(o => o.id === p.spectating);
    const n = list.length, next = i < 0 ? 0 : (i + (dir > 0 ? 1 : -1) + n) % n;
    p.spectating = list[next].id;
  }

  tick() {
    for (const p of this.ctx.players.values()) {
      if (!p.is(PS.AWAITING_RESPAWN, PS.ELIMINATED)) { p.spectating = null; continue; }
      const cur = p.spectating && this.ctx.players.get(p.spectating);
      if (!cur || !this.candidates(p).includes(cur)) { p.spectating = null; this.cycle(p, 1); }
    }
  }

  /** Posição de onde o jogador "vê" o mundo (para interesse de rede). */
  viewpoint(p) { const t = p.spectating && this.ctx.players.get(p.spectating); return t ? t.pos : p.pos; }
}
