import * as THREE from 'three';

interface Item {
  obj: THREE.Object3D;
  dist2: number;
  pos: THREE.Vector3;
}

/** Hides objects beyond a per-object distance from the camera (cheap distance LOD). */
export class Culler {
  private items: Item[] = [];
  private t = 0;

  add(obj: THREE.Object3D, dist: number, pos?: THREE.Vector3) {
    this.items.push({ obj, dist2: dist * dist, pos: pos ?? obj.position });
    return obj;
  }

  remove(obj: THREE.Object3D) {
    this.items = this.items.filter((i) => i.obj !== obj);
  }

  update(dt: number, cam: THREE.Vector3, force = false) {
    this.t -= dt;
    if (this.t > 0 && !force) return;
    this.t = 0.25;
    for (const it of this.items) {
      const dx = it.pos.x - cam.x, dz = it.pos.z - cam.z;
      const v = dx * dx + dz * dz < it.dist2;
      if (it.obj.visible !== v && !it.obj.userData.hiddenByGame) it.obj.visible = v;
    }
  }
}

export const culler = new Culler();

/** Register every scene child added since `from` for distance culling, scaled by its size. */
export function autoCull(scene: THREE.Scene, from: number) {
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();
  for (let i = from; i < scene.children.length; i++) {
    const o = scene.children[i];
    if (o.userData.isCharacter || o.userData.noCull) continue;
    if ((o as THREE.Light).isLight) continue;
    box.setFromObject(o);
    if (box.isEmpty()) continue;
    box.getBoundingSphere(sphere);
    const dist = Math.min(1600, 110 + sphere.radius * 28);
    culler.add(o, dist);
  }
}

/** Instanced meshes split into spatial chunks so frustum/shadow culling and distance culling work. */
export class ChunkedInstances {
  private pending: { m: THREE.Matrix4; c?: THREE.Color }[] = [];
  meshes = new Map<number, THREE.InstancedMesh>();
  private handles: { key: number; index: number }[] = [];
  group = new THREE.Group();

  constructor(
    private geometry: THREE.BufferGeometry,
    private material: THREE.Material,
    private opts: { chunk?: number; castShadow?: boolean; receiveShadow?: boolean; colors?: boolean; viewDist?: number } = {},
  ) {}

  private keyOf(x: number, z: number) {
    const c = this.opts.chunk ?? 96;
    return Math.floor((x + 2048) / c) * 1000 + Math.floor((z + 2048) / c);
  }

  /** Returns a handle id valid after build(). */
  add(m: THREE.Matrix4, c?: THREE.Color) {
    this.pending.push({ m: m.clone(), c: c?.clone() });
    return this.pending.length - 1;
  }

  build() {
    const buckets = new Map<number, number[]>();
    this.pending.forEach((p, i) => {
      const e = p.m.elements;
      const key = this.keyOf(e[12], e[14]);
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(i);
    });
    this.handles = new Array(this.pending.length);
    for (const [key, list] of buckets) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, list.length);
      mesh.castShadow = !!this.opts.castShadow;
      mesh.receiveShadow = this.opts.receiveShadow ?? true;
      if (this.opts.colors) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3).fill(1), 3);
      list.forEach((pi, index) => {
        mesh.setMatrixAt(index, this.pending[pi].m);
        const c = this.pending[pi].c;
        if (c && mesh.instanceColor) mesh.setColorAt(index, c);
        this.handles[pi] = { key, index };
      });
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      this.meshes.set(key, mesh);
      this.group.add(mesh);
      const center = mesh.boundingSphere!.center.clone();
      culler.add(mesh, (this.opts.viewDist ?? 600) + mesh.boundingSphere!.radius, center);
    }
    this.pending = [];
  }

  setMatrix(handle: number, m: THREE.Matrix4) {
    const h = this.handles[handle];
    const mesh = this.meshes.get(h.key)!;
    mesh.setMatrixAt(h.index, m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  setColor(handle: number, c: THREE.Color) {
    const h = this.handles[handle];
    const mesh = this.meshes.get(h.key)!;
    if (!mesh.instanceColor) return;
    mesh.setColorAt(h.index, c);
    mesh.instanceColor.needsUpdate = true;
  }
}
