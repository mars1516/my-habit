import * as THREE from 'three';

/**
 * Re-proportions the chibi KayKit rig (~2 heads tall) into a ~6-head adventurer.
 *
 * Every bone gets a scale in its own local frame (Y runs along the bone). The skinned
 * vertices are re-baked in that frame, child joints are pushed out accordingly and the
 * inverse bind matrices recomputed, so the result is an ordinary rotation-driven rig
 * again: the shared animation clips only need their translation tracks rescaled.
 */
const S: Record<string, [number, number, number]> = {
  hips: [0.95, 1.25, 0.95],
  spine: [0.88, 1.3, 0.86],
  chest: [0.9, 1.15, 0.86],
  head: [0.43, 0.43, 0.43],
  upperarml: [0.72, 1.75, 0.72],
  upperarmr: [0.72, 1.75, 0.72],
  lowerarml: [0.7, 1.75, 0.7],
  lowerarmr: [0.7, 1.75, 0.7],
  wristl: [0.7, 1, 0.7],
  wristr: [0.7, 1, 0.7],
  handl: [0.62, 0.62, 0.62],
  handr: [0.62, 0.62, 0.62],
  upperlegl: [1.05, 3.0, 1.05],
  upperlegr: [1.05, 3.0, 1.05],
  lowerlegl: [0.95, 3.25, 0.95],
  lowerlegr: [0.95, 3.25, 0.95],
  footl: [0.9, 0.95, 0.9],
  footr: [0.9, 0.95, 0.9],
};
/** How much the hips' animated offsets from rest are amplified (legs got longer). */
const HIPS_DELTA = new THREE.Vector3(1.4, 2.6, 1.4);
/** Rigid capes hang from the chest; stretch them so they still reach the thighs. */
const CAPE_STRETCH = 1.55;

const ONE: [number, number, number] = [1, 1, 1];
const scaleOf = (name: string) => S[name] ?? ONE;

function isBone(o: THREE.Object3D) {
  return (o as THREE.Bone).isBone === true;
}

interface RigInfo {
  hipsLift: number;
  rest: Map<string, THREE.Vector3>;
  parent: Map<string, string>;
}

/** Applies the new joint offsets to a skeleton (in place) and returns rig info. */
function reposeRig(root: THREE.Object3D, anyNode = false): RigInfo {
  // the animation libraries carry the rig without a skin, so their joints load as plain nodes
  const joint = (o: THREE.Object3D) => (anyNode ? o !== root && o.parent !== root : isBone(o));
  const rest = new Map<string, THREE.Vector3>();
  const parent = new Map<string, string>();
  const bones: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (!joint(o)) return;
    bones.push(o);
    rest.set(o.name, o.position.clone());
    if (o.parent && joint(o.parent)) parent.set(o.name, o.parent.name);
  });
  const hips = bones.find((b) => b.name === 'hips');
  const foot = bones.find((b) => b.name === 'footl');
  root.updateMatrixWorld(true);
  const oldAnkle = foot ? foot.getWorldPosition(new THREE.Vector3()).y : 0;
  for (const b of bones) {
    const p = parent.get(b.name);
    if (!p) continue;
    const s = scaleOf(p);
    b.position.set(b.position.x * s[0], b.position.y * s[1], b.position.z * s[2]);
  }
  let hipsLift = 0;
  if (hips && foot) {
    root.updateMatrixWorld(true);
    hipsLift = oldAnkle - foot.getWorldPosition(new THREE.Vector3()).y;
    hips.position.y += hipsLift;
  }
  root.updateMatrixWorld(true);
  return { hipsLift, rest, parent };
}

const bakedScenes = new WeakSet<THREE.Object3D>();

