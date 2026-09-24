import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ================== CONFIG ==================
const MAP = 420;                 // tamanho do mapa
const HALF = MAP / 2;
const BOT_COUNT = 19;
const RESPAWN_TIME = 12;         // segundos até ressurgir
const PLAYER_H = 1.7, CROUCH_H = 1.1, PLAYER_R = 0.4;
const GRAV = 22;

const WEAPONS = {
  pistol:  { name: 'X12 PISTOLA',   dmg: 22, rpm: 380, mag: 12, reserve: 60,  spread: 0.018, auto: false, range: 80,  reload: 1.2, pellets: 1, rec: 0.012 },
  m4:      { name: 'M4 FUZIL',      dmg: 26, rpm: 780, mag: 30, reserve: 120, spread: 0.022, auto: true,  range: 160, reload: 1.8, pellets: 1, rec: 0.008 },
  ak47:    { name: 'AK-47',         dmg: 32, rpm: 600, mag: 30, reserve: 120, spread: 0.028, auto: true,  range: 150, reload: 2.0, pellets: 1, rec: 0.013 },
  mp5:     { name: 'MP5 SMG',       dmg: 20, rpm: 950, mag: 32, reserve: 128, spread: 0.035, auto: true,  range: 70,  reload: 1.5, pellets: 1, rec: 0.006 },
  shotgun: { name: 'LOCKWOOD 12G',  dmg: 14, rpm: 90,  mag: 6,  reserve: 30,  spread: 0.09,  auto: false, range: 30,  reload: 2.4, pellets: 9, rec: 0.04 },
  sniper:  { name: 'KAR98K',        dmg: 110,rpm: 55,  mag: 5,  reserve: 25,  spread: 0.001, auto: false, range: 400, reload: 2.6, pellets: 1, rec: 0.06 },
};
const LOOT_WEAPONS = ['m4', 'ak47', 'mp5', 'shotgun', 'sniper'];

// fases do gás: [raio final, tempo de espera, tempo de fechamento, dano/s]
const PHASES = [
  [150, 35, 30, 3],
  [95,  30, 28, 5],
  [55,  25, 24, 8],  // após esta fase o ressurgimento desliga
  [25,  20, 20, 12],
  [8,   15, 18, 18],
  [0,   10, 15, 25],
];
const RESURGENCE_OFF_PHASE = 3;

// ================== RENDER SETUP ==================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9b98a);
scene.fog = new THREE.Fog(0xe9b98a, 60, 330);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 900);
scene.add(camera);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0xffe2c0, 0x4a4030, 0.9));
const sun = new THREE.DirectionalLight(0xffc890, 2.2);
sun.position.set(-120, 140, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, far: 500 });
scene.add(sun, sun.target);

// ================== RNG ==================
let seed = 1337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rr = (a, b) => a + rnd() * (b - a);

// ================== MAP ==================
const colliders = [];   // {minX,maxX,minZ,maxZ,h}
const solidMeshes = []; // para raycast
const chests = [];

// Terreno
const groundTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#6d6a3e'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(${60 + Math.random() * 60},${60 + Math.random() * 50},${30 + Math.random() * 20},0.5)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 60);
  t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP, MAP), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground); solidMeshes.push(ground);

// Mar ao redor (ilha estilo Rebirth)
const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x2b6f8a, roughness: 0.25, metalness: 0.3 }));
sea.rotation.x = -Math.PI / 2; sea.position.y = -0.3; scene.add(sea);
const beach = new THREE.Mesh(new THREE.RingGeometry(HALF * 0.98, HALF * 1.12, 64), new THREE.MeshStandardMaterial({ color: 0xcdb485 }));
beach.rotation.x = -Math.PI / 2; beach.position.y = -0.1; scene.add(beach);

// Estradas
const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 });
for (const [x, z, w, d] of [[0, 0, 10, MAP * 0.9], [0, 0, MAP * 0.9, 10], [90, -60, 8, 200], [-100, 70, 220, 8]]) {
  const r = new THREE.Mesh(new THREE.PlaneGeometry(w, d), roadMat);
  r.rotation.x = -Math.PI / 2; r.position.set(x, 0.02, z); r.receiveShadow = true; scene.add(r);
}

function windowTex(base) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 64, 128);
  for (let y = 8; y < 128; y += 24) for (let x = 6; x < 64; x += 20) {
    g.fillStyle = Math.random() < 0.3 ? '#d9a55a' : '#1d2630'; g.fillRect(x, y, 12, 14);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const buildingColors = ['#b9a58a', '#8f7f6a', '#a36b4f', '#c7c0b0', '#7d8a8c', '#9c8f73'];
const bMats = buildingColors.map(c => new THREE.MeshStandardMaterial({ map: windowTex(c), roughness: 0.9 }));
const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a403a });

function addBox(x, z, w, d, h, mat, rep = true) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true;
  if (rep && mat.map) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4);
      const sx = face < 2 ? d : w;
      uv.setXY(i, uv.getX(i) * sx / 6, uv.getY(i) * (face === 2 || face === 3 ? d / 6 : h / 8));
    }
  }
  scene.add(m); solidMeshes.push(m);
  colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
  return m;
}

// Bairros / POIs
const POIS = [
  { name: 'PRISÃO', x: -20, z: -30, n: 10, s: 45, big: true },
  { name: 'CENTRO', x: 70, z: 60, n: 12, s: 50 },
  { name: 'FÁBRICA', x: -110, z: 90, n: 7, s: 45 },
  { name: 'DOCAS', x: 130, z: -120, n: 8, s: 40 },
  { name: 'VILA', x: -120, z: -120, n: 9, s: 45 },
  { name: 'TORRE', x: 140, z: 130, n: 5, s: 30 },
];
for (const p of POIS) {
  for (let i = 0; i < p.n; i++) {
    const w = rr(8, p.big ? 22 : 16), d = rr(8, p.big ? 22 : 16), h = rr(5, p.big ? 22 : 16);
    const x = p.x + rr(-p.s, p.s), z = p.z + rr(-p.s, p.s);
    if (Math.abs(x) < 8 || Math.abs(z) < 8) continue; // não bloquear estradas
    if (colliders.some(c => x + w / 2 + 3 > c.minX && x - w / 2 - 3 < c.maxX && z + d / 2 + 3 > c.minZ && z - d / 2 - 3 < c.maxZ)) continue;
    addBox(x, z, w, d, h, bMats[Math.floor(rnd() * bMats.length)]);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6), roofMat);
    roof.position.set(x, h + 0.25, z); roof.castShadow = true; scene.add(roof);
    // baú perto do prédio
    if (rnd() < 0.8) spawnChest(x + (w / 2 + 1.2) * (rnd() < 0.5 ? 1 : -1), z + rr(-d / 3, d / 3));
  }
}

// Containers, muros e cobertura
const contMats = [0xa33b2c, 0x2c5ea3, 0x3f7a3a, 0xc08a2a].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.3 }));
for (let i = 0; i < 70; i++) {
  const x = rr(-HALF + 15, HALF - 15), z = rr(-HALF + 15, HALF - 15);
  if (Math.abs(x) < 7 || Math.abs(z) < 7) continue;
  if (colliders.some(c => x + 4 > c.minX && x - 4 < c.maxX && z + 4 > c.minZ && z - 4 < c.maxZ)) continue;
  const rot = rnd() < 0.5;
  addBox(x, z, rot ? 6 : 2.5, rot ? 2.5 : 6, 2.6, contMats[i % 4], false);
}
// Árvores (decorativas, com colisor de tronco)
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4d3a26 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x4b5e2a, roughness: 1 });
for (let i = 0; i < 160; i++) {
  const x = rr(-HALF + 5, HALF - 5), z = rr(-HALF + 5, HALF - 5);
  if (Math.abs(x) < 7 || Math.abs(z) < 7) continue;
  if (colliders.some(c => x + 2 > c.minX && x - 2 < c.maxX && z + 2 > c.minZ && z - 2 < c.maxZ)) continue;
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 4), trunkMat);
  t.position.set(x, 2, z); t.castShadow = true; scene.add(t); solidMeshes.push(t);
  const l = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 7), leafMat);
  l.position.set(x, 5.5, z); l.castShadow = true; scene.add(l);
  colliders.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, h: 8 });
}

// ================== BAÚS / LOOT ==================
function spawnChest(x, z) {
  if (colliders.some(c => x > c.minX - 0.8 && x < c.maxX + 0.8 && z > c.minZ - 0.8 && z < c.maxZ + 0.8)) return;
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.7), new THREE.MeshStandardMaterial({ color: 0x5a4a2a }));
  box.position.y = 0.3;
  const trim = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.1, 0.75), new THREE.MeshStandardMaterial({ color: 0xf5b400, emissive: 0x6a4a00 }));
  trim.position.y = 0.55;
  g.add(box, trim); g.position.set(x, 0, z); box.castShadow = true;
  scene.add(g);
  chests.push({ mesh: g, trim, opened: false, x, z });
}

const pickups = []; // {mesh, type, data, x, z}
const pickupColors = { weapon: 0xffffff, plates: 0x4fb3ff, ammo: 0xd8c14a, cash: 0x6fdc6f };
function spawnPickup(type, data, x, z) {
  const geo = type === 'weapon' ? new THREE.BoxGeometry(0.9, 0.15, 0.2) : new THREE.BoxGeometry(0.35, 0.35, 0.35);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: pickupColors[type], emissive: pickupColors[type], emissiveIntensity: 0.4 }));
  m.position.set(x, 0.4, z); scene.add(m);
  pickups.push({ mesh: m, type, data, x, z, t: Math.random() * 6 });
}
function openChest(c) {
  c.opened = true; c.trim.material = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const off = () => rr(-1.2, 1.2);
  spawnPickup('weapon', LOOT_WEAPONS[Math.floor(Math.random() * LOOT_WEAPONS.length)], c.x + off(), c.z + off());
  spawnPickup('plates', 1 + Math.floor(Math.random() * 2), c.x + off(), c.z + off());
  spawnPickup('ammo', 1, c.x + off(), c.z + off());
  spawnPickup('cash', 200 + Math.floor(Math.random() * 6) * 100, c.x + off(), c.z + off());
  sfx.chest();
}

