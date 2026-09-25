import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets } from '../assets/AssetManager.js';
import { characters } from './characters/CharacterFactory.js';

/**
 * LootRenderer — itens do chão e baús com modelos reais.
 *   - cada TIPO de modelo é um InstancedMesh (arma X, caixa de munição, placa, dinheiro...):
 *     todo o loot sai em ~15–20 draw calls, não um por item
 *   - armas: o próprio GLB da arma, deitado; munição: a caixa soviética em miniatura
 *   - feixe de luz baixo + brilho no chão na cor da raridade/tipo
 *   - baús: o GLB animado (tampa, travas e fuzis); a animação toca ao abrir
 */
export const RARITY = { common: 0xbbbbbb, uncommon: 0x6fd16f, rare: 0x4fa8ff, epic: 0xb36bff, legendary: 0xffb13a };
export const LOOT_COLOR = { cash: 0x6fdc6f, plate: 0x6ec6ff, ammo: 0xd8c14a, heal: 0xff7070, lethal: 0x9aa05a, tactical: 0xc9d0d6, intel: 0xffb13a };
const MAX = 512, VIEW = 90, BEAM_VIEW = 220;

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
/** Funde todas as malhas de um objeto (no espaço dele) numa geometria com grupos por material. */
function mergeObject(obj) {
  obj.updateMatrixWorld(true);
  const byMat = new Map();
  obj.traverse(o => {
    if (!o.isMesh) return;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const m = Array.isArray(o.material) ? o.material[0] : o.material; if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(g);
  });
  const mats = [...byMat.keys()];
  return { geo: mergeGeometries(mats.map(m => mergeGeometries(byMat.get(m), false)), true), mats };
}

