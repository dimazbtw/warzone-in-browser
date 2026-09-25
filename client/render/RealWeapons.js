import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { assets } from '../assets/AssetManager.js';

/**
 * RealWeapons — armas GLB enviadas pelo usuário, normalizadas para a convenção do jogo:
 *   cano em -Z, topo em +Y, origem na linha do cano acima da empunhadura, comprimento L.
 *
 * A orientação é detectada sozinha (cada site exporta de um jeito):
 *   - eixo longo = maior dimensão da caixa
 *   - cano = ponta mais fina (a coronha/empunhadura é mais alta)
 *   - "para cima" = entre os dois eixos restantes, o de maior extensão é o vertical; o
 *     sentido é o do cano (a linha do cano fica no alto, carregador/empunhadura embaixo)
 * `flip`/`roll` no catálogo corrigem casos em que a heurística erra.
 */
export const WEAPON_MODELS = {
  // flip: inverte o lado do cano detectado (conferido visualmente em tools/weapons.html)
  sidearm:  { model: 'w_pistol_1', L: 0.21, grip: 0.8 },
  pistol45: { model: 'w_pistol_4', L: 0.22, grip: 0.8, flip: true },
  pistol9:  { model: 'w_pistol_2', L: 0.19, grip: 0.8, flip: true },
  smg:      { model: 'w_smg_1', L: 0.62, grip: 0.62, flip: true },
  smg2:     { model: 'w_smg_2', L: 0.55, grip: 0.62, flip: true },
  smg4:     { model: 'w_smg_4', L: 0.66, grip: 0.62, flip: true },
  rifle:    { model: 'w_rifle_m4', L: 0.88, grip: 0.64, flip: true },
  battle:   { model: 'w_ak-47', L: 0.88, grip: 0.62, flip: true },
  marksman: { model: 'w_sniper_1', L: 1.12, grip: 0.66 },
  sniper:   { model: 'w_sniper_2', L: 1.2, grip: 0.66 },
};
const tpls = new Map();

/** Converte SkinnedMesh em Mesh estático na pose atual (armas com esqueleto, ex.: ferrolho rigado). */
function bakeSkins(root) {
  const skinned = []; root.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
  for (const sm of skinned) {
    sm.skeleton.update();
    const g = sm.geometry.clone(), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); sm.applyBoneTransform(i, v); p.setXYZ(i, v.x, v.y, v.z); }
    g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight'); g.computeVertexNormals();
    const m = new THREE.Mesh(g, sm.material); m.name = sm.name;
    // applyBoneTransform já inclui bindMatrix → as posições ficam no espaço do SkinnedMesh
    m.position.copy(sm.position); m.quaternion.copy(sm.quaternion); m.scale.copy(sm.scale);
    sm.parent.add(m); sm.parent.remove(sm);
  }
  root.traverse(o => { if (o.isBone) o.visible = false; });
}

/** Analisa os vértices: direção do cano e "para cima" (eixos do mundo do modelo). */
function analyze(src, flip) {
  src.updateMatrixWorld(true);
  // peças soltas (acessório longe da arma): esconde as pequenas fora do corpo principal
  const parts = []; src.traverse(o => { if (o.isMesh) parts.push({ o, b: new THREE.Box3().setFromObject(o), n: o.geometry.attributes.position.count }); });
  const total = parts.reduce((s, p) => s + p.n, 0), main = parts.slice().sort((a, b) => b.n - a.n)[0].b.clone();
  for (const p of parts) if (p.b.intersectsBox(main)) main.union(p.b);
  const pad = main.getSize(new THREE.Vector3()).length() * 0.04;
  for (const p of parts) if (p.n < total * 0.2 && !p.b.intersectsBox(main.clone().expandByScalar(pad))) p.o.visible = false;
  const pts = [], v = new THREE.Vector3();
  src.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 4000));
    for (let i = 0; i < p.count; i += step) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).clone());
  });
  const box = new THREE.Box3().setFromPoints(pts), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const ax = ['x', 'y', 'z'].sort((a, b) => size[b] - size[a]), L = ax[0], V = ax[1];
  const e = k => new THREE.Vector3(k === 'x' ? 1 : 0, k === 'y' ? 1 : 0, k === 'z' ? 1 : 0);
  const len = size[L], lo = box.min[L];
  // espessura vertical de cada ponta: a mais fina é o cano
  const endStat = (t0, t1) => { let s = 0, n = 0, h = 0; for (const p of pts) { const t = (p[L] - lo) / len; if (t >= t0 && t <= t1) { s += Math.abs(p[V] - c[V]); h += p[V] - c[V]; n++; } } return { thick: n ? s / n : 1e9, mid: n ? h / n : 0 }; };
  const a = endStat(0, 0.12), b = endStat(0.88, 1);
  let muzzleAtMax = b.thick < a.thick; if (flip) muzzleAtMax = !muzzleAtMax;
  const barrel = muzzleAtMax ? b.mid : a.mid;                  // altura da linha do cano (relativa ao centro)
  return { long: e(L), vert: e(V), muzzleAtMax, upSign: barrel >= 0 ? 1 : -1, c, len, barrel, mid: 0 };
}

/** Matriz de base: colunas = eixos X, Y, Z do jogo expressos no espaço do modelo. */
function basisFor(r) {
  const fwd = r.long.clone().multiplyScalar(r.muzzleAtMax ? 1 : -1);
  const up = r.vert.clone().multiplyScalar(r.upSign);
  const zGame = fwd.clone().negate(), xGame = new THREE.Vector3().crossVectors(up, zGame).normalize();
  return new THREE.Matrix4().makeBasis(xGame, up, zGame);
}

function buildTemplate(id) {
  const spec = WEAPON_MODELS[id], g = spec && assets.get(spec.model); if (!g) return null;
  const src = SkeletonUtils.clone(g.scene); bakeSkins(src); const r = analyze(src, spec.flip);
  if (spec.roll) r.upSign = -r.upSign;
  const k = spec.L / r.len;
  // pivô: centro no eixo longo, linha do cano na vertical
  const pivot = r.c.clone().addScaledVector(r.long, r.mid).addScaledVector(r.vert, r.barrel);
  const inner = new THREE.Group(); inner.add(src); src.position.sub(pivot);
  const orient = new THREE.Group(); orient.add(inner);
  orient.quaternion.setFromRotationMatrix(basisFor(r).invert());
  const holder = new THREE.Group(); holder.add(orient); orient.scale.setScalar(k);
  // empunhadura: `grip` = fração do comprimento a partir do cano → origem da arma
  holder.position.z = -(spec.grip - 0.5) * spec.L;
  const root = new THREE.Group(); root.add(holder);
  src.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.frustumCulled = false;
    const m = o.material = o.material.clone();
    if (m.metalness !== undefined) { m.metalness = Math.min(m.metalness, 0.6); m.roughness = Math.max(m.roughness ?? 0.5, 0.35); }
    if (m.emissiveMap) { m.emissive = new THREE.Color(0x1a1a1a); m.emissiveIntensity = 0.4; }
  });
  root.userData = { L: spec.L, muzzleZ: -spec.grip * spec.L, real: true };
  return root;
}

/** Arma real (cópia), ou null se o modelo não carregou — aí o jogo usa a procedural. */
export function realGun(id) {
  if (!tpls.has(id)) { const t = buildTemplate(id); if (!t) return null; tpls.set(id, t); }
  const t = tpls.get(id), g = t.clone(true); g.userData = { ...t.userData }; return g;
}
export const hasRealGun = id => !!WEAPON_MODELS[id] && !!assets.get(WEAPON_MODELS[id].model);