// ================== GÁS ==================
const gas = { cx: 0, cz: 0, r: HALF * 1.45, fromR: HALF * 1.45, fromX: 0, fromZ: 0, toR: 0, toX: 0, toZ: 0, phase: -1, state: 'wait', t: 0, dmg: 2 };
const gasWall = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1, 160, 96, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
);
gasWall.position.y = 80; scene.add(gasWall);
function nextPhase() {
  gas.phase++;
  if (gas.phase >= PHASES.length) { gas.state = 'done'; return; }
  const [r, wait, , dmg] = PHASES[gas.phase];
  gas.fromR = gas.r; gas.fromX = gas.cx; gas.fromZ = gas.cz;
  const maxOff = Math.max(0, gas.r - r);
  const a = Math.random() * Math.PI * 2, d = Math.random() * maxOff * 0.8;
  gas.toX = THREE.MathUtils.clamp(gas.cx + Math.cos(a) * d, -HALF + r, HALF - r);
  gas.toZ = THREE.MathUtils.clamp(gas.cz + Math.sin(a) * d, -HALF + r, HALF - r);
  gas.toR = r; gas.state = 'wait'; gas.t = wait; gas.dmg = dmg;
  if (gas.phase === RESURGENCE_OFF_PHASE) {
    resurgence = false; announce('RESSURGIMENTO DESATIVADO — SEM MAIS RETORNOS', 5);
    document.getElementById('resp').classList.add('off');
  } else announce(`FASE ${gas.phase + 1}: O GÁS VAI FECHAR`, 3);
}
function updateGas(dt) {
  if (gas.state === 'done') return;
  gas.t -= dt;
  if (gas.state === 'wait' && gas.t <= 0) { gas.state = 'close'; gas.t = PHASES[gas.phase][2]; announce('O GÁS ESTÁ FECHANDO!', 2.5); }
  else if (gas.state === 'close') {
    const k = 1 - Math.max(0, gas.t) / PHASES[gas.phase][2];
    gas.r = THREE.MathUtils.lerp(gas.fromR, gas.toR, k);
    gas.cx = THREE.MathUtils.lerp(gas.fromX, gas.toX, k);
    gas.cz = THREE.MathUtils.lerp(gas.fromZ, gas.toZ, k);
    if (gas.t <= 0) nextPhase();
  }
  gasWall.scale.set(Math.max(gas.r, 0.1), 1, Math.max(gas.r, 0.1));
  gasWall.position.x = gas.cx; gasWall.position.z = gas.cz;
}
const inGas = (x, z) => Math.hypot(x - gas.cx, z - gas.cz) > gas.r;

// ================== COLISÃO ==================
function collide(pos, r, height) {
  pos.x = THREE.MathUtils.clamp(pos.x, -HALF + 1, HALF - 1);
  pos.z = THREE.MathUtils.clamp(pos.z, -HALF + 1, HALF - 1);
  let onTop = 0;
  for (const c of colliders) {
    if (pos.y >= c.h - 0.05) { // em cima
      if (pos.x > c.minX - r * 0.5 && pos.x < c.maxX + r * 0.5 && pos.z > c.minZ - r * 0.5 && pos.z < c.maxZ + r * 0.5) onTop = Math.max(onTop, c.h);
      continue;
    }
    const nx = THREE.MathUtils.clamp(pos.x, c.minX, c.maxX), nz = THREE.MathUtils.clamp(pos.z, c.minZ, c.maxZ);
    const dx = pos.x - nx, dz = pos.z - nz, d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-6) { const d = Math.sqrt(d2); pos.x = nx + dx / d * r; pos.z = nz + dz / d * r; }
      else { // dentro: empurrar para a borda mais próxima
        const pens = [pos.x - c.minX, c.maxX - pos.x, pos.z - c.minZ, c.maxZ - pos.z];
        const i = pens.indexOf(Math.min(...pens));
        if (i === 0) pos.x = c.minX - r; else if (i === 1) pos.x = c.maxX + r; else if (i === 2) pos.z = c.minZ - r; else pos.z = c.maxZ + r;
      }
    }
  }
  return onTop;
}

const ray = new THREE.Raycaster();
function losClear(a, b) {
  const dir = new THREE.Vector3().subVectors(b, a); const dist = dir.length(); dir.normalize();
  ray.set(a, dir); ray.far = dist;
  return ray.intersectObjects(solidMeshes, false).length === 0;
}

// ================== ÁUDIO ==================
const AC = new (window.AudioContext || window.webkitAudioContext)();
const noiseBuf = (() => { const b = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })();
function shot(vol = 1, freq = 900, len = 0.18) {
  if (vol < 0.02) return;
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = AC.createGain(); g.gain.setValueAtTime(vol * 0.5, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + len);
  s.connect(f).connect(g).connect(AC.destination); s.start(); s.stop(AC.currentTime + len);
}
function tone(freq, len, vol = 0.15, type = 'square') {
  const o = AC.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = AC.createGain(); g.gain.setValueAtTime(vol, AC.currentTime); g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + len);
  o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + len);
}
const sfx = {
  shoot: (w) => shot(1, w === 'sniper' ? 500 : w === 'shotgun' ? 600 : 1400, w === 'sniper' ? 0.5 : 0.18),
  hit: () => tone(1800, 0.05, 0.08),
  kill: () => { tone(1200, 0.08, 0.12); setTimeout(() => tone(1600, 0.12, 0.12), 70); },
  plate: () => tone(300, 0.15, 0.1, 'sawtooth'),
  crack: () => tone(2400, 0.1, 0.08, 'triangle'),
  chest: () => { tone(600, 0.1, 0.08, 'sine'); setTimeout(() => tone(900, 0.15, 0.08, 'sine'), 90); },
  empty: () => tone(200, 0.04, 0.05),
};

// ================== OPERADORES / CAMUFLAGENS ==================
const IMG = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Jib0BzU3aLdeWOQjrliCwaWdFv/hf_20260924_';
const OPERATORS = [
  { id: 'reaper', name: 'REAPER', desc: 'Força Tarefa Sombra', img: IMG + '172742_fcfe9b2a-ad86-4cbc-8633-a21d62693126.png', uniform: 0x1d1f22, vest: 0x111214, skin: 0x6b4e3a, glove: 0x161616, head: 'skull' },
  { id: 'sahara', name: 'SAHARA', desc: 'Forças Especiais do Deserto', img: IMG + '172741_fc82033c-57a6-465e-b84f-c4ddbf864b19.png', uniform: 0xa58d66, vest: 0x7a6545, skin: 0x9a7255, glove: 0x5c4a33, head: 'cap' },
  { id: 'ranger', name: 'RANGER', desc: 'Veterano de Floresta', img: IMG + '172741_1e19f3c4-8a62-4386-b105-5b0b7106dd7c.png', uniform: 0x4a5634, vest: 0x3a4228, skin: 0xa87d5d, glove: 0x2f3322, head: 'boonie' },
  { id: 'nightops', name: 'NIGHT OPS', desc: 'Unidade Urbana Noturna', img: IMG + '172742_67718c5b-9753-4537-ac4e-3dd3276d2cde.png', uniform: 0x1f2a3d, vest: 0x161e2b, skin: 0x7c5a44, glove: 0x101318, head: 'nvg' },
];
const CAMOS = {
  black:  { name: 'Preto Fosco', desc: 'Padrão de fábrica', colors: ['#1c1c1c', '#232323', '#161616'] },
  desert: { name: 'Deserto', desc: 'Areia e pedra', colors: ['#b39a70', '#8f7650', '#cdb892'] },
  forest: { name: 'Floresta', desc: 'Woodland clássico', colors: ['#3f4a2a', '#2a2f1c', '#5b5236', '#1a1a12'] },
  urban:  { name: 'Digital Urbano', desc: 'Pixels cinzentos', colors: ['#5d6166', '#3b3e42', '#8a8e93'], digital: true },
  gold:   { name: 'Ouro', desc: 'Maestria', colors: ['#c9a227', '#e8c65a', '#9c7a12'], metal: true },
};
const camoTexCache = {};
function camoTex(id) {
  if (camoTexCache[id]) return camoTexCache[id];
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const cm = CAMOS[id];
  g.fillStyle = cm.colors[0]; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < (cm.digital ? 260 : 26); i++) {
    g.fillStyle = cm.colors[1 + (i % (cm.colors.length - 1))];
    if (cm.digital) { const s = 4 + Math.floor(Math.random() * 3) * 4; g.fillRect(Math.floor(Math.random() * 32) * 4, Math.floor(Math.random() * 32) * 4, s, s); }
    else { g.beginPath(); g.ellipse(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 16, 4 + Math.random() * 10, Math.random() * 3, 0, 7); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return (camoTexCache[id] = t);
}
const PERKS = {
  doubletime: { name: 'Double Time', desc: 'Corrida tática +25% mais rápida' },
  amped:      { name: 'Amped', desc: 'Recarga e troca de arma 40% mais rápidas' },
  tuneup:     { name: 'Tune Up', desc: 'Ressurgimento 5s mais rápido' },
  ghost:      { name: 'Ghost', desc: 'Inimigos demoram mais para te notar' },
};
const LETHALS = {
  frag:   { name: 'Granada Frag', desc: 'Quica e explode em 2s', count: 2 },
  semtex: { name: 'Semtex', desc: 'Gruda e explode em 1.4s', count: 2 },
};
const loadout = Object.assign({ op: 0, primary: 'm4', secondary: 'pistol', camo: 'black', perk: 'doubletime', lethal: 'frag' },
  (() => { try { return JSON.parse(localStorage.getItem('rz_loadout')) || {}; } catch { return {}; } })());
const perk = id => loadout.perk === id;

// ================== VIEWMODEL (braços + armas detalhadas) ==================
const gunGroup = new THREE.Group(); gunGroup.scale.setScalar(0.62); camera.add(gunGroup);
const gunMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.4 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.8, roughness: 0.35 });
const polymer = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.85 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b3f1f, roughness: 0.7 });
const lensMat = new THREE.MeshStandardMaterial({ color: 0x224455, metalness: 1, roughness: 0.05, emissive: 0x0a2030 });
const dotMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
const muzzle = new THREE.PointLight(0xffaa44, 0, 8);
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
const flash = new THREE.Group();
for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.1), flashMat); p.rotation.z = i * Math.PI / 3; flash.add(p); }
flash.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), flashMat));

