import * as THREE from 'three';
import { gunModel, armsModel, OPERATOR_STYLES, classOf } from './Models.js';
import { realGun, hasRealGun } from './RealWeapons.js';
import { assets } from '../assets/AssetManager.js';

/**
 * ViewModel — arma + braços em primeira pessoa.
 *   - fuzil GLB real (Higgsfield) quando carregado, senão o procedural
 *   - recuo com mola (posição + rotação), sway do mouse, bob do passo
 *   - animações: sacar, recarga (3 fases), placa, cura, reviver, sprint, slide, pouso
 */
/**
 * Braço real de 1ª pessoa (GLB enviado pelo usuário: braço direito, mão aberta, mão na ponta -Z).
 * Normalizado: origem no centro da palma, braço estendendo para +Z (como o procedural), ~0,72 m.
 * O esquerdo é o mesmo modelo espelhado em X.
 */
let armTpl;
function realArm() {
  if (armTpl === undefined) {
    const g = assets.get('arms'); if (!g) return null;
    const src = g.scene.clone(true); src.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(src), sz = box.getSize(new THREE.Vector3()), len = sz.z;
    // centro da palma: média dos vértices nos 8% da ponta -Z
    const palm = new THREE.Vector3(), v = new THREE.Vector3(); let n = 0;
    src.traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i += 3) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.z < box.min.z + len * 0.08) { palm.add(v); n++; } } });
    palm.divideScalar(Math.max(1, n));
    const k = 0.72 / len, inner = new THREE.Group(); inner.add(src); src.position.sub(palm); inner.scale.setScalar(k);
    src.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.material = o.material.clone(); o.material.roughness = Math.max(0.55, o.material.roughness ?? 1); } });
    armTpl = inner;
  }
  return armTpl.clone(true);
}
/** Braços reais: mesmos pontos/rotações do procedural (a mão fica na origem de cada grupo). */
function realArms(pose) {
  const g = new THREE.Group();
  const mk = (x, y, z, rx, ry, rz, roll, mirror) => {
    const a = new THREE.Group(), m = realArm(); if (!m) return null;
    m.rotation.z = roll; if (mirror) m.scale.x *= -1;
    a.add(m); a.position.set(x, y, z); a.rotation.set(rx, ry, rz); g.add(a); return a;
  };
  if (!mk(...pose.right)) return null;
  g.userData.left = mk(...pose.left);
  return g;
}
// [x, y, z, rx, ry, rz, roll da mão, espelhar] — mão direita no punho, esquerda sob o guarda-mão
const ARM_POSE = {
  // palma do modelo olha para -Y com roll 0 → direita: roll -π/2 (palma contra a lateral do punho);
  // esquerda (espelhada): roll π (palma para cima, sob o guarda-mão). rx/ry levam o antebraço para trás e para baixo.
  long:   { right: [0.035, -0.055, 0.03, 0.42, 0.34, 0, -Math.PI / 2, false], left: [0.012, -0.06, -0.36, 0.12, -0.32, 0, Math.PI, true] },
  pistol: { right: [0.03, -0.1, 0.03, 0.5, 0.34, 0, -Math.PI / 2, false], left: [-0.01, -0.14, 0.04, 0.55, -0.45, 0, Math.PI, true] },
};

const VM_FOV = 50;
/** Faca de combate (procedural): lâmina em -Z, cabo na origem. */
function knifeModel() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.9, roughness: 0.28 }), grip = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.8 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.032, 0.17), steel); blade.position.set(0, 0.004, -0.1);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 4), steel); tip.rotation.x = -Math.PI / 2; tip.scale.set(0.3, 1, 1); tip.position.set(0, 0.004, -0.205);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.01), grip); guard.position.z = -0.012;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.11, 10), grip); handle.rotation.x = Math.PI / 2; handle.position.z = 0.045;
  g.add(blade, tip, guard, handle); g.userData = { L: 0.3, muzzleZ: -0.23, knife: true };
  return g;
}
/** Mola amortecida com subpassos: estável mesmo com um quadro lento (antes explodia e a arma "pulava"). */
const spring = (s, target, k, d, dt) => {
  const n = Math.min(12, Math.ceil(dt / (1 / 120))), h = dt / n;
  for (let i = 0; i < n; i++) { const a = (target - s.x) * k - s.v * d; s.v += a * h; s.x += s.v * h; }
  return s.x;
};
const smooth = t => t * t * (3 - 2 * t);

