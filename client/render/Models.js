import * as THREE from 'three';

/**
 * Models — fábrica de malhas procedurais originais (operadores, armas, braços,
 * objetos do mapa). Materiais são compartilhados/cacheados para performance.
 */
const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts }));
  return matCache.get(key);
}
const geoCache = new Map();
const B = (w, h, d) => { const k = `b${w},${h},${d}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d)); return geoCache.get(k); };
const C = (r1, r2, h, s = 10) => { const k = `c${r1},${r2},${h},${s}`; if (!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(r1, r2, h, s)); return geoCache.get(k); };
export function part(geo, m, x, y, z, rx = 0, ry = 0, rz = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; }

// ---------- camuflagens ----------
const camoCache = {};
export function camoTexture(colors, digital = false) {
  const key = colors.join() + digital; if (camoCache[key]) return camoCache[key];
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = colors[0]; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < (digital ? 260 : 26); i++) {
    g.fillStyle = colors[1 + (i % (colors.length - 1))];
    if (digital) { const s = 4 + (i % 3) * 4; g.fillRect((i * 37 % 32) * 4, (i * 53 % 32) * 4, s, s); }
    else { g.beginPath(); g.ellipse((i * 47) % 128, (i * 83) % 128, 6 + (i % 5) * 3, 4 + (i % 4) * 2.5, i, 0, 7); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return (camoCache[key] = t);
}

// ---------- operadores (visual por squad) ----------
export const OPERATOR_STYLES = [
  { uniform: 0x4a5634, vest: 0x3a4228, skin: 0xa87d5d, glove: 0x2f3322, head: 'boonie' },
  { uniform: 0xa58d66, vest: 0x7a6545, skin: 0x9a7255, glove: 0x5c4a33, head: 'cap' },
  { uniform: 0x1f2a3d, vest: 0x161e2b, skin: 0x7c5a44, glove: 0x101318, head: 'helmet' },
  { uniform: 0x1d1f22, vest: 0x111214, skin: 0x6b4e3a, glove: 0x161616, head: 'mask' },
  { uniform: 0x5b3b2e, vest: 0x3b2a22, skin: 0x8a6a50, glove: 0x2a1c14, head: 'helmet' },
  { uniform: 0x5d6166, vest: 0x3b3e42, skin: 0xb08a6a, glove: 0x222222, head: 'cap' },
];

// ---------- armas ----------
/** Mapeia armas do servidor → modelo. */
const GUN_SHAPE = { sidearm: 'pistol', pistol9: 'pistol', pistol45: 'pistol', rifle: 'ar', battle: 'br', smg: 'smg', smg2: 'smg', smg4: 'smg', shotgun: 'shotgun', marksman: 'dmr', sniper: 'dmr' };
/** Família da arma (animação, som, viewmodel) — espelha `class` do config. */
export const WEAPON_CLASS = { sidearm: 'pistol', pistol9: 'pistol', pistol45: 'pistol', smg: 'smg', smg2: 'smg', smg4: 'smg', rifle: 'ar', battle: 'ar', shotgun: 'shotgun', marksman: 'dmr', sniper: 'sniper' };
export const classOf = id => WEAPON_CLASS[id] ?? 'ar';
const darkMetal = () => mat(0x151515, { metalness: 0.8, roughness: 0.35 });
const polymer = () => mat(0x2a2a28);
const wood = () => mat(0x6b3f1f, { roughness: 0.7 });
const lens = () => mat(0x224455, { metalness: 1, roughness: 0.05, emissive: 0x0a2030 });
export function gunModel(weaponId, camo = ['#1c1c1c', '#232323', '#161616']) {
  const shape = GUN_SHAPE[weaponId] ?? 'ar', g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ map: camoTexture(camo), metalness: 0.35, roughness: 0.6 });
  let L;
  if (shape === 'pistol') {
    g.add(part(B(0.05, 0.05, 0.24), body, 0, 0.02, -0.1), part(B(0.045, 0.03, 0.2), polymer(), 0, -0.02, -0.09), part(B(0.045, 0.14, 0.06), polymer(), 0, -0.1, 0, 0.25));
    L = 0.25;
  } else if (shape === 'dmr') {
    g.add(part(B(0.06, 0.07, 0.6), wood(), 0, -0.02, -0.2), part(B(0.05, 0.1, 0.28), wood(), 0, -0.05, 0.22));
    g.add(part(C(0.013, 0.016, 0.62), darkMetal(), 0, 0.03, -0.62, Math.PI / 2), part(C(0.032, 0.032, 0.34), darkMetal(), 0, 0.11, -0.13, Math.PI / 2));
    g.add(part(C(0.036, 0.036, 0.005), lens(), 0, 0.11, -0.3, Math.PI / 2), part(C(0.008, 0.008, 0.08), darkMetal(), 0.06, 0.03, -0.02, 0, 0, Math.PI / 2));
    L = 0.95;
  } else if (shape === 'shotgun') {
    g.add(part(B(0.06, 0.08, 0.3), body, 0, 0.01, -0.12), part(C(0.02, 0.02, 0.6), darkMetal(), 0, 0.035, -0.55, Math.PI / 2), part(B(0.07, 0.06, 0.18), polymer(), 0, -0.01, -0.48));
    g.add(part(B(0.05, 0.13, 0.06), polymer(), 0, -0.08, 0.02, 0.3), part(B(0.055, 0.09, 0.26), polymer(), 0, -0.03, 0.18, -0.08));
    L = 0.86;
  } else {
    const mp = shape === 'smg', br = shape === 'br', hg = mp ? 0.2 : 0.3, bl = mp ? 0.1 : 0.3;
    g.add(part(B(0.06, 0.075, mp ? 0.28 : 0.32), body, 0, 0.01, -0.1), part(B(0.056, 0.03, 0.28), body, 0, 0.055, -0.1));
    g.add(part(B(0.062, 0.07, hg), br ? wood() : polymer(), 0, 0.015, -0.26 - hg / 2 + 0.02));
    for (let z = -0.02; z > -0.02 - (mp ? 0.2 : 0.5); z -= 0.028) g.add(part(B(0.05, 0.012, 0.014), darkMetal(), 0, 0.068, z));
    g.add(part(C(0.012, 0.012, bl), darkMetal(), 0, 0.02, -0.26 - hg - bl / 2 + 0.04, Math.PI / 2), part(C(0.02, 0.018, 0.07), darkMetal(), 0, 0.02, -0.26 - hg - bl + 0.02, Math.PI / 2));
    if (br) for (let i = 0; i < 4; i++) g.add(part(B(0.045, 0.06, 0.075), mat(0x222222), 0, -0.07 - i * 0.05, -0.16 + i * 0.022, -0.35 - i * 0.12));
    else g.add(part(B(0.045, mp ? 0.15 : 0.19, 0.07), mat(0x222222), 0, -0.12, -0.16, -0.18));
    g.add(part(B(0.045, 0.13, 0.055), polymer(), 0, -0.09, 0.02, 0.35), part(B(0.05, 0.1, 0.14), br ? wood() : polymer(), 0, -0.01, 0.24));
    g.add(part(B(0.05, 0.05, 0.08), darkMetal(), 0, 0.1, -0.08), part(B(0.044, 0.034, 0.004), lens(), 0, 0.105, -0.12));
    L = 0.26 + hg + bl + 0.02;
  }
  g.userData.L = L; g.userData.muzzleZ = -L;
  return g;
}

export function armsModel(style) {
  const sleeve = mat(style.uniform, { roughness: 0.95 }), glove = mat(style.glove), skin = mat(style.skin);
  const g = new THREE.Group();
  const arm = (x, y, z, rx, ry, rz, len) => {
    const a = new THREE.Group();
    a.add(part(C(0.055, 0.048, len), sleeve, 0, 0, len / 2, Math.PI / 2), part(C(0.047, 0.047, 0.05), skin, 0, 0, 0, Math.PI / 2), part(B(0.085, 0.07, 0.11), glove, 0, 0, -0.06));
    a.position.set(x, y, z); a.rotation.set(rx, ry, rz); g.add(a); return a;
  };
  arm(0.045, -0.12, 0.02, 0.25, 0.28, 0.2, 0.42);
  g.userData.left = arm(-0.08, -0.09, -0.36, 0.1, -0.55, -0.4, 0.5);
  return g;
}

/** Soldado de terceira pessoa. Retorna grupo com userData.{legs, chute, head, gunSlot, torso}. */
export function soldierModel(style) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const uni = mat(style.uniform, { roughness: 0.95 }), vest = mat(style.vest), skin = mat(style.skin), boot = mat(0x1a1612), glove = mat(style.glove);
  const legs = [-0.13, 0.13].map(x => {
    const lg = new THREE.Group();
    lg.add(part(B(0.2, 0.46, 0.22), uni, 0, -0.23, 0), part(B(0.18, 0.42, 0.2), uni, 0, -0.65, 0.02), part(B(0.2, 0.12, 0.3), boot, 0, -0.9, -0.04), part(B(0.21, 0.12, 0.08), vest, 0, -0.45, -0.11));
    lg.position.set(x, 0.95, 0); body.add(lg); return lg;
  });
  body.add(part(B(0.5, 0.62, 0.28), uni, 0, 1.25, 0), part(B(0.54, 0.44, 0.34), vest, 0, 1.3, 0), part(B(0.38, 0.42, 0.18), vest, 0, 1.3, 0.25));
  for (let i = -1; i <= 1; i++) body.add(part(B(0.13, 0.14, 0.08), vest, i * 0.15, 1.18, -0.2));
  body.add(part(B(0.13, 0.5, 0.14), uni, 0.3, 1.3, -0.15, 1.2), part(B(0.13, 0.5, 0.14), uni, -0.22, 1.3, -0.25, 1.3, 0.5), part(B(0.1, 0.1, 0.1), glove, 0.25, 1.28, -0.42), part(B(0.1, 0.1, 0.1), glove, -0.05, 1.3, -0.55));
  body.add(part(B(0.14, 0.12, 0.14), skin, 0, 1.62, 0), part(B(0.26, 0.3, 0.27), skin, 0, 1.78, 0));
  if (style.head === 'boonie') body.add(part(C(0.26, 0.26, 0.03, 12), uni, 0, 1.93, 0), part(C(0.15, 0.16, 0.12, 12), uni, 0, 2.0, 0));
  else if (style.head === 'cap') body.add(part(B(0.29, 0.1, 0.3), uni, 0, 1.96, 0), part(B(0.26, 0.02, 0.14), uni, 0, 1.92, -0.2));
  else if (style.head === 'mask') body.add(part(B(0.27, 0.31, 0.28), mat(0x0c0c0c), 0, 1.78, 0), part(B(0.2, 0.12, 0.01), mat(0xd8d2c4), 0, 1.74, -0.145));
  else body.add(part(B(0.32, 0.16, 0.33), vest, 0, 1.97, 0), part(B(0.14, 0.06, 0.08), darkMetal(), 0, 2.0, -0.18));
  body.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const chute = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3), mat(0x7a6a2a, { side: THREE.DoubleSide }));
  canopy.position.y = 4.4; canopy.scale.set(1.3, 0.5, 0.8); chute.add(canopy);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x222222 });
  for (const [x, z] of [[-1.9, -0.8], [1.9, -0.8], [-1.9, 0.8], [1.9, 0.8]]) chute.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(x, 4.9, z)]), lineMat));
  chute.visible = false; g.add(chute);
  const gunSlot = new THREE.Group(); gunSlot.position.set(0.12, 1.32, -0.45); gunSlot.scale.setScalar(1.1); body.add(gunSlot);
  g.userData = { legs, chute, body, gunSlot };
  return g;
}

/** Placa de nome (sprite) para aliados. */
export function nameplate(text, color = '#7cff6b') {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.font = 'bold 30px Segoe UI, sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(28, 12, 200, 40);
  g.fillStyle = color; g.fillText(text, 128, 43);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1); s.renderOrder = 10; return s;
}