function part(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = false; return m;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const C = (r1, r2, h, s = 12) => new THREE.CylinderGeometry(r1, r2, h, s);

function buildArms(op) {
  const sleeve = new THREE.MeshStandardMaterial({ color: op.uniform, roughness: 0.95 });
  const glove = new THREE.MeshStandardMaterial({ color: op.glove, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: op.skin, roughness: 0.7 });
  const g = new THREE.Group();
  // braço direito (gatilho)
  const r = new THREE.Group();
  r.add(part(C(0.055, 0.048, 0.42), sleeve, 0, 0, 0.21, Math.PI / 2));
  r.add(part(C(0.047, 0.047, 0.05), skin, 0, 0, 0.0, Math.PI / 2));
  r.add(part(B(0.085, 0.07, 0.11), glove, 0, 0, -0.06));
  r.add(part(B(0.02, 0.02, 0.07), glove, -0.035, -0.02, -0.12));
  r.position.set(0.045, -0.12, 0.02); r.rotation.set(0.25, 0.28, 0.2); g.add(r);
  // braço esquerdo (guarda-mão)
  const l = new THREE.Group();
  l.add(part(C(0.055, 0.048, 0.5), sleeve, 0, 0, 0.25, Math.PI / 2));
  l.add(part(C(0.047, 0.047, 0.05), skin, 0, 0, 0.0, Math.PI / 2));
  l.add(part(B(0.09, 0.06, 0.12), glove, 0, 0.01, -0.06));
  l.add(part(B(0.11, 0.02, 0.05), glove, 0.03, 0.035, -0.08));
  l.position.set(-0.08, -0.09, -0.36); l.rotation.set(0.1, -0.55, -0.4); g.add(l);
  g.userData.left = l;
  return g;
}

function buildGunModel(id, camo, small = false) {
  const camoMat = new THREE.MeshStandardMaterial({ map: camoTex(camo), metalness: CAMOS[camo].metal ? 0.95 : 0.35, roughness: CAMOS[camo].metal ? 0.25 : 0.6 });
  const g = new THREE.Group();
  let L = 0.6, muzzleZ;
  const rail = (z0, len) => { for (let z = z0; z > z0 - len; z -= 0.028) g.add(part(B(0.05, 0.012, 0.014), darkMetal, 0, 0.068, z)); };
  if (id === 'pistol') {
    g.add(part(B(0.05, 0.05, 0.24), camoMat, 0, 0.02, -0.1));                 // slide
    for (let z = 0; z < 5; z++) g.add(part(B(0.052, 0.035, 0.006), darkMetal, 0, 0.025, 0.0 - z * 0.012)); // serrilha
    g.add(part(B(0.045, 0.03, 0.2), polymer, 0, -0.02, -0.09));
    g.add(part(B(0.045, 0.14, 0.06), polymer, 0, -0.1, -0.0, 0.25));         // cabo
    g.add(part(B(0.04, 0.02, 0.04), darkMetal, 0, -0.05, -0.07));             // guarda-mato
    g.add(part(B(0.008, 0.012, 0.01), darkMetal, 0, 0.05, -0.2));             // mira
    muzzleZ = -0.24; L = 0.25;
  } else if (id === 'sniper') {
    g.add(part(B(0.06, 0.07, 0.6), woodMat, 0, -0.02, -0.2));                 // coronha/madeira
    g.add(part(B(0.05, 0.1, 0.28), woodMat, 0, -0.05, 0.22));
    g.add(part(C(0.022, 0.022, 0.26), camoMat, 0, 0.03, -0.12, Math.PI / 2));  // receptor
    g.add(part(C(0.013, 0.016, 0.62), darkMetal, 0, 0.03, -0.62, Math.PI / 2)); // cano
    g.add(part(C(0.008, 0.008, 0.08), darkMetal, 0.06, 0.03, -0.02, 0, 0, Math.PI / 2)); // ferrolho
    g.add(part(new THREE.SphereGeometry(0.016, 8, 8), darkMetal, 0.1, 0.03, -0.02));
    g.add(part(C(0.032, 0.032, 0.34), darkMetal, 0, 0.11, -0.13, Math.PI / 2)); // luneta
    g.add(part(C(0.04, 0.032, 0.07), darkMetal, 0, 0.11, -0.33, Math.PI / 2));
    g.add(part(C(0.036, 0.036, 0.005), lensMat, 0, 0.11, -0.37, Math.PI / 2));
    g.add(part(B(0.02, 0.05, 0.02), darkMetal, 0, 0.07, -0.05), part(B(0.02, 0.05, 0.02), darkMetal, 0, 0.07, -0.22));
    muzzleZ = -0.95; L = 0.95;
  } else if (id === 'shotgun') {
    g.add(part(B(0.06, 0.08, 0.3), camoMat, 0, 0.01, -0.12));
    g.add(part(C(0.02, 0.02, 0.6), darkMetal, 0, 0.035, -0.55, Math.PI / 2));
    g.add(part(C(0.017, 0.017, 0.5), darkMetal, 0, -0.01, -0.5, Math.PI / 2)); // tubo
    g.add(part(B(0.07, 0.06, 0.18), polymer, 0, -0.01, -0.48));                 // pump
    for (let i = 0; i < 6; i++) g.add(part(B(0.072, 0.008, 0.01), darkMetal, 0, -0.01, -0.41 - i * 0.025));
    g.add(part(B(0.05, 0.13, 0.06), polymer, 0, -0.08, 0.02, 0.3));
    g.add(part(B(0.055, 0.09, 0.26), polymer, 0, -0.03, 0.18, -0.08));
    g.add(part(B(0.01, 0.015, 0.01), dotMat, 0, 0.06, -0.84));
    muzzleZ = -0.86; L = 0.86;
  } else { // m4, mp5, ak47
    const isAK = id === 'ak47', isMP = id === 'mp5';
    const rlen = isMP ? 0.28 : 0.32;
    g.add(part(B(0.06, 0.075, rlen), camoMat, 0, 0.01, -0.1));                      // receptor
    g.add(part(B(0.056, 0.03, rlen * 0.9), camoMat, 0, 0.055, -0.1));               // upper
    g.add(part(B(0.012, 0.018, 0.04), darkMetal, 0.03, 0.02, -0.05));               // ejetor
    const hgL = isMP ? 0.2 : 0.3;
    g.add(part(B(0.062, 0.07, hgL), isAK ? woodMat : polymer, 0, 0.015, -0.26 - hgL / 2 + 0.02)); // guarda-mão
    if (!isAK) for (let i = 0; i < 5; i++) g.add(part(B(0.064, 0.012, 0.025), darkMetal, 0, 0.015, -0.28 - i * (hgL / 6)));
    rail(-0.02, isMP ? 0.2 : 0.5);
    const bl = isMP ? 0.1 : 0.3;
    g.add(part(C(0.012, 0.012, bl), darkMetal, 0, 0.02, -0.26 - hgL - bl / 2 + 0.04, Math.PI / 2));
    g.add(part(C(0.02, 0.018, 0.07), darkMetal, 0, 0.02, -0.26 - hgL - bl + 0.02, Math.PI / 2));    // freio de boca
    muzzleZ = -0.26 - hgL - bl - 0.02; L = -muzzleZ;
    // carregador
    if (isAK) { for (let i = 0; i < 4; i++) g.add(part(B(0.045, 0.06, 0.075), gunMat, 0, -0.07 - i * 0.05, -0.16 + i * 0.022, -0.35 - i * 0.12)); }
    else if (isMP) { for (let i = 0; i < 3; i++) g.add(part(B(0.035, 0.06, 0.05), gunMat, 0, -0.07 - i * 0.055, -0.2 + i * 0.015, -0.18 - i * 0.08)); }
    else g.add(part(B(0.045, 0.19, 0.07), gunMat, 0, -0.12, -0.16, -0.18));
    g.add(part(B(0.045, 0.13, 0.055), polymer, 0, -0.09, 0.02, 0.35));              // cabo
    g.add(part(B(0.035, 0.012, 0.07), darkMetal, 0, -0.035, -0.04));                // guarda-mato
    // coronha
    if (isAK) g.add(part(B(0.05, 0.08, 0.28), woodMat, 0, -0.02, 0.2, -0.1));
    else { g.add(part(C(0.014, 0.014, 0.18), darkMetal, 0, 0.02, 0.15, Math.PI / 2)); g.add(part(B(0.05, 0.1, 0.12), polymer, 0, -0.01, 0.26)); }
    // mira: red dot holográfico
    if (!isAK) {
      g.add(part(B(0.05, 0.05, 0.08), darkMetal, 0, 0.1, -0.08));
      g.add(part(B(0.044, 0.034, 0.004), lensMat, 0, 0.105, -0.12));
      g.add(part(new THREE.SphereGeometry(0.0035, 6, 6), dotMat, 0, 0.105, -0.119));
    } else g.add(part(B(0.01, 0.03, 0.01), darkMetal, 0, 0.07, -0.55));
    if (id === 'm4') g.add(part(B(0.03, 0.08, 0.03), polymer, 0, -0.03, -0.4));   // grip vertical
  }
  g.userData.muzzleZ = muzzleZ; g.userData.L = L;
  return g;
}

let armsGroup = null;
function buildGun(id) {
  gunGroup.clear();
  const model = buildGunModel(id, loadout.camo);
  gunGroup.add(model);
  armsGroup = buildArms(OPERATORS[loadout.op]);
  // posicionar mão esquerda de acordo com o tamanho da arma
  armsGroup.userData.left.position.z = id === 'pistol' ? -0.02 : -Math.min(0.42, model.userData.L * 0.5);
  if (id === 'pistol') { armsGroup.userData.left.position.set(-0.03, -0.12, -0.02); armsGroup.userData.left.rotation.set(0.3, -0.2, -0.9); }
  gunGroup.add(armsGroup);
  flash.position.set(0, 0.02, model.userData.muzzleZ - 0.05); muzzle.position.copy(flash.position); flash.visible = false;
  gunGroup.add(flash, muzzle);
}

// ================== TRACERS ==================
const tracers = [];
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.8 });
function tracer(a, b) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const l = new THREE.Line(g, tracerMat.clone()); scene.add(l); tracers.push({ l, t: 0.06 });
}
const sparks = [];
function spark(p, color = 0xffcc66) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 4, 4), new THREE.MeshBasicMaterial({ color }));
  m.position.copy(p); scene.add(m); sparks.push({ m, t: 0.15 });
}

