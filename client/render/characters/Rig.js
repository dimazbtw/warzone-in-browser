import * as THREE from 'three';
import { V, C, Q, M4 } from './pool.js';

/**
 * Rig — mapeia um esqueleto humanoide (Meshy/Higgsfield, Mixamo ou o humanoide
 * procedural) para nomes canônicos, guarda a pose de repouso e oferece
 * operações no ESPAÇO DO MUNDO: girar osso em torno de um eixo e IK de dois ossos.
 * Trabalhar no mundo evita depender dos eixos locais de cada rig.
 */
const PATTERNS = {
  hips: /^(mixamorig:?)?hips$/i,
  spine0: /^(mixamorig:?)?spine0?2$|^spine_?02$/i, spine1: /^(mixamorig:?)?spine0?1$/i, spine2: /^(mixamorig:?)?spine$/i,
  neck: /^(mixamorig:?)?neck$/i, head: /^(mixamorig:?)?head$/i,
  shoulderL: /^(mixamorig:?)?leftshoulder$/i, armL: /^(mixamorig:?)?leftarm$/i, foreL: /^(mixamorig:?)?leftforearm$/i, handL: /^(mixamorig:?)?lefthand$/i,
  shoulderR: /^(mixamorig:?)?rightshoulder$/i, armR: /^(mixamorig:?)?rightarm$/i, foreR: /^(mixamorig:?)?rightforearm$/i, handR: /^(mixamorig:?)?righthand$/i,
  thighL: /^(mixamorig:?)?leftupleg$/i, shinL: /^(mixamorig:?)?leftleg$/i, footL: /^(mixamorig:?)?leftfoot$/i, toeL: /^(mixamorig:?)?lefttoe(base)?$/i,
  thighR: /^(mixamorig:?)?rightupleg$/i, shinR: /^(mixamorig:?)?rightleg$/i, footR: /^(mixamorig:?)?rightfoot$/i, toeR: /^(mixamorig:?)?righttoe(base)?$/i,
};
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

