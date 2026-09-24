import { C2S, S2C } from '../../shared/protocol.js';

/**
 * NetClient — conversa com o servidor por um transporte (WebSocket ou Worker).
 * Reconexão automática por token (online), medição de RTT e estimativa do
 * relógio do servidor (usada na interpolação e na predição).
 * Emite: welcome, lobby, matchStart, snap, ev, error, status
 */
export class NetClient extends EventTarget {
  constructor(transport) {
    super();
    this.transport = transport; this.kind = transport.kind;
    this.token = transport.kind === 'online' ? sessionStorage.getItem('zr_token') : null;
    this.serverTimeOffset = null; this.rtt = transport.kind === 'offline' ? 0.004 : 0.08; this.connected = false; this.retry = 0; this.closed = false;
    this.hello = {};
  }
  on(type, fn) { this.addEventListener(type, e => fn(e.detail)); return this; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  connect(hello) {
    this.hello = hello;
    this.transport.open({
      onOpen: () => { this.connected = true; this.retry = 0; this.emit('status', 'online'); this.send(C2S.HELLO, { ...this.hello, token: this.token }); },
      onMessage: m => this.onMessage(m),
      onError: msg => this.emit('error', msg),
      onClose: () => {
        this.connected = false; this.emit('status', 'offline');
        if (this.closed || !this.transport.canReconnect) return;
        const wait = Math.min(8000, 800 * 2 ** this.retry++);
        setTimeout(() => { if (!this.closed) this.connect(this.hello); }, wait);
      },
    });
    return this;
  }
  close() { this.closed = true; this.transport.close(); }
  pause(v) { this.transport.pause?.(v); }
  send(t, payload = {}) { this.transport.send({ ...payload, t }); }

  onMessage(m) {
    switch (m.t) {
      case S2C.WELCOME:
        this.token = m.token;
        if (this.kind === 'online') sessionStorage.setItem('zr_token', m.token);
        this.emit('welcome', m); break;
      case S2C.SNAPSHOT: {
        // relógio do servidor ≈ tempo do snapshot + meia latência
        const est = m.time + this.rtt / 2 - performance.now() / 1000;
        this.serverTimeOffset = this.serverTimeOffset === null || Math.abs(est - this.serverTimeOffset) > 1 ? est : this.serverTimeOffset * 0.9 + est * 0.1;
        this.emit('snap', m); break;
      }
      case 'ping2': this.send('pong2'); this.send(C2S.PING, { t0: performance.now() }); break;
      case S2C.PONG: if (Number.isFinite(m.t0)) this.rtt = this.rtt * 0.7 + ((performance.now() - m.t0) / 1000) * 0.3; break;
      case S2C.ERROR:
        if (m.error === 'partida em andamento') { sessionStorage.removeItem('zr_token'); this.token = null; }
        this.emit('error', m.error); break;
      default: this.emit(m.t, m);
    }
  }
  /** Tempo do servidor estimado (s). */
  serverNow() { return performance.now() / 1000 + (this.serverTimeOffset ?? 0); }
}
