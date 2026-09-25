import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Humanoide procedural com o MESMO esqueleto do soldado do Higgsfield (nomes e
 * posições de repouso). Usado se o GLB não carregar — o Animator trata os dois
 * igual. Olha para +Z, como o modelo do Meshy.
 */
export const BONES = [
  ['Hips', null, [0, 1.005, 0]],
  ['LeftUpLeg', 'Hips', [0.11, 0.91, 0]], ['LeftLeg', 'LeftUpLeg', [0.12, 0.53, 0.02]], ['LeftFoot', 'LeftLeg', [0.12, 0.12, -0.03]], ['LeftToeBase', 'LeftFoot', [0.12, 0.03, 0.12]],
  ['RightUpLeg', 'Hips', [-0.11, 0.91, 0]], ['RightLeg', 'RightUpLeg', [-0.12, 0.53, 0.02]], ['RightFoot', 'RightLeg', [-0.12, 0.12, -0.03]], ['RightToeBase', 'RightFoot', [-0.12, 0.03, 0.12]],
  ['Spine02', 'Hips', [0, 1.14, 0]], ['Spine01', 'Spine02', [0, 1.28, 0]], ['Spine', 'Spine01', [0, 1.42, 0.01]],
  ['LeftShoulder', 'Spine', [0.04, 1.45, 0.01]], ['LeftArm', 'LeftShoulder', [0.18, 1.45, 0.01]], ['LeftForeArm', 'LeftArm', [0.39, 1.3, -0.01]], ['LeftHand', 'LeftForeArm', [0.58, 1.18, 0.05]],
  ['RightShoulder', 'Spine', [-0.04, 1.45, 0.01]], ['RightArm', 'RightShoulder', [-0.18, 1.45, 0.01]], ['RightForeArm', 'RightArm', [-0.39, 1.3, -0.01]], ['RightHand', 'RightForeArm', [-0.58, 1.18, 0.05]],
  ['neck', 'Spine', [0, 1.52, 0.015]], ['Head', 'neck', [0, 1.6, 0.02]], ['head_end', 'Head', [0, 1.8, 0.05]],
];

/** Esqueleto padrão (24 ossos, humano de 1,8 m olhando para +Z). */
export function makeSkeleton() {
  const bones = {}, list = [];
  for (const [name, parent, p] of BONES) {
    const b = new THREE.Bone(); b.name = name; bones[name] = b; list.push(b);
    const pw = parent ? BONES.find(x => x[0] === parent)[2] : [0, 0, 0];
    b.position.set(p[0] - pw[0], p[1] - pw[1], p[2] - pw[2]);
    if (parent) bones[parent].add(b);
  }
  return { bones, list };
}