// ================== ENTIDADES ==================
const NAMES = ['Ghost', 'Soap', 'Price', 'Gaz', 'Nikto', 'Roze', 'Farah', 'Alex', 'Mace', 'Krueger', 'Valeria', 'Hudson', 'Woods', 'Mason', 'Adler', 'Park', 'Nova', 'Stitch', 'Raptor'];
const canopyMat = new THREE.MeshStandardMaterial({ color: 0x6b6a34, side: THREE.DoubleSide, roughness: 0.9 });
function makeSoldierMesh(op) {
  const g = new THREE.Group();
  const uni = new THREE.MeshStandardMaterial({ color: op.uniform, roughness: 0.95 });
  const vest = new THREE.MeshStandardMaterial({ color: op.vest, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: op.skin, roughness: 0.7 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x1a1612 });
  const glove = new THREE.MeshStandardMaterial({ color: op.glove });
  const add = (m, head) => { m.castShadow = true; if (head) m.userData.head = true; g.add(m); return m; };
  const legL = new THREE.Group(), legR = new THREE.Group();
  for (const [lg, x] of [[legL, -0.13], [legR, 0.13]]) {
    lg.add(part(B(0.2, 0.46, 0.22), uni, 0, -0.23, 0), part(B(0.18, 0.42, 0.2), uni, 0, -0.65, 0.02), part(B(0.2, 0.12, 0.3), boot, 0, -0.9, -0.04));
    lg.add(part(B(0.21, 0.12, 0.08), vest, 0, -0.45, -0.11)); // joelheira
    lg.position.set(x, 0.95, 0); lg.children.forEach(c => c.castShadow = true); g.add(lg);
  }
  add(part(B(0.5, 0.62, 0.28), uni, 0, 1.25, 0));
  add(part(B(0.54, 0.44, 0.34), vest, 0, 1.3, 0));                            // plate carrier
  for (let i = -1; i <= 1; i++) add(part(B(0.13, 0.14, 0.08), vest, i * 0.15, 1.18, -0.2)); // bolsos
  add(part(B(0.38, 0.42, 0.18), vest, 0, 1.3, 0.25));                          // mochila
  add(part(B(0.52, 0.06, 0.3), boot, 0, 0.95, 0));                             // cinto
  // braços segurando a arma
  const armR = part(B(0.13, 0.5, 0.14), uni, 0.3, 1.3, -0.15, 1.2, 0, 0); add(armR);
  const armL = part(B(0.13, 0.5, 0.14), uni, -0.22, 1.3, -0.25, 1.3, 0.5, 0); add(armL);
  add(part(B(0.1, 0.1, 0.1), glove, 0.25, 1.28, -0.42)); add(part(B(0.1, 0.1, 0.1), glove, -0.05, 1.3, -0.55));
  add(part(B(0.14, 0.12, 0.14), skin, 0, 1.62, 0));                            // pescoço
  add(part(B(0.26, 0.3, 0.27), skin, 0, 1.78, 0), true);                       // cabeça
  if (op.head === 'skull') { add(part(B(0.27, 0.31, 0.28), new THREE.MeshStandardMaterial({ color: 0x0c0c0c }), 0, 1.78, 0), true); add(part(B(0.2, 0.12, 0.01), new THREE.MeshStandardMaterial({ color: 0xd8d2c4 }), 0, 1.74, -0.145), true); }
  if (op.head === 'cap') { add(part(B(0.29, 0.1, 0.3), uni, 0, 1.96, 0), true); add(part(B(0.26, 0.02, 0.14), uni, 0, 1.92, -0.2), true); add(part(B(0.3, 0.06, 0.06), boot, 0, 1.82, 0), true); }
  if (op.head === 'boonie') { add(part(C(0.26, 0.26, 0.03, 12), uni, 0, 1.93, 0), true); add(part(C(0.15, 0.16, 0.12, 12), uni, 0, 2.0, 0), true); }
  if (op.head === 'nvg') { add(part(B(0.32, 0.16, 0.33), vest, 0, 1.97, 0), true); add(part(B(0.14, 0.06, 0.08), darkMetal, 0, 2.0, -0.18), true); }
  const gun = buildGunModel('m4', 'black'); gun.scale.setScalar(1.1); gun.position.set(0.12, 1.32, -0.45); g.add(gun);
  g.userData.gunSlot = gun;
  // paraquedas
  const chute = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3), canopyMat); canopy.position.y = 3.2; canopy.scale.set(1.3, 0.5, 0.8);
  chute.add(canopy);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x222222 });
  for (const [x, z] of [[-1.9, -0.8], [1.9, -0.8], [-1.9, 0.8], [1.9, 0.8]]) chute.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(x, 3.7, z)]), lineMat));
  chute.position.y = 1.2; chute.visible = false; g.add(chute);
  g.userData.chute = chute; g.userData.legs = [legL, legR];
  return g;
}

const player = {
  pos: new THREE.Vector3(0, 120, 0), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
  hp: 100, armor: 150, plates: 2, cash: 0, kills: 0, alive: true, dropping: true, grounded: false,
  crouch: false, sprint: false, ads: false, lethal: 2,
  weapons: [{ id: 'm4', mag: 30, reserve: 90 }, { id: 'pistol', mag: 12, reserve: 48 }], cur: 0,
  fireCd: 0, reloading: 0, plating: 0, respawnT: 0, lastDmg: 0, recoil: 0, name: 'VOCÊ', deaths: 0,
};

const bots = [];
for (let i = 0; i < BOT_COUNT; i++) {
  const mesh = makeSoldierMesh(OPERATORS[i % OPERATORS.length]);
  scene.add(mesh);
  mesh.traverse(o => { o.userData.bot = i; });
  const b = {
    i, name: NAMES[i], mesh, pos: new THREE.Vector3(), vy: 0, yaw: 0, hp: 100, armor: 100, alive: true, dropping: true,
    weapon: ['m4', 'mp5', 'shotgun', 'sniper', 'ak47'][i % 5], mag: 30, target: null, dest: new THREE.Vector2(),
    fireCd: 0, thinkT: 0, strafe: 1, respawnT: 0, skill: 0.4 + Math.random() * 0.5, reactT: 0, reloadT: 0, walk: 0,
  };
  b.mag = WEAPONS[b.weapon].mag;
  bots.push(b);
}
function setBotGun(b) {
  const old = b.mesh.userData.gunSlot; b.mesh.remove(old);
  const gun = buildGunModel(b.weapon, ['black', 'desert', 'forest', 'urban'][b.i % 4]); gun.scale.setScalar(1.1); gun.position.copy(old.position);
  gun.traverse(o => { o.userData.bot = b.i; o.castShadow = true; });
  b.mesh.add(gun); b.mesh.userData.gunSlot = gun;
}
const allMeshes = () => bots.filter(b => b.alive).map(b => b.mesh);

function dropIn(e, x, z) {
  e.pos.set(x, 110 + Math.random() * 20, z);
  e.dropping = true; e.alive = true; e.hp = 100;
  if (e === player) {
    e.vel.set(0, 0, 0); e.pitch = -0.9; e.armor = 100; e.lethal = 1; e.weapons = [{ id: 'pistol', mag: 12, reserve: 48 }, { id: 'mp5', mag: 32, reserve: 64 }]; e.cur = 0;
    buildGun(e.weapons[0].id);
    if (e.plates < 1) e.plates = 1;
  } else {
    e.armor = 50 + Math.random() * 100; e.mesh.visible = true; e.mesh.rotation.set(0, 0, 0);
    e.weapon = LOOT_WEAPONS[Math.floor(Math.random() * LOOT_WEAPONS.length)]; e.mag = WEAPONS[e.weapon].mag; setBotGun(e);
  }
}
function randomInCircle(margin = 0.8) {
  const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * Math.max(gas.r, gas.toR || 0) * margin;
  const r = Math.min(gas.r, HALF * 0.9);
  return [THREE.MathUtils.clamp(gas.cx + Math.cos(a) * Math.min(d, r), -HALF + 5, HALF - 5), THREE.MathUtils.clamp(gas.cz + Math.sin(a) * Math.min(d, r), -HALF + 5, HALF - 5)];
}

// ================== DANO ==================
function damage(target, amount, attacker, headshot) {
  if (!target.alive || target.dropping && target.pos.y > 3) return;
  if (headshot) amount *= 1.6;
  if (target.armor > 0) {
    const a = Math.min(target.armor, amount); target.armor -= a; amount -= a;
    if (target.armor <= 0 && attacker === player) sfx.crack();
  }
  target.hp -= amount;
  if (target === player) { player.lastDmg = 0.4; player.lastDmgFx = 0.9; document.getElementById('dmgOverlay').style.opacity = 0.8; }
  if (target !== player && attacker === player) { target.target = player; target.reactT = 0; }
  if (target.hp <= 0) kill(target, attacker);
}
function kill(t, attacker) {
  t.alive = false; t.hp = 0;
  const aName = attacker ? attacker.name : 'GÁS';
  feed(`${aName} ✖ ${t.name}`, attacker === player || t === player);
  if (attacker === player) { player.kills++; player.cash += 300; sfx.kill(); hitmarker(true); }
  else if (attacker && attacker !== player) attacker.kills = (attacker.kills || 0) + 1;
  if (t === player) {
    player.deaths++;
    if (resurgence) { player.respawnT = RESPAWN_TIME - (perk('tuneup') ? 5 : 0); announce(`VOCÊ MORREU — RETORNO EM ${Math.ceil(player.respawnT)}s`, 3); }
    else endGame(false);
  } else {
    t.mesh.rotation.x = -Math.PI / 2; t.mesh.position.y = 0.2;
    spawnPickup('cash', 200 + Math.floor(Math.random() * 4) * 100, t.pos.x, t.pos.z);
    if (Math.random() < 0.6) spawnPickup('plates', 1, t.pos.x + 0.8, t.pos.z);
    if (Math.random() < 0.5) spawnPickup('weapon', t.weapon, t.pos.x - 0.8, t.pos.z);
    setTimeout(() => { if (!t.alive) t.mesh.visible = false; }, 4000);
    if (resurgence) t.respawnT = RESPAWN_TIME + Math.random() * 6;
    else t.respawnT = -1; // permanente
  }
}

// ================== TIRO ==================
function fire(shooter, origin, dir, wid) {
  const w = WEAPONS[wid];
  const targets = [...allMeshes()];
  for (let p = 0; p < w.pellets; p++) {
    const d = dir.clone();
    const sp = shooter === player ? w.spread * (player.ads ? 0.35 : 1) * (player.grounded ? 1 : 2.5) * (player.crouch ? 0.7 : 1) + player.recoil * 0.3 : w.spread + (1 - shooter.skill) * 0.05;
    d.x += (Math.random() - 0.5) * sp * 2; d.y += (Math.random() - 0.5) * sp * 2; d.z += (Math.random() - 0.5) * sp * 2; d.normalize();
    ray.set(origin, d); ray.far = w.range;
    const hits = ray.intersectObjects([...solidMeshes, ...targets, ...(shooter !== player && player.alive ? [playerHitbox] : [])], true);
    let hit = hits.find(h => !(shooter !== player && h.object.userData.bot === shooter.i));
    const end = hit ? hit.point : origin.clone().addScaledVector(d, w.range);
    if (shooter === player || Math.random() < 0.4) tracer(origin.clone().addScaledVector(d, 1.2), end);
    if (!hit) continue;
    const falloff = hit.distance > w.range * 0.5 ? 0.75 : 1;
    if (hit.object.userData.bot !== undefined) {
      const tb = bots[hit.object.userData.bot];
      damage(tb, w.dmg * falloff, shooter, hit.object.userData.head);
      spark(hit.point, 0xaa2222);
      if (shooter === player) { sfx.hit(); if (tb.alive) hitmarker(false); }
    } else if (hit.object === playerHitbox) {
      damage(player, w.dmg * falloff * 0.7, shooter, false);
    } else spark(hit.point);
  }
}
const playerHitbox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), new THREE.MeshBasicMaterial({ visible: false }));
scene.add(playerHitbox);

