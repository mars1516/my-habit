import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ctx } from '../core/ctx';
import { assets } from '../core/Assets';
import { physics, RAPIER, G } from '../core/Physics';
import { hash2, clamp, mulberry32 } from '../core/math';
import { HALF, biomeAt, roadDistance, isFlattened, waterLevelAt, fbm, P } from './WorldGen';
import { events } from '../core/Events';
import { ChunkedInstances } from '../core/Culler';

export type TreeType = 'pine' | 'pine2' | 'oak' | 'bush' | 'drybush';

export interface Tree {
  id: number;
  type: TreeType;
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  state: 0 | 1 | 2; // normal, burning, burnt
  burn: number;
  /** How many tree-to-tree hops this fire has made (spread stops after a couple). */
  fireGen?: number;
  apples: number;
  idx: number; // handle within its type's chunked instances
  collider?: RAPIER.Collider;
  shake: number;
}

function sway(mat: THREE.Material, amount: number, uniforms: { uTime: { value: number } }) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x*0.21 + instanceMatrix[3].z*0.17;
        #else
        float ph = 0.0;
        #endif
        float hy = max(position.y, 0.0);
        transformed.x += sin(uTime*1.4 + ph) * ${amount.toFixed(4)} * hy * hy;
        transformed.z += cos(uTime*1.1 + ph*1.3) * ${(amount * 0.6).toFixed(4)} * hy * hy;`,
      );
  };
  mat.customProgramCacheKey = () => 'sway' + amount;
}

function oakGeometry(rng: () => number, canopy: string, trunkCol = '#7a5234') {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.4, 3.4, 7, 1).translate(0, 1.7, 0).toNonIndexed();
  paint(trunk, new THREE.Color(trunkCol), 0.08, rng);
  parts.push(trunk);
  const base = new THREE.Color(canopy);
  const blobs: [number, number, number, number][] = [
    [0, 4.3, 0, 1.9],
    [0.9, 3.8, 0.4, 1.4],
    [-0.8, 3.9, -0.3, 1.5],
    [0.2, 5.0, -0.6, 1.3],
    [-0.3, 3.6, 0.9, 1.2],
  ];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      v.multiplyScalar(0.85 + rng() * 0.3);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.translate(x, y, z);
    const ng = g.toNonIndexed();
    paint(ng, base, 0.12, rng);
    parts.push(ng);
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  return geo;
}

function bushGeometry(rng: () => number, color: string) {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.Color(color);
  for (let i = 0; i < 4; i++) {
    const r = 0.45 + rng() * 0.35;
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.translate((rng() - 0.5) * 0.9, r * 0.8, (rng() - 0.5) * 0.9);
    const ng = g.toNonIndexed();
    paint(ng, base, 0.15, rng);
    parts.push(ng);
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  return geo;
}

/** Per-face vertex colors with a little variation (flat-shaded look). */
function paint(g: THREE.BufferGeometry, c: THREE.Color, vary: number, rng: () => number) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let f = 0; f < n; f += 3) {
    const k = 1 - vary + rng() * vary * 2;
    for (let j = 0; j < 3; j++) {
      col[(f + j) * 3] = c.r * k;
      col[(f + j) * 3 + 1] = c.g * k;
      col[(f + j) * 3 + 2] = c.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
}

const TMP_M = new THREE.Matrix4();
const TMP_Q = new THREE.Quaternion();
const TMP_S = new THREE.Vector3();
const TMP_P = new THREE.Vector3();
const WHITE = new THREE.Color('#ffffff');
const BURN = new THREE.Color('#5a2a14');
const CHAR = new THREE.Color('#1d1a18');

export class Vegetation {
  trees: Tree[] = [];
  meshes = new Map<TreeType, ChunkedInstances>();
  stumps!: THREE.InstancedMesh;
  apples!: THREE.InstancedMesh;
  flowers: ChunkedInstances[] = [];
  rocks: ChunkedInstances[] = [];
  private stumpCount = 0;
  private grid = new Map<number, number[]>();
  private burningSet = new Set<Tree>();
  private uniforms = { uTime: { value: 0 } };
  private appleSlots: { tree: Tree; slot: number; local: THREE.Vector3 }[] = [];
  group = new THREE.Group();

  generate() {
    const rng = mulberry32(777);
    const pending: Omit<Tree, 'id' | 'idx'>[] = [];
    const cell = 7;
    for (let gz = -HALF + 4; gz < HALF - 4; gz += cell) {
      for (let gx = -HALF + 4; gx < HALF - 4; gx += cell) {
        const ix = Math.round(gx / cell), iz = Math.round(gz / cell);
        const r0 = hash2(ix, iz, 1);
        const x = gx + (hash2(ix, iz, 2) - 0.5) * cell * 0.9;
        const z = gz + (hash2(ix, iz, 3) - 0.5) * cell * 0.9;
        const h = ctx.terrain.heightAt(x, z);
        const wl = waterLevelAt(x, z);
        if (h < wl + 1.2) continue;
        const n = ctx.terrain.normalAt(x, z);
        if (n.y < 0.8) continue;
        if (isFlattened(x, z, 6)) continue;
        if (roadDistance(x, z) < 4.5) continue;
        const b = biomeAt(x, z, h);
        if (h > 125) continue;
        let density = 0.05 + b.forest * 0.75 + b.frost * 0.2 + b.mountain * 0.18;
        density *= 0.6 + 0.8 * clamp(fbm(x * 0.008, z * 0.008, 2) + 0.5, 0, 1);
        if (Math.hypot(x - P.plateau.x, z - P.plateau.z) < 100) density = 0.1;
        const r1 = hash2(ix, iz, 4);
        if (r0 < density) {
          let type: TreeType;
          if (b.frost > 0.5 || b.mountain > 0.4) type = r1 < 0.6 ? 'pine' : 'pine2';
          else if (b.forest > 0.5) type = r1 < 0.45 ? 'oak' : r1 < 0.8 ? 'pine2' : 'pine';
          else type = r1 < 0.65 ? 'oak' : 'pine2';
          const scale = type === 'oak' ? 0.95 + hash2(ix, iz, 5) * 0.45 : 5.5 + hash2(ix, iz, 5) * 3;
          const apples = type === 'oak' && hash2(ix, iz, 6) < 0.35 ? 3 : 0;
          pending.push({ type, x, y: h, z, scale, rot: hash2(ix, iz, 7) * Math.PI * 2, state: 0, burn: 0, apples, shake: 0 });
        } else if (r0 < density + 0.1 + b.forest * 0.12) {
          // bushes fill the gaps
          const bx = x + 2, bz = z - 1.5;
          const bh = ctx.terrain.heightAt(bx, bz);
          if (bh > waterLevelAt(bx, bz) + 1) {
            pending.push({ type: 'bush', x: bx, y: bh, z: bz, scale: 0.8 + r1 * 0.7, rot: r1 * 6.28, state: 0, burn: 0, apples: 0, shake: 0 });
          }
        }
      }
    }
    // Farmer's dry bushes near the village fields
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 1.2 + 2.4;
      const x = P.village.x + 58 + Math.cos(a) * 12;
      const z = P.village.z + 30 + Math.sin(a) * 12;
      pending.push({ type: 'drybush', x, y: ctx.terrain.heightAt(x, z), z, scale: 1.1, rot: a, state: 0, burn: 0, apples: 0, shake: 0 });
    }

    const counts: Record<TreeType, number> = { pine: 0, pine2: 0, oak: 0, bush: 0, drybush: 0 };
    for (const t of pending) counts[t.type]++;

    const pineA = assets.merged('tree_a');
    const pineB = assets.merged('tree_b');
    const pineMatA = (pineA.material as THREE.MeshStandardMaterial).clone();
    const pineMatB = pineMatA;
    sway(pineMatA, 0.03, this.uniforms);
    const oakMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    sway(oakMat, 0.006, this.uniforms);
    const bushMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

    const make = (type: TreeType, geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const small = type === 'bush' || type === 'drybush';
      const ci = new ChunkedInstances(geo, mat, { chunk: 96, castShadow: !small, colors: true, viewDist: small ? 260 : 700 });
      this.meshes.set(type, ci);
      this.group.add(ci.group);
    };
    make('pine', pineA.geometry, pineMatA);
    make('pine2', pineB.geometry, pineMatB);
    make('oak', oakGeometry(rng, '#5c9e3a'), oakMat);
    make('bush', bushGeometry(rng, '#4e8f36'), bushMat);
    make('drybush', bushGeometry(rng, '#a58a4a'), bushMat);
    void counts;

    const stump = assets.merged('tree_a_cut');
    this.stumps = new THREE.InstancedMesh(stump.geometry, (stump.material as THREE.Material).clone(), 400);
    this.stumps.count = 0;
    this.stumps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(400 * 3).fill(0.25), 3);
    this.group.add(this.stumps);

    const appleCount = pending.reduce((s, t) => s + t.apples, 0);
    this.apples = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.16, 1),
      new THREE.MeshLambertMaterial({ color: '#e0302a', emissive: '#400000' }),
      Math.max(1, appleCount),
    );
    this.apples.count = 0;
    this.group.add(this.apples);

    for (const t of pending) {
      const tree: Tree = { ...t, id: this.trees.length, idx: -1 };
      tree.idx = this.meshes.get(t.type)!.add(this.matrixOf(tree));
      this.trees.push(tree);
      const key = this.key(t.x, t.z);
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(tree.id);
      if (t.type !== 'bush' && t.type !== 'drybush') {
        const r = t.type === 'oak' ? 0.38 * t.scale : 0.05 * t.scale;
        const desc = RAPIER.ColliderDesc.cylinder(2, r).setTranslation(t.x, t.y + 1.8, t.z);
        tree.collider = physics.fixedCollider(desc, new THREE.Vector3(t.x, t.y + 1.8, t.z), undefined, G.STATIC);
        physics.setOwner(tree.collider, { kind: 'tree', tree: tree.id, climbable: true });
      }
      for (let a = 0; a < t.apples; a++) {
        const ang = (a / 3) * Math.PI * 2 + t.rot;
        const local = new THREE.Vector3(Math.cos(ang) * 1.6, 3.6 + (a % 2) * 0.7, Math.sin(ang) * 1.6).multiplyScalar(t.scale);
        this.appleSlots.push({ tree, slot: a, local });
      }
    }
    for (const ci of this.meshes.values()) ci.build();
    this.apples.count = this.appleSlots.length;
    this.appleSlots.forEach((s, i) => this.writeApple(i));
    this.apples.computeBoundingSphere();
    this.buildFlowers(rng);
    this.buildRocks();
  }

  private matrixOf(t: Tree) {
    const s = t.state === 2 ? 0 : t.scale;
    TMP_Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
    if (t.shake > 0) TMP_Q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t.shake * 40) * 0.04 * t.shake, 0, Math.cos(t.shake * 33) * 0.04 * t.shake)));
    return TMP_M.compose(TMP_P.set(t.x, t.y - 0.1, t.z), TMP_Q, TMP_S.setScalar(s));
  }

  private writeMatrix(t: Tree) {
    this.meshes.get(t.type)!.setMatrix(t.idx, this.matrixOf(t));
  }

  private writeApple(i: number) {
    const s = this.appleSlots[i];
    const visible = s.slot < s.tree.apples && s.tree.state === 0;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
    TMP_P.set(s.tree.x + s.local.x, s.tree.y + s.local.y, s.tree.z + s.local.z);
    TMP_M.compose(TMP_P, q, TMP_S.setScalar(visible ? 1 : 0));
    this.apples.setMatrixAt(i, TMP_M);
    this.apples.instanceMatrix.needsUpdate = true;
  }

  private buildFlowers(rng: () => number) {
    const colors = ['#ffffff', '#ffd84a', '#ff8fc8', '#b79bff', '#7fc8ff', '#ff6a5a'];
    const head = new THREE.OctahedronGeometry(0.11, 0).translate(0, 0.32, 0);
    const stem = new THREE.CylinderGeometry(0.012, 0.012, 0.32, 3, 1, true).translate(0, 0.16, 0);
    const headMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#222222' });
    const stemMat = new THREE.MeshLambertMaterial({ color: '#4c8a2e' });
    const heads = new ChunkedInstances(head, headMat, { chunk: 64, colors: true, viewDist: 130, receiveShadow: false });
    const stems = new ChunkedInstances(stem, stemMat, { chunk: 64, viewDist: 90, receiveShadow: false });
    const max = 11000;
    let n = 0;
    const c = new THREE.Color();
    for (let tries = 0; tries < 100000 && n < max; tries++) {
      const x = (rng() - 0.5) * 900, z = (rng() - 0.5) * 900;
      const patch = fbm(x * 0.012 + 70, z * 0.012, 2);
      if (patch < 0.25) continue;
      const i = ctx.terrain.cellIndex(x, z);
      if (i < 0 || ctx.terrain.grass[i] < 120) continue;
      const y = ctx.terrain.heightAt(x, z);
      const s = 0.8 + rng() * 0.7;
      TMP_M.compose(TMP_P.set(x, y, z), TMP_Q.identity(), TMP_S.setScalar(s));
      const ci = Math.floor((fbm(x * 0.05, z * 0.05, 1) * 0.5 + 0.5) * colors.length * 1.5 + rng() * 1.2) % colors.length;
      heads.add(TMP_M, c.set(colors[ci]));
      stems.add(TMP_M);
      n++;
    }
    heads.build();
    stems.build();
    this.flowers.push(heads, stems);
    this.group.add(heads.group, stems.group);
  }

  private buildRocks() {
    const kinds = ['rock_a', 'rock_b', 'rock_c', 'rock_d', 'rock_e'];
    const placed: Record<string, THREE.Matrix4[]> = {};
    for (const k of kinds) placed[k] = [];
    const cell = 13;
    for (let gz = -HALF + 6; gz < HALF - 6; gz += cell) {
      for (let gx = -HALF + 6; gx < HALF - 6; gx += cell) {
        const ix = Math.round(gx / cell), iz = Math.round(gz / cell);
        const x = gx + (hash2(ix, iz, 11) - 0.5) * cell;
        const z = gz + (hash2(ix, iz, 12) - 0.5) * cell;
        const h = ctx.terrain.heightAt(x, z);
        const b = biomeAt(x, z, h);
        const n = ctx.terrain.normalAt(x, z);
        const density = 0.05 + b.mountain * 0.35 + (1 - n.y) * 0.8 + b.frost * 0.08;
        if (hash2(ix, iz, 13) > density) continue;
        if (isFlattened(x, z, 4) || roadDistance(x, z) < 4) continue;
        if (h < waterLevelAt(x, z) - 3) continue;
        const kind = kinds[Math.floor(hash2(ix, iz, 14) * kinds.length)];
        const s = 5 + hash2(ix, iz, 15) * 9;
        const rot = hash2(ix, iz, 16) * Math.PI * 2;
        TMP_Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.3, z), TMP_Q.clone(), new THREE.Vector3(s, s * 1.4, s));
        placed[kind].push(m);
        // collider from the model bounds
        const geo = assets.merged(kind).geometry;
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        const size = bb.getSize(new THREE.Vector3());
        const center = bb.getCenter(new THREE.Vector3());
        const hx = (size.x * s) / 2, hy = (size.y * s * 1.4) / 2, hz = (size.z * s) / 2;
        if (hy > 0.25) {
          const cpos = new THREE.Vector3(center.x * s, center.y * s * 1.4, center.z * s).applyQuaternion(TMP_Q).add(new THREE.Vector3(x, h - 0.3, z));
          const col = physics.fixedCollider(RAPIER.ColliderDesc.cuboid(hx * 0.9, hy, hz * 0.9), cpos, TMP_Q.clone(), G.STATIC);
          physics.setOwner(col, { kind: 'rock', climbable: true });
        }
      }
    }
    for (const k of kinds) {
      const src = assets.merged(k);
      const ci = new ChunkedInstances(src.geometry, src.material, { chunk: 128, castShadow: true, viewDist: 700 });
      for (const m of placed[k]) ci.add(m);
      ci.build();
      this.rocks.push(ci);
      this.group.add(ci.group);
    }
  }

  private key(x: number, z: number) {
    return Math.floor((x + HALF) / 16) * 1000 + Math.floor((z + HALF) / 16);
  }

  near(x: number, z: number, r: number, out: Tree[] = []) {
    const x0 = Math.floor((x - r + HALF) / 16), x1 = Math.floor((x + r + HALF) / 16);
    const z0 = Math.floor((z - r + HALF) / 16), z1 = Math.floor((z + r + HALF) / 16);
    for (let gx = x0; gx <= x1; gx++)
      for (let gz = z0; gz <= z1; gz++) {
        const list = this.grid.get(gx * 1000 + gz);
        if (!list) continue;
        for (const id of list) {
          const t = this.trees[id];
          if (Math.hypot(t.x - x, t.z - z) < r + (t.type === 'oak' ? 1.5 : 0.8)) out.push(t);
        }
      }
    return out;
  }

  ignite(t: Tree, gen = 0) {
    if (t.state !== 0) return;
    t.state = 1;
    t.fireGen = gen;
    t.burn = t.type === 'bush' || t.type === 'drybush' ? 4 : 11;
    this.burningSet.add(t);
    this.meshes.get(t.type)!.setColor(t.idx, BURN);
    if (t.apples > 0) this.dropApples(t, true);
  }

  igniteNear(pos: THREE.Vector3, r: number, gen = 0) {
    for (const t of this.near(pos.x, pos.z, r)) if (Math.abs(t.y - pos.y) < 6) this.ignite(t, gen);
  }

  extinguishNear(pos: THREE.Vector3, r: number) {
    for (const t of this.near(pos.x, pos.z, r)) {
      if (t.state === 1) {
        t.state = 0;
        this.burningSet.delete(t);
        this.meshes.get(t.type)!.setColor(t.idx, WHITE);
      }
    }
  }

  /** Shake a tree (wind, impacts); drops apples. */
  shake(t: Tree, strength = 1) {
    t.shake = Math.max(t.shake, 0.6 * strength);
    if (t.apples > 0) this.dropApples(t, false);
  }

  private dropApples(t: Tree, roasted: boolean) {
    this.appleSlots.forEach((s, i) => {
      if (s.tree === t && s.slot < t.apples) {
        const p = new THREE.Vector3(t.x + s.local.x, t.y + s.local.y, t.z + s.local.z);
        ctx.interact.spawnPickup(roasted ? 'roasted_apple' : 'apple', p, true);
      }
    });
    t.apples = 0;
    this.appleSlots.forEach((s, i) => {
      if (s.tree === t) this.writeApple(i);
    });
    events.emit('sound', { name: 'rustle', pos: new THREE.Vector3(t.x, t.y, t.z), volume: 0.4 });
  }

  update(dt: number) {
    this.uniforms.uTime.value += dt;
    for (const t of this.burningSet) {
      t.burn -= dt;
      const top = t.type === 'oak' ? 4 * t.scale : t.type === 'bush' || t.type === 'drybush' ? 0.8 * t.scale : 0.7 * t.scale;
      const pos = TMP_P.set(t.x, t.y + top * (0.4 + Math.random() * 0.6), t.z);
      if (Math.random() < 0.9)
        ctx.particles.emit({ pos, posSpread: t.type === 'oak' ? 1.8 : 1.0, vel: new THREE.Vector3(0, 3, 0), spread: 1, life: [0.5, 1.0], size: [1.4, 0.2], color: '#ffc050', color2: '#ff3000', count: 2 });
      if (Math.random() < 0.15)
        ctx.particles.emit({ pos, posSpread: 1, vel: new THREE.Vector3(0, 3, 0), spread: 0.8, life: [1.5, 2.5], size: [1.5, 3.5], alpha: [0.35, 0], color: '#3a3430', additive: false, drag: 0.8 });
      if (Math.random() < dt * 1.2) ctx.fire.igniteCircle(t.x, t.z, 3, 1.2);
      if ((t.fireGen ?? 0) < 2 && Math.random() < dt * 0.25) {
        for (const o of this.near(t.x, t.z, 4.5)) if (o !== t && !ctx.weather?.raining && Math.random() < 0.5) this.ignite(o, (t.fireGen ?? 0) + 1);
      }
      if (Math.random() < dt * 2) ctx.lights.flash(new THREE.Vector3(t.x, t.y + top * 0.6, t.z), '#ff8a30', 30, 18, 0.6);
      if (ctx.weather?.raining) t.burn -= dt * 2;
      if (t.burn <= 0) this.finishBurn(t);
    }
    for (const t of this.trees) {
      if (t.shake > 0) {
        t.shake = Math.max(0, t.shake - dt * 1.5);
        this.writeMatrix(t);
      }
    }
  }

  private finishBurn(t: Tree) {
    this.burningSet.delete(t);
    t.state = 2;
    this.writeMatrix(t);
    events.emit('objectBurned', { kind: t.type, pos: new THREE.Vector3(t.x, t.y, t.z) });
    if (t.type !== 'bush' && t.type !== 'drybush' && this.stumpCount < this.stumps.instanceMatrix.count) {
      TMP_M.compose(TMP_P.set(t.x, t.y - 0.1, t.z), TMP_Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot), TMP_S.setScalar(t.type === 'oak' ? 7 * t.scale : t.scale));
      this.stumps.setMatrixAt(this.stumpCount, TMP_M);
      this.stumps.setColorAt(this.stumpCount, CHAR);
      this.stumpCount++;
      this.stumps.count = this.stumpCount;
      this.stumps.instanceMatrix.needsUpdate = true;
      this.stumps.instanceColor!.needsUpdate = true;
      this.stumps.computeBoundingSphere();
      // charcoal drop
      if (Math.random() < 0.5) ctx.interact.spawnPickup('charcoal', new THREE.Vector3(t.x + 1, t.y + 1, t.z), true);
    } else if (t.collider) {
      physics.removeCollider(t.collider);
      t.collider = undefined;
    }
    ctx.particles.emit({ pos: new THREE.Vector3(t.x, t.y + 2, t.z), count: 12, posSpread: 1.5, vel: new THREE.Vector3(0, 2, 0), spread: 1.5, life: [1.5, 3], size: [2, 4], alpha: [0.4, 0], color: '#2a2624', additive: false });
  }

  get burningCount() {
    return this.burningSet.size;
  }
}
