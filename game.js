import * as THREE from 'three';

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
  mp5:     { name: 'MP5 SMG',       dmg: 20, rpm: 950, mag: 32, reserve: 128, spread: 0.035, auto: true,  range: 70,  reload: 1.5, pellets: 1, rec: 0.006 },
  shotgun: { name: 'LOCKWOOD 12G',  dmg: 14, rpm: 90,  mag: 6,  reserve: 30,  spread: 0.09,  auto: false, range: 30,  reload: 2.4, pellets: 9, rec: 0.04 },
  sniper:  { name: 'KAR98K',        dmg: 110,rpm: 55,  mag: 5,  reserve: 25,  spread: 0.001, auto: false, range: 400, reload: 2.6, pellets: 1, rec: 0.06 },
};
const LOOT_WEAPONS = ['m4', 'mp5', 'shotgun', 'sniper'];

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

// ================== VIEWMODEL ==================
const gunGroup = new THREE.Group(); gunGroup.scale.setScalar(0.6); camera.add(gunGroup);
const gunMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.4 });
const gunAcc = new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.8 });
const muzzle = new THREE.PointLight(0xffaa44, 0, 6);
const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffd080 }));
function buildGun(id) {
  gunGroup.clear();
  const L = { pistol: 0.25, m4: 0.65, mp5: 0.45, shotgun: 0.75, sniper: 0.95 }[id];
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, L), gunMat); body.position.z = -L / 2;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), gunAcc); grip.position.set(0, -0.1, -0.05); grip.rotation.x = 0.3;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2), gunMat); barrel.rotation.x = Math.PI / 2; barrel.position.z = -L - 0.08;
  gunGroup.add(body, grip, barrel);
  if (id !== 'pistol') {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), gunMat); mag.position.set(0, -0.12, -L * 0.45); mag.rotation.x = -0.2;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.22), gunAcc); stock.position.set(0, -0.02, 0.1);
    gunGroup.add(mag, stock);
  }
  if (id === 'sniper' || id === 'm4') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, id === 'sniper' ? 0.3 : 0.12), gunMat);
    scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.08, -L * 0.45); gunGroup.add(scope);
  }
  flash.position.set(0, 0, -L - 0.2); muzzle.position.copy(flash.position); flash.visible = false;
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
function makeSoldierMesh(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6a50 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x2a2a22 });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.85, 0.3), mat); legs.position.y = 0.43;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.65, 0.35), vest); torso.position.y = 1.18;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.28), skin); head.position.y = 1.65;
  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.32), mat); helm.position.y = 1.83;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.7), gunMat); gun.position.set(0.25, 1.25, -0.35);
  for (const m of [legs, torso, head, helm, gun]) { m.castShadow = true; g.add(m); }
  head.userData.head = true; helm.userData.head = true;
  return g;
}

const player = {
  pos: new THREE.Vector3(0, 120, 0), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
  hp: 100, armor: 150, plates: 2, cash: 0, kills: 0, alive: true, dropping: true, grounded: false,
  crouch: false, sprint: false, ads: false,
  weapons: [{ id: 'm4', mag: 30, reserve: 90 }, { id: 'pistol', mag: 12, reserve: 48 }], cur: 0,
  fireCd: 0, reloading: 0, plating: 0, respawnT: 0, lastDmg: 0, recoil: 0, name: 'VOCÊ', deaths: 0,
};

const bots = [];
for (let i = 0; i < BOT_COUNT; i++) {
  const mesh = makeSoldierMesh(new THREE.Color().setHSL(0.1 + Math.random() * 0.15, 0.3, 0.25 + Math.random() * 0.15));
  scene.add(mesh);
  mesh.traverse(o => { o.userData.bot = i; });
  const b = {
    i, name: NAMES[i], mesh, pos: new THREE.Vector3(), vy: 0, yaw: 0, hp: 100, armor: 100, alive: true, dropping: true,
    weapon: ['m4', 'mp5', 'shotgun', 'sniper', 'm4'][i % 5], mag: 30, target: null, dest: new THREE.Vector2(),
    fireCd: 0, thinkT: 0, strafe: 1, respawnT: 0, skill: 0.4 + Math.random() * 0.5, reactT: 0, reloadT: 0,
  };
  b.mag = WEAPONS[b.weapon].mag;
  bots.push(b);
}
const allMeshes = () => bots.filter(b => b.alive).map(b => b.mesh);

