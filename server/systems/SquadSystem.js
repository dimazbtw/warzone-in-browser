import { PS, IN_PLAY } from '../Player.js';

/**
 * SquadSystem
 * - Monta squads respeitando parties (código de party enviado no hello)
 * - Consultas: companheiros, vivos, status para HUD
 * Tamanho vem de cfg.match.squadSize (1 solo, 2 duo, 3 trio, 4 squad).
 */
export class SquadSystem {
  constructor(ctx) { this.ctx = ctx; this.squads = new Map(); }
  get size() { return this.ctx.cfg.match.squadSize; }
  get isSolo() { return this.size === 1; }

  assignAll(players) {
    this.squads.clear();
    const size = this.size, groups = [];
    // 1) parties primeiro (dividas se maiores que o squad)
    const byParty = new Map();
    for (const p of players) if (p.party) { if (!byParty.has(p.party)) byParty.set(p.party, []); byParty.get(p.party).push(p); }
    for (const list of byParty.values()) for (let i = 0; i < list.length; i += size) groups.push(list.slice(i, i + size));
    // 2) completa grupos incompletos com jogadores sem party (humanos antes de bots)
    const solo = players.filter(p => !p.party).sort((a, b) => a.isBot - b.isBot);
    for (const g of groups) while (g.length < size && solo.length) g.push(solo.shift());
    for (let i = 0; i < solo.length; i += size) groups.push(solo.slice(i, i + size));
    groups.forEach((g, i) => {
      const id = `S${i + 1}`;
      this.squads.set(id, { id, members: g.map(p => p.id), color: i, placement: 0 });
      for (const p of g) p.squadId = id;
    });
    this.ctx.log.info(`${this.squads.size} squads de até ${size}`);
  }

  get(id) { return this.squads.get(id); }
  members(squadId) { return (this.squads.get(squadId)?.members ?? []).map(id => this.ctx.players.get(id)).filter(Boolean); }
  teammates(p) { return this.members(p.squadId).filter(m => m !== p); }
  /** Companheiros "de pé" (em jogo, não abatidos). */
  standingTeammates(p) { return this.teammates(p).filter(m => m.is(...IN_PLAY)); }
  /** Squad sem ninguém de pé = wipe. */
  isWiped(squadId) { return !this.members(squadId).some(m => m.is(...IN_PLAY)); }
  areAllies(a, b) { return a !== b && a.squadId && a.squadId === b.squadId; }

  /** Status dos companheiros para a HUD do jogador `p`. */
  statusFor(p) {
    return this.teammates(p).map(m => ({
      id: m.id, name: m.name, state: m.state, hp: Math.round(m.hp), armor: Math.round(m.armor),
      dist: Math.round(Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z)),
      respawnIn: m.is(PS.AWAITING_RESPAWN) ? Math.ceil(m.respawnRemaining) : null,
      bleed: m.is(PS.DOWNED) ? Math.round(m.bleed) : null,
      connected: m.connected, x: Math.round(m.pos.x), z: Math.round(m.pos.z),
    }));
  }
  summary() { return [...this.squads.values()].map(s => ({ id: s.id, members: s.members, color: s.color })); }
}
