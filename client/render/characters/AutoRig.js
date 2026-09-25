import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeSkeleton, BONES } from './FallbackHumanoid.js';

/**
 * AutoRig — transforma um operador ESTÁTICO (malha sem esqueleto, ex.: Tripo) num
 * SkinnedMesh com o esqueleto padrão de 24 ossos, para o Animator animar igual aos outros.
 *
 * Pesos por região (malha normalizada para 1,8 m, pés em y=0, olhando +Z):
 *   - pernas (abaixo do quadril, perto do eixo de cada perna): coxa → canela → pé,
 *     com transição suave no joelho, tornozelo e virilha
 *   - tronco: quadril → Spine02 → Spine01 → Spine por altura
 *   - cabeça/pescoço acima do colarinho
 *   - braços + fuzil embutido (tudo à frente ou ao lado do tronco): rígidos no peito,
 *     então acompanham a mira para cima/baixo sem rasgar a malha
 */
const H = 1.8;
const Y = n => BONES.find(b => b[0] === n)[2][1];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function autoRig(src) {
  src.updateMatrixWorld(true);
  // junta todas as malhas (com transformações aplicadas) preservando os materiais
  const geos = [], mats = [];
  src.traverse(o => {
    if (!o.isMesh) return;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    geos.push(g); mats.push(o.material);
  });
  const geo = geos.length > 1 ? mergeGeometries(geos, true) : geos[0];
  geo.computeBoundingBox();
  const bb = geo.boundingBox, k = H / (bb.max.y - bb.min.y), c = bb.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -bb.min.y, -c.z); geo.scale(k, k, k); geo.computeBoundingBox();

  const { bones, list } = makeSkeleton(), idx = n => list.findIndex(b => b.name === n);
  const I = Object.fromEntries(list.map((b, i) => [b.name, i]));
  const hipJ = Y('LeftUpLeg'), knee = Y('LeftLeg'), ankle = Y('LeftFoot'), waist = Y('Spine02'), chest = Y('Spine'), neck = Y('neck');
  const pos = geo.attributes.position, n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const set = (v, pairs) => { let t = 0; pairs.forEach(([, w]) => t += w); pairs.slice(0, 4).forEach(([b, w], j) => { si[v * 4 + j] = b; sw[v * 4 + j] = w / (t || 1); }); };
  // largura do tronco na altura do peito: separa braços/arma das pernas e do tronco
  for (let v = 0; v < n; v++) {
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    const side = x >= 0 ? 'Left' : 'Right';
    const inLegColumn = y < 0.72 || (Math.abs(x) < 0.3 && z < 0.24);   // abaixo de 0,72 m é sempre perna; acima, o fuzil fica à frente (z > 0,24)
    if (y < hipJ + 0.06 && inLegColumn) {
      // perna: pesos de cada lado; perto do meio (x≈0) divide entre as duas pernas
      // (malhas Tripo costumam ter as pernas "coladas" por triângulos entre elas)
      const wl = ss(-0.06, 0.06, x), toHip = ss(hipJ - 0.04, hipJ + 0.08, y) * (Math.abs(x) < 0.08 ? 0.8 : 0.15);
      const toShin = 1 - ss(knee - 0.03, knee + 0.04, y), toFoot = 1 - ss(ankle - 0.02, ankle + 0.03, y);
      const seg = y > knee - 0.03 ? [[1 - toShin, 'UpLeg'], [toShin, 'Leg']] : [[1 - toFoot, 'Leg'], [toFoot, 'Foot']];
      const pairs = [[I.Hips, toHip]];
      for (const [sw, sd] of [[wl, 'Left'], [1 - wl, 'Right']]) for (const [w, bn] of seg) if (sw * w > 0.001) pairs.push([I[sd + bn], sw * w * (1 - toHip)]);
      pairs.sort((a, b) => b[1] - a[1]);
      set(v, pairs);
      continue;
    }
    if (y > neck - 0.02 && Math.abs(x) < 0.16 && z > -0.2) {
      const h = ss(neck - 0.02, neck + 0.07, y);
      set(v, [[I.Spine, 1 - h], [I.Head, h]]);
      continue;
    }
    // braços / arma / equipamentos à frente e aos lados: presos ao peito
    const armOrGun = Math.abs(x) > 0.22 || z > 0.2;
    if (armOrGun) { set(v, [[I.Spine, y > waist ? 1 : 0.7], [I.Spine01, y > waist ? 0 : 0.3]]); continue; }
    // tronco por altura
    const a = ss(hipJ, waist + 0.06, y), b = ss(waist, (waist + chest) / 2 + 0.04, y), cc = ss((waist + chest) / 2, chest, y);
    set(v, [[I.Hips, 1 - a], [I.Spine02, a * (1 - b)], [I.Spine01, b * (1 - cc)], [I.Spine, cc]]);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geo, mats.length > 1 ? mats : mats[0]);
  const scene = new THREE.Group(); scene.add(bones.Hips, mesh); scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list)); mesh.castShadow = true; mesh.frustumCulled = false;
  scene.userData.baked = true;
  return scene;
}
