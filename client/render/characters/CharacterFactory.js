import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { assets } from '../../assets/AssetManager.js';
import { Rig } from './Rig.js';
import { Animator } from './Animator.js';
import { buildFallbackHumanoid } from './FallbackHumanoid.js';
import { realGun } from '../RealWeapons.js';
import { gunModel, OPERATOR_STYLES, nameplate } from '../Models.js';
import { operatorOf } from '../../core/Operators.js';

/**
 * CharacterFactory — cria personagens animáveis:
 *   GLB real do Higgsfield (soldado rigado, 24 ossos) se carregou, senão humanoide
 *   procedural com o mesmo esqueleto. Aplica o tom do operador, arma na mão e placa
 *   de nome para aliados. Devolve { root, rig, animator, setWeapon, setOperator }.
 */
export class CharacterFactory {
  constructor() { this.materials = new Map(); this.stats = { real: 0, fallback: 0 }; }

  soldierTemplate() {
    const g = assets.get('soldier'); if (!g) return null;
    if (!this.tpl) {
      this.tpl = g.scene;
      this.tpl.traverse(o => { if (o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; } });
    }
    return this.tpl;
  }
  /** Material do GLB por operador (tinta sobre a textura, luz assada reduzida). */
  realMaterial(base, op) {
    const key = `${base.uuid}:${op}`;
    if (!this.materials.has(key)) {
      const m = base.clone(), o = operatorOf(op);
      m.color = new THREE.Color(o.tint).lerp(new THREE.Color(0xffffff), 0.35);
      if (m.emissiveMap) { m.emissive = new THREE.Color(0x222222); m.emissiveIntensity = 0.5; }
      m.roughness = 0.82; m.metalness = 0; if (m.specularColor) m.specularColor.set(0x555555); m.side = THREE.FrontSide;
      this.materials.set(key, m);
    }
    return this.materials.get(key);
  }

  /**
   * Arma de 3ª pessoa como UM mesh (geometrias fundidas por material, em cache por id).
   * O modelo procedural tem ~10 peças → 10 draw calls por jogador; fundido vira 1–3.
   */
  gun(id) {
    this.guns ??= new Map();
    const real = realGun(id), key = id + (real ? ':real' : '');
    let e = this.guns.get(key);
    if (!e) {
      const src = real || gunModel(id); src.updateMatrixWorld(true);
      const byMat = new Map();
      src.traverse(o => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
        for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        const m = mats[0]; if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(g);
      });
      const mats = [...byMat.keys()], geo = mergeGeometries(mats.map(m => mergeGeometries(byMat.get(m), false)), true);
      e = { geo, mats, L: src.userData.L, muzzleZ: src.userData.muzzleZ };
      this.guns.set(key, e);
    }
    const mesh = new THREE.Mesh(e.geo, e.mats); mesh.userData.L = e.L; mesh.userData.muzzleZ = e.muzzleZ;
    return mesh;
  }

  create({ operator = 0, name = null, ally = false, lite = false } = {}) {
    const root = new THREE.Group(), holder = new THREE.Group();
    holder.rotation.y = Math.PI;        // modelos do Meshy olham para +Z; o jogo usa -Z como frente
    root.add(holder);
    const tpl = lite ? null : this.soldierTemplate();
    let model, real = false;
    if (tpl) {
      model = SkeletonUtils.clone(tpl); real = true;
      model.traverse(o => { if (o.isSkinnedMesh) { o.material = this.realMaterial(o.material, operator); o.castShadow = true; o.frustumCulled = false; } });
      this.stats.real++;
    } else {
      const style = OPERATOR_STYLES[operator % OPERATOR_STYLES.length];
      model = buildFallbackHumanoid({ ...style, uniform: operatorOf(operator).tint }).scene; this.stats.fallback++;
    }
    holder.add(model);
    root.updateMatrixWorld(true);
    const rig = new Rig(root, model);
    const weapon = new THREE.Group();   // arma no espaço do mundo (posicionada pelo Animator)
    const animator = new Animator(rig, weapon);
    const meshes = []; model.traverse(o => { if (o.isMesh) meshes.push(o); });
    const c = { root, rig, animator, weapon, real, weaponId: null, plate: null, meshes, shadow: true };
    /** Sombra só para quem está perto (sombra de skinned mesh custa um segundo desenho inteiro). */
    c.setShadow = on => { if (c.shadow === on) return; c.shadow = on; for (const m of meshes) m.castShadow = on; weapon.traverse(o => { if (o.isMesh) o.castShadow = on; }); };
    c.setWeapon = id => {
      if (c.weaponId === id) return; c.weaponId = id; weapon.clear();
      if (id) { const g = this.gun(id); g.castShadow = c.shadow !== false; weapon.add(g); }
    };
    if (ally && name) { c.plate = nameplate(name); c.plate.position.y = 2.25; root.add(c.plate); }
    return c;
  }
}
export const characters = new CharacterFactory();
