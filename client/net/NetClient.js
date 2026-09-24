import { C2S, S2C } from '../../shared/protocol.js';

/**
 * NetClient — WebSocket com reconexão automática por token, medição de RTT
 * e estimativa do relógio do servidor (usada na interpolação e predição).
 * Emite: welcome, lobby, matchStart, snap, ev, error, status
 */
export class NetClient extends EventTarget {
  constructor() {
    super();
    this.ws = null; this.token = sessionStorage.getItem('zr_token'); this.name = ''; this.party = '';
    this.serverTimeOffset = null; this.rtt = 0.08; this.connected = false; this.retry = 0;
  }
  on(type, fn) { this.addEventListener(type, e => fn(e.detail)); }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  connect(name, party) {
    this.name = name; this.party = party;
    const ws = this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
    ws.onopen = () => { this.connected = true; this.retry = 0; this.emit('status', 'online'); this.send(C2S.HELLO, { name, party, token: this.token }); };
    ws.onmessage = e => this.onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      this.connected = false; this.emit('status', 'offline');
      const wait = Math.min(8000, 800 * 2 ** this.retry++);
      setTimeout(() => this.connect(this.name, this.party), wait);
    };
  }
  send(t, payload = {}) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t, ...payload })); }

  onMessage(m) {
    switch (m.t) {
      case S2C.WELCOME: this.token = m.token; sessionStorage.setItem('zr_token', m.token); this.emit('welcome', m); break;
      case S2C.SNAPSHOT: {
        // relógio do servidor ≈ time do snapshot + meia latência
        const est = m.time + this.rtt / 2 - performance.now() / 1000;
        this.serverTimeOffset = this.serverTimeOffset === null ? est : this.serverTimeOffset * 0.9 + est * 0.1;
        this.emit('snap', m); break;
      }
      case 'ping2': this.send('pong2'); this.send(C2S.PING, { t0: performance.now() }); break;
      case S2C.PONG: if (Number.isFinite(m.t0)) this.rtt = this.rtt * 0.7 + ((performance.now() - m.t0) / 1000) * 0.3; break;
      case S2C.ERROR: if (m.error === 'partida em andamento') { sessionStorage.removeItem('zr_token'); this.token = null; } this.emit('error', m.error); break;
      default: this.emit(m.t, m);
    }
  }
  /** Tempo do servidor estimado (s). */
  serverNow() { return performance.now() / 1000 + (this.serverTimeOffset ?? 0); }
}
