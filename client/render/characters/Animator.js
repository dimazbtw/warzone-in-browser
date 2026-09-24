import * as THREE from 'three';

/**
 * Animator — animação procedural por IK para qualquer humanoide mapeado no Rig.
 *
 * Camadas por quadro:
 *   1. pesos suavizados de cada modo (em pé, agachado, deitado, no ar, queda livre,
 *      paraquedas, abatido, slide, mantle/escalada, morto) — transições contínuas
 *   2. quadril: altura, inclinação, balanço do passo, torção para strafe
 *   3. coluna/cabeça: inclinação + pitch da mira distribuído
 *   4. arma: posição no peito conforme mira/sprint/ação (recarga, placa, cura…)
 *   5. braços: IK de dois ossos até o punho e o guarda-mão da arma
 *   6. pernas: ciclo de passos com pés plantados (IK) e altura do chão por pé
 */
const _v = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const approach = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);

/** Pontos de empunhadura por tipo de arma (espaço local da arma: cano em -Z). */
export const GRIPS = {
  rifle:   { grip: [0, -0.085, 0.03], support: [0, -0.035, -0.33], shoulder: 0.22 },
  battle:  { grip: [0, -0.085, 0.03], support: [0, -0.035, -0.35], shoulder: 0.24 },
  smg:     { grip: [0, -0.085, 0.03], support: [0, -0.03, -0.22], shoulder: 0.2 },
  shotgun: { grip: [0, -0.08, 0.03], support: [0, -0.02, -0.46], shoulder: 0.24 },
  marksman:{ grip: [0, -0.06, 0.12], support: [0, -0.03, -0.38], shoulder: 0.3 },
  sidearm: { grip: [0, -0.085, 0.0], support: [-0.035, -0.09, 0.025], shoulder: 0.42 },
};

export class Animator {
  constructor(rig, weaponHolder) {
    this.rig = rig; this.weapon = weaponHolder; this.phase = Math.random(); this.t = 0;
    this.k = { crouch: 0, prone: 0, air: 0, freefall: 0, chute: 0, downed: 0, slide: 0, mantle: 0, dead: 0, sprint: 0, tac: 0, ads: 0, low: 0, hide: 0, action: 0 };
    this.speed = 0; this.moveYaw = 0; this.kick = 0; this.legTwist = 0; this.deadDir = 1;
    this.fwd = _v(); this.right = _v(); this.tmp = _v();
  }
  fire() { this.kick = 1; }

