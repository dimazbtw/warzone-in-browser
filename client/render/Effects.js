import * as THREE from 'three';

/** Effects — traçantes, faíscas e explosões com pool de objetos. */
export class Effects {
  constructor(scene) {
    this.scene = scene; this.live = [];
    this.tracerPool = []; this.sparkPool = []; this.boomPool = [];
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.85 });
  }
  tracer(from, to) {
    const l = this.tracerPool.pop() ?? new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.tracerMat);
    const pos = l.geometry.attributes.position; pos.setXYZ(0, from.x, from.y, from.z); pos.setXYZ(1, to.x, to.y, to.z); pos.needsUpdate = true; l.geometry.computeBoundingSphere();
    this.scene.add(l); this.live.push({ o: l, t: 0.06, pool: this.tracerPool });
  }
  spark(p, color = 0xffcc66) {
    const m = this.sparkPool.pop() ?? new THREE.Mesh(new THREE.SphereGeometry(0.07, 4, 4), new THREE.MeshBasicMaterial({ color }));
    m.material.color.set(color); m.position.copy(p); this.scene.add(m); this.live.push({ o: m, t: 0.15, pool: this.sparkPool });
  }
  explosion(p, radius) {
    let e = this.boomPool.pop();
    if (!e) {
      e = new THREE.Group();
      e.add(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      e.add(new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshStandardMaterial({ color: 0x333028, transparent: true, depthWrite: false })));
      e.add(new THREE.PointLight(0xff9933, 0, radius * 4));
    }
    e.position.set(p.x, p.y, p.z); this.scene.add(e);
    this.live.push({ o: e, t: 2.5, total: 2.5, boom: true, radius, pool: this.boomPool });
  }
  /** Nuvem de fumaça: sprites suaves que crescem, giram devagar e somem no fim. */
  smoke(p, radius = 7, duration = 16) {
    if (!this.smokeTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(235,235,230,1)'); gr.addColorStop(0.5, 'rgba(210,210,205,.6)'); gr.addColorStop(1, 'rgba(200,200,195,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); this.smokeTex = new THREE.CanvasTexture(c);
    }
    const grp = new THREE.Group(); grp.position.set(p.x, p.y, p.z);
    const puffs = [];
    for (let i = 0; i < 22; i++) {
      const m = new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, opacity: 0, color: new THREE.Color().setHSL(0, 0, 0.78 + Math.random() * 0.12) });
      const sp = new THREE.Sprite(m), a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius * 0.75;
      sp.userData = { x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.8 + Math.random() * radius * 0.45, s: radius * (0.7 + Math.random() * 0.5), rot: (Math.random() - 0.5) * 0.2 };
      grp.add(sp); puffs.push(sp);
    }
    this.scene.add(grp); this.live.push({ o: grp, t: duration, total: duration, smoke: true, puffs, pool: [] });
  }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i]; f.t -= dt;
      if (f.boom) {
        const age = f.total - f.t, [fire, smoke, light] = f.o.children;
        fire.scale.setScalar(0.5 + age * f.radius * 1.8); fire.material.opacity = Math.max(0, 1 - age * 3);
        smoke.scale.setScalar(1 + age * 3); smoke.position.y = age * 1.5; smoke.material.opacity = Math.max(0, 0.7 - age * 0.3);
        light.intensity = Math.max(0, 60 - age * 200);
      }
      if (f.smoke) {
        const age = f.total - f.t, grow = Math.min(1, age / 1.6), fade = Math.min(1, f.t / 3);
        for (const sp of f.puffs) { const u = sp.userData; sp.position.set(u.x * grow, u.y * (0.4 + 0.6 * grow) + age * 0.03, u.z * grow); sp.scale.setScalar(u.s * (0.3 + 0.7 * grow)); sp.material.opacity = 0.85 * fade * Math.min(1, age * 2); sp.material.rotation += u.rot * dt; }
        if (f.t <= 0) { for (const sp of f.puffs) sp.material.dispose(); }
      }
      if (f.t <= 0) { this.scene.remove(f.o); f.pool.push(f.o); this.live.splice(i, 1); }
    }
  }
}