// ================== INPUT ==================
const keys = {}; let mouseDown = false;
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!started || !player.alive) return;
  if (e.code === 'KeyR') reload();
  if (e.code === 'Digit1' || e.code === 'Digit2') switchWeapon(e.code === 'Digit1' ? 0 : 1);
  if (e.code === 'KeyQ') usePlate();
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyG') throwGrenade();
  if (e.code === 'KeyB') buyLoadout();
  if (e.code === 'KeyC') player.crouch = !player.crouch;
  if (e.code === 'KeyM') document.getElementById('bigmap').classList.toggle('hidden');
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('mousedown', e => {
  if (!started) return;
  if (document.pointerLockElement !== renderer.domElement) { renderer.domElement.requestPointerLock(); return; }
  if (e.button === 0) { mouseDown = true; tryFire(true); }
  if (e.button === 2) player.ads = true;
});
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; if (e.button === 2) player.ads = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  const s = player.ads ? 0.0011 : 0.0022;
  player.yaw -= e.movementX * s; player.pitch -= e.movementY * s;
  player.pitch = THREE.MathUtils.clamp(player.pitch, -1.5, 1.5);
});
addEventListener('wheel', () => started && switchWeapon(1 - player.cur));

function curW() { return player.weapons[player.cur]; }
function switchWeapon(i) { if (i === player.cur || !player.weapons[i]) return; player.cur = i; player.reloading = 0; buildGun(curW().id); player.fireCd = perk('amped') ? 0.2 : 0.4; }
function reload() {
  const w = curW(), def = WEAPONS[w.id];
  if (player.reloading > 0 || w.mag >= def.mag || w.reserve <= 0) return;
  player.reloading = def.reload * (perk('amped') ? 0.6 : 1);
}
function usePlate() {
  if (player.plates <= 0 || player.armor >= 150 || player.plating > 0) return;
  player.plating = 1.0; sfx.plate();
}
function tryFire(click) {
  const w = curW(), def = WEAPONS[w.id];
  if (player.fireCd > 0 || player.reloading > 0 || player.plating > 0 || player.dropping) return;
  if (!def.auto && !click) return;
  if (w.mag <= 0) { sfx.empty(); reload(); return; }
  w.mag--; player.fireCd = 60 / def.rpm;
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = camera.getWorldDirection(new THREE.Vector3());
  fire(player, origin, dir, w.id);
  sfx.shoot(w.id);
  player.recoil += def.rec; player.pitch += def.rec * (player.ads ? 0.6 : 1); player.yaw += (Math.random() - 0.5) * def.rec * 0.5;
  flash.visible = true; flash.rotation.z = Math.random() * 3; flash.scale.setScalar(0.8 + Math.random() * 0.6); muzzle.intensity = 6; setTimeout(() => { flash.visible = false; muzzle.intensity = 0; }, 40);
  gunGroup.position.z += 0.06;
  // barulho alerta bots próximos
  for (const b of bots) if (b.alive && !b.target && b.pos.distanceTo(player.pos) < 70) b.target = player;
}
function interact() {
  let best = null, bd = 2.5;
  for (const c of chests) if (!c.opened) { const d = Math.hypot(c.x - player.pos.x, c.z - player.pos.z); if (d < bd) { bd = d; best = { c }; } }
  for (const p of pickups) { const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z); if (d < bd) { bd = d; best = { p }; } }
  if (drop.crate && drop.y <= 0 && Math.hypot(drop.x - player.pos.x, drop.z - player.pos.z) < 3) return claimLoadout();
  if (!best) return;
  if (best.c) return openChest(best.c);
  const p = best.p;
  if (p.type === 'weapon') {
    const def = WEAPONS[p.data]; const old = curW();
    player.weapons[player.cur] = { id: p.data, mag: def.mag, reserve: def.reserve };
    buildGun(p.data);
    removePickup(p);
    if (old) spawnPickup('weapon', old.id, player.pos.x + 0.5, player.pos.z + 0.5);
    return;
  }
  if (p.type === 'plates') player.plates = Math.min(8, player.plates + p.data);
  if (p.type === 'ammo') for (const w of player.weapons) w.reserve += WEAPONS[w.id].mag * 2;
  if (p.type === 'cash') player.cash += p.data;
  sfx.chest();
  removePickup(p);
}
function removePickup(p) { scene.remove(p.mesh); pickups.splice(pickups.indexOf(p), 1); }

// auto-coleta de dinheiro/placas/munição
function autoPickup() {
  for (const p of [...pickups]) {
    if (p.type === 'weapon') continue;
    if (Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 1.2) {
      if (p.type === 'plates') { if (player.plates >= 8) continue; player.plates = Math.min(8, player.plates + p.data); }
      if (p.type === 'ammo') for (const w of player.weapons) w.reserve += WEAPONS[w.id].mag * 2;
      if (p.type === 'cash') player.cash += p.data;
      sfx.chest(); removePickup(p);
    }
  }
}

// ================== PLAYER UPDATE ==================
function updatePlayer(dt) {
  if (!player.alive) {
    if (player.respawnT > 0) {
      player.respawnT -= dt;
      centerMsg.textContent = `RESSURGINDO EM ${Math.ceil(player.respawnT)}`;
      if (player.respawnT <= 0) {
        if (resurgence) { const [x, z] = randomInCircle(0.7); dropIn(player, x, z); centerMsg.textContent = ''; announce('DE VOLTA AO JOGO!', 2); }
        else endGame(false);
      }
    }
    // câmera espectadora orbitando
    camera.position.set(player.pos.x + Math.cos(performance.now() / 3000) * 12, 10, player.pos.z + Math.sin(performance.now() / 3000) * 12);
    camera.lookAt(player.pos.x, 0, player.pos.z);
    gunGroup.visible = false;
    return;
  }
  gunGroup.visible = !player.dropping || player.pos.y < 3;

  const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const move = new THREE.Vector3();
  if (keys.KeyW) move.add(fwd); if (keys.KeyS) move.sub(fwd);
  if (keys.KeyD) move.add(right); if (keys.KeyA) move.sub(right);
  if (move.lengthSq()) move.normalize();
  player.sprint = keys.ShiftLeft && keys.KeyW && !player.ads && !player.crouch;
  if (player.sprint) player.crouch = false;

  if (player.dropping) {
    // paraquedas
    player.vel.y = Math.max(player.vel.y - GRAV * dt, player.pos.y > 30 ? -40 : -10);
    player.pos.addScaledVector(move, 22 * dt);
    player.pos.y += player.vel.y * dt;
    if (player.pos.y > 30) centerMsg.textContent = 'QUEDA LIVRE'; else if (player.pos.y > 1) centerMsg.textContent = 'PARAQUEDAS ABERTO';
  } else {
    const speed = player.crouch ? 2.8 : player.sprint ? (perk('doubletime') ? 11.9 : 9.5) : player.ads ? 3.5 : 6;
    const accel = player.grounded ? 12 : 3;
    player.vel.x = THREE.MathUtils.lerp(player.vel.x, move.x * speed, Math.min(1, accel * dt));
    player.vel.z = THREE.MathUtils.lerp(player.vel.z, move.z * speed, Math.min(1, accel * dt));
    if (keys.Space && player.grounded) { player.vel.y = 8; player.grounded = false; }
    player.vel.y -= GRAV * dt;
    player.pos.addScaledVector(player.vel, dt);
  }
  const floor = collide(player.pos, PLAYER_R, PLAYER_H);
  if (player.pos.y <= floor) {
    player.pos.y = floor; player.vel.y = 0; player.grounded = true;
    if (player.dropping) { player.dropping = false; centerMsg.textContent = ''; }
  } else player.grounded = false;

  const eyeH = player.crouch ? CROUCH_H : PLAYER_H;
  camera.position.set(player.pos.x, player.pos.y + eyeH, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  playerHitbox.position.set(player.pos.x, player.pos.y + 0.9, player.pos.z);
  playerHitbox.scale.y = player.crouch ? 0.65 : 1;

  // FOV / ADS
  const targetFov = player.ads ? (curW().id === 'sniper' ? 22 : 50) : player.sprint ? 82 : 75;
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, 12 * dt)); camera.updateProjectionMatrix();

  // viewmodel
  const bob = player.grounded && move.lengthSq() ? Math.sin(performance.now() / (player.sprint ? 80 : 120)) * 0.012 : 0;
  const adsPos = new THREE.Vector3(0, -0.12, -0.3), hip = new THREE.Vector3(0.22, -0.22, -0.4), sprintPos = new THREE.Vector3(0.28, -0.3, -0.3);
  const tp = player.ads ? adsPos : player.sprint ? sprintPos : hip;
  gunGroup.position.lerp(new THREE.Vector3(tp.x + bob, tp.y + Math.abs(bob), tp.z), Math.min(1, 14 * dt));
  gunGroup.rotation.y = THREE.MathUtils.lerp(gunGroup.rotation.y, player.sprint ? 0.6 : 0, 10 * dt);
  gunGroup.rotation.x = player.reloading > 0 ? -0.5 : player.plating > 0 ? -1.0 : THREE.MathUtils.lerp(gunGroup.rotation.x, 0, 10 * dt);
  gunGroup.visible = gunGroup.visible && !(player.ads && curW().id === 'sniper' && camera.fov < 30);

  // tiros / recarga / placas
  player.fireCd -= dt; player.recoil = Math.max(0, player.recoil - dt * 0.15);
  if (mouseDown && WEAPONS[curW().id].auto) tryFire(false);
  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) {
      const w = curW(), def = WEAPONS[w.id], need = def.mag - w.mag, take = Math.min(need, w.reserve);
      w.mag += take; w.reserve -= take;
    }
  }
  if (player.plating > 0) {
    player.plating -= dt;
    if (player.plating <= 0) { player.plates--; player.armor = Math.min(150, player.armor + 50); if (keys.KeyQ) usePlate(); }
  }
  // regen de vida
  player.lastDmg -= dt;
  if (player.lastDmg < -4 && player.hp < 100) player.hp = Math.min(100, player.hp + 25 * dt);

  // gás
  if (inGas(player.pos.x, player.pos.z) && !player.dropping) {
    player.hp -= gas.dmg * dt; player.lastDmg = 0.2;
    if (player.hp <= 0) kill(player, null);
  }
  document.getElementById('gasOverlay').style.opacity = inGas(player.pos.x, player.pos.z) ? 1 : 0;

  autoPickup();
  // prompt
  let msg = '';
  for (const c of chests) if (!c.opened && Math.hypot(c.x - player.pos.x, c.z - player.pos.z) < 2.5) msg = '[E] Abrir baú de suprimentos';
  for (const p of pickups) if (p.type === 'weapon' && Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 2.5) msg = `[E] Pegar ${WEAPONS[p.data].name}`;
  if (drop.crate && drop.y <= 0 && Math.hypot(drop.x - player.pos.x, drop.z - player.pos.z) < 3) msg = '[E] Pegar LOADOUT';
  promptEl.style.display = msg ? 'block' : 'none'; promptEl.textContent = msg;
}

