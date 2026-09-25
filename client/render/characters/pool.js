import * as THREE from 'three';

/**
 * Pool circular de temporários para a animação: nada de `new Vector3()` por osso
 * por quadro (40 personagens × dezenas de vetores = milhares de objetos/s → pausas
 * de GC visíveis como engasgos). Cada valor vale só dentro de um update.
 */
const N = 2048, VS = Array.from({ length: N }, () => new THREE.Vector3()), QS = Array.from({ length: 256 }, () => new THREE.Quaternion());
let vi = 0, qi = 0;
export const V = (x = 0, y = 0, z = 0) => VS[vi++ & (N - 1)].set(x, y, z);
export const C = v => VS[vi++ & (N - 1)].copy(v);
export const Q = () => QS[qi++ & 255].identity();
export const M4 = new THREE.Matrix4();