export function buildFallbackHumanoid(style) {
  const { bones, list } = makeSkeleton();
  const W = n => new THREE.Vector3(...BONES.find(x => x[0] === n)[2]);
  const idx = n => list.findIndex(b => b.name === n);
  const parts = { cloth: [], gear: [], skin: [], boot: [] };
  const put = (geo, bone, set) => {
    const n = geo.attributes.position.count, i = idx(bone);
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, k) => (k % 4 === 0 ? i : 0)), 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, k) => (k % 4 === 0 ? 1 : 0)), 4));
    parts[set].push(geo.index ? geo.toNonIndexed() : geo);
  };
  const limb = (a, b, r0, r1, bone, set, ext = 0.02) => {
    const A = W(a), B = W(b), len = A.distanceTo(B) + ext * 2;
    const g = new THREE.CylinderGeometry(r1, r0, len, 10, 1); g.translate(0, 0, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    g.applyQuaternion(q); g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    put(g, bone, set);
  };
  const box = (w, h, d, at, bone, set, rot) => { const g = new THREE.BoxGeometry(w, h, d); if (rot) g.rotateX(rot); g.translate(...at); put(g, bone, set); };
  const sph = (r, at, bone, set, sy = 1) => { const g = new THREE.SphereGeometry(r, 12, 9); g.scale(1, sy, 1); g.translate(...at); put(g, bone, set); };
  // pernas
  for (const s of ['Left', 'Right']) {
    limb(`${s}UpLeg`, `${s}Leg`, 0.085, 0.07, `${s}UpLeg`, 'cloth'); limb(`${s}Leg`, `${s}Foot`, 0.068, 0.055, `${s}Leg`, 'cloth');
    const f = W(`${s}Foot`); box(0.11, 0.1, 0.27, [f.x, 0.06, f.z + 0.07], `${s}Foot`, 'boot');
    const k = W(`${s}Leg`); box(0.12, 0.12, 0.06, [k.x, k.y, k.z + 0.07], `${s}Leg`, 'gear');   // joelheira
    limb(`${s}Arm`, `${s}ForeArm`, 0.058, 0.05, `${s}Arm`, 'cloth'); limb(`${s}ForeArm`, `${s}Hand`, 0.05, 0.043, `${s}ForeArm`, 'cloth');
    const h = W(`${s}Hand`); sph(0.05, [h.x + (s === 'Left' ? 0.03 : -0.03), h.y - 0.03, h.z], `${s}Hand`, 'gear', 1.3);
    const a = W(`${s}Arm`); sph(0.07, [a.x, a.y, a.z], `${s}Arm`, 'cloth');
  }
  // tronco
  box(0.34, 0.2, 0.22, [0, 1.0, 0], 'Hips', 'cloth');
  box(0.33, 0.18, 0.2, [0, 1.16, 0], 'Spine02', 'cloth');
  box(0.38, 0.22, 0.24, [0, 1.3, 0.01], 'Spine01', 'cloth');
  box(0.42, 0.34, 0.3, [0, 1.3, 0.015], 'Spine01', 'gear');                      // colete
  box(0.12, 0.13, 0.06, [-0.11, 1.22, 0.17], 'Spine01', 'gear'); box(0.12, 0.13, 0.06, [0.11, 1.22, 0.17], 'Spine01', 'gear'); box(0.1, 0.12, 0.06, [0, 1.24, 0.17], 'Spine01', 'gear');
  box(0.3, 0.36, 0.14, [0, 1.3, -0.2], 'Spine', 'gear');                           // mochila
  box(0.4, 0.14, 0.24, [0, 1.46, 0.01], 'Spine', 'cloth');
  limb('neck', 'Head', 0.055, 0.05, 'neck', 'skin', 0);
  sph(0.105, [0, 1.7, 0.03], 'Head', 'skin', 1.18);
  // capacete / boné conforme o estilo
  const hg = new THREE.SphereGeometry(0.128, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55); hg.translate(0, 1.73, 0.02); put(hg, 'Head', style.head === 'cap' ? 'cloth' : 'gear');
  if (style.head === 'nvg' || style.head === 'helmet') box(0.08, 0.05, 0.06, [0, 1.84, 0.11], 'Head', 'boot');
  box(0.2, 0.05, 0.02, [0, 1.68, 0.125], 'Head', 'boot');                          // óculos/visor
  const mats = [
    new THREE.MeshStandardMaterial({ color: style.uniform, roughness: 0.95 }), new THREE.MeshStandardMaterial({ color: style.vest, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: style.skin, roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0x1b1814, roughness: 0.8 }),
  ];
  const groups = ['cloth', 'gear', 'skin', 'boot'].map(k => mergeGeometries(parts[k].map(g => { for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(n)) g.deleteAttribute(n); return g; }), false));
  const geo = mergeGeometries(groups, true);
  const mesh = new THREE.SkinnedMesh(geo, mats);
  const skeleton = new THREE.Skeleton(list);
  const scene = new THREE.Group(); scene.add(bones.Hips); scene.add(mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(skeleton); mesh.castShadow = true; mesh.frustumCulled = false;
  return { scene, mesh, materials: mats };
}
