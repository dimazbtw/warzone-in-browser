import * as THREE from 'three';
import { characters } from './characters/CharacterFactory.js';
import { assets } from '../assets/AssetManager.js';
import { hasRealGun } from './RealWeapons.js';

/**
 * LobbyScene — cena 3D do menu: hangar escuro com faixas de luz no teto, piso
 * refletivo, a aeronave estacionada ao fundo e o operador selecionado em pose de
 * espera, segurando a arma escolhida. O operador acompanha o mouse de leve.
 * Usa o mesmo WebGLRenderer do jogo (renderiza só quando não há partida).
 */
export class LobbyScene {
  constructor(renderer) {
    this.renderer = renderer;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x14181d); s.fog = new THREE.Fog(0x14181d, 18, 60);
    this.camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 120);
    this.mouse = { x: 0, y: 0 }; this.t = 0; this.op = null; this.weapon = null;
    addEventListener('mousemove', e => { this.mouse.x = e.clientX / innerWidth * 2 - 1; this.mouse.y = e.clientY / innerHeight * 2 - 1; });
    this.build();
  }

  build() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xb8c8dc, 0x1a1d22, 1.1));
    // luz principal (fria, de cima-frente) + contraluz âmbar
    const key = new THREE.SpotLight(0xe8eeff, 90, 30, 0.6, 0.6, 1.3); key.position.set(-2.5, 7, 5); key.target.position.set(0, 1, 0); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); s.add(key, key.target);
    const rim = new THREE.SpotLight(0xcfe0ff, 38, 25, 0.7, 0.8, 1.4); rim.position.set(3.5, 4, -4); rim.target.position.set(0, 1.2, 0); s.add(rim, rim.target);
    const fill = new THREE.PointLight(0x6d8cff, 6, 12); fill.position.set(3, 1.5, 3); s.add(fill);
    // piso: escuro, levemente brilhante, com linhas de marcação
    const fc = document.createElement('canvas'); fc.width = fc.height = 512; const g = fc.getContext('2d');
    g.fillStyle = '#15181c'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 3; for (let i = 0; i <= 512; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
    const ft = new THREE.CanvasTexture(fc); ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(12, 12); ft.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.35, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    // teto com faixas de luz em perspectiva (como um hangar)
    const strip = new THREE.MeshBasicMaterial({ color: 0xdfe6f0 }), ceil = new THREE.MeshStandardMaterial({ color: 0x0e1013, roughness: 0.9 });
    const c = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), ceil); c.rotation.x = Math.PI / 2; c.position.y = 5.4; s.add(c);
    for (let z = -40; z < 14; z += 4.5) for (const x of [-9, -3, 3, 9]) { const m = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 0.5), strip); m.position.set(x, 5.33, z); s.add(m); }
    // luz rebatida das faixas no piso (brilho do hangar)
    for (const z of [-2, -12, -24]) { const l = new THREE.PointLight(0xdfe6f0, 14, 16); l.position.set(0, 5, z); s.add(l); }
    // paredes laterais e painéis
    const wall = new THREE.MeshStandardMaterial({ color: 0x16191e, roughness: 0.8, metalness: 0.2 });
    for (const x of [-16, 16]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.5, 80), wall); w.position.set(x, 2.75, -10); s.add(w); }
    const back = new THREE.Mesh(new THREE.BoxGeometry(40, 5.5, 0.4), wall); back.position.set(0, 2.75, -42); s.add(back);
    const neon = new THREE.MeshBasicMaterial({ color: 0xe8b13a });
    for (const x of [-15.7, 15.7]) { const n = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 60), neon); n.position.set(x, 1.1, -12); s.add(n); }
    // caixas de equipamento
    const crate = new THREE.MeshStandardMaterial({ color: 0x2c3326, roughness: 0.85 }), dark = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.6, metalness: 0.5 });
    for (const [x, z, w, h, d, m] of [[-4.2, -3.5, 1.6, 0.9, 1, crate], [-4.2, -3.5, 1.2, 0.6, 0.8, dark], [5.5, -6, 2.2, 1.1, 1.2, crate], [-7.5, -9, 1.4, 1.4, 1.4, crate], [6.5, -2.8, 1, 0.7, 0.7, dark]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, h / 2 + (m === dark && x === -4.2 ? 0.9 : 0), z); b.castShadow = b.receiveShadow = true; s.add(b);
    }
    // plataforma do operador
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.08, 48), new THREE.MeshStandardMaterial({ color: 0x1f2328, roughness: 0.4, metalness: 0.6 }));
    pad.position.y = 0.04; pad.receiveShadow = true; s.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.012, 6, 64), new THREE.MeshBasicMaterial({ color: 0x58c7d8, transparent: true, opacity: 0.55 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.085; s.add(ring);
    this.planeSlot = new THREE.Group(); this.planeSlot.position.set(-9, 0, -30); this.planeSlot.rotation.y = 1.1; s.add(this.planeSlot);
  }

  /** Coloca a aeronave real no fundo quando o GLB carregar. */
  ensurePlane() {
    if (this.planeReady || !assets.get('aircraft')) return;
    const m = assets.get('aircraft').scene.clone(true); m.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(m), sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3()), k = 30 / Math.max(sz.x, sz.z);
    const h = new THREE.Group(); m.position.sub(c); h.add(m); h.scale.setScalar(k); h.position.y = sz.y * k / 2 - 0.2;
    m.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color?.multiplyScalar(0.55); o.material.metalness = 0.3; o.material.roughness = 0.5; } });
    this.planeSlot.add(h); this.planeReady = true;
  }

  /** Troca operador/arma exibidos (recria só o que mudou). */
  setLoadout(operator, weapon) {
    const key = `${operator}|${!!characters.template(operator)}`;
    if (key !== this.opKey) {
      if (this.op) this.scene.remove(this.op.root, this.op.weapon);
      this.op = characters.create({ operator }); this.op.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(this.op.root, this.op.weapon); this.opKey = key; this.weapon = null;
    }
    // troca a arma (ou atualiza para o modelo real quando o GLB terminar de carregar)
    const wkey = `${weapon}|${hasRealGun(weapon)}`;
    if (wkey !== this.weapon) { this.op.weaponId = null; this.op.setWeapon(weapon); this.weapon = wkey; }
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  render(dt, { operator = 0, weapon = 'rifle', focus = 'lobby' } = {}) {
    this.t += dt; this.ensurePlane(); this.setLoadout(operator, weapon);
    // operador acompanha o mouse; respira; olha levemente para a câmera
    const yaw = Math.PI + 0.35 - this.mouse.x * 0.35;
    this.yaw = this.yaw === undefined ? yaw : this.yaw + (yaw - this.yaw) * Math.min(1, dt * 3);
    this.op.animator.update(dt, { x: 0, y: 0.08, z: 0, yaw: this.yaw, pitch: -0.1 - this.mouse.y * 0.12, vx: 0, vz: 0, state: 'alive', stance: 'stand', grounded: true, weapon, groundAt: () => 0.08 });
    // câmera: enquadramento conforme a aba (lobby = operador à direita do centro; armas = close na arma)
    const tgt = focus === 'weapons' ? { p: [0.35, 1.4, 3.1], l: [0.25, 1.2, 0] } : focus === 'operators' ? { p: [0, 1.25, 4.4], l: [0, 1.05, 0] } : { p: [-0.9, 1.25, 5.9], l: [-0.35, 1.35, 0] };
    this.cam ??= { p: new THREE.Vector3(...tgt.p), l: new THREE.Vector3(...tgt.l) };
    const k = Math.min(1, dt * 2.5); this.cam.p.lerp(new THREE.Vector3(...tgt.p), k); this.cam.l.lerp(new THREE.Vector3(...tgt.l), k);
    this.camera.position.copy(this.cam.p).add(new THREE.Vector3(Math.sin(this.t * 0.3) * 0.05, Math.sin(this.t * 0.23) * 0.03, 0));
    this.camera.lookAt(this.cam.l);
    this.renderer.render(this.scene, this.camera);
  }
}