function dropIn(e, x, z) {
  e.pos.set(x, 110 + Math.random() * 20, z);
  e.dropping = true; e.alive = true; e.hp = 100;
  if (e === player) {
    e.vel.set(0, 0, 0); e.pitch = -0.9; e.armor = 100; e.weapons = [{ id: 'pistol', mag: 12, reserve: 48 }, { id: 'mp5', mag: 32, reserve: 64 }]; e.cur = 0;
    buildGun(e.weapons[0].id);
    if (e.plates < 1) e.plates = 1;
  } else {
    e.armor = 50 + Math.random() * 100; e.mesh.visible = true; e.mesh.rotation.set(0, 0, 0);
    e.weapon = LOOT_WEAPONS[Math.floor(Math.random() * 4)]; e.mag = WEAPONS[e.weapon].mag;
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
  if (target === player) { player.lastDmg = 0.4; document.getElementById('dmgOverlay').style.opacity = 0.8; }
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
    if (resurgence) { player.respawnT = RESPAWN_TIME; announce(`VOCÊ MORREU — RETORNO EM ${RESPAWN_TIME}s`, 3); }
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
function switchWeapon(i) { if (i === player.cur || !player.weapons[i]) return; player.cur = i; player.reloading = 0; buildGun(curW().id); player.fireCd = 0.4; }
function reload() {
  const w = curW(), def = WEAPONS[w.id];
  if (player.reloading > 0 || w.mag >= def.mag || w.reserve <= 0) return;
  player.reloading = def.reload;
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
  flash.visible = true; muzzle.intensity = 4; setTimeout(() => { flash.visible = false; muzzle.intensity = 0; }, 40);
  gunGroup.position.z += 0.06;
  // barulho alerta bots próximos
  for (const b of bots) if (b.alive && !b.target && b.pos.distanceTo(player.pos) < 70) b.target = player;
}
function interact() {
  let best = null, bd = 2.5;
  for (const c of chests) if (!c.opened) { const d = Math.hypot(c.x - player.pos.x, c.z - player.pos.z); if (d < bd) { bd = d; best = { c }; } }
  for (const p of pickups) { const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z); if (d < bd) { bd = d; best = { p }; } }
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
    const speed = player.crouch ? 2.8 : player.sprint ? 9.5 : player.ads ? 3.5 : 6;
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
      b.mesh.position.copy(b.pos); continue;
    }
    b.thinkT -= dt; b.fireCd -= dt; b.reactT -= dt;
    if (b.thinkT <= 0) {
      b.thinkT = 0.3 + Math.random() * 0.3;
      // procurar alvo: jogador ou outro bot
      let best = null, bd = 90;
      const eye = tmpV.set(b.pos.x, 1.6, b.pos.z).clone();
      const cands = [...(player.alive && !player.dropping ? [player] : []), ...bots.filter(o => o !== b && o.alive && !o.dropping)];
      for (const c of cands) {
        const d = c.pos.distanceTo(b.pos);
        const bias = c === player ? 0.8 : 1; // leve preferência pelo jogador
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
        b.mag--; b.fireCd = 60 / w.rpm * (w.auto ? 1 + Math.random() * 1.5 : 1.5 + Math.random());
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
  ctx.save(); ctx.fillStyle = '#2b6f8a'; ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  if (rotate) ctx.rotate(player.yaw);
  ctx.scale(scale, scale); ctx.translate(-cx, -cz);
  ctx.fillStyle = '#6d6a3e'; ctx.fillRect(-HALF, -HALF, MAP, MAP);
  ctx.fillStyle = '#3a3a3a'; ctx.fillRect(-5, -HALF * 0.9, 10, MAP * 0.9); ctx.fillRect(-HALF * 0.9, -5, MAP * 0.9, 10);
  ctx.fillStyle = '#9a8f7a';
  for (const c of colliders) if (c.h > 3) ctx.fillRect(c.minX, c.minZ, c.maxX - c.minX, c.maxZ - c.minZ);
  // gás
  ctx.fillStyle = 'rgba(255,110,0,0.35)';
  ctx.beginPath(); ctx.rect(-HALF * 3, -HALF * 3, MAP * 3, MAP * 3); ctx.arc(gas.cx, gas.cz, Math.max(gas.r, 0.1), 0, Math.PI * 2, true); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 / scale;
  if (gas.state !== 'done' && gas.phase >= 0) { ctx.beginPath(); ctx.arc(gas.toX, gas.toZ, Math.max(gas.toR, 0.1), 0, Math.PI * 2); ctx.stroke(); }
  // POIs no mapa grande
  if (!rotate) { ctx.fillStyle = '#fff'; ctx.font = `${12 / scale}px sans-serif`; ctx.textAlign = 'center'; for (const p of POIS) ctx.fillText(p.name, p.x, p.z); }
  // inimigos disparando (pontos vermelhos, estilo UAV)
  ctx.fillStyle = '#ff3333';
  for (const b of bots) if (b.alive && !b.dropping && b.fireCd > 0 && b.target) { ctx.beginPath(); ctx.arc(b.pos.x, b.pos.z, 3 / scale, 0, 7); ctx.fill(); }
  // jogador
  ctx.translate(player.pos.x, player.pos.z); ctx.rotate(-player.yaw);
  ctx.fillStyle = '#f5b400'; ctx.beginPath(); ctx.moveTo(0, -7 / scale); ctx.lineTo(5 / scale, 6 / scale); ctx.lineTo(-5 / scale, 6 / scale); ctx.fill();
  ctx.restore();
}

function updateHUD() {
  const alive = bots.filter(b => b.alive || b.respawnT > 0).length + (player.alive || player.respawnT > 0 ? 1 : 0);
  $('alive').innerHTML = `VIVOS <b>${alive}</b>`;
  $('kills').innerHTML = `ABATES <b>${player.kills}</b>`;
  const gt = gas.state === 'done' ? '--' : `${gas.state === 'wait' ? '⏳' : '⚠'} ${Math.ceil(Math.max(0, gas.t))}s`;
  $('circle').innerHTML = `GÁS <b>${gt}</b>`;
  $('resp').innerHTML = `RESSURGIMENTO <b>${resurgence ? 'ATIVO' : 'DESLIGADO'}</b>`;
  $('hpbar').firstElementChild.style.width = Math.max(0, player.hp) + '%';
  const plates = $('plates').children;
  for (let i = 0; i < 3; i++) plates[i].style.setProperty('--f', THREE.MathUtils.clamp((player.armor - i * 50) / 50, 0, 1) * 100 + '%');
  $('platecount').innerHTML = `Placas: <b>${player.plates}</b>${player.plating > 0 ? ' — aplicando...' : ''}`;
  const w = curW();
  $('wname').textContent = WEAPONS[w.id].name + (player.reloading > 0 ? ' — RECARREGANDO' : '');
  $('ammo').innerHTML = `<b>${w.mag}</b> / ${w.reserve}`;
  $('cash').innerHTML = `$ <b>${player.cash}</b>`;
  const spread = (WEAPONS[w.id].spread * (player.ads ? 0.35 : 1) + player.recoil * 0.3) * 400 + 4;
  $('crosshair').style.setProperty('--s', spread + 'px');
  $('crosshair').style.opacity = player.ads ? 0 : 1;
  drawMap(mm, 200, player.pos.x, player.pos.z, 1.1, true);
  if (!$('bigmap').classList.contains('hidden')) drawMap(bm, 600, 0, 0, 600 / (MAP * 1.05), false);
}

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
$('playBtn').onclick = () => {
  AC.resume();
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
  renderer.domElement.requestPointerLock();
  started = true;
  // todos saltam do avião
  dropIn(player, rr(-100, 100), rr(-100, 100));
  player.weapons = [{ id: 'm4', mag: 30, reserve: 90 }, { id: 'pistol', mag: 12, reserve: 48 }]; player.armor = 150; buildGun('m4');
  for (const b of bots) dropIn(b, rr(-HALF * 0.8, HALF * 0.8), rr(-HALF * 0.8, HALF * 0.8));
  nextPhase();
  announce('BEM-VINDO AO RESSURGIMENTO', 3);
};

// câmera do menu
camera.position.set(0, 60, 140); camera.lookAt(0, 0, 0);
buildGun('m4'); gunGroup.visible = false;

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (started && !over) {
    matchTime += dt;
    updateGas(dt);
    updatePlayer(dt);
    updateBots(dt);
    checkWin();
    updateHUD();
    if (announceT > 0) { announceT -= dt; if (announceT <= 0 && player.alive && !player.dropping) centerMsg.textContent = ''; }
    if (hmT > 0) { hmT -= dt; if (hmT <= 0) $('hitmarker').style.opacity = 0; }
    if (player.lastDmg < 0.2) $('dmgOverlay').style.opacity = Math.max(0, (100 - player.hp) / 150);
    sun.position.set(player.pos.x - 120, 140, player.pos.z + 60); sun.target.position.set(player.pos.x, 0, player.pos.z);
  } else if (!started) {
    const t = performance.now() / 8000;
    camera.position.set(Math.cos(t) * 160, 60, Math.sin(t) * 160); camera.lookAt(0, 0, 0);
  }
  for (const p of pickups) { p.t += dt; p.mesh.rotation.y += dt * 2; p.mesh.position.y = 0.4 + Math.sin(p.t * 3) * 0.1; }
  for (let i = tracers.length - 1; i >= 0; i--) { const t = tracers[i]; t.t -= dt; if (t.t <= 0) { scene.remove(t.l); t.l.geometry.dispose(); tracers.splice(i, 1); } }
  for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.t -= dt; if (s.t <= 0) { scene.remove(s.m); sparks.splice(i, 1); } }
  renderer.render(scene, camera);
}
loop();
