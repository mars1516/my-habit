import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'node:fs';
const buf = fs.readFileSync('public/assets/characters/mage.glb');
const L = new GLTFLoader(); L.register((p) => ({ name: 'x', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const g = await L.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
const m = g.scene.getObjectByName('Mage_LegLeft');
const sk = m.skeleton; const geo=m.geometry;
g.scene.updateMatrixWorld(true);
const v = new THREE.Vector3().fromBufferAttribute(geo.attributes.position, 0);
for (const bi of [17,16,18]) {
  const b = sk.bones[bi];
  const l = v.clone().applyMatrix4(sk.boneInverses[bi]);
  console.log(b.name, 'local', l.toArray().map(x=>x.toFixed(3)), 'boneWorld', b.getWorldPosition(new THREE.Vector3()).toArray().map(x=>x.toFixed(3)));
}
const P = await import('../src/core/Proportions.ts');
const order=[]; g.scene.traverse(o=>o.isSkinnedMesh&&order.push(o.name)); console.log('order', order.join(','));
const fb = sk.bones[17];
const origPose = THREE.Skeleton.prototype.pose;
THREE.Skeleton.prototype.pose = function(){ console.log('pose called; foot world before', fb.matrixWorld.elements[13].toFixed(3)); origPose.call(this); console.log(' after', fb.matrixWorld.elements[13].toFixed(3)); };
P.reproportionCharacter(g.scene);