/** Re-proportion a loaded character scene (meshes, skeleton, rigid attachments). */
export function reproportionCharacter(scene: THREE.Object3D) {
  if (bakedScenes.has(scene)) return;
  bakedScenes.add(scene);
  scene.updateMatrixWorld(true);
  const skinned: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  // Rigid attachments (hats, helmets, capes, weapons) parented to bones.
  const rigid: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!isBone(o) && o.parent && isBone(o.parent)) rigid.push(o);
  });

  reposeRig(scene);

  for (const o of rigid) {
    const s = scaleOf(o.parent!.name);
    o.position.set(o.position.x * s[0], o.position.y * s[1], o.position.z * s[2]);
    // hats/helmets shrink with the head; hand-held items keep their size
    if (o.parent!.name === 'head') o.scale.multiplyScalar(s[0]);
    if (/cape|cloak/i.test(o.name)) o.scale.y *= CAPE_STRETCH;
  }
  scene.updateMatrixWorld(true);

  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const acc = new THREE.Vector3();
  const accN = new THREE.Vector3();
  const l = new THREE.Vector3();
  const ln = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();
  const nrm = new THREE.Matrix3();
  // Skeletons may be shared between the meshes of one character: remember the
  // original inverse bind matrices before any of them is rewritten.
  const origInv = new Map<THREE.Skeleton, THREE.Matrix4[]>();
  for (const mesh of skinned) {
    if (!origInv.has(mesh.skeleton)) origInv.set(mesh.skeleton, mesh.skeleton.boneInverses.map((m) => m.clone()));
  }
  for (const mesh of skinned) {
    const sk = mesh.skeleton;
    const geo = mesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nor = geo.attributes.normal as THREE.BufferAttribute | undefined;
    const si = geo.attributes.skinIndex as THREE.BufferAttribute;
    const sw = geo.attributes.skinWeight as THREE.BufferAttribute;
    const bind = mesh.bindMatrix;
    const bindInv = mesh.bindMatrixInverse;
    const oldInv = origInv.get(sk)!;
    const newWorld = sk.bones.map((b) => b.matrixWorld.clone());
    const scales = sk.bones.map((b) => scaleOf(b.name));
    // normal matrices: rotate(newWorld) * S^-1 * rotate(oldInv)
    const oldInvN = oldInv.map((m) => new THREE.Matrix3().setFromMatrix4(m));
    const newWorldN = newWorld.map((m) => new THREE.Matrix3().setFromMatrix4(m));
    const outPos = new Float32Array(pos.count * 3);
    const outNor = nor ? new Float32Array(nor.count * 3) : null;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(bind);
      if (nor) n.fromBufferAttribute(nor, i).applyMatrix3(nrm.setFromMatrix4(bind));
      acc.set(0, 0, 0);
      accN.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w <= 0) continue;
        const bi = si.getComponent(i, k);
        const s = scales[bi];
        l.copy(v).applyMatrix4(oldInv[bi]);
        l.set(l.x * s[0], l.y * s[1], l.z * s[2]);
        l.applyMatrix4(newWorld[bi]);
        acc.addScaledVector(l, w);
        if (nor) {
          ln.copy(n).applyMatrix3(oldInvN[bi]);
          ln.set(ln.x / s[0], ln.y / s[1], ln.z / s[2]);
          ln.applyMatrix3(newWorldN[bi]);
          accN.addScaledVector(ln.normalize(), w);
        }
      }
      acc.applyMatrix4(bindInv);
      outPos[i * 3] = acc.x;
      outPos[i * 3 + 1] = acc.y;
      outPos[i * 3 + 2] = acc.z;
      if (outNor) {
        accN.applyMatrix3(nrm.setFromMatrix4(tmpM.copy(bindInv))).normalize();
        outNor[i * 3] = accN.x;
        outNor[i * 3 + 1] = accN.y;
        outNor[i * 3 + 2] = accN.z;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
    if (outNor) geo.setAttribute('normal', new THREE.BufferAttribute(outNor, 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    sk.boneInverses = newWorld.map((m) => m.clone().invert());
    sk.pose();
  }
}

/** Rescale translation tracks of the shared clips to match the re-proportioned rig. */
export function reproportionClips(rigScene: THREE.Object3D, clips: THREE.AnimationClip[]) {
  const info = reposeRig(rigScene, true);
  const hipsRest = info.rest.get('hips') ?? new THREE.Vector3();
  for (const clip of clips) {
    clip.tracks = clip.tracks.filter((t) => !t.name.endsWith('.scale'));
    for (const t of clip.tracks) {
      if (!t.name.endsWith('.position')) continue;
      const bone = t.name.slice(0, t.name.lastIndexOf('.'));
      // deduplicated accessors share one array between clips: never scale in place
      const vals = (t.values = t.values.slice());
      if (bone === 'hips') {
        for (let i = 0; i < vals.length; i += 3) {
          vals[i] = hipsRest.x + (vals[i] - hipsRest.x) * HIPS_DELTA.x;
          vals[i + 1] = hipsRest.y + info.hipsLift + (vals[i + 1] - hipsRest.y) * HIPS_DELTA.y;
          vals[i + 2] = hipsRest.z + (vals[i + 2] - hipsRest.z) * HIPS_DELTA.z;
        }
        continue;
      }
      const p = info.parent.get(bone);
      if (!p) continue;
      const s = scaleOf(p);
      for (let i = 0; i < vals.length; i += 3) {
        vals[i] *= s[0];
        vals[i + 1] *= s[1];
        vals[i + 2] *= s[2];
      }
    }
  }
  return info;
}
