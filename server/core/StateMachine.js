/**
 * Máquina de estados finita com transições permitidas explícitas.
 * Transição inválida é recusada (e logada) — evita estados impossíveis
 * como "ELIMINATED -> ALIVE" sem passar pelo respawn.
 */
export class StateMachine {
  constructor(name, initial, transitions, onChange) {
    this.name = name; this.state = initial; this.transitions = transitions; this.onChange = onChange; this.enteredAt = 0;
  }
  can(to) { return (this.transitions[this.state] || []).includes(to); }
  set(to, now = 0, info) {
    if (this.state === to) return true;
    if (!this.can(to)) return false;
    const from = this.state; this.state = to; this.enteredAt = now;
    this.onChange?.(from, to, info);
    return true;
  }
  is(...s) { return s.includes(this.state); }
}