// ================== BOT AI ==================
const tmpV = new THREE.Vector3();
function updateBots(dt) {
  for (const b of bots) {
    if (!b.alive) {
      if (b.respawnT > 0) {
        b.respawnT -= dt;
        if (b.respawnT <= 0) {
          if (resurgence) { const [x, z] = randomInCircle(0.8); dropIn(b, x, z); }
          else b.respawnT = -1;
        }
      }
      continue;
    }
    // queda
    if (b.dropping) {
      b.pos.y -= (b.pos.y > 30 ? 40 : 10) * dt;
      if (b.pos.y <= 0) { b.pos.y = 0; b.dropping = false; }
      b.mesh.userData.chute.visible = b.dropping && b.pos.y < 30;
      b.mesh.position.copy(b.pos); continue;
    }
    b.mesh.userData.chute.visible = false;
    b.thinkT -= dt; b.fireCd -= dt; b.reactT -= dt; b.shotPing = (b.shotPing || 0) - dt;
    if (b.thinkT <= 0) {
      b.thinkT = 0.3 + Math.random() * 0.3;
      // procurar alvo: jogador ou outro bot
      let best = null, bd = 90;
      const eye = tmpV.set(b.pos.x, 1.6, b.pos.z).clone();
      const cands = [...(player.alive && !player.dropping ? [player] : []), ...bots.filter(o => o !== b && o.alive && !o.dropping)];
      for (const c of cands) {
        const d = c.pos.distanceTo(b.pos);
        const bias = c === player ? (perk('ghost') ? 1.4 : 0.8) : 1; // leve preferência pelo jogador
        if (d * bias < bd && losClear(eye, new THREE.Vector3(c.pos.x, c.pos.y + 1.4, c.pos.z))) { bd = d * bias; best = c; }
      }
      if (best && best !== b.target) { b.target = best; b.reactT = 0.4 + (1 - b.skill) * 0.6; }
      else if (!best) b.target = null;
      // destino dentro do gás
      const gasTarget = gas.state === 'close' || gas.state === 'wait' ? [gas.toX || gas.cx, gas.toZ || gas.cz, gas.toR || gas.r] : [gas.cx, gas.cz, gas.r];
      if (Math.hypot(b.pos.x - gasTarget[0], b.pos.z - gasTarget[1]) > gasTarget[2] * 0.85 || b.dest.distanceTo(new THREE.Vector2(b.pos.x, b.pos.z)) < 2 || Math.random() < 0.05) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * gasTarget[2] * 0.7;
        b.dest.set(gasTarget[0] + Math.cos(a) * d, gasTarget[1] + Math.sin(a) * d);
      }
      if (Math.random() < 0.3) b.strafe *= -1;
    }
    const w = WEAPONS[b.weapon];
    let mx = 0, mz = 0, speed = 5;
    if (b.target && b.target.alive) {
      const t = b.target, dx = t.pos.x - b.pos.x, dz = t.pos.z - b.pos.z, d = Math.hypot(dx, dz);
      b.yaw = Math.atan2(-dx, -dz);
      const ideal = w.range * 0.35;
      const fwd = d > ideal ? 1 : d < ideal * 0.5 ? -1 : 0;
      mx = (dx / d) * fwd + (-dz / d) * b.strafe * 0.8; mz = (dz / d) * fwd + (dx / d) * b.strafe * 0.8;
      speed = 4;
      if (b.reloadT > 0) { b.reloadT -= dt; if (b.reloadT <= 0) b.mag = w.mag; }
      else if (b.reactT <= 0 && b.fireCd <= 0 && d < w.range) {
        const origin = new THREE.Vector3(b.pos.x, 1.5, b.pos.z);
        const aim = new THREE.Vector3(t.pos.x, t.pos.y + (t === player && player.crouch ? 0.8 : 1.2), t.pos.z).sub(origin).normalize();
        fire(b, origin, aim, b.weapon);
        const distToPlayer = b.pos.distanceTo(player.pos);
        sfx.shoot(b.weapon); shot(Math.max(0, 1 - distToPlayer / 120) * 0.6, 700, 0.15);
        b.shotPing = 1.5; b.mag--; b.fireCd = 60 / w.rpm * (w.auto ? 1 + Math.random() * 1.5 : 1.5 + Math.random());
        if (w.auto && Math.random() < 0.15) b.fireCd += 0.6; // pausa entre rajadas
        if (b.mag <= 0) b.reloadT = w.reload;
      }
    } else {
      const dx = b.dest.x - b.pos.x, dz = b.dest.y - b.pos.z, d = Math.hypot(dx, dz) || 1;
      mx = dx / d; mz = dz / d; b.yaw = Math.atan2(-mx, -mz);
      speed = inGas(b.pos.x, b.pos.z) ? 8 : 5;
    }
    const len = Math.hypot(mx, mz) || 1;
    const prev = b.pos.clone();
    b.pos.x += mx / len * speed * dt; b.pos.z += mz / len * speed * dt;
    collide(b.pos, 0.4, 1.8);
    if (prev.distanceTo(b.pos) < speed * dt * 0.3) { b.strafe *= -1; b.dest.set(b.pos.x + rr(-20, 20), b.pos.z + rr(-20, 20)); }
    b.mesh.position.copy(b.pos);
    b.mesh.rotation.y = b.yaw;
    const moved = prev.distanceTo(b.pos) / dt; b.walk += moved * dt * 2.2;
    const [lL, lR] = b.mesh.userData.legs; lL.rotation.x = Math.sin(b.walk) * 0.5 * Math.min(1, moved / 3); lR.rotation.x = -lL.rotation.x;
    if (inGas(b.pos.x, b.pos.z)) { b.hp -= gas.dmg * dt; if (b.hp <= 0) kill(b, null); }
    else if (b.hp < 100) b.hp = Math.min(100, b.hp + 8 * dt);
  }
}

// ================== HUD ==================
const $ = id => document.getElementById(id);
const centerMsg = $('center-msg'), promptEl = $('prompt');
let announceT = 0;
function announce(t, dur) { centerMsg.textContent = t; announceT = dur; }
function feed(text, me) {
  const d = document.createElement('div'); d.textContent = text; if (me) d.className = 'me';
  $('killfeed').prepend(d); setTimeout(() => d.remove(), 6000);
  while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
}
let hmT = 0;
function hitmarker(k) { const h = $('hitmarker'); h.style.opacity = 1; h.style.filter = k ? 'drop-shadow(0 0 3px red)' : ''; h.style.background = h.style.background; hmT = k ? 0.3 : 0.12; }

