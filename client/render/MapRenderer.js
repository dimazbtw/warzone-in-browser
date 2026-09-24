import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * MapRenderer — transforma a geometria autoritativa (caixas + terreno) em cena:
 *   terreno com cor por altura/inclinação, prédios mesclados por material
 *   (UV em escala de mundo), contêineres, sacos de areia, caixas, rochas e
 *   árvores instanciadas, arbustos, mar e praia.
 * Tudo estático é mesclado: poucas chamadas de desenho mesmo com 4 mil peças.
 */
const HF = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Jib0BzU3aLdeWOQjrliCwaWdFv/hf_20260924_';
const HF_TEX = {
  ground: HF + '173816_8da157e1-0e79-4b7a-8cef-33698d7841d9.png', brick: HF + '173847_5a2f95cf-3c03-43c1-8740-f830b13a0ab2.png',
  container: HF + '173816_d261a97d-8a6c-4b1a-988c-d49be2eafbf3.png', crate: HF + '173816_7ec2053c-2b82-4c8b-8152-cc75bf44c1d0.png',
  roof: HF + '173816_0bfc50ac-de26-4d9c-8c15-23e3c60f12f8.png', foliage: HF + '173817_b662c4f6-0d95-4fac-b44a-d293fcc486f2.png',
};

// índices `mat` gerados pelo servidor → aparência
const MAT_DEFS = {
  0: { color: '#cbb89a', tex: 'plaster', scale: 3 }, 1: { color: '#b5704f', tex: 'brick', scale: 2.2 }, 2: { color: '#b9b5aa', tex: 'concrete', scale: 3 },
  3: { color: '#8f959a', tex: 'concrete', scale: 3 }, 4: { color: '#9a8b76', tex: 'plaster', scale: 3 }, 5: { color: '#7d8466', tex: 'concrete', scale: 3 },
  6: { color: '#7a5a3e', tex: 'wood', scale: 2 }, 7: { color: '#8c8a84', tex: 'concrete', scale: 3 }, 8: { color: '#56504a', tex: 'roof', scale: 4 },
  9: { color: '#d8d0c0', tex: 'plaster', scale: 3 }, 10: { color: '#8a6a3c', tex: 'crate', scale: 1.4 },
  11: { color: '#a33b2c', tex: 'container', scale: 2.6 }, 12: { color: '#2c5ea3', tex: 'container', scale: 2.6 }, 13: { color: '#3f7a3a', tex: 'container', scale: 2.6 }, 14: { color: '#c08a2a', tex: 'container', scale: 2.6 },
  15: { color: '#9b8a62', tex: 'sandbag', scale: 1 }, 17: { color: '#8a857b', tex: 'concrete', scale: 3 },
};

export class MapRenderer {
  constructor(world) { this.world = world; this.loader = new THREE.TextureLoader(); this.loader.setCrossOrigin('anonymous'); this.texCache = {}; }

