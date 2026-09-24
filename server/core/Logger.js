/** Logger com níveis. LOG_LEVEL=debug|info|warn|error|silent */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
export class Logger {
  constructor(scope = 'srv', level = globalThis.process?.env?.LOG_LEVEL || 'info') { this.scope = scope; this.level = LEVELS[level] ?? 20; }
  child(scope) { const l = new Logger(`${this.scope}:${scope}`); l.level = this.level; return l; }
  #out(lvl, msg, data) {
    if (LEVELS[lvl] < this.level) return;
    const line = `[${new Date().toISOString().slice(11, 23)}] ${lvl.toUpperCase().padEnd(5)} ${this.scope} ${msg}`;
    const fn = lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log;
    data === undefined ? fn(line) : fn(line, typeof data === 'object' ? safe(data) : data);
  }
  debug(m, d) { this.#out('debug', m, d); } info(m, d) { this.#out('info', m, d); }
  warn(m, d) { this.#out('warn', m, d); } error(m, d) { this.#out('error', m, d); }
}
function safe(d) { try { return JSON.stringify(d, (k, v) => (v instanceof Error ? v.stack : v)); } catch { return String(d); } }