const mm = $('minimap').getContext('2d'), bm = $('bigmap').getContext('2d');
function drawMap(ctx, size, cx, cz, scale, rotate) {
  ctx.save(); ctx.fillStyle = '#23566b'; ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  if (rotate) ctx.rotate(player.yaw);
  ctx.scale(scale, scale); ctx.translate(-cx, -cz);
  ctx.fillStyle = '#c8b286'; ctx.beginPath(); ctx.arc(0, 0, HALF * 1.1, 0, 7); ctx.fill();
  ctx.fillStyle = '#5f6040'; ctx.fillRect(-HALF, -HALF, MAP, MAP);
  ctx.fillStyle = '#3a3a3a'; ctx.fillRect(-5, -HALF * 0.9, 10, MAP * 0.9); ctx.fillRect(-HALF * 0.9, -5, MAP * 0.9, 10);
  ctx.fillStyle = '#a79d88'; ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 0.6;
  for (const c of colliders) if (c.h > 3) { ctx.fillRect(c.minX, c.minZ, c.maxX - c.minX, c.maxZ - c.minZ); ctx.strokeRect(c.minX, c.minZ, c.maxX - c.minX, c.maxZ - c.minZ); }
  ctx.fillStyle = 'rgba(255,100,0,0.38)';
  ctx.beginPath(); ctx.rect(-HALF * 3, -HALF * 3, MAP * 3, MAP * 3); ctx.arc(gas.cx, gas.cz, Math.max(gas.r, 0.1), 0, Math.PI * 2, true); ctx.fill();
  ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 2 / scale; ctx.beginPath(); ctx.arc(gas.cx, gas.cz, Math.max(gas.r, 0.1), 0, 7); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / scale;
  if (gas.state !== 'done' && gas.phase >= 0) { ctx.setLineDash([6 / scale, 4 / scale]); ctx.beginPath(); ctx.arc(gas.toX, gas.toZ, Math.max(gas.toR, 0.1), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
  if (!rotate) { ctx.fillStyle = '#fff'; ctx.font = `bold ${12 / scale}px sans-serif`; ctx.textAlign = 'center'; for (const p of POIS) ctx.fillText(p.name, p.x, p.z); }
  if (drop.crate) { ctx.fillStyle = '#7cff6b'; ctx.fillRect(drop.x - 3 / scale, drop.z - 3 / scale, 6 / scale, 6 / scale); }
  // inimigos disparando (pontos vermelhos)
  ctx.fillStyle = '#ff2b2b';
  for (const b of bots) if (b.alive && !b.dropping && b.shotPing > 0) { ctx.beginPath(); ctx.arc(b.pos.x, b.pos.z, 3.5 / scale, 0, 7); ctx.fill(); }
  // cone de visão + jogador
  ctx.translate(player.pos.x, player.pos.z); ctx.rotate(-player.yaw);
  const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, 40 / scale); grd.addColorStop(0, 'rgba(255,255,255,.28)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 40 / scale, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); ctx.fill();
  ctx.fillStyle = '#f5b400'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1 / scale;
  ctx.beginPath(); ctx.moveTo(0, -7 / scale); ctx.lineTo(5 / scale, 6 / scale); ctx.lineTo(0, 3 / scale); ctx.lineTo(-5 / scale, 6 / scale); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

// bússola
const strip = $('compassStrip'), PX_PER_DEG = 3.2;
(() => {
  const labels = { 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
  let html = '';
  for (let k = -360; k <= 720; k += 15) {
    const d = ((k % 360) + 360) % 360;
    html += labels[d] ? `<span class="c" style="left:${k * PX_PER_DEG}px">${labels[d]}</span>` : `<span style="left:${k * PX_PER_DEG}px">${d}</span>`;
    html += `<span class="t" style="left:${(k + 7.5) * PX_PER_DEG}px"></span>`;
  }
  strip.innerHTML = html + '<span class="gas" id="gasMark">▼</span>';
})();
const heading = () => ((-player.yaw * 180 / Math.PI) % 360 + 360) % 360;

// ícone da arma (silhueta)
const wctx = $('wicon').getContext('2d');
function drawWeaponIcon(ctx, id, w, h, color = 'rgba(255,255,255,.9)') {
  ctx.clearRect(0, 0, w, h); ctx.save(); ctx.fillStyle = color; ctx.scale(w / 140, h / 44);
  const R = (x, y, ww, hh) => ctx.fillRect(x, y, ww, hh);
  if (id === 'pistol') { R(40, 10, 60, 10); R(78, 18, 14, 22); R(62, 18, 10, 6); }
  else if (id === 'sniper') { R(4, 18, 132, 4); R(30, 16, 70, 8); R(50, 8, 40, 6); R(96, 16, 40, 12); R(100, 26, 30, 8); }
  else if (id === 'shotgun') { R(4, 14, 100, 5); R(20, 20, 60, 5); R(80, 14, 30, 12); R(106, 18, 32, 10); R(90, 24, 10, 12); }
  else { const isMP = id === 'mp5'; R(isMP ? 30 : 6, 17, isMP ? 60 : 80, 5); R(50, 12, 50, 12); R(62, 6, 22, 6); R(74, 24, 10, 14); R(90, 24, 10, 14); R(100, 14, 38, 8); if (id === 'ak47') R(60, 24, 10, 16); }
  ctx.restore();
}

let lastIcon = '';
function updateHUD() {
  const alive = bots.filter(b => b.alive || b.respawnT > 0).length + (player.alive || player.respawnT > 0 ? 1 : 0);
  $('alive').innerHTML = `👤 <b>${alive}</b>`;
  $('kills').innerHTML = `☠ <b>${player.kills}</b>`;
  const gt = gas.state === 'done' ? '--' : `${gas.state === 'wait' ? 'GÁS FECHA EM' : 'GÁS FECHANDO'} ${Math.floor(Math.max(0, gas.t) / 60)}:${String(Math.ceil(Math.max(0, gas.t)) % 60).padStart(2, '0')}`;
  $('circle').innerHTML = `⚠ <b>${gt}</b>`;
  $('resp').innerHTML = `RESSURGIMENTO <b>${resurgence ? 'ATIVO' : 'DESATIVADO'}</b>`;
  $('hpbar').firstElementChild.style.width = Math.max(0, player.hp) + '%';
  const plates = $('plates').children;
  for (let i = 0; i < 3; i++) plates[i].style.setProperty('--f', THREE.MathUtils.clamp((player.armor - i * 50) / 50, 0, 1) * 100 + '%');
  $('platecount').innerHTML = `🛡 <b>${player.plates}</b>`;
  $('lethal').innerHTML = `${loadout.lethal === 'frag' ? '💣' : '🧨'} <b>${player.lethal}</b>`;
  $('sqName').textContent = OPERATORS[loadout.op].name;
  const w = curW();
  $('wname').textContent = WEAPONS[w.id].name + (player.reloading > 0 ? ' — RECARREGANDO' : player.plating > 0 ? ' — PLACA' : '');
  $('ammo').innerHTML = `<b style="color:${w.mag <= WEAPONS[w.id].mag * 0.25 ? '#ff5050' : '#fff'}">${w.mag}</b><small>${w.reserve}</small>`;
  $('cash').innerHTML = `$${player.cash}`;
  if (lastIcon !== w.id) { drawWeaponIcon(wctx, w.id, 140, 44); lastIcon = w.id; }
  const spread = (WEAPONS[w.id].spread * (player.ads ? 0.35 : 1) + player.recoil * 0.3) * 400 + 4;
  $('crosshair').style.setProperty('--s', spread + 'px');
  $('crosshair').style.opacity = player.ads || player.sprint ? 0 : 1;
  $('scope').classList.toggle('hidden', !(player.ads && w.id === 'sniper' && camera.fov < 30 && player.alive));
  // bússola
  const hd = heading();
  strip.style.transform = `translateX(${260 - hd * PX_PER_DEG}px)`;
  const gasAng = ((Math.atan2(gas.toX - player.pos.x, -(gas.toZ - player.pos.z)) * 180 / Math.PI) + 360) % 360;
  let rel = gasAng; if (rel - hd > 180) rel -= 360; if (hd - rel > 180) rel += 360;
  $('gasMark').style.left = rel * PX_PER_DEG + 'px';
  drawMap(mm, 220, player.pos.x, player.pos.z, 1.2, true);
  if (!$('bigmap').classList.contains('hidden')) drawMap(bm, 600, 0, 0, 600 / (MAP * 1.1), false);
}

// ================== GRANADAS ==================
const grenades = [];
const nadeMat = new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.6 });
function throwGrenade() {
  if (player.lethal <= 0 || !player.alive || player.dropping || player.plating > 0) return;
  player.lethal--;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), nadeMat); m.castShadow = true; scene.add(m);
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const pos = camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.6);
  const vel = dir.multiplyScalar(19).add(new THREE.Vector3(0, 4, 0));
  grenades.push({ m, pos, vel, t: loadout.lethal === 'semtex' ? 1.4 : 2.0, stuck: false, semtex: loadout.lethal === 'semtex' });
  tone(500, 0.05, 0.05, 'sine');
}
const explosions = [];
function explode(p, owner) {
  const light = new THREE.PointLight(0xff9933, 60, 30); light.position.copy(p).y += 1; scene.add(light);
  const fire = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
  fire.position.copy(p); scene.add(fire);
  const smoke = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshStandardMaterial({ color: 0x333028, transparent: true, opacity: 0.7, depthWrite: false }));
  smoke.position.copy(p); scene.add(smoke);
  explosions.push({ light, fire, smoke, t: 0 });
  shot(1.4, 300, 0.9); shot(0.8, 120, 1.2);
  for (let i = 0; i < 14; i++) spark(p.clone().add(new THREE.Vector3(rr(-2, 2), rr(0, 2), rr(-2, 2))), 0xffaa33);
  const hitE = e => { const d = e.pos.distanceTo(p); if (d < 8 && e.alive) damage(e, 150 * (1 - d / 8), owner, false); };
  for (const b of bots) hitE(b); hitE(player);
  if (camera.position.distanceTo(p) < 30) shake = Math.max(shake, 0.6 * (1 - camera.position.distanceTo(p) / 30));
}
let shake = 0;
function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i]; g.t -= dt;
    if (!g.stuck) {
      g.vel.y -= GRAV * dt; g.pos.addScaledVector(g.vel, dt);
      const before = g.pos.clone(); collide(g.pos, 0.1, 0.2);
      if (!before.equals(g.pos)) { if (g.semtex) g.stuck = true; else { g.vel.x *= -0.4; g.vel.z *= -0.4; } }
      if (g.pos.y < 0.1) { g.pos.y = 0.1; if (g.semtex) g.stuck = true; g.vel.y *= -0.35; g.vel.x *= 0.6; g.vel.z *= 0.6; }
    }
    g.m.position.copy(g.pos); g.m.rotation.x += dt * 10;
    if (g.t <= 0) { explode(g.pos.clone(), player); scene.remove(g.m); grenades.splice(i, 1); }
  }
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i]; e.t += dt;
    e.fire.scale.setScalar(1 + e.t * 14); e.fire.material.opacity = Math.max(0, 1 - e.t * 3);
    e.smoke.scale.setScalar(1.5 + e.t * 5); e.smoke.position.y += dt * 1.5; e.smoke.material.opacity = Math.max(0, 0.7 - e.t * 0.25);
    e.light.intensity = Math.max(0, 60 - e.t * 200);
    if (e.t > 3) { scene.remove(e.light, e.fire, e.smoke); explosions.splice(i, 1); }
  }
}

// ================== LOADOUT DROP ==================
const drop = { crate: null, x: 0, z: 0, y: 0, cd: 0, smoke: null };
function buyLoadout() {
  if (!player.alive || player.dropping) return;
  if (drop.crate) return announce('LOADOUT DROP JÁ ESTÁ NO MAPA', 2);
  if (drop.cd > 0) return announce(`LOADOUT DISPONÍVEL EM ${Math.ceil(drop.cd)}s`, 2);
  if (player.cash < 5000) return announce('DINHEIRO INSUFICIENTE ($5000)', 2);
  player.cash -= 5000; drop.cd = 90;
  const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  drop.x = player.pos.x + fwd.x * 5; drop.z = player.pos.z + fwd.z * 5; drop.y = 60;
  const g = new THREE.Group();
  const box = part(B(1.6, 1.0, 1.1), new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.8 }), 0, 0.5, 0); box.castShadow = true;
  const band = part(B(1.65, 0.12, 1.15), new THREE.MeshStandardMaterial({ color: 0x7cff6b, emissive: 0x2f8a20 }), 0, 0.8, 0);
  const chute = new THREE.Mesh(new THREE.SphereGeometry(2, 10, 5, 0, Math.PI * 2, 0, Math.PI / 3), canopyMat); chute.position.y = 4; chute.scale.y = 0.5;
  g.add(box, band, chute); g.userData.chute = chute; g.position.set(drop.x, drop.y, drop.z); scene.add(g);
  drop.crate = g;
  const smoke = new THREE.Mesh(C(0.4, 1.4, 30, 10), new THREE.MeshBasicMaterial({ color: 0x7cff6b, transparent: true, opacity: 0.25, depthWrite: false }));
  smoke.position.set(drop.x, 15, drop.z); scene.add(smoke); drop.smoke = smoke;
  announce('LOADOUT DROP A CAMINHO', 2.5); tone(700, 0.2, 0.08, 'sine');
}
function updateDrop(dt) {
  drop.cd -= dt;
  if (!drop.crate) return;
  if (drop.y > 0) { drop.y = Math.max(0, drop.y - 7 * dt); drop.crate.position.y = drop.y; drop.crate.userData.chute.visible = drop.y > 0.1; }
  drop.smoke.material.opacity = 0.18 + Math.sin(performance.now() / 300) * 0.05;
}
function claimLoadout() {
  const mk = id => ({ id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve });
  player.weapons = [mk(loadout.primary), mk(loadout.secondary)]; player.cur = 0; buildGun(loadout.primary);
  player.lethal = LETHALS[loadout.lethal].count; player.plates = Math.max(player.plates, 3);
  scene.remove(drop.crate, drop.smoke); drop.crate = null;
  announce('LOADOUT EQUIPADO', 2); sfx.chest();
}