export class Rig {
  /** `root` = Object3D do personagem (posição/yaw do jogo); `model` = cena do GLB dentro dele. */
  constructor(root, model) {
    this.root = root; this.model = model; this.b = {};
    // nomes: tira prefixo Mixamo e sufixo numérico do Sketchfab ("mixamorig:Hips_01" → "Hips")
    const clean = n => n.replace(/^mixamorig\d*:?/i, '').replace(/_\d+$/, '');
    model.traverse(o => { if (!o.isBone) return; const n = clean(o.name); for (const [k, re] of Object.entries(PATTERNS)) if (!k.startsWith('spine') && !this.b[k] && re.test(n)) this.b[k] = o; });
    // coluna: Meshy numera de cima para baixo (Spine02→Spine), Mixamo de baixo para cima (Spine→Spine2);
    // ordena pela profundidade na hierarquia a partir do quadril
    const depth = o => { let d = 0; for (let x = o; x && x !== this.b.hips; x = x.parent) d++; return d; };
    const spines = []; model.traverse(o => { if (o.isBone && /^spine\d*$/i.test(clean(o.name))) spines.push(o); });
    spines.sort((a, b) => depth(a) - depth(b));
    [this.b.spine0, this.b.spine1, this.b.spine2] = [spines[0], spines[1] ?? spines[0], spines[spines.length - 1]];
    this.ok = ['hips', 'spine2', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'].every(k => this.b[k]);
    this.bones = [...new Set(Object.values(this.b))];
    this.rest = new Map(this.bones.map(bn => [bn, { q: bn.quaternion.clone(), p: bn.position.clone() }]));
    root.updateMatrixWorld(true);
    // medidas em repouso (no espaço do personagem)
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    this.restLocal = {}; for (const [k, bn] of Object.entries(this.b)) this.restLocal[k] = bn.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const L = (a, c) => this.restLocal[a].distanceTo(this.restLocal[c]);
    this.len = { thigh: L('thighL', 'shinL'), shin: L('shinL', 'footL'), upper: L('armL', 'foreL'), fore: L('foreL', 'handL') };
    this.hipHeight = this.restLocal.hips.y; this.height = this.restLocal.head.y + 0.2;
    this.footRestRel = {};
    for (const s of ['L', 'R']) { const f = this.b['foot' + s]; this.footRestRel[s] = new THREE.Quaternion().copy(root.getWorldQuaternion(_q1)).invert().multiply(f.getWorldQuaternion(_q2)); }
    // dedos (se o rig tiver): cadeias proximal → distal por dedo, por lado
    this.fingers = { L: [], R: [] };
    for (const [side, S] of [['L', 'Left'], ['R', 'Right']]) for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      const chain = [1, 2, 3].map(i => { let hit = null; model.traverse(o => { if (!hit && o.isBone && clean(o.name).toLowerCase() === `${S}Hand${f}${i}`.toLowerCase()) hit = o; }); return hit; }).filter(Boolean);
      if (chain.length >= 2) this.fingers[side].push({ name: f, chain });
    }
    // base da mão em repouso (espaço do personagem): direção dos dedos + normal da palma (T/A-pose: palma para baixo)
    this.handBasis = {};
    for (const s of ['L', 'R']) {
      const h = this.b['hand' + s], mid = this.fingers[s].find(f => f.name === 'Middle')?.chain[0];
      if (!h || !mid) continue;
      const toLocal = v => v.applyMatrix4(inv);
      const fwd = toLocal(mid.getWorldPosition(new THREE.Vector3())).sub(toLocal(h.getWorldPosition(new THREE.Vector3()))).normalize();
      const palm = new THREE.Vector3(0, -1, 0); palm.addScaledVector(fwd, -palm.dot(fwd)).normalize();
      const q = new THREE.Quaternion().copy(root.getWorldQuaternion(_q1)).invert().multiply(h.getWorldQuaternion(_q2));
      this.handBasis[s] = { fwd, palm, q, palmLocal: palm.clone().applyQuaternion(q.clone().invert()) };   // palma no referencial do osso
    }
    this.handRestRel = {};
    for (const s of ['L', 'R']) { const h = this.b['hand' + s]; this.handRestRel[s] = new THREE.Quaternion().copy(this.b['fore' + s].getWorldQuaternion(_q1)).invert().multiply(h.getWorldQuaternion(_q2)); }
  }

  /**
   * Orienta a mão (mundo) para que os dedos apontem para `fwdW` e a palma para `palmW`,
   * a partir da base de repouso. `w` mistura com a orientação atual (0..1).
   */
  orientHand(side, fwdW, palmW, w = 1) {
    const hb = this.handBasis[side], h = this.b['hand' + side]; if (!hb || w <= 0.001) return;
    const rq = this.root.getWorldQuaternion(_q1);
    const f0 = _v1.copy(hb.fwd).applyQuaternion(rq), p0 = _v2.copy(hb.palm).applyQuaternion(rq);
    const basis = (f, p) => { const z = f.clone().normalize(), y = p.clone().addScaledVector(z, -p.dot(z)).normalize(), x = new THREE.Vector3().crossVectors(y, z); return new THREE.Matrix4().makeBasis(x, y, z); };
    const R = basis(fwdW, palmW).multiply(basis(f0, p0).transpose());
    const target = new THREE.Quaternion().setFromRotationMatrix(R).multiply(_q3.copy(rq).multiply(hb.q));
    const cur = h.getWorldQuaternion(new THREE.Quaternion());
    this.setWorldQuaternion(h, cur.slerp(target, w));
  }
  /** Fecha os dedos em direção à palma. amounts = [proximal, meio, distal] em rad; thumb separado. */
  curlFingers(side, amounts, thumb = 0.5, w = 1) {
    if (w <= 0.001) return;
    const hb = this.handBasis[side]; if (!hb) return;
    for (const f of this.fingers[side]) {
      f.chain.forEach((bone, i) => {
        const child = f.chain[i + 1] ?? bone.children.find(c => c.isBone); if (!child) return;
        const a = bone.getWorldPosition(new THREE.Vector3()), d = child.getWorldPosition(new THREE.Vector3()).sub(a).normalize();
        const palmW = hb.palmLocal.clone().applyQuaternion(this.b['hand' + side].getWorldQuaternion(new THREE.Quaternion()));
        const axis = new THREE.Vector3().crossVectors(d, palmW).normalize(); if (axis.lengthSq() < 1e-6) return;
        this.rotateWorld(bone, axis, (f.name === 'Thumb' ? thumb * (i === 0 ? 0.5 : 1) : amounts[i] ?? amounts[amounts.length - 1]) * w);
      });
    }
  }