  /**
   * s = { x, y, z, yaw, pitch, vx, vz, state, stance, sprint(0|1|2), ads, slide, mantle(0|1|2),
   *       grounded, action, weapon, groundAt(x,z)->y }
   */
  update(dt, s) {
    const rig = this.rig, b = rig.b, K = this.k, root = rig.root;
    this.t += dt;
    // ---------- raiz ----------
    root.position.set(s.x, s.y, s.z); root.rotation.set(0, s.yaw, 0);
    const F = this.fwd.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw)), R = this.right.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    // ---------- pesos alvo ----------
    const st = s.state, alive = st === 'alive';
    const tgt = {
      crouch: alive && (s.stance === 'crouch' || s.action === 'revive' || s.action === 'chest') && !s.slide ? 1 : 0,
      prone: alive && s.stance === 'prone' ? 1 : 0,
      air: alive && !s.grounded && !s.mantle ? 1 : 0,
      freefall: st === 'freefall' ? 1 : 0, chute: st === 'parachute' ? 1 : 0, downed: st === 'downed' ? 1 : 0,
      slide: alive && s.slide ? 1 : 0, mantle: alive && s.mantle ? 1 : 0, dead: st === 'dead' ? 1 : 0,
      sprint: alive && s.sprint === 1 ? 1 : 0, tac: alive && s.sprint === 2 ? 1 : 0, ads: alive && s.ads ? 1 : 0,
      low: alive && ['plate', 'heal', 'revive', 'chest'].includes(s.action) ? 1 : 0,
      hide: st === 'freefall' || st === 'parachute' || st === 'dead' || st === 'aircraft' ? 1 : 0,
      action: s.action === 'reload' ? 1 : 0,
    };
    for (const k in K) K[k] = approach(K[k], tgt[k], k === 'dead' ? 5 : k === 'air' ? 12 : 9, dt);
    const locoW = Math.max(0, 1 - K.prone - K.freefall - K.chute - K.downed - K.dead - K.slide * 0.8);

    // ---------- locomoção ----------
    const vSpeed = Math.hypot(s.vx ?? 0, s.vz ?? 0);
    this.speed = approach(this.speed, alive && s.grounded ? vSpeed : 0, 10, dt);
    if (vSpeed > 0.3) {
      const my = Math.atan2(-(s.vx), -(s.vz)); let d = my - this.moveYaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      this.moveYaw += d * Math.min(1, 12 * dt);
    }
    const M = _v().set(-Math.sin(this.moveYaw), 0, -Math.cos(this.moveYaw));
    const run = Math.min(1, this.speed / 8), stride = (0.45 + this.speed * 0.2) * (1 - K.crouch * 0.35), lift = (0.07 + run * 0.12) * (1 - K.crouch * 0.4);
    this.phase = (this.phase + (this.speed * dt) / Math.max(0.4, stride * 2)) % 1;
    // ângulo entre movimento e olhar (para torcer pernas no strafe e andar de costas)
    let rel = this.moveYaw - s.yaw; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI;
    const backward = Math.abs(rel) > Math.PI * 0.6;
    const twistTarget = this.speed > 0.8 && !backward ? Math.max(-0.6, Math.min(0.6, rel)) * 0.7 : backward ? Math.max(-0.5, Math.min(0.5, rel - Math.sign(rel) * Math.PI)) * 0.5 : 0;
    this.legTwist = approach(this.legTwist, twistTarget * locoW, 8, dt);
    this.kick = Math.max(0, this.kick - dt * 9);

    rig.reset();
    // ---------- quadril ----------
    const bob = -Math.abs(Math.sin(this.phase * Math.PI * 2)) * 0.035 * run * locoW;
    const hipDrop = K.crouch * 0.4 + run * 0.05 + K.air * 0.05 + K.mantle * 0.25;
    const hipRestY = rig.restLocal.hips.y, wSlide = K.slide * 0.8;
    const hsum = locoW * (hipRestY - hipDrop + bob) + K.prone * 0.16 + K.downed * 0.3 + K.dead * 0.15 + (K.freefall + K.chute) * hipRestY + wSlide * 0.48;
    const hipsY = s.y + hsum / (locoW + K.prone + K.downed + K.dead + K.freefall + K.chute + wSlide || 1);
    const hipsFwd = K.prone * -0.55 + K.downed * 0.2 + K.dead * this.deadDir * -0.6;
    const hipsPos = _v().set(s.x, hipsY, s.z).addScaledVector(F, hipsFwd).addScaledVector(R, Math.sin(this.phase * Math.PI * 2) * 0.025 * run * locoW);
    b.hips.position.copy(b.hips.parent.worldToLocal(hipsPos.clone()));
    rig.update();
    const lean = -(run * 0.14 + K.sprint * 0.12 + K.tac * 0.16 + K.crouch * 0.18) * locoW;
    const pitchBody = lean - K.prone * 1.5 + K.downed * 0.75 - K.freefall * 1.35 + K.slide * 0.45 + K.dead * this.deadDir * 1.5 - K.mantle * 0.35;
    rig.rotateWorld(b.hips, UP, this.legTwist);
    rig.rotateWorld(b.hips, R, pitchBody);
    // ---------- coluna / cabeça ----------
    const aimPitch = Math.max(-1.1, Math.min(1.1, s.pitch ?? 0)) * (1 - K.hide) * (1 - K.sprint * 0.7) * (1 - K.tac);
    const breathe = Math.sin(this.t * 1.7) * 0.012;
    const spineCounter = -lean * 0.4 + K.prone * 0.45 - K.downed * 0.35 + K.freefall * 0.25;
    for (const [bone, w] of [[b.spine0, 0.28], [b.spine1, 0.32], [b.spine2, 0.3]]) {
      if (!bone) continue;
      rig.rotateWorld(bone, UP, -this.legTwist * w * 1.1);
      rig.rotateWorld(bone, R, aimPitch * w * 0.75 + spineCounter * w + breathe);
    }
    if (b.neck) rig.rotateWorld(b.neck, R, aimPitch * 0.15 + K.prone * 0.5 + K.freefall * 0.55 - K.downed * 0.1);
    rig.rotateWorld(b.head, R, aimPitch * 0.12 + K.prone * 0.35 + K.freefall * 0.4);

    // ---------- arma ----------
    const kind = s.weapon && GRIPS[s.weapon] ? s.weapon : 'rifle', G = GRIPS[kind], pistol = kind === 'sidearm';
    const chest = b.spine2.getWorldPosition(_v()), head = b.head.getWorldPosition(_v());
    const bodyUp = UP.clone().applyAxisAngle(R, pitchBody), bodyF = F.clone().applyAxisAngle(R, pitchBody);
    // direção da arma: mira (com pitch) → sprint (atravessada) → tático (para cima) → baixa (ações)
    const aimDir = F.clone().multiplyScalar(Math.cos(aimPitch)).addScaledVector(UP, Math.sin(aimPitch));
    const portDir = F.clone().multiplyScalar(0.55).addScaledVector(UP, -0.45).addScaledVector(R, -0.55).normalize();
    const tacDir = F.clone().multiplyScalar(0.25).addScaledVector(UP, 0.92).addScaledVector(R, -0.15).normalize();
    const lowDir = F.clone().multiplyScalar(0.55).addScaledVector(UP, -0.8).normalize();
    const pronDir = bodyUp.clone().multiplyScalar(1).normalize();
    const D = aimDir.clone().multiplyScalar(Math.max(0, 1 - K.sprint - K.tac - K.low) * (1 - K.prone)).addScaledVector(portDir, K.sprint).addScaledVector(tacDir, K.tac).addScaledVector(lowDir, K.low)
      .addScaledVector(F, K.prone * 0.9).addScaledVector(pronDir, K.prone * 0.1).normalize();
    // punho: à frente do ombro direito; ADS sobe para a linha do olho
    const sock = chest.clone()
      .addScaledVector(R, (0.1 - K.ads * 0.07 + (pistol ? -0.06 : 0)) * (1 - K.prone))
      .addScaledVector(UP, (-0.1 + K.ads * 0.12 - K.low * 0.1 + K.tac * 0.05) * (1 - K.prone))
      .addScaledVector(aimDir, (G.shoulder - 0.2 + (pistol ? 0.08 : 0)) * (1 - K.sprint - K.tac) * (1 - K.prone))
      .addScaledVector(F, K.sprint * 0.12 + K.tac * 0.05 + K.prone * 0.35)
      .addScaledVector(D, -0.05 * this.kick);
    if (K.prone > 0.01) sock.y = approach(sock.y, s.y + 0.22, 1, K.prone);
    if (K.action > 0.01) { const w = Math.sin(this.t * 6) * 0.03 * K.action; sock.addScaledVector(UP, -0.05 * K.action + w); }
    const wq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), D, UP));
    // recarga: rola a arma de lado
    if (K.action > 0.01) wq.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.6 * K.action));
    const gripLocal = new THREE.Vector3(...G.grip);
    this.weapon.quaternion.copy(wq);
    this.weapon.position.copy(sock).sub(gripLocal.clone().applyQuaternion(wq));
    this.weapon.visible = K.hide < 0.5 && !!s.weapon;
    this.weapon.updateMatrixWorld(true);
    const rightTarget = this.weapon.localToWorld(gripLocal.clone());
    const leftTarget = this.weapon.localToWorld(new THREE.Vector3(...G.support));
    // recarga: mão de apoio vai ao carregador e volta
    if (K.action > 0.01) { const cyc = (Math.sin(this.t * 3.2) * 0.5 + 0.5) * K.action; leftTarget.lerp(chest.clone().addScaledVector(R, -0.05).addScaledVector(UP, -0.25).addScaledVector(F, 0.2), cyc * 0.7); }
    if (K.low > 0.01) leftTarget.lerp(chest.clone().addScaledVector(F, 0.22).addScaledVector(UP, -0.05), K.low);
    // ---------- braços ----------
    const armL = b.armL.getWorldPosition(_v()), armR = b.armR.getWorldPosition(_v());
    const hand = (side) => {
      const sgn = side === 'L' ? -1 : 1, sh = side === 'L' ? armL : armR;
      let t = side === 'L' ? leftTarget.clone() : rightTarget.clone();
      // modos sem arma: queda livre (abertos), paraquedas (segurando as alças), morto (soltos), mantle (na borda)
      const spread = sh.clone().addScaledVector(R, sgn * 0.52).addScaledVector(bodyF, 0.18).addScaledVector(bodyUp, 0.05);
      const risers = sh.clone().addScaledVector(UP, 0.42).addScaledVector(R, sgn * 0.1).addScaledVector(F, 0.06);
      const limp = sh.clone().addScaledVector(R, sgn * 0.2).addScaledVector(bodyUp, -0.5);
      const ledge = chest.clone().addScaledVector(F, 0.42).addScaledVector(UP, 0.32).addScaledVector(R, sgn * 0.22);
      const ground = _v().set(s.x, s.y + 0.05, s.z).addScaledVector(F, -0.25).addScaledVector(R, sgn * 0.28);
      t.lerp(spread, K.freefall).lerp(risers, K.chute).lerp(limp, K.dead).lerp(ledge, K.mantle * 0.9);
      if (side === 'L') t.lerp(ground, K.downed);
      const pole = sh.clone().addScaledVector(R, sgn * 0.35).addScaledVector(bodyUp, -0.55).addScaledVector(bodyF, -0.2);
      rig.twoBone(b['arm' + side], b['fore' + side], b['hand' + side], t, pole, rig.len.upper, rig.len.fore);
      const fq = b['fore' + side].getWorldQuaternion(new THREE.Quaternion());
      rig.setWorldQuaternion(b['hand' + side], fq.multiply(rig.handRestRel[side]));
    };
    hand('R'); hand('L');

    // ---------- pernas ----------
    const hipsW = b.hips.getWorldPosition(_v());
    const foot = (side, phaseOff) => {
      const sgn = side === 'L' ? -1 : 1, thigh = b['thigh' + side].getWorldPosition(_v());
      const base = _v().set(s.x, 0, s.z).addScaledVector(R, sgn * (0.11 + K.crouch * 0.05));
      const ph = (this.phase + phaseOff) % 1;
      let off = 0, up = 0;
      if (ph < 0.6) off = stride * (0.5 - ph / 0.6); else { const u = (ph - 0.6) / 0.4; off = stride * (-0.5 + u); up = Math.sin(u * Math.PI) * lift; }
      const moving = Math.min(1, this.speed / 1.2);
      const idleOff = K.crouch * (side === 'R' ? 0.22 : -0.12);
      const loco = base.clone().addScaledVector(M, off * moving).addScaledVector(F, idleOff * (1 - moving));
      const gy = s.groundAt ? s.groundAt(loco.x, loco.z) : s.y;
      loco.y = Math.max(s.y - 0.35, Math.min(s.y + 0.4, gy)) + 0.1 + up * moving;
      // outros modos
      const prone = _v().set(s.x, s.y + 0.08, s.z).addScaledVector(F, -0.85 + Math.sin((this.phase + phaseOff) * Math.PI * 2) * 0.12 * moving).addScaledVector(R, sgn * 0.18);
      const ff = hipsW.clone().addScaledVector(bodyUp, -0.78).addScaledVector(R, sgn * 0.26).addScaledVector(bodyF, 0.1);
      const chute = hipsW.clone().addScaledVector(UP, -0.86).addScaledVector(F, 0.12 + Math.sin(this.t * 1.3 + sgn) * 0.05).addScaledVector(R, sgn * 0.12);
      const air = hipsW.clone().addScaledVector(UP, -0.72).addScaledVector(R, sgn * 0.13).addScaledVector(F, side === 'R' ? 0.12 : -0.05);
      const sit = _v().set(s.x, s.y + 0.08, s.z).addScaledVector(F, 0.62 + (side === 'R' ? 0.1 : 0)).addScaledVector(R, sgn * 0.2);
      const slide = _v().set(s.x, s.y + 0.1, s.z).addScaledVector(F, side === 'R' ? 0.8 : 0.1).addScaledVector(R, sgn * 0.14);
      const mantle = hipsW.clone().addScaledVector(UP, -0.45).addScaledVector(F, 0.25).addScaledVector(R, sgn * 0.14);
      const dead = hipsW.clone().addScaledVector(bodyUp, -0.85).addScaledVector(R, sgn * 0.16);
      const t = loco.lerp(prone, K.prone).lerp(ff, K.freefall).lerp(chute, K.chute).lerp(air, K.air * (1 - K.mantle)).lerp(sit, K.downed).lerp(slide, K.slide).lerp(mantle, K.mantle).lerp(dead, K.dead);
      const pole = thigh.clone().addScaledVector(bodyF, 0.6).addScaledVector(R, sgn * 0.08).addScaledVector(UP, -K.prone * 0.5);
      rig.twoBone(b['thigh' + side], b['shin' + side], b['foot' + side], t, pole, rig.len.thigh, rig.len.shin);
      // pé plano, virado para frente
      const rq = root.getWorldQuaternion(new THREE.Quaternion());
      rig.setWorldQuaternion(b['foot' + side], rq.multiply(rig.footRestRel[side]));
    };
    foot('L', 0); foot('R', 0.5);
  }
}
