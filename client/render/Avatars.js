import * as THREE from 'three';
import { characters } from './characters/CharacterFactory.js';
import { mat } from './Models.js';

/**
 * Avatars — outros jogadores (e o próprio em 3ª pessoa) com modelos 3D animados.
 * Apresentação apenas: estado vem dos snapshots interpolados.
 *   - animação procedural por IK (Animator)
 *   - paraquedas, marcador de radar, placa de nome de aliado
 *   - morte: o corpo cai e some depois de alguns segundos
 *   - LOD: longe atualiza a animação com menos frequência
 */
export class Avatars {
  constructor(scene, geo) {
    this.scene = scene; this.geo = geo; this.viewDist = 260; this.map = new Map(); this.dead = []; this.frame = 0;
    this.radarMat = new THREE.SpriteMaterial({ color: 0xff3333, depthTest: false });
    this.canopyMat = mat(0x7a6a2a, { side: THREE.DoubleSide });
  }
  setGeo(geo) { this.geo = geo; }

  make(o, lite = false) {
    const c = characters.create({ operator: o.op ?? 0, name: o.n, ally: !!o.a, lite });
    const chute = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 6, 0, Math.PI * 2, 0, Math.PI / 3), this.canopyMat);
    canopy.position.y = 4.6; canopy.scale.set(1.35, 0.5, 0.85); chute.add(canopy);
    const lm = new THREE.LineBasicMaterial({ color: 0x222222 });
    for (const [x, z] of [[-1.9, -0.8], [1.9, -0.8], [-1.9, 0.8], [1.9, 0.8]]) chute.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.9, 0), new THREE.Vector3(x, 5.0, z)]), lm));
    chute.visible = false; c.root.add(chute); c.chute = chute;
    const mk = new THREE.Sprite(this.radarMat); mk.scale.set(0.6, 0.6, 1); mk.position.y = 2.5; mk.visible = false; mk.renderOrder = 11; c.root.add(mk); c.marker = mk;
    this.scene.add(c.root, c.weapon);
    return c;
  }

  /** Anima um personagem (usado pelo LOD distante). */
  drive(c, o, dt, dist) {
    c.root.visible = true; c.last = o; c.setWeapon(o.w); c.setShadow(false);
    c.marker.visible = !!o.rv; c.chute.visible = o.s === 'parachute';
    const every = dist < 110 ? 2 : dist < 200 ? 4 : 8;
    c.acc = (c.acc ?? 0) + dt;
    if ((this.frame + c.animator.phase * 7 | 0) % every !== 0 && c.initialized) {
      const p = c.root.position; c.weapon.position.x += o.x - p.x; c.weapon.position.y += o.y - p.y; c.weapon.position.z += o.z - p.z; p.set(o.x, o.y, o.z); return;
    }
    const y = o.y;
    c.animator.update(c.acc, { x: o.x, y, z: o.z, yaw: o.yaw, pitch: o.pitch, vx: o.vx, vz: o.vz, state: o.s, stance: o.st, sprint: o.spr, ads: o.ads,
      slide: o.sl, mantle: o.mt, grounded: o.gr !== 0, action: o.ac, weapon: o.w, groundAt: (x, z) => this.groundAt(x, z, y) });
    c.acc = 0; c.initialized = true;
  }
  groundAt = (x, z, y) => (this.geo ? this.geo.groundHeight(x, z, y + 0.6, 0.1) : 0);

  /** list = jogadores interpolados; camPos para LOD. */
  update(list, dt, camPos) {
    this.frame++;
    const seen = new Set();
    for (const o of list) {
      seen.add(o.id);
      let c = this.map.get(o.id);
      if (c && !c.real && characters.soldierTemplate()) { this.scene.remove(c.root, c.weapon); c = null; }
      if (c?.useFar === undefined && c) c.useFar = false;   // modelo real chegou: troca
      if (!c) { c = this.make(o); this.map.set(o.id, c); }
      c.last = o;
      const dist = camPos ? Math.hypot(o.x - camPos.x, o.z - camPos.z) : 0;
      // longe demais (além da neblina): nem desenha nem anima
      if (dist > (this.scene.fog ? this.scene.fog.far * 0.8 : this.viewDist) && o.s !== 'parachute' && o.s !== 'freefall') { c.root.visible = false; c.weapon.visible = false; c.initialized = false; continue; }
      // LOD: modelo real (18k vértices) só perto; longe usa o humanoide leve com o mesmo esqueleto
      if (c.real) {
        const far = dist > (c.useFar ? 36 : 44);   // histerese evita piscar na borda
        if (far !== !!c.useFar) {
          c.useFar = far;
          if (far && !c.far) { c.far = this.make(o, true); }
          const on = far ? c.far : c, off = far ? c : c.far;
          if (off) { off.root.visible = false; off.weapon.visible = false; }
          on.initialized = false;
        }
        if (c.useFar) { this.drive(c.far, o, dt, dist); c.root.visible = false; c.weapon.visible = false; c.last = o; continue; }
      }
      c.root.visible = true; c.setShadow(dist < 45);
      c.setWeapon(o.w);
      c.marker.visible = !!o.rv; c.chute.visible = o.s === 'parachute';
      const every = dist < 45 ? 1 : dist < 110 ? 2 : dist < 200 ? 4 : 8;
      c.acc = (c.acc ?? 0) + dt;
      if ((this.frame + c.animator.phase * 7 | 0) % every !== 0 && c.initialized) {
        const p = c.root.position; c.weapon.position.x += o.x - p.x; c.weapon.position.y += o.y - p.y; c.weapon.position.z += o.z - p.z; p.set(o.x, o.y, o.z); continue;
      }
      const y = o.y;
      c.animator.update(c.acc, { x: o.x, y, z: o.z, yaw: o.yaw, pitch: o.pitch, vx: o.vx, vz: o.vz, state: o.s, stance: o.st, sprint: o.spr, ads: o.ads,
        slide: o.sl, mantle: o.mt, grounded: o.gr !== 0, action: o.ac, weapon: o.w, groundAt: (x, z) => this.groundAt(x, z, y) });
      c.acc = 0; c.initialized = true;
    }
    for (const [id, c] of this.map) {
      if (seen.has(id)) continue;
      if (c.dying) continue;
      c.root.visible = false; c.weapon.visible = false;
      if (c.far) { c.far.root.visible = false; c.far.weapon.visible = false; }
    }
    // corpos caindo
    for (let i = this.dead.length - 1; i >= 0; i--) {
      const d = this.dead[i]; d.t += dt;
      const o = d.c.last;
      d.c.animator.update(dt, { x: o.x, y: o.y, z: o.z, yaw: o.yaw, pitch: 0, vx: 0, vz: 0, state: 'dead', stance: 'stand', grounded: true, weapon: null, groundAt: (x, z) => this.groundAt(x, z, o.y) });
      if (d.t > 6) { d.c.dying = false; const e = this.map.get([...this.map].find(([, v]) => v === d.c || v.far === d.c)?.[0]); if (e) e.dying = false; d.c.root.visible = false; d.c.weapon.visible = false; this.dead.splice(i, 1); }
    }
  }
  /** Jogador morreu: toca a queda no último lugar visto. */
  kill(id) {
    const c0 = this.map.get(id); if (!c0 || !c0.last || c0.dying) return;
    c0.dying = true; const c = c0.useFar && c0.far ? c0.far : c0; c.last ??= c0.last; c.dying = true; c.animator.deadDir = Math.random() < 0.5 ? 1 : -1; c.weapon.visible = false; c.chute.visible = false;
    this.dead.push({ c, t: 0 });
  }
  fire(id) { this.map.get(id)?.animator.fire(); }
  get(id) { return this.map.get(id); }
  clear() { for (const c of this.map.values()) { this.scene.remove(c.root, c.weapon); if (c.far) this.scene.remove(c.far.root, c.far.weapon); } this.map.clear(); this.dead.length = 0; }
}
