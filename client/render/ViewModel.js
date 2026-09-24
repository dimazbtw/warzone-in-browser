import * as THREE from 'three';
import { gunModel, armsModel, OPERATOR_STYLES } from './Models.js';

/** ViewModel — arma + braços em primeira pessoa com bob, sway, recuo e animações de ação. */
export class ViewModel {
  constructor(camera) {
    this.root = new THREE.Group(); this.root.scale.setScalar(0.62); camera.add(this.root);
    this.weaponId = null; this.kick = 0; this.swayX = 0; this.swayY = 0; this.bob = 0;
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flash = new THREE.Group();
    for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.1), flashMat); p.rotation.z = i * Math.PI / 3; this.flash.add(p); }
    this.light = new THREE.PointLight(0xffaa44, 0, 8); this.flashT = 0;
    this.style = OPERATOR_STYLES[0];
  }
  setWeapon(id, style = this.style) {
    if (id === this.weaponId && style === this.style) return;
    this.weaponId = id; this.style = style; this.root.clear();
    if (!id) return;
    const gun = gunModel(id), arms = armsModel(style);
    arms.userData.left.position.z = id === 'sidearm' ? -0.02 : -Math.min(0.42, gun.userData.L * 0.5);
    if (id === 'sidearm') { arms.userData.left.position.set(-0.03, -0.12, -0.02); arms.userData.left.rotation.set(0.3, -0.2, -0.9); }
    this.flash.position.set(0, 0.02, gun.userData.muzzleZ - 0.05); this.light.position.copy(this.flash.position);
    this.root.add(gun, arms, this.flash, this.light); this.flash.visible = false;
  }
  fire(recoil = 1) { this.kick = Math.min(0.12, this.kick + 0.045 * recoil); this.flashT = 0.045; this.flash.rotation.z = Math.random() * 3; this.flash.scale.setScalar(0.8 + Math.random() * 0.6); }

  update(dt, { ads, sprint, moving, action, mouseDX = 0, mouseDY = 0, visible, sniperScope }) {
    this.root.visible = visible && !sniperScope;
    this.flashT -= dt; this.flash.visible = this.flashT > 0; this.light.intensity = this.flashT > 0 ? 6 : 0;
    this.kick = Math.max(0, this.kick - dt * 0.6);
    this.swayX += (-mouseDX * 0.002 - this.swayX) * Math.min(1, dt * 8); this.swayY += (mouseDY * 0.002 - this.swayY) * Math.min(1, dt * 8);
    if (moving) this.bob += dt * (sprint ? 13 : 8);
    const b = moving ? Math.sin(this.bob) * (sprint ? 0.02 : 0.01) : 0;
    const target = ads ? [0, -0.12, -0.3] : sprint ? [0.28, -0.3, -0.3] : [0.22, -0.22, -0.4];
    const k = Math.min(1, dt * 14), p = this.root.position;
    p.x += (target[0] + b + this.swayX - p.x) * k; p.y += (target[1] + Math.abs(b) + this.swayY - p.y) * k; p.z += (target[2] + this.kick - p.z) * k;
    const rx = action === 'reload' ? -0.55 : action === 'plate' ? -1.0 : action === 'heal' ? -0.8 : action === 'revive' ? -1.2 : this.kick * 1.5;
    this.root.rotation.x += (rx - this.root.rotation.x) * k;
    this.root.rotation.y += ((sprint ? 0.6 : 0) - this.root.rotation.y) * k;
  }
}