export class ViewModel {
  constructor(camera) {
    // espaço do viewmodel: escala X/Y = tan(FOV da câmera/2) / tan(FOV da arma/2) → a arma é projetada como
    // se tivesse o próprio FOV (50°), sem a distorção de perspectiva do FOV largo do jogo
    this.camera = camera; this.space = new THREE.Group(); camera.add(this.space);
    this.root = new THREE.Group(); this.root.scale.setScalar(0.62); this.space.add(this.root);
    this.gun = null; this.arms = null; this.left = null; this.leftRest = new THREE.Vector3(); this.leftRot = new THREE.Euler();
    this.weaponId = null; this.swayX = 0; this.swayY = 0; this.bob = 0; this.t = 0;
    this.kz = { x: 0, v: 0 }; this.kr = { x: 0, v: 0 }; this.ky = { x: 0, v: 0 }; this.land = { x: 0, v: 0 };
    this.drawT = 1; this.actionT = 0; this.lastAction = null; this.adsK = 0; this.sprintK = 0; this.slideK = 0; this.fireRoll = 0;
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flash = new THREE.Group();
    for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.1), flashMat); p.rotation.z = i * Math.PI / 3; this.flash.add(p); }
    this.light = new THREE.PointLight(0xffaa44, 0, 8); this.flashT = 0; this.root.add(this.light);
    this.style = OPERATOR_STYLES[0];
  }
  setWeapon(id, style = this.style) {
    const upgrade = id && this.gun && !this.gun.userData.real && hasRealGun(id);   // GLB chegou depois
    if (id === this.weaponId && style === this.style && !upgrade) return;
    this.weaponId = id; this.style = style; this.root.clear(); this.root.add(this.light); this.gun = null;   // luz persistente: nº de luzes nunca muda (evita recompilar shaders)
    if (!id) return;
    const pistolCls = classOf(id) === 'pistol', real = realArms(pistolCls ? ARM_POSE.pistol : ARM_POSE.long);
    const gun = id === 'knife' ? knifeModel() : realGun(id) || gunModel(id), arms = real || armsModel(style);
    if (id === 'knife' && arms.userData.left) arms.userData.left.visible = false;   // faca: só a mão direita
    const left = arms.userData.left;
    const pistol = pistolCls;
    if (!real) left.position.z = pistol ? -0.02 : -Math.min(0.42, gun.userData.L * 0.5);
    else if (!pistol) left.position.z = -Math.min(0.5, gun.userData.L * 0.42);   // apoio no guarda-mão, conforme o tamanho da arma
    if (!real && pistol) { left.position.set(-0.03, -0.12, -0.02); left.rotation.set(0.3, -0.2, -0.9); }
    this.leftRest.copy(left.position); this.leftRot.copy(left.rotation);
    this.flash.position.set(0, 0.02, gun.userData.muzzleZ - 0.05); this.light.position.copy(this.flash.position);
    this.root.add(gun, arms, this.flash); this.flash.visible = false;
    this.gun = gun; this.arms = arms; this.left = left; this.drawT = 0;
    // ADS: sobe a arma até a linha de visada (topo do modelo) ficar exatamente no centro da tela
    this.root.remove(gun); gun.updateMatrixWorld(true);                       // caixa no espaço da própria arma
    const bb = new THREE.Box3().setFromObject(gun), sightY = (bb.max.y - 0.004) * this.root.scale.y; this.root.add(gun);
    this.aimPos = [0, -sightY, pistol ? -0.36 : -0.37];
  }
  fire(recoil = 1) {
    this.kz.v += 1.6 * recoil; this.kr.v += 9 * recoil; this.ky.v += (Math.random() - 0.5) * 3 * recoil; this.fireRoll = (Math.random() - 0.5) * 0.04 * recoil;
    this.flashT = 0.045; this.flash.rotation.z = Math.random() * 3; this.flash.scale.setScalar(0.8 + Math.random() * 0.6);
  }
  /** Golpe de faca: a arma sai de lado e a mão varre a frente. */
  melee() { this.meleeT = 0; }
  /** Impacto de pouso (velocidade vertical em m/s). */
  landed(speed) { this.land.v -= Math.min(4, speed * 0.25); }

  fovCompensate() {
    const k = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(VM_FOV) / 2);
    this.space.scale.set(k, k, 1);
  }
  update(dt, { ads, sprint, moving, speed = 0, slide, grounded = true, action, actionTime = 1, mouseDX = 0, mouseDY = 0, visible, sniperScope }) {
    this.t += dt; this.fovCompensate();
    this.root.visible = visible && !sniperScope && !!this.gun;
    this.flashT -= dt; this.flash.visible = this.flashT > 0; this.light.intensity = this.flashT > 0 ? 6 : 0;
    const a = Math.min(1, dt * 12);
    this.adsK += ((ads ? 1 : 0) - this.adsK) * Math.min(1, dt * 14);
    this.sprintK += ((sprint && !ads ? 1 : 0) - this.sprintK) * Math.min(1, dt * 9);
    this.slideK += ((slide ? 1 : 0) - this.slideK) * a;
    this.drawT = Math.min(1, this.drawT + dt / 0.4);
    if (action !== this.lastAction) { this.actionT = 0; this.lastAction = action; }
    this.actionT += dt;

    // molas de recuo
    const kz = spring(this.kz, 0, 180, 18, dt), kr = spring(this.kr, 0, 160, 16, dt), ky = spring(this.ky, 0, 120, 14, dt), ld = spring(this.land, 0, 90, 10, dt);
    this.fireRoll *= Math.max(0, 1 - dt * 10);
    // sway / bob
    this.swayX += (-mouseDX * 0.0018 - this.swayX) * Math.min(1, dt * 8); this.swayY += (mouseDY * 0.0018 - this.swayY) * Math.min(1, dt * 8);
    const mv = moving && grounded ? Math.min(1, speed / 4) : 0;
    this.bob += dt * (sprint ? 13 : 8.5) * (mv > 0 ? 1 : 0);
    const amp = (sprint ? 0.028 : 0.012) * mv * (1 - this.adsK * 0.85);
    const bx = Math.sin(this.bob) * amp, by = -Math.abs(Math.cos(this.bob)) * amp * 0.8;
    const breathe = Math.sin(this.t * 1.6) * 0.003 * (1 - this.adsK * 0.7);

    // pose-base: quadril ↔ mira ↔ sprint
    const hip = [0.155, -0.1, -0.36], aim = this.aimPos ?? [0, -0.115, -0.3], spr = [0.14, -0.15, -0.34];
    const px = hip[0] + (aim[0] - hip[0]) * this.adsK + (spr[0] - hip[0]) * this.sprintK;
    const py = hip[1] + (aim[1] - hip[1]) * this.adsK + (spr[1] - hip[1]) * this.sprintK;
    const pz = hip[2] + (aim[2] - hip[2]) * this.adsK + (spr[2] - hip[2]) * this.sprintK;
    let rx = kr * 0.012 + this.sprintK * -0.25, ry = this.sprintK * 0.7, rz = this.sprintK * 0.35 + this.fireRoll + this.slideK * 0.25;
    let ox = 0, oy = 0, oz = 0;

    // ações
    const t = this.actionT, T = Math.max(0.2, actionTime);
    if (action === 'reload') {
      const k = Math.min(1, t / T);
      const inOut = k < 0.2 ? smooth(k / 0.2) : k > 0.8 ? 1 - smooth((k - 0.8) / 0.2) : 1;
      rz += 0.55 * inOut; rx += -0.18 * inOut; oy -= 0.04 * inOut;
      if (this.left) {   // mão de apoio: tira o carregador, desce, volta e dá o tapa
        const m = k < 0.25 ? 0 : k < 0.45 ? smooth((k - 0.25) / 0.2) : k < 0.65 ? 1 : k < 0.85 ? 1 - smooth((k - 0.65) / 0.2) : 0;
        this.left.position.set(this.leftRest.x + 0.05 * m, this.leftRest.y - 0.28 * m, this.leftRest.z + 0.18 * m);
        if (k > 0.82 && k < 0.9) oy += 0.012;   // tranco do carregador entrando
      }
    } else if (action === 'plate' || action === 'heal' || action === 'revive' || action === 'chest') {
      const k = Math.min(1, t / 0.25), down = smooth(k);
      rx += -0.9 * down; oy -= 0.18 * down; oz += 0.06 * down;
      if (this.left) { const w = Math.sin(t * 9) * 0.02; this.left.position.set(this.leftRest.x - 0.05, this.leftRest.y + 0.1 * down + w, this.leftRest.z - 0.1 * down); }
    } else if (this.left) {
      this.left.position.lerp(this.leftRest, Math.min(1, dt * 14));
    }
    // faca
    if (this.meleeT !== undefined && this.meleeT < 0.45) {
      this.meleeT += dt; const k = this.meleeT / 0.45, sw = Math.sin(Math.min(1, k) * Math.PI);
      ry += -0.9 * sw; rz += 0.6 * sw; ox -= 0.18 * sw; oy -= 0.06 * sw; oz -= 0.12 * Math.sin(Math.min(1, k * 1.6) * Math.PI);
    }
    // sacar a arma
    const d = 1 - smooth(this.drawT); rx += -1.0 * d; oy -= 0.3 * d;

    const p = this.root.position, k = Math.min(1, dt * 18);
    p.x += (px + bx + this.swayX * (1 - this.adsK * 0.7) + ox - p.x) * k;
    p.y += (py + by + breathe + this.swayY * (1 - this.adsK * 0.7) + oy + ld * 0.05 - p.y) * k;
    p.z = pz + kz * 0.05 * (1 - this.adsK * 0.4) + oz;
    this.root.rotation.x += (rx + ld * 0.08 - this.root.rotation.x) * k;
    this.root.rotation.y += (ry + ky * 0.01 - this.root.rotation.y) * k;
    this.root.rotation.z += (rz - this.root.rotation.z) * k;
  }
}
