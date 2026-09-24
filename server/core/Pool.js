/** Pool genérico de objetos para evitar GC em entidades de vida curta (loot, projéteis, eventos). */
export class Pool {
  constructor(factory, reset, prealloc = 0) { this.factory = factory; this.reset = reset; this.free = []; this.created = 0; for (let i = 0; i < prealloc; i++) this.free.push(this.#make()); }
  #make() { this.created++; return this.factory(); }
  acquire() { return this.free.pop() ?? this.#make(); }
  release(o) { this.reset?.(o); this.free.push(o); }
}
