/**
 * EventBus síncrono: sistemas não se chamam diretamente para efeitos colaterais,
 * eles emitem eventos. Ex.: HealthSystem emite 'eliminated' e o ResurgenceSystem,
 * LootSystem (drop) e HUD/rede reagem sem acoplamento.
 */
export class EventBus {
  constructor(logger) { this.handlers = new Map(); this.logger = logger; this.history = []; this.keepHistory = false; }
  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(fn); return () => this.off(type, fn); }
  off(type, fn) { this.handlers.get(type)?.delete(fn); }
  emit(type, payload = {}) {
    if (this.keepHistory) this.history.push({ type, payload });
    this.logger?.debug(`evt:${type}`, payload);
    for (const fn of this.handlers.get(type) ?? []) {
      try { fn(payload); } catch (e) { this.logger?.error(`handler ${type} falhou`, e); }
    }
    for (const fn of this.handlers.get('*') ?? []) fn(type, payload);
  }
}
