import * as THREE from 'three';
import { settings } from '../core/Settings.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mat, part } from './Models.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MapRenderer } from './MapRenderer.js';
import { LootRenderer } from './LootRenderer.js';
import { assets } from '../assets/AssetManager.js';

const RARITY = { common: 0xbbbbbb, uncommon: 0x6fd16f, rare: 0x4fa8ff, epic: 0xb36bff, legendary: 0xffb13a };
const LOOT_COLOR = { cash: 0x6fdc6f, plate: 0x6ec6ff, ammo: 0xd8c14a, heal: 0xff7070, lethal: 0x9aa05a, intel: 0xffb13a };

// Texturas geradas no Higgsfield (carregadas em runtime; fallback procedural se o CDN/CORS falhar)
const HF = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Jib0BzU3aLdeWOQjrliCwaWdFv/hf_20260924_';
const HF_TEX = {
  ground: HF + '173816_8da157e1-0e79-4b7a-8cef-33698d7841d9.png', facade: HF + '173816_0883ab29-9c27-45e9-a103-08ead8b79f18.png',
  brick: HF + '173847_5a2f95cf-3c03-43c1-8740-f830b13a0ab2.png', container: HF + '173816_d261a97d-8a6c-4b1a-988c-d49be2eafbf3.png',
  crate: HF + '173816_7ec2053c-2b82-4c8b-8152-cc75bf44c1d0.png', roof: HF + '173816_0bfc50ac-de26-4d9c-8c15-23e3c60f12f8.png',
};

/**
 * World — cena 3D: céu (shader), terreno, prédios/contêineres/muretas a partir da
 * MESMA geometria do servidor, zona, loot (pool), estações, tablets de contrato,
 * aeronave e pós-processamento (bloom + gradação + aberração + grão + vinheta).
 */
