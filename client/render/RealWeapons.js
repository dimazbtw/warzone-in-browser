import * as THREE from 'three';
import { assets } from '../assets/AssetManager.js';

/**
 * RealWeapons — normaliza o fuzil GLB do Higgsfield para a convenção do jogo
 * (cano em -Z, punho na origem, comprimento L) para ser usado em 1ª e 3ª pessoa.
 * Detecta automaticamente o eixo longo e para que lado fica o cano (a ponta mais
 * fina do modelo). Retorna null se o GLB não carregou — aí usa o modelo procedural.
 */
const USES = { rifle: 0.86, battle: 0.95, lmg: 1.0 };
let tpl = null;

function buildTemplate() {
  const g = assets.get('rifle'); if (!g) return null;
  const src = g.scene.clone(true);
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.z >= size.y ? 'z' : 'y';
  // espessura média perto de cada ponta → a mais fina é o cano
  const ends = [0, 0], cnt = [0, 0], lo = box.min[axis], len = size[axis], v = new THREE.Vector3();
  const other = axis === 'y' ? 'z' : 'y';
  src.traverse(o => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 3000));
    for (let i = 0; i < p.count; i += step) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const t = (v[axis] - lo) / len, h = Math.abs(v[other] - c[other]);
      if (t < 0.15) { ends[0] += h; cnt[0]++; } else if (t > 0.85) { ends[1] += h; cnt[1]++; }
    }
  });
  const muzzleAtMax = ends[1] / Math.max(1, cnt[1]) < ends[0] / Math.max(1, cnt[0]);
  const pivot = new THREE.Group(); pivot.add(src);
  src.position.sub(c);
  // leva o eixo longo para Z com o cano em -Z
  if (axis === 'x') pivot.rotation.y = muzzleAtMax ? Math.PI / 2 : -Math.PI / 2;
  else if (axis === 'z') pivot.rotation.y = muzzleAtMax ? Math.PI : 0;
  else pivot.rotation.x = muzzleAtMax ? -Math.PI / 2 : Math.PI / 2;
  const holder = new THREE.Group(); holder.add(pivot);
  holder.userData.len = len;
  src.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material.clone();
    if (m.emissiveMap) { m.emissive = new THREE.Color(0x1a1a1a); m.emissiveIntensity = 0.4; }
    m.roughness = 0.55; m.metalness = 0.35; o.material = m; o.castShadow = true;
  });
  return holder;
}

/** Fuzil real com o comprimento L desejado, punho na origem; ou null. */
export function realGun(id) {
  const L = USES[id]; if (!L) return null;
  if (!tpl) tpl = buildTemplate(); if (!tpl) return null;
  const g = new THREE.Group(), m = tpl.clone(true), s = L / tpl.userData.len;
  m.scale.setScalar(s);
  m.position.set(0, -0.02, -L * 0.2);   // o punho fica ~30% a partir da coronha
  g.add(m);
  g.userData.L = L; g.userData.muzzleZ = -L * 0.7; g.userData.real = true;
  return g;
}
export const hasRealGun = id => !!USES[id] && !!assets.get('rifle');