  // ------------------------------------------------ texturas procedurais (fallback) e do Higgsfield
  proc(kind) {
    if (this.texCache[kind]) return this.texCache[kind];
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const noise = (n, a, s = 2) => { for (let i = 0; i < n; i++) { const v = Math.random() * 255 | 0; g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(Math.random() * 256, Math.random() * 256, s, s); } };
    g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
    if (kind === 'brick') { g.fillStyle = '#ddd'; for (let y = 0; y < 256; y += 32) for (let x = (y / 32) % 2 ? -32 : 0; x < 256; x += 64) { g.fillStyle = `hsl(0,0%,${80 + Math.random() * 15}%)`; g.fillRect(x + 2, y + 2, 60, 28); } noise(3000, 0.12); }
    else if (kind === 'wood') { for (let y = 0; y < 256; y += 32) { g.fillStyle = `hsl(0,0%,${78 + Math.random() * 18}%)`; g.fillRect(0, y + 1, 256, 30); } for (let i = 0; i < 160; i++) { g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(Math.random() * 256, Math.random() * 256, 40 + Math.random() * 60, 1); } }
    else if (kind === 'container') { for (let x = 0; x < 256; x += 16) { g.fillStyle = x % 32 ? '#e8e8e8' : '#c9c9c9'; g.fillRect(x, 0, 16, 256); } noise(2500, 0.1); }
    else if (kind === 'crate') { g.fillStyle = '#e0e0e0'; for (let y = 0; y < 256; y += 64) { g.fillStyle = `hsl(0,0%,${80 + Math.random() * 12}%)`; g.fillRect(0, y + 2, 256, 60); } g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 246); g.beginPath(); g.moveTo(0, 0); g.lineTo(256, 256); g.stroke(); }
    else if (kind === 'sandbag') { for (let y = 0; y < 256; y += 42) for (let x = (y / 42) % 2 ? -40 : 0; x < 256; x += 80) { g.fillStyle = `hsl(0,0%,${75 + Math.random() * 15}%)`; g.beginPath(); g.ellipse(x + 40, y + 21, 38, 19, 0, 0, 7); g.fill(); } noise(3000, 0.1); }
    else if (kind === 'roof') { noise(9000, 0.18, 3); }
    else if (kind === 'ground') { g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, 256, 256); noise(14000, 0.25, 2); }
    else noise(kind === 'plaster' ? 7000 : 9000, kind === 'plaster' ? 0.07 : 0.12, 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return (this.texCache[kind] = t);
  }
  hf(key, mat, tint) {
    this.loader.load(HF_TEX[key], t => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; mat.map = t; if (tint) mat.color.set(tint); mat.needsUpdate = true; }, undefined, () => {});
  }
  material(id) {
    const d = MAT_DEFS[id] ?? MAT_DEFS[0];
    const m = new THREE.MeshStandardMaterial({ color: d.color, map: this.proc(d.tex), roughness: d.tex === 'container' ? 0.6 : 0.92, metalness: d.tex === 'container' ? 0.25 : 0 });
    if (d.tex === 'brick') this.hf('brick', m, '#ffffff');
    if (d.tex === 'container') this.hf('container', m);
    if (d.tex === 'crate') this.hf('crate', m, '#ffffff');
    if (d.tex === 'roof') this.hf('roof', m, '#9a9590');
    m.userData.scale = d.scale;
    return m;
  }

  build(mapView, geo, quality) {
    const group = new THREE.Group(); group.name = 'map';
    this.buildTerrain(group, mapView, geo);
    this.buildBoxes(group, geo);
    this.buildVegetation(group, mapView, geo, quality);
    return group;
  }

  // ------------------------------------------------ terreno
  buildTerrain(group, view, geo) {
    const size = view.size, ext = size + 160, seg = Math.round(ext / 3);
    const pg = new THREE.PlaneGeometry(ext, ext, seg, seg); pg.rotateX(-Math.PI / 2);
    const pos = pg.attributes.position, colors = new Float32Array(pos.count * 3), half = size / 2;
    const grass = new THREE.Color('#6f7342'), dry = new THREE.Color('#9b8f5c'), sand = new THREE.Color('#cdb485'), rock = new THREE.Color('#77736a'), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), out = Math.max(Math.abs(x), Math.abs(z)) - half;
      let h = geo.terrainHeight(Math.max(-half, Math.min(half, x)), Math.max(-half, Math.min(half, z)));
      if (out > 0) h = Math.min(h, 0.15) - out * 0.06;
      pos.setY(i, h);
      const hx = geo.terrainHeight(x + 2, z) - geo.terrainHeight(x - 2, z), hz = geo.terrainHeight(x, z + 2) - geo.terrainHeight(x, z - 2);
      const slope = Math.min(1, Math.hypot(hx, hz) / 3), n = Math.sin(x * 0.07) * Math.cos(z * 0.05) * 0.5 + 0.5;
      tmp.copy(grass).lerp(dry, n * 0.6 + Math.max(0, h - 9) * 0.05);
      if (h < 0.9) tmp.lerp(sand, Math.min(1, (0.9 - h) / 0.6));
      tmp.lerp(rock, slope * 0.85);
      colors.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    pg.setAttribute('color', new THREE.BufferAttribute(colors, 3)); pg.computeVertexNormals();
    const tex = this.proc('ground'); tex.repeat.set(ext / 6, ext / 6);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 1 });
    this.loader.load(HF_TEX.ground, t => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(ext / 9, ext / 9); t.anisotropy = 8; m.map = t; m.needsUpdate = true; }, undefined, () => {});
    const mesh = new THREE.Mesh(pg, m); mesh.receiveShadow = true; group.add(mesh);
    // mar
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshStandardMaterial({ color: 0x2a6a80, roughness: 0.18, metalness: 0.35, transparent: true, opacity: 0.92 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.35; group.add(sea); this.sea = sea;
  }

  // ------------------------------------------------ prédios e objetos (mesclados por material)
  buildBoxes(group, geo) {
    const byMat = new Map();
    for (const b of geo.boxes) {
      if (b.kind === 'trunk' || b.kind === 'rock') continue;
      const w = b.maxX - b.minX, h = b.y1 - b.y0, d = b.maxZ - b.minZ;
      const g = new THREE.BoxGeometry(w, h, d); g.translate((b.minX + b.maxX) / 2, (b.y0 + b.y1) / 2, (b.minZ + b.maxZ) / 2);
      worldUV(g);
      const key = b.mat ?? 0; if (!byMat.has(key)) byMat.set(key, []); byMat.get(key).push(g);
    }
    for (const [key, list] of byMat) {
      const mat = this.material(key), s = mat.userData.scale;
      for (const g of list) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / s, uv.getY(i) / s); }
      for (let i = 0; i < list.length; i += 1500) {
        const merged = mergeGeometries(list.slice(i, i + 1500), false);
        const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
      }
      for (const g of list) g.dispose();
    }
    // rochas: poliedros irregulares preenchendo a caixa de colisão
    const rocks = geo.boxes.filter(b => b.kind === 'rock');
    if (rocks.length) {
      const rg = new THREE.DodecahedronGeometry(1, 1), p = rg.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.82 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.3; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
      rg.computeVertexNormals();
      const im = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: 0x86817a, map: this.proc('concrete'), roughness: 1, flatShading: true }), rocks.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      rocks.forEach((b, i) => {
        e.set(0, (i * 1.7) % 6.28, 0); q.setFromEuler(e);
        m4.compose(new THREE.Vector3((b.minX + b.maxX) / 2, (b.y0 + b.y1) / 2, (b.minZ + b.maxZ) / 2), q, new THREE.Vector3((b.maxX - b.minX) * 0.62, (b.y1 - b.y0) * 0.62, (b.maxZ - b.minZ) * 0.62));
        im.setMatrixAt(i, m4);
      });
      im.castShadow = im.receiveShadow = true; group.add(im);
    }
  }

  // ------------------------------------------------ árvores e arbustos (instanciados)
  buildVegetation(group, view, geo, q) {
    const trees = view.trees ?? [], density = q?.trees ?? 1;
    const pines = trees.filter((t, i) => t[4] === 0 && (i % 10) < density * 10), broads = trees.filter((t, i) => t[4] === 1 && (i % 10) < density * 10);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4d3a26, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f5a2a, roughness: 0.95, flatShading: true });
    this.hf('foliage', leafMat, '#8fa070');
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    const inst = (geoIn, material, list, fn) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geoIn, material, list.length);
      list.forEach((t, i) => { fn(t, m4); im.setMatrixAt(i, m4); col.setHSL(0.24 + (t[5] % 13) / 200, 0.35 + (t[5] % 7) / 40, 0.26 + (t[5] % 11) / 120); im.setColorAt?.(i, col); });
      im.castShadow = true; im.receiveShadow = true; group.add(im);
    };
    const trunk = new THREE.CylinderGeometry(0.16, 0.28, 1, 6); trunk.translate(0, 0.5, 0);
    const trunkAll = [...pines, ...broads];
    if (trunkAll.length) {
      const im = new THREE.InstancedMesh(trunk, trunkMat, trunkAll.length);
      trunkAll.forEach((t, i) => { m4.compose(new THREE.Vector3(t[0], t[1] - 0.2, t[2]), q4.identity(), new THREE.Vector3(1, t[3] * (t[4] === 0 ? 0.6 : 0.55), 1)); im.setMatrixAt(i, m4); });
      im.castShadow = true; group.add(im);
    }
    // pinheiro: dois cones empilhados
    const cone = mergeGeometries([new THREE.ConeGeometry(1.9, 3.6, 7).translate(0, 1.8, 0), new THREE.ConeGeometry(1.4, 3.0, 7).translate(0, 3.6, 0), new THREE.ConeGeometry(0.9, 2.2, 7).translate(0, 5.0, 0)]);
    inst(cone, leafMat, pines, (t, m) => { e.set(0, t[5] % 6.28, 0); q4.setFromEuler(e); const s = t[3] / 9; m.compose(new THREE.Vector3(t[0], t[1] + t[3] * 0.28, t[2]), q4, new THREE.Vector3(s, s, s)); });
    // copa larga: icosaedros agrupados
    const crown = mergeGeometries([new THREE.IcosahedronGeometry(2.2, 0), new THREE.IcosahedronGeometry(1.6, 0).translate(1.3, -0.4, 0.4), new THREE.IcosahedronGeometry(1.5, 0).translate(-1.2, -0.2, -0.5)]);
    inst(crown, leafMat, broads, (t, m) => { e.set(0, t[5] % 6.28, 0); q4.setFromEuler(e); const s = t[3] / 9; m.compose(new THREE.Vector3(t[0], t[1] + t[3] * 0.62, t[2]), q4, new THREE.Vector3(s * 1.1, s, s * 1.1)); });
    // arbustos visuais (sem colisão) em volta das árvores
    const bushes = []; trees.forEach((t, i) => { if (i % 2 === 0 && density > 0.6) bushes.push([t[0] + ((t[5] % 7) - 3) * 0.9, t[1], t[2] + ((t[5] % 5) - 2) * 1.1, 0.6 + (t[5] % 5) / 8, 0, t[5]]); });
    inst(new THREE.IcosahedronGeometry(1, 0), leafMat, bushes, (t, m) => m.compose(new THREE.Vector3(t[0], geo.terrainHeight(t[0], t[2]) + t[3] * 0.4, t[2]), q4.identity(), new THREE.Vector3(t[3] * 1.3, t[3], t[3] * 1.3)));
  }
}

/** UV em escala de mundo (1 unidade = 1 m) por face da caixa: texturas não esticam. */
function worldUV(g) {
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    if (ny > 0.5) uv.setXY(i, x, z); else if (nx > 0.5) uv.setXY(i, z, y); else uv.setXY(i, x, y);
  }
}
