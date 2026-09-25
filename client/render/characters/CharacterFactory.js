import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { assets } from '../../assets/AssetManager.js';
import { Rig } from './Rig.js';
import { Animator } from './Animator.js';
import { buildFallbackHumanoid } from './FallbackHumanoid.js';
import { autoRig } from './AutoRig.js';
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

  /**
   * Template do operador (uma vez por modelo+tinta):
   *   - GLB com esqueleto (Mixamo etc.): usa os ossos do próprio modelo
   *   - GLB estático: auto-rig (pernas/tronco/cabeça; braços presos ao peito)
   * Normaliza para 1,8 m com os pés em y=0 (a caixa considera o skinning).
   */
  template(op) {
    const o = operatorOf(op), key = `${o.model}:${o.tint}`; this.tpls ??= {};
    if (this.tpls[key] === undefined) {
      const g = assets.get(o.model); if (!g) return null;
      let rigged = false; g.scene.traverse(x => { if (x.isSkinnedMesh) rigged = true; });
      let scene;
      if (rigged) {
        const src = SkeletonUtils.clone(g.scene); src.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(src, true), k = 1.8 / Math.max(1e-6, b.max.y - b.min.y), c = b.getCenter(new THREE.Vector3());
        scene = new THREE.Group(); scene.add(src); src.scale.multiplyScalar(k); src.position.set(-c.x * k, -b.min.y * k, -c.z * k);
        scene.updateMatrixWorld(true);
      } else scene = autoRig(g.scene);
      scene.traverse(x => {
        if (!x.isMesh) return;
        x.castShadow = true; x.frustumCulled = false;
        const mats = (Array.isArray(x.material) ? x.material : [x.material]).map(m0 => { const m = m0.clone(); m.roughness = Math.max(0.6, m.roughness ?? 1); m.metalness = Math.min(0.2, m.metalness ?? 0); if (o.tint !== 0xffffff) m.color = new THREE.Color(o.tint).multiply(m.color ?? new THREE.Color(1, 1, 1)); return m; });
        x.material = Array.isArray(x.material) ? mats : mats[0];
      });
      this.tpls[key] = scene;
    }
    return this.tpls[key];
  }
  /** Algum modelo real já carregou? (Avatars troca o fallback quando chegar) */
  soldierTemplate() { return this.template(0) || this.template(1); }

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
    const tpl = lite ? null : this.template(operator);
    let model, real = false;
    if (tpl) {
      model = SkeletonUtils.clone(tpl); real = true;
      model.traverse(o => { if (o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; } });
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
    animator.bakedArms = !!model.userData.baked;   // fuzil embutido na malha: sem IK de braço nem arma separada
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
