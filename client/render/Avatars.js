import * as THREE from 'three';
import { soldierModel, gunModel, nameplate, OPERATOR_STYLES } from './Models.js';

/**
 * Avatars — outros jogadores em 3D (apresentação apenas).
 * Pool por id; visual por squad; aliados com placa de nome verde;
 * poses por estado (queda livre, paraquedas, abatido, agachado, prone, slide).
 */
export class Avatars {
  constructor(scene) { this.scene = scene; this.map = new Map(); this.styleBySquad = new Map(); this.radarMat = new THREE.SpriteMaterial({ color: 0xff3333, depthTest: false }); }

  styleFor(squadId) {
    if (!this.styleBySquad.has(squadId)) this.styleBySquad.set(squadId, OPERATOR_STYLES[this.styleBySquad.size % OPERATOR_STYLES.length]);
    return this.styleBySquad.get(squadId);
  }

  update(list, dt, time) {
    const seen = new Set();
    for (const o of list) {
      seen.add(o.id);
      let a = this.map.get(o.id);
      if (!a) {
        const mesh = soldierModel(this.styleFor(o.sq));
        a = { mesh, weapon: null, walk: 0, plate: null, marker: null };
        if (o.a) { a.plate = nameplate(o.n); a.plate.position.y = 2.45; mesh.add(a.plate); }
        a.marker = new THREE.Sprite(this.radarMat); a.marker.scale.set(0.6, 0.6, 1); a.marker.position.y = 2.6; a.marker.visible = false; a.marker.renderOrder = 11; mesh.add(a.marker);
        this.scene.add(mesh); this.map.set(o.id, a);
      }
      const m = a.mesh, u = m.userData, body = u.body;
      m.visible = true; m.position.set(o.x, o.y, o.z); m.rotation.y = o.yaw;
      if (a.weapon !== o.w) { u.gunSlot.clear(); if (o.w) u.gunSlot.add(gunModel(o.w)); a.weapon = o.w; }
      a.marker.visible = !!o.rv;
      // poses
      body.rotation.set(0, 0, 0); body.position.set(0, 0, 0); body.scale.set(1, 1, 1); u.chute.visible = false;
      if (o.s === 'freefall') { body.rotation.x = -1.25; body.position.y = 0.8; }
      else if (o.s === 'parachute') { u.chute.visible = true; }
      else if (o.s === 'downed') { body.rotation.x = -1.45; body.position.set(0, 0.25, 0.6); }
      else if (o.sl) { body.rotation.x = 0.55; body.position.y = -0.35; }
      else if (o.st === 'prone') { body.rotation.x = -1.5; body.position.set(0, 0.2, 0.7); }
      else if (o.st === 'crouch') { body.scale.y = 0.72; }
      // pernas
      const speed = Math.min(1, (o.speed ?? 0) / 6);
      a.walk += dt * (4 + speed * 8) * (speed > 0.05 ? 1 : 0);
      const [lL, lR] = u.legs; lL.rotation.x = Math.sin(a.walk) * 0.6 * speed; lR.rotation.x = -lL.rotation.x;
    }
    for (const [id, a] of this.map) if (!seen.has(id)) a.mesh.visible = false;
  }
  get(id) { return this.map.get(id); }
  clear() { for (const a of this.map.values()) this.scene.remove(a.mesh); this.map.clear(); this.styleBySquad.clear(); }
}
