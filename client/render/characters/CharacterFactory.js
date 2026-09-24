import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { assets } from '../../assets/AssetManager.js';
import { Rig } from './Rig.js';
import { Animator } from './Animator.js';
import { buildFallbackHumanoid } from './FallbackHumanoid.js';
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

  create({ operator = 0, name = null, ally = false } = {}) {
    const root = new THREE.Group(), holder = new THREE.Group();
    holder.rotation.y = Math.PI;        // modelos do Meshy olham para +Z; o jogo usa -Z como frente
    root.add(holder);
    const tpl = this.soldierTemplate();
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
    const c = { root, rig, animator, weapon, real, weaponId: null, plate: null };
    c.setWeapon = id => {
      if (c.weaponId === id) return; c.weaponId = id; weapon.clear();
      if (id) { const g = gunModel(id); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); weapon.add(g); }
    };
    if (ally && name) { c.plate = nameplate(name); c.plate.position.y = 2.25; root.add(c.plate); }
    return c;
  }
}
export const characters = new CharacterFactory();