export class World {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 1.75)); r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.Fog(0xe0b08a, 80, 380);
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 1500); this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffe2c0, 0x4a4030, 0.95));
    const sun = this.sun = new THREE.DirectionalLight(0xffc890, 2.3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, far: 500 }); this.scene.add(sun, sun.target);
    this.texLoader = new THREE.TextureLoader(); this.texLoader.setCrossOrigin('anonymous');
    this.buildSky(); this.buildPost();
    this.dynamic = new THREE.Group(); this.scene.add(this.dynamic);
    const lootGroup = new THREE.Group(); this.scene.add(lootGroup);
    this.lootR = new LootRenderer(lootGroup); this.loot = this.lootR.items;   // loot + baús com modelos reais (instanciados)
    addEventListener('resize', () => this.resize());
  }
  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight); this.grade.uniforms.res.value.set(innerWidth, innerHeight); }

  hfTex(key, repX, repY, apply) {
    this.texLoader.load(HF_TEX[key], t => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repX, repY); t.anisotropy = 8; apply(t); }, undefined, () => {});
  }

  // ------------------------------------------------------------ mapa estático
  buildMap(mapView, geo) {
    if (this.mapGroup) { this.scene.remove(this.mapGroup); this.mapGroup.traverse(o => { o.geometry?.dispose(); }); }
    this.mapRenderer ??= new MapRenderer(this);
    this.mapGroup = this.mapRenderer.build(mapView, geo, this.quality);
    this.scene.add(this.mapGroup);
    this.pois = mapView.pois; this.geo = geo;
  }
  windowTex(base) {
    return this.canvasTex(64, (g) => { g.fillStyle = base; g.fillRect(0, 0, 64, 128); for (let y = 8; y < 128; y += 24) for (let x = 6; x < 64; x += 20) { g.fillStyle = Math.random() < 0.3 ? '#d9a55a' : '#1d2630'; g.fillRect(x, y, 12, 14); } }, 1, 128);
  }
  canvasTex(w, draw, rep = 1, h = w) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); return t;
  }

  // ------------------------------------------------------------ partida
  startMatch(payload) {
    this.dynamic.clear(); this.lootR.clear();
    // zona
    this.zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 220, 96, 1, true), new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide, depthWrite: false, uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `varying vec2 vUv; uniform float time;
        void main(){ float band = .5 + .5 * sin(vUv.y * 120. - time * 3.); float fade = smoothstep(0., .08, vUv.y) * (1. - smoothstep(.4, 1., vUv.y));
          gl_FragColor = vec4(mix(vec3(1., .42, .05), vec3(1., .75, .3), band), (.28 + band * .12) * fade + .04); }`,
    }));
    this.zoneWall.position.y = 100; this.dynamic.add(this.zoneWall);
    this.nextZone = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 96, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    this.nextZone.position.y = 20; this.nextZone.visible = false;   // próxima zona só aparece no minimapa
    // estações
    this.stations = payload.stations ?? [];
    for (const s of this.stations) {
      const k = new THREE.Group();
      k.add(part(new THREE.BoxGeometry(1.2, 2.2, 0.8), mat(0x2a3a2a, { metalness: 0.4 }), 0, 1.1, 0));
      k.add(part(new THREE.BoxGeometry(0.9, 0.6, 0.05), new THREE.MeshBasicMaterial({ color: 0x7cff6b }), 0, 1.5, -0.43));
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 40, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x7cff6b, transparent: true, opacity: 0.18, depthWrite: false }));
      beam.position.y = 20; k.add(beam);
      k.position.set(s.x, s.y ?? 0, s.z); k.traverse(o => { if (o.isMesh) o.castShadow = true; }); this.dynamic.add(k);
    }
    // tablets de contrato
    this.boardMeshes = new Map();
    for (const b of payload.boards ?? []) {
      const k = new THREE.Group();
      k.add(part(new THREE.CylinderGeometry(0.05, 0.05, 1.0), mat(0x333333), 0, 0.5, 0), part(new THREE.BoxGeometry(0.6, 0.4, 0.05), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffb13a, emissiveIntensity: 1.2 }), 0, 1.1, 0, -0.4));
      k.position.set(b.x, b.y ?? this.geo?.groundHeight(b.x, b.z, 200) ?? 0, b.z); k.visible = !b.taken; this.dynamic.add(k); this.boardMeshes.set(b.id, k);
    }
    for (const it of payload.loot ?? []) this.addLoot(it);
    // baús de suprimento
    this.chestMeshes = new Map();
    for (const c of payload.chests ?? []) { this.lootR.addChest(c); this.chestMeshes.set(c.id, { userData: { item: c } }); }
    // aeronave
    const plane = this.plane = new THREE.Group();
    const glb = assets.get('aircraft');
    if (glb) {
      // KC-10 enviado pelo usuário: normaliza para ~42 m, nariz em -Z (mesma convenção do jogo), centrado
      const m = glb.scene.clone(true); m.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(m), sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3()), k = 42 / Math.max(sz.x, sz.z);
      const holder = new THREE.Group(); m.position.sub(c); holder.add(m); holder.scale.setScalar(k);
      m.traverse(o => { if (o.isMesh) { o.castShadow = false; o.material = o.material.clone(); o.material.roughness = 0.6; o.material.metalness = 0.05; o.material.emissive?.set(0x3a3e45); } });
      plane.add(holder);
      // luzes de navegação piscando (ponta da asa esquerda vermelha, direita verde)
      const nav = (color, x) => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color })); l.position.set(x, 0, 2); plane.add(l); return l; };
      this.navLights = [nav(0xff2020, -sz.x * k / 2 + 0.5), nav(0x20ff40, sz.x * k / 2 - 0.5)];
    } else {
      plane.add(part(new THREE.CylinderGeometry(1.4, 1.1, 16, 12), mat(0x6b6f5a, { metalness: 0.4 }), 0, 0, 0, Math.PI / 2));
      plane.add(part(new THREE.BoxGeometry(22, 0.3, 3), mat(0x5b5f4a), 0, 0.2, 0), part(new THREE.BoxGeometry(7, 0.25, 1.8), mat(0x5b5f4a), 0, 0.6, 7), part(new THREE.BoxGeometry(0.25, 3, 2), mat(0x5b5f4a), 0, 1.8, 7));
    }
    this.aircraft = payload.aircraft; this.dynamic.add(plane); plane.visible = !!payload.aircraft;
    // marcadores de contrato
    this.contractMarker = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb13a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    this.contractMarker.position.y = 30; this.contractMarker.visible = false; this.dynamic.add(this.contractMarker);
  }

  addLoot(it) { this.lootR.add(it); }
  removeLoot(id) { this.lootR.remove(id); }
  setChestOpened(id) { const k = this.chestMeshes?.get(id); if (k) k.userData.item.opened = true; this.lootR.openChest(id); }
  setBoard(id, taken) { const m = this.boardMeshes?.get(id); if (m) m.visible = !taken; }

  update(dt, snap, camPos, time) {
    if (this.zoneWall && snap) {
      const z = snap.zone; this.zoneWall.scale.set(Math.max(0.1, z.r), 1, Math.max(0.1, z.r)); this.zoneWall.position.x = z.x; this.zoneWall.position.z = z.z;
      this.zoneWall.material.uniforms.time.value = time;
      this.nextZone.scale.set(Math.max(0.1, z.to.r), 1, Math.max(0.1, z.to.r)); this.nextZone.position.x = z.to.x; this.nextZone.position.z = z.to.z;
      const a = snap.match.aircraft; this.plane.visible = !!a;
      if (a) { const k = Math.min(1, a.t / a.duration); this.plane.position.set(a.start.x + (a.end.x - a.start.x) * k, a.altitude + 4, a.start.z + (a.end.z - a.start.z) * k); this.plane.rotation.y = Math.atan2(-(a.end.x - a.start.x), -(a.end.z - a.start.z)); this.plane.rotation.z = Math.sin(time * 0.4) * 0.03; if (this.navLights) for (const l of this.navLights) l.visible = (time % 1.2) < 0.15; }
      const c = snap.you.contract, pt = c && (c.area ?? c.cache ?? c.lastSeen);
      this.contractMarker.visible = !!pt;
      if (pt) { const r = c.area?.r ?? (c.lastSeen ? 15 : 2); this.contractMarker.scale.set(r, 1, r); this.contractMarker.position.x = pt.x; this.contractMarker.position.z = pt.z; }
    }
    this.lootR.update(dt, camPos);
    this.sun.position.set(camPos.x - 120, 160, camPos.z + 60); this.sun.target.position.set(camPos.x, 0, camPos.z);
    this.sky.position.copy(camPos); this.sky.material.uniforms.time.value = time;
    // o céu precisa caber dentro do plano distante; senão a parte à frente é recortada (buraco no centro da tela)
    this.sky.geometry.boundingSphere ?? this.sky.geometry.computeBoundingSphere();
    this.sky.scale.setScalar(Math.min(1, (this.camera.far * 0.92) / this.sky.geometry.boundingSphere.radius));
    this.grade.uniforms.time.value = time % 100;
  }

  // ------------------------------------------------------------ shaders
  buildSky() {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { sunDir: { value: new THREE.Vector3(-0.6, 0.6, 0.3).normalize() }, time: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `varying vec3 vDir; uniform vec3 sunDir; uniform float time;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.1; a*=.5; } return v; }
        void main(){ float h = vDir.y; vec3 col = mix(vec3(1., .72, .48), vec3(.28, .42, .62), smoothstep(-.05, .6, h));
          float s = max(dot(vDir, sunDir), 0.); col += vec3(1., .6, .3) * pow(s, 8.) * .6 + vec3(1., .9, .7) * pow(s, 400.) * 3.;
          if (h > 0.) { vec2 uv = vDir.xz / (h + .15) * 1.5 + time * .01; float c = smoothstep(.5, .8, fbm(uv)); col = mix(col, mix(vec3(1., .8, .65), vec3(.55, .45, .45), c), c * .7 * smoothstep(0., .2, h)); }
          col = mix(col, vec3(.9, .7, .55), smoothstep(.1, -.1, h)); gl_FragColor = vec4(col, 1.); }`,
    }));
    this.scene.add(this.sky);
  }
  buildPost() {
    const c = this.composer = new EffectComposer(this.renderer);
    c.addPass(new RenderPass(this.scene, this.camera));
    c.addPass(this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.6, 0.85));
    c.addPass(new OutputPass());
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 }, damage: { value: 0 }, gas: { value: 0 }, ads: { value: 0 }, downed: { value: 0 }, res: { value: new THREE.Vector2(innerWidth, innerHeight) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float time, damage, gas, ads, downed; uniform vec2 res; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        void main(){ vec2 uv = vUv, d = uv - .5; float r = dot(d, d); float ca = .014 * r + damage * .008;
          vec3 c = vec3(texture2D(tDiffuse, uv + d * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d * ca).b);
          float l = dot(c, vec3(.299, .587, .114)); c = mix(vec3(l), c, 1.12 - damage * .6 - downed * .8);
          c += mix(vec3(-.015, .005, .03), vec3(.03, .012, -.03), smoothstep(.2, .8, l)); c = (c - .5) * 1.1 + .5;
          c = mix(c, c * vec3(1.1, .6, .3) + vec3(.18, .06, 0.), gas * .65);
          c *= 1. - r * (.9 + ads * .8 + downed * 1.5);
          c = mix(c, vec3(.55, 0., 0.), clamp(damage * smoothstep(.05, .35, r) * 1.6 + downed * .25, 0., .8));
          c += (hash(uv * res + time) - .5) * .045; gl_FragColor = vec4(c, 1.); }`,
    });
    c.addPass(this.grade);
  }
  /** Aplica preset de qualidade (Settings.QUALITY). */
  applyQuality(q) {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows; this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowMap) { this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    if (this.bloom) this.bloom.enabled = q.bloom;
    if (this.grade) this.grade.enabled = q.post;
    this.scene.fog.far = q.viewDistance; this.camera.far = q.viewDistance + 800; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight);
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  }
  clearMatch() { this.dynamic.clear(); this.lootR.clear(); }
  /**
   * Resolução dinâmica: mede o tempo médio de quadro e ajusta a escala interna
   * (entre 55% e o máximo do preset) para segurar ~60 fps em cenas pesadas.
   */
  /**
   * Resolução dinâmica com histerese: só muda depois de 2,5 s estáveis acima/abaixo do alvo,
   * em degraus de 0,2, e não volta a subir por 12 s depois de descer — mudar a resolução
   * realoca os buffers de render (travada), então oscilar a cada segundo gerava stutter.
   */
  render() {
    const now = performance.now(), dt = this.lastFrame ? now - this.lastFrame : 16; this.lastFrame = now;
    if (dt < 250) this.frameAvg = (this.frameAvg ?? 16) * 0.95 + dt * 0.05;
    if (this.quality && settings.get('dynamicRes') !== false) {
      const slow = this.frameAvg > 24, fast = this.frameAvg < 12;
      this.slowFor = slow ? (this.slowFor ?? 0) + dt : 0; this.fastFor = fast ? (this.fastFor ?? 0) + dt : 0;
      const max = Math.min(devicePixelRatio, this.quality.pixelRatio), cur = this.renderer.getPixelRatio();
      let next = cur;
      if (this.slowFor > 2500 && cur > 0.6) { next = Math.max(0.6, cur - 0.2); this.lastDrop = now; }
      else if (this.fastFor > 2500 && cur < max && now - (this.lastDrop ?? -1e9) > 12000) next = Math.min(max, cur + 0.2);
      if (Math.abs(next - cur) > 0.01) { this.renderer.setPixelRatio(next); this.composer.setPixelRatio?.(next); this.composer.setSize(innerWidth, innerHeight); this.slowFor = this.fastFor = 0; }
    }
    this.composer.render();
  }
  get fps() { return 1000 / (this.frameAvg ?? 16); }
}
