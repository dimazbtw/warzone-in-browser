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
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i]; f.t -= dt;
      if (f.boom) {
        const age = f.total - f.t, [fire, smoke, light] = f.o.children;
        fire.scale.setScalar(0.5 + age * f.radius * 1.8); fire.material.opacity = Math.max(0, 1 - age * 3);
        smoke.scale.setScalar(1 + age * 3); smoke.position.y = age * 1.5; smoke.material.opacity = Math.max(0, 0.7 - age * 0.3);
        light.intensity = Math.max(0, 60 - age * 200);
      }
      if (f.t <= 0) { this.scene.remove(f.o); f.pool.push(f.o); this.live.splice(i, 1); }
    }
  }
}
