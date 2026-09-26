import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'node:fs';
const buf = fs.readFileSync('public/assets/characters/mage.glb');
const L = new GLTFLoader(); L.register((p) => ({ name: 'x', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const g = await L.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const meshes = [];
g.scene.traverse((o) => o.isSkinnedMesh && meshes.push(o));
for (const m of meshes) {
  console.log(m.name, 'bindIdentity', m.bindMatrix.equals(new THREE.Matrix4()), 'skelBones', m.skeleton.bones.length, 'sameInvArray', m.skeleton.boneInverses === meshes[0].skeleton.boneInverses, 'sameMat', m.skeleton.boneInverses[0] === meshes[0].skeleton.boneInverses[0]);
}
const sk = meshes[0].skeleton;
g.scene.updateMatrixWorld(true);
for (let i = 0; i < 6; i++) {
  const b = sk.bones[i];
  const prod = b.matrixWorld.clone().multiply(sk.boneInverses[i]);
  console.log(b.name, 'W*Inv ~ I ?', prod.elements.map((v) => v.toFixed(2)).join(','));
}
const { reproportionCharacter } = await import('../src/core/Proportions.ts');
// skinned bbox per mesh before
const box = (m) => { const b = new THREE.Box3(); const v = new THREE.Vector3(); const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) { m.getVertexPosition(i, v); b.expandByPoint(v); } return b; };
g.scene.updateMatrixWorld(true);
for (const m of meshes) { m.skeleton.update(); }
const before = meshes.map((m) => box(m));
reproportionCharacter(g.scene);
g.scene.updateMatrixWorld(true);
for (const m of meshes) m.skeleton.update();
meshes.forEach((m, i) => { const a = box(m); console.log(m.name, 'before', before[i].min.toArray().map(v=>v.toFixed(2)), before[i].max.toArray().map(v=>v.toFixed(2)), 'after', a.min.toArray().map(v=>v.toFixed(2)), a.max.toArray().map(v=>v.toFixed(2))); });
const hb = g.scene.getObjectByName('head'); console.log('head bone world', hb.getWorldPosition(new THREE.Vector3()).toArray().map(v=>v.toFixed(2)));
console.log('foot', g.scene.getObjectByName('footl').getWorldPosition(new THREE.Vector3()).toArray().map(v=>v.toFixed(2)));
console.log('upperlegl', g.scene.getObjectByName('upperlegl').getWorldPosition(new THREE.Vector3()).toArray().map(v=>v.toFixed(2)));
