import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PngTexturePlugin } from './PngTexture';
import { reproportionCharacter, reproportionClips } from './Proportions';

export type CharacterKey =
  | 'mage'
  | 'knight'
  | 'barbarian'
  | 'rogue'
  | 'rogue_hooded'
  | 'skeleton_minion'
  | 'skeleton_warrior'
  | 'skeleton_rogue'
  | 'skeleton_mage';

const CHARACTERS: CharacterKey[] = [
  'mage',
  'knight',
  'barbarian',
  'rogue',
  'rogue_hooded',
  'skeleton_minion',
  'skeleton_warrior',
  'skeleton_rogue',
  'skeleton_mage',
];

/**
 * Fetch a .glb; hosts that refuse binary model types can serve the same bytes as
 * base64 text next to it (`model.glb.txt`), which is used as a fallback.
 */
async function fetchGlb(url: string): Promise<ArrayBuffer> {
  try {
    const r = await fetch(url);
    if (r.ok) {
      const buf = await r.arrayBuffer();
      const magic = new Uint8Array(buf, 0, 4);
      if (magic[0] === 0x67 && magic[1] === 0x6c && magic[2] === 0x54 && magic[3] === 0x46) return buf;
    }
  } catch {
    /* fall through to the text copy */
  }
  const r = await fetch(url + '.txt');
  if (!r.ok) throw new Error(`asset missing: ${url}`);
  const bin = atob((await r.text()).trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export class Assets {
  private chars = new Map<CharacterKey, GLTF>();
  private envRoot = new THREE.Object3D();
  private mergedCache = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material }>();
  clips = { adventurer: [] as THREE.AnimationClip[], skeleton: [] as THREE.AnimationClip[] };

  async load(base: string, onProgress: (p: number) => void) {
    const manager = new THREE.LoadingManager();
    const loader = new GLTFLoader(manager);
    loader.register((parser) => new PngTexturePlugin(parser));
    const files = [
      ...CHARACTERS.map((c) => `characters/${c}.glb`),
      'characters/anims_adventurer.glb',
      'characters/anims_skeleton.glb',
      'env.glb',
    ];
    let done = 0;
    const results = await Promise.all(
      files.map(async (f) => {
        const g = await loader.parseAsync(await fetchGlb(base + f), '');
        done++;
        onProgress(done / files.length);
        return g;
      }),
    );
    CHARACTERS.forEach((c, i) => {
      const g = results[i];
      this.prepareMaterials(g.scene);
      reproportionCharacter(g.scene);
      this.chars.set(c, g);
    });
    this.clips.adventurer = results[CHARACTERS.length].animations;
    this.clips.skeleton = results[CHARACTERS.length + 1].animations;
    reproportionClips(results[CHARACTERS.length].scene, this.clips.adventurer);
    reproportionClips(results[CHARACTERS.length + 1].scene, this.clips.skeleton);
    const env = results[CHARACTERS.length + 2];
    this.prepareMaterials(env.scene);
    this.envRoot = env.scene;
  }

  private prepareMaterials(root: THREE.Object3D) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial;
        if (sm.isMeshStandardMaterial) {
          sm.roughness = 0.85;
          sm.metalness = 0;
          if (sm.map) {
            sm.map.colorSpace = THREE.SRGBColorSpace;
            sm.map.anisotropy = 4;
          }
        }
      }
    });
  }

  character(key: CharacterKey): THREE.Object3D {
    const g = this.chars.get(key);
    if (!g) throw new Error('missing character ' + key);
    const obj = SkeletonUtils.clone(g.scene);
    obj.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.frustumCulled = false;
        // Each character gets its own material so it can be tinted (burn/freeze/hit flash).
        m.material = (m.material as THREE.Material).clone();
      }
    });
    return obj;
  }

  hasEnv(name: string) {
    return !!this.envRoot.getObjectByName(name);
  }

  /** Clone of a named environment model (shares geometry/material). */
  env(name: string): THREE.Object3D {
    const src = this.envRoot.children.find((c) => c.name === name);
    if (!src) throw new Error('missing env model ' + name);
    const obj = src.clone(true);
    obj.position.set(0, 0, 0);
    return obj;
  }

  /** A single merged geometry (in model space) for instancing. */
  merged(name: string) {
    let m = this.mergedCache.get(name);
    if (m) return m;
    const src = this.envRoot.children.find((c) => c.name === name);
    if (!src) throw new Error('missing env model ' + name);
    src.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
    const geos: THREE.BufferGeometry[] = [];
    let material: THREE.Material | null = null;
    src.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
      for (const key of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
      }
      geos.push(g.index ? g : g);
      material ??= mesh.material as THREE.Material;
    });
    const geometry = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
    m = { geometry, material: material! };
    this.mergedCache.set(name, m);
    return m;
  }
}

export const assets = new Assets();