export class LootRenderer {
  constructor(parent) {
    this.parent = parent; this.kinds = new Map(); this.items = new Map(); this.chests = new Map(); this.mixers = [];
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3(); this.t = 0;
    const tex = glowTexture();
    this.beam = this.instanced(new THREE.CylinderGeometry(0.035, 0.07, 1.2, 8, 1, true).translate(0, 0.6, 0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }), true);
    this.glow = this.instanced(new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), true);   // polygonOffset: sem z-fighting com o piso
  }
  instanced(geo, mat, colored = false) {
    const m = new THREE.InstancedMesh(geo, mat, MAX); m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (colored) m.setColorAt(0, new THREE.Color());
    m.castShadow = false; this.parent.add(m); return m;
  }

  // ---------------------------------------------------------------- modelos por tipo
  /** Chave do modelo: arma por id (quando o GLB existe), senão o tipo. */
  keyOf(it) { return it.type === 'weapon' ? `w:${it.data?.id}` : it.type; }
  kind(key, it) {
    let k = this.kinds.get(key); if (k) return k;
    let geo, mats, lay = { roll: 0, y: 0.04 };
    if (key.startsWith('w:')) {
      const g = characters.gun(it.data.id); geo = g.geometry; mats = g.material; lay = { roll: Math.PI / 2, y: 0.05 };   // deitada de lado
    } else if (key === 'ammo' && assets.get('crate')) {
      const src = assets.get('crate').scene.clone(true), b = new THREE.Box3().setFromObject(src), sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const w = new THREE.Group(); src.position.sub(c).add(new THREE.Vector3(0, sz.y / 2, 0)); w.add(src); w.scale.setScalar(0.42 / Math.max(sz.x, sz.z));
      ({ geo, mats } = mergeObject(w)); lay = { roll: 0, y: 0 };
    } else ({ geo, mats } = this.procedural(key));
    const mesh = this.instanced(geo, mats);
    k = { mesh, lay, n: 0 }; this.kinds.set(key, k); return k;
  }
  /** Modelos simples e reconhecíveis para itens sem GLB. */
  procedural(key) {
    const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
    const parts = [];
    const box = (w, h, d, x, y, z, m) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); parts.push([g, m]); };
    const cyl = (r, h, x, y, z, m, rx = 0) => { const g = new THREE.CylinderGeometry(r, r, h, 12); if (rx) g.rotateX(rx); g.translate(x, y, z); parts.push([g, m]); };
    if (key === 'plate') { const m = std(0x2d3a46, { metalness: 0.3 }); box(0.26, 0.035, 0.34, 0, 0.02, 0, m); box(0.2, 0.012, 0.26, 0, 0.042, 0, std(0x6ec6ff, { emissive: 0x1a3a50 })); }
    else if (key === 'cash') { const m = std(0x3f7a44); for (let i = 0; i < 3; i++) box(0.17, 0.035, 0.08, (i - 1) * 0.02, 0.018 + i * 0.036, (i % 2) * 0.02, m); box(0.02, 0.11, 0.085, 0, 0.055, 0, std(0xd8c14a)); }
    else if (key === 'heal') { box(0.2, 0.09, 0.14, 0, 0.045, 0, std(0xe8e8e8)); box(0.1, 0.005, 0.03, 0, 0.092, 0, std(0xd83a3a)); box(0.03, 0.005, 0.1, 0, 0.092, 0, std(0xd83a3a)); }
    else if (key === 'lethal') { const g = new THREE.SphereGeometry(0.055, 12, 8); g.scale(1, 1.2, 1); g.translate(0, 0.066, 0); parts.push([g, std(0x4d5a2e)]); cyl(0.015, 0.04, 0, 0.14, 0, std(0x888888, { metalness: 0.7 })); }
    else if (key === 'tactical') { cyl(0.04, 0.15, 0, 0.075, 0, std(0x9aa3aa, { metalness: 0.4 })); cyl(0.041, 0.02, 0, 0.12, 0, std(0x3a3f44)); }
    else if (key === 'intel') { box(0.24, 0.018, 0.17, 0, 0.01, 0, std(0x222428)); box(0.2, 0.004, 0.13, 0, 0.021, 0, std(0xffb13a, { emissive: 0x7a4a00 })); }
    else { box(0.25, 0.15, 0.2, 0, 0.075, 0, std(0x5a5a3a)); }       // munição sem GLB / genérico
    const mats = [...new Set(parts.map(([, m]) => m))];
    const geo = mergeGeometries(mats.map(m => mergeGeometries(parts.filter(([, x]) => x === m).map(([g]) => { const n = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(a)) n.deleteAttribute(a); return n; }), false)), true);
    return { geo, mats };
  }

  /** Cria de antemão os modelos de todos os tipos (compila os shaders no carregamento, não no meio do jogo). */
  prewarm(weaponIds) {
    for (const id of weaponIds) this.kind(`w:${id}`, { type: 'weapon', data: { id } });
    for (const t of ['ammo', 'plate', 'cash', 'heal', 'lethal', 'tactical', 'intel']) this.kind(t, { type: t, data: {} });
  }
  // ---------------------------------------------------------------- itens
  add(it) {
    if (this.items.has(it.id)) return;
    const color = new THREE.Color(it.type === 'weapon' ? RARITY[it.rarity] ?? 0xffffff : LOOT_COLOR[it.type] ?? 0xffffff);
    const e = { userData: { item: it }, color, key: this.keyOf(it), beam: it.type === 'weapon' || it.type === 'intel' || ['rare', 'epic', 'legendary'].includes(it.rarity), yaw: (it.id.length * 1.7 + (it.x * 13.1) % 6.28) };
    this.items.set(it.id, e);
  }
  remove(id) { this.items.delete(id); }
  clear() { this.items.clear(); for (const c of this.chests.values()) this.parent.remove(c.root); this.chests.clear(); this.mixers.length = 0; }

  // ---------------------------------------------------------------- baús
  addChest(c) {
    const root = new THREE.Group(); root.position.set(c.x, c.y, c.z); root.rotation.y = c.rot ?? 0;
    const e = { root, item: c, model: null, mixer: null, opened: !!c.opened };
    this.buildChestModel(e); this.parent.add(root); this.chests.set(c.id, e);
    return e;
  }
  buildChestModel(e) {
    const g = assets.get('crate');
    if (g) {
      const src = g.scene.clone(true), b = new THREE.Box3().setFromObject(src), sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const w = new THREE.Group(); src.position.sub(c).add(new THREE.Vector3(0, sz.y / 2, 0)); w.add(src); w.scale.setScalar(1.15 / Math.max(sz.x, sz.z));
      src.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });   // sem sombra: 4 malhas × dezenas de baús
      e.root.add(w); e.model = w;
      const clip = g.animations?.[0];
      if (clip) {
        e.mixer = new THREE.AnimationMixer(src); e.action = e.mixer.clipAction(clip);
        e.action.setLoop(THREE.LoopOnce, 1); e.action.clampWhenFinished = true; e.action.timeScale = 3.2;
        if (e.opened) { e.action.play(); e.mixer.setTime(clip.duration / e.action.timeScale); }
        this.mixers.push(e);
      }
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.65).translate(0, 0.3, 0), new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.8 }));
      m.castShadow = true; e.root.add(m); e.model = m;
    }
    // faixa dourada: baú fechado brilha levemente
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xe8b13a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.y = 0.03; glow.visible = !e.opened; e.root.add(glow); e.glow = glow;
  }
  openChest(id) {
    const e = this.chests.get(id); if (!e || e.opened) return; e.opened = true; e.item.opened = true;
    if (e.action) { e.action.reset(); e.action.play(); }
    if (e.glow) e.glow.visible = false;
  }

  // ---------------------------------------------------------------- quadro
  update(dt, camPos) {
    this.t += dt;
    for (const e of this.mixers) if (e.mixer && e.root.visible) e.mixer.update(dt);
    for (const c of this.chests.values()) { const d2 = (c.root.position.x - camPos.x) ** 2 + (c.root.position.z - camPos.z) ** 2; c.root.visible = d2 < 80 * 80; }
    for (const k of this.kinds.values()) k.n = 0;
    let nb = 0, ng = 0;
    const { m4, q, p, s } = this, UP = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), qr = new THREE.Quaternion();
    for (const e of this.items.values()) {
      const it = e.userData.item, dx = it.x - camPos.x, dz = it.z - camPos.z, d2 = dx * dx + dz * dz;
      if (d2 > BEAM_VIEW * BEAM_VIEW) continue;
      if (d2 < VIEW * VIEW) {
        const k = this.kind(e.key, it);
        if (k.n < MAX) {
          q.setFromAxisAngle(UP, e.yaw + this.t * 0.25); if (k.lay.roll) q.multiply(qr.setFromAxisAngle(Z, k.lay.roll));
          p.set(it.x, it.y + k.lay.y + Math.sin(this.t * 2 + e.yaw) * 0.015, it.z); s.set(1, 1, 1);
          k.mesh.setMatrixAt(k.n++, m4.compose(p, q, s));
        }
        if (ng < MAX) { p.set(it.x, it.y + 0.045, it.z); q.identity(); s.setScalar(it.type === 'weapon' ? 1.3 : 0.9); this.glow.setMatrixAt(ng, m4.compose(p, q, s)); this.glow.setColorAt(ng++, e.color); }
      }
      if (e.beam && nb < MAX) { p.set(it.x, it.y, it.z); q.identity(); s.set(1, 1, 1); this.beam.setMatrixAt(nb, m4.compose(p, q, s)); this.beam.setColorAt(nb++, e.color); }
    }
    for (const k of this.kinds.values()) { k.mesh.count = k.n; k.mesh.instanceMatrix.needsUpdate = true; }
    this.beam.count = nb; this.glow.count = ng;
    for (const m of [this.beam, this.glow]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}
