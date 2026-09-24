/**
 * Transportes do NetClient. Ambos entregam objetos do protocolo (shared/protocol.js).
 *   WebSocketTransport — servidor online (npm start)
 *   WorkerTransport    — servidor autoritativo rodando num Web Worker (modo offline)
 */
export class WebSocketTransport {
  constructor(url) { this.url = url; this.kind = 'online'; this.ws = null; }
  open({ onOpen, onMessage, onClose }) {
    const ws = this.ws = new WebSocket(this.url);
    ws.onopen = () => onOpen();
    ws.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch { /* mensagem inválida */ } };
    ws.onclose = () => onClose();
    ws.onerror = () => {};
  }
  send(obj) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  close() { const ws = this.ws; this.ws = null; if (ws) { ws.onclose = null; ws.close(); } }
  get canReconnect() { return true; }
}

export class WorkerTransport {
  /** `overrides` são aplicados sobre shared/config.js (modo, bots, dificuldade). */
  constructor(overrides = {}) { this.overrides = overrides; this.kind = 'offline'; this.worker = null; }
  open({ onOpen, onMessage, onClose, onError }) {
    const w = this.worker = new Worker(new URL('./LocalServer.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = e => {
      const m = e.data;
      if (m.kind === 'ready') onOpen();
      else if (m.kind === 'msg') onMessage(m.data);
      else if (m.kind === 'error') onError?.(m.message);
    };
    w.onerror = e => { onError?.(e.message || 'falha no worker'); onClose(); };
    w.postMessage({ kind: 'init', overrides: this.overrides });
  }
  send(obj) { this.worker?.postMessage({ kind: 'msg', data: obj }); }
  pause(v) { this.worker?.postMessage({ kind: 'pause', value: !!v }); }
  close() { this.worker?.terminate(); this.worker = null; }
  get canReconnect() { return false; }
}
