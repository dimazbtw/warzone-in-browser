import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * AssetManager — modelos 3D reais (GLB) com progresso e fallback.
 * Ordem de busca de cada asset: cópia local em /assets/models (se você baixou com
 * `npm run assets`) → CDN do Higgsfield (CORS liberado) → null (o jogo usa o
 * modelo procedural equivalente, nunca trava).
 */
const HF = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Jib0BzU3aLdeWOQjrliCwaWdFv/hf_20260924_';
export const ASSET_LIST = {
  operator_1: { local: 'assets/models/operator_1.glb', size: 3.6e5, label: 'Operador Caveira' },
  operator_2: { local: 'assets/models/operator_2.glb', size: 3.9e5, label: 'Operador Duna' },
  aircraft:   { local: 'assets/models/aircraft.glb', size: 3.1e5, label: 'Aeronave' },
  rifle:   { local: 'assets/models/rifle.glb',   remote: HF + '173843_824599f6-4ea8-4128-bc98-f0fbac851e22.glb', size: 10.6e6, label: 'Fuzil' },
};

class Assets extends EventTarget {
  constructor() {
    super();
    this.loader = new GLTFLoader(); this.loader.setCrossOrigin('anonymous');
    this.items = {}; this.loaded = {}; this.total = {}; this.done = false; this.promise = null;
  }
  get progress() {
    const keys = Object.keys(ASSET_LIST);
    return keys.reduce((s, k) => s + (this.items[k] !== undefined ? 1 : Math.min(0.99, (this.loaded[k] ?? 0) / (this.total[k] || ASSET_LIST[k].size))), 0) / keys.length;
  }
  get(name) { return this.items[name] ?? null; }

  preload() {
    if (this.promise) return this.promise;
    this.promise = Promise.all(Object.entries(ASSET_LIST).map(([k, a]) => this.loadOne(k, a))).then(() => {
      this.done = true; this.dispatchEvent(new Event('done'));
      console.info('[assets]', Object.fromEntries(Object.keys(ASSET_LIST).map(k => [k, this.items[k] ? 'ok' : 'fallback'])));
    });
    return this.promise;
  }
  async loadOne(key, a) {
    const local = a.local && new URL('../../' + a.local, import.meta.url).href;   // relativo ao projeto, não à página
    for (const url of [local, a.remote].filter(Boolean)) {
      try {
        if (url === local) { const head = await fetch(url, { method: 'HEAD' }); if (!head.ok) continue; }
        const gltf = await this.loader.loadAsync(url, e => { this.loaded[key] = e.loaded; if (e.total) this.total[key] = e.total; this.dispatchEvent(new Event('progress')); });
        this.items[key] = gltf; this.dispatchEvent(new Event('progress'));
        return;
      } catch { /* tenta a próxima fonte */ }
    }
    this.items[key] = null;
  }
  /** Espera até `ms` pelos assets (a partida não fica refém de uma rede lenta). */
  wait(ms = 25000) { return Promise.race([this.preload(), new Promise(r => setTimeout(r, ms))]); }
}
export const assets = new Assets();