  reset() { for (const [bn, r] of this.rest) { bn.quaternion.copy(r.q); bn.position.copy(r.p); } }
  update() { this.root.updateMatrixWorld(true); }

  /** Gira o osso `bone` em torno de `axis` (mundo) por `angle` rad, preservando o resto da cadeia. */
  rotateWorld(bone, axis, angle) {
    if (!bone || !angle) return;
    const pq = bone.parent.getWorldQuaternion(_q1), wq = bone.getWorldQuaternion(_q2);
    _q3.setFromAxisAngle(axis, angle).multiply(wq);
    bone.quaternion.copy(pq.invert().multiply(_q3));
    bone.updateMatrixWorld(true);
  }
  /** Define a orientação de mundo de um osso. */
  setWorldQuaternion(bone, q) { const pq = bone.parent.getWorldQuaternion(_q1).invert(); bone.quaternion.copy(pq.multiply(q)); bone.updateMatrixWorld(true); }
  /** Aponta o osso A de forma que a direção A→B vire `dir` (mundo), com rotação mínima. */
  aimBone(boneA, boneB, dirWorld) {
    const a = boneA.getWorldPosition(_v1), b = boneB.getWorldPosition(_v2);
    const cur = _v3.subVectors(b, a).normalize();
    _q3.setFromUnitVectors(cur, dirWorld);
    const pq = boneA.parent.getWorldQuaternion(_q1), wq = boneA.getWorldQuaternion(_q2);
    boneA.quaternion.copy(pq.invert().multiply(_q3.multiply(wq)));
    boneA.updateMatrixWorld(true);
  }

  /**
   * IK analítico de dois ossos: a (raiz) → b (meio) → c (ponta) alcança `target`,
   * com o meio (joelho/cotovelo) puxado para `pole`. Tudo em coordenadas de mundo.
   */
  twoBone(A, B, C, target, pole, lenAB, lenBC) {
    const a = A.getWorldPosition(V());
    const toT = V().subVectors(target, a);
    let d = toT.length(); if (d < 1e-4) return;
    const dir = toT.divideScalar(d);
    d = Math.min(d, (lenAB + lenBC) * 0.9995); d = Math.max(d, Math.abs(lenAB - lenBC) + 0.001);
    const cosA = (lenAB * lenAB + d * d - lenBC * lenBC) / (2 * lenAB * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pd = V().subVectors(pole, a); pd.addScaledVector(dir, -pd.dot(dir));
    if (pd.lengthSq() < 1e-8) pd.set(0, 1, 0).addScaledVector(dir, -dir.y);
    pd.normalize();
    const bTarget = V().copy(a).addScaledVector(dir, cosA * lenAB).addScaledVector(pd, sinA * lenAB);
    this.aimBone(A, B, bTarget.sub(a).normalize());
    const b = B.getWorldPosition(V());
    const endTarget = V().copy(a).addScaledVector(dir, d);
    this.aimBone(B, C, endTarget.sub(b).normalize());
  }
}