// ================== TELA DE LOADOUT ==================
const PRIMARY_OPTS = ['m4', 'ak47', 'mp5', 'sniper', 'shotgun'];
const SECONDARY_OPTS = ['pistol', 'mp5', 'shotgun'];
function saveLoadout() { try { localStorage.setItem('rz_loadout', JSON.stringify(loadout)); } catch {} }
function renderLoadout() {
  $('loOperators').innerHTML = OPERATORS.map((o, i) => `<div class="op-card ${loadout.op === i ? 'sel' : ''}" data-op="${i}" style="background-image:url('${o.img}'), linear-gradient(#333,#111)"><div><b>${o.name}</b><small>${o.desc}</small></div></div>`).join('');
  const list = (el, opts, key, lab) => $(el).innerHTML = opts.map(k => `<div class="lo-item ${loadout[key] === k ? 'sel' : ''}" data-k="${key}" data-v="${k}">${lab(k)}</div>`).join('');
  const wl = k => `${WEAPONS[k].name}<small>${WEAPONS[k].dmg}×${WEAPONS[k].pellets} dano • ${WEAPONS[k].rpm} RPM • ${WEAPONS[k].mag} munições</small>`;
  list('loPrimary', PRIMARY_OPTS, 'primary', wl);
  list('loSecondary', SECONDARY_OPTS, 'secondary', wl);
  list('loCamo', Object.keys(CAMOS), 'camo', k => `${CAMOS[k].name}<small>${CAMOS[k].desc}</small>`);
  list('loPerk', Object.keys(PERKS), 'perk', k => `${PERKS[k].name}<small>${PERKS[k].desc}</small>`);
  list('loLethal', Object.keys(LETHALS), 'lethal', k => `${LETHALS[k].name}<small>${LETHALS[k].desc}</small>`);
  const w = WEAPONS[loadout.primary];
  const pct = (v, m) => Math.min(100, v / m * 100) + '%';
  $('loStats').innerHTML = `<b style="letter-spacing:2px">${w.name}</b>` + [
    ['DANO', pct(w.dmg * w.pellets, 126)], ['CADÊNCIA', pct(w.rpm, 950)], ['ALCANCE', pct(w.range, 400)],
    ['PRECISÃO', pct(0.1 - w.spread, 0.1)], ['MOBILIDADE', pct(w.reload > 2 ? 40 : 80, 100)]
  ].map(([n, v]) => `<div class="st"><span>${n}</span><i style="--v:${v}"></i></div>`).join('');
  const pc = $('loPreview').getContext('2d');
  const cm = CAMOS[loadout.camo].colors;
  drawWeaponIcon(pc, loadout.primary, 420, 132, cm[0] === '#1c1c1c' ? '#555' : cm[0]);
}
$('loadout').addEventListener('click', e => {
  const op = e.target.closest('[data-op]'), it = e.target.closest('[data-k]');
  if (op) loadout.op = +op.dataset.op;
  if (it) loadout[it.dataset.k] = it.dataset.v;
  if (op || it) { saveLoadout(); renderLoadout(); tone(900, 0.04, 0.04, 'sine'); }
});

// ================== SHADERS: CÉU + PÓS-PROCESSAMENTO ==================
const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sunDir: { value: sun.position.clone().normalize() }, time: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `
    varying vec3 vDir; uniform vec3 sunDir; uniform float time;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.1; a*=.5; } return v; }
    void main(){
      float h = vDir.y;
      vec3 horizon = vec3(1.0, .72, .48), zenith = vec3(.28, .42, .62);
      vec3 col = mix(horizon, zenith, smoothstep(-.05, .6, h));
      float s = max(dot(vDir, normalize(sunDir)), 0.);
      col += vec3(1., .6, .3) * pow(s, 8.) * .6 + vec3(1., .9, .7) * pow(s, 400.) * 3.;
      if (h > 0.) { vec2 uv = vDir.xz / (h + .15) * 1.5 + time * .01;
        float c = smoothstep(.5, .8, fbm(uv)); col = mix(col, mix(vec3(1., .8, .65), vec3(.55, .45, .45), c), c * .7 * smoothstep(0., .2, h)); }
      col = mix(col, vec3(.9, .7, .55), smoothstep(.1, -.1, h));
      gl_FragColor = vec4(col, 1.);
    }`
}));
scene.add(sky); scene.background = null;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.6, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, damage: { value: 0 }, gas: { value: 0 }, ads: { value: 0 }, res: { value: new THREE.Vector2(innerWidth, innerHeight) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, damage, gas, ads; uniform vec2 res; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv, d = uv - .5; float r = dot(d, d);
      // aberração cromática nas bordas (+ dano)
      float ca = .0035 * r * 4. + damage * .008;
      vec3 c = vec3(texture2D(tDiffuse, uv + d * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d * ca).b);
      // gradação cinematográfica: sombras frias, altas quentes
      float l = dot(c, vec3(.299, .587, .114));
      c = mix(vec3(l), c, 1.12 - damage * .6);
      c += mix(vec3(-.015, .005, .03), vec3(.03, .012, -.03), smoothstep(.2, .8, l));
      c = (c - .5) * 1.1 + .5;
      // gás: tom laranja tóxico e distorção
      c = mix(c, c * vec3(1.1, .6, .3) + vec3(.18, .06, 0.), gas * .65);
      // vinheta + vinheta de dano vermelha
      c *= 1. - r * (0.9 + ads * 0.8);
      c = mix(c, vec3(.55, 0., 0.), clamp(damage * smoothstep(.05, .35, r) * 1.6, 0., .8));
      // granulação de filme
      c += (hash(uv * res + time) - .5) * .045;
      gl_FragColor = vec4(c, 1.);
    }`
});
composer.addPass(gradePass);
addEventListener('resize', () => { composer.setSize(innerWidth, innerHeight); gradePass.uniforms.res.value.set(innerWidth, innerHeight); });

// ================== FIM DE JOGO ==================
let started = false, over = false, resurgence = true, matchTime = 0;
function endGame(win) {
  if (over) return; over = true;
  document.exitPointerLock();
  $('endscreen').classList.remove('hidden');
  $('endtitle').textContent = win ? 'VITÓRIA!' : 'ELIMINADO';
  $('endtitle').style.color = win ? '#f5b400' : '#e33';
  const place = win ? 1 : bots.filter(b => b.alive || b.respawnT > 0).length + 1;
  $('endstats').innerHTML = `Colocação: <b>#${place}</b> &nbsp; Abates: <b>${player.kills}</b> &nbsp; Mortes: <b>${player.deaths}</b> &nbsp; Dinheiro: <b>$${player.cash}</b> &nbsp; Tempo: <b>${Math.floor(matchTime / 60)}:${String(Math.floor(matchTime % 60)).padStart(2, '0')}</b>`;
}
function checkWin() {
  if (over || resurgence) return;
  if (player.alive && bots.every(b => !b.alive && b.respawnT <= 0)) endGame(true);
}

// ================== LOOP ==================
$('playBtn').onclick = () => { AC.resume(); $('mainPanel').classList.add('hidden'); $('loadout').classList.remove('hidden'); renderLoadout(); };
$('deployBtn').onclick = () => {
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
  renderer.domElement.requestPointerLock();
  started = true;
  dropIn(player, rr(-100, 100), rr(-100, 100));
  const mk = id => ({ id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve });
  player.weapons = [mk(loadout.primary), mk(loadout.secondary)]; player.armor = 150; player.lethal = LETHALS[loadout.lethal].count; buildGun(loadout.primary);
  for (const b of bots) dropIn(b, rr(-HALF * 0.8, HALF * 0.8), rr(-HALF * 0.8, HALF * 0.8));
  nextPhase();
  announce('BEM-VINDO AO RESSURGIMENTO', 3);
};

camera.position.set(0, 60, 140); camera.lookAt(0, 0, 0);
buildGun(loadout.primary); gunGroup.visible = false;

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now() / 1000;
  if (started && !over) {
    matchTime += dt;
    updateGas(dt);
    updatePlayer(dt);
    updateBots(dt);
    updateGrenades(dt);
    updateDrop(dt);
    checkWin();
    updateHUD();
    if (announceT > 0) { announceT -= dt; if (announceT <= 0 && player.alive && !player.dropping) centerMsg.textContent = ''; }
    if (hmT > 0) { hmT -= dt; if (hmT <= 0) $('hitmarker').style.opacity = 0; }
    sun.position.set(player.pos.x - 120, 140, player.pos.z + 60); sun.target.position.set(player.pos.x, 0, player.pos.z);
    if (shake > 0) { camera.position.x += (Math.random() - .5) * shake; camera.position.y += (Math.random() - .5) * shake; shake = Math.max(0, shake - dt * 1.5); }
    // uniforms do shader
    const u = gradePass.uniforms;
    player.lastDmgFx = Math.max(0, (player.lastDmgFx || 0) - dt * 1.5);
    u.damage.value = Math.min(1, Math.max(player.lastDmgFx, (100 - player.hp) / 110));
    u.gas.value = THREE.MathUtils.lerp(u.gas.value, player.alive && inGas(player.pos.x, player.pos.z) ? 1 : 0, dt * 4);
    u.ads.value = THREE.MathUtils.lerp(u.ads.value, player.ads ? 1 : 0, dt * 8);
  } else if (!started) {
    const t = now / 8;
    camera.position.set(Math.cos(t) * 160, 60, Math.sin(t) * 160); camera.lookAt(0, 0, 0);
  }
  sky.position.copy(camera.position); sky.material.uniforms.time.value = now;
  gradePass.uniforms.time.value = now % 100;
  for (const p of pickups) { p.t += dt; p.mesh.rotation.y += dt * 2; p.mesh.position.y = 0.4 + Math.sin(p.t * 3) * 0.1; }
  for (let i = tracers.length - 1; i >= 0; i--) { const t = tracers[i]; t.t -= dt; if (t.t <= 0) { scene.remove(t.l); t.l.geometry.dispose(); tracers.splice(i, 1); } }
  for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.t -= dt; if (s.t <= 0) { scene.remove(s.m); sparks.splice(i, 1); } }
  composer.render();
}
loop();
window.RZ = { player, bots, loadout }; // depuração via console
