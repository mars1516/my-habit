import * as THREE from 'three';
import { physics, RAPIER, G, groups, ALL } from '../core/Physics';
import { clamp, lerp, smoothstep } from '../core/math';
import {
  RES,
  CELL,
  HALF,
  WORLD_SIZE,
  computeHeight,
  biomeAt,
  roadDistance,
  isFlattened,
  fbm,
  P,
  SEA_LEVEL,
  waterLevelAt,
} from './WorldGen';

const N = RES + 1;
const CHUNK = 32;

const C = {
  grassLush: new THREE.Color('#5ea53e'),
  grassDry: new THREE.Color('#a4bf4c'),
  grassForest: new THREE.Color('#3f7e35'),
  grassFrost: new THREE.Color('#93b8a0'),
  snow: new THREE.Color('#eef4fb'),
  rock: new THREE.Color('#8d857a'),
  rockDark: new THREE.Color('#6d6760'),
  cliff: new THREE.Color('#9a8a73'),
  sand: new THREE.Color('#e6d49b'),
  sandWet: new THREE.Color('#b9a275'),
  dirt: new THREE.Color('#b8986a'),
  lakeBed: new THREE.Color('#7f8f78'),
  plaza: new THREE.Color('#a6a095'),
};

export class Terrain {
  heights = new Float32Array(N * N);
  colors = new Float32Array(N * N * 3);
  /** Grass density per cell 0..255 */
  grass = new Uint8Array(RES * RES);
  heightTex!: THREE.DataTexture;
  /** R: grass density, G: burnt amount, B: wetness/frost, A: unused. */
  maskData = new Uint8Array(RES * RES * 4);
  maskTex!: THREE.DataTexture;
  colorTex!: THREE.DataTexture;
  group = new THREE.Group();
  material!: THREE.MeshLambertMaterial;
  collider!: RAPIER.Collider;
  private maskDirty = false;

  generate() {
    const h = this.heights;
    for (let iz = 0; iz < N; iz++) {
      const z = -HALF + iz * CELL;
      for (let ix = 0; ix < N; ix++) {
        const x = -HALF + ix * CELL;
        h[iz * N + ix] = computeHeight(x, z);
      }
    }
    this.computeColors();
    this.buildTextures();
    this.buildMesh();
    this.buildCollider();
  }

  // ---- queries -------------------------------------------------------------
  heightAt(x: number, z: number) {
    const fx = clamp((x + HALF) / CELL, 0, RES - 0.0001);
    const fz = clamp((z + HALF) / CELL, 0, RES - 0.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const h = this.heights;
    const a = h[iz * N + ix], b = h[iz * N + ix + 1];
    const c = h[(iz + 1) * N + ix], d = h[(iz + 1) * N + ix + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const e = CELL;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  /** Depth of water at a point (<=0 when dry). */
  waterDepth(x: number, z: number) {
    return waterLevelAt(x, z) - this.heightAt(x, z);
  }

  inBounds(x: number, z: number, margin = 0) {
    return Math.abs(x) < HALF - margin && Math.abs(z) < HALF - margin;
  }

  /** Grass density 0..1 at a world point (0 where burnt or bare). */
  grassAt(x: number, z: number) {
    const i = this.cellIndex(x, z);
    if (i < 0) return 0;
    return this.getBurnt(i) > 40 ? 0 : this.grass[i] / 255;
  }

  cellIndex(x: number, z: number) {
    const ix = Math.floor((x + HALF) / CELL), iz = Math.floor((z + HALF) / CELL);
    if (ix < 0 || iz < 0 || ix >= RES || iz >= RES) return -1;
    return iz * RES + ix;
  }

  cellCenter(i: number, out: THREE.Vector3) {
    const ix = i % RES, iz = Math.floor(i / RES);
    const x = -HALF + (ix + 0.5) * CELL, z = -HALF + (iz + 0.5) * CELL;
    return out.set(x, this.heightAt(x, z), z);
  }

  /** Remove grass (and its fuel) around a structure footprint. */
  clearGrass(x: number, z: number, r: number, keepInside = 0) {
    const cr = Math.ceil(r / CELL) + 1;
    const cx = Math.floor((x + HALF) / CELL), cz = Math.floor((z + HALF) / CELL);
    for (let dz = -cr; dz <= cr; dz++)
      for (let dx = -cr; dx <= cr; dx++) {
        const ix = cx + dx, iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= RES || iz >= RES) continue;
        const d = Math.hypot(dx, dz) * CELL;
        if (d > r + CELL) continue;
        const i = iz * RES + ix;
        const keep = d > r ? 0.5 : keepInside;
        this.grass[i] = Math.round(this.grass[i] * keep);
        this.maskData[i * 4] = this.grass[i];
      }
    this.maskDirty = true;
  }

  setBurnt(i: number, v: number) {
    this.maskData[i * 4 + 1] = v;
    this.maskDirty = true;
  }

  /** Glowing embers under active flames (terrain emissive). */
  setBurning(i: number, v: number) {
    if (this.maskData[i * 4 + 3] === v) return;
    this.maskData[i * 4 + 3] = v;
    this.maskDirty = true;
  }

  getBurnt(i: number) {
    return this.maskData[i * 4 + 1];
  }

  setWet(i: number, v: number) {
    this.maskData[i * 4 + 2] = v;
    this.maskDirty = true;
  }

  flushMask() {
    if (this.maskDirty) {
      this.maskTex.needsUpdate = true;
      this.maskDirty = false;
    }
  }

  // ---- generation ----------------------------------------------------------
  private computeColors() {
    const col = new THREE.Color();
    const tmp = new THREE.Color();
    const n = new THREE.Vector3();
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const x = -HALF + ix * CELL, z = -HALF + iz * CELL;
        const h = this.heights[iz * N + ix];
        this.normalAt(x, z, n);
        const b = biomeAt(x, z, h);
        const var1 = fbm(x * 0.02, z * 0.02, 2);
        const var2 = fbm(x * 0.07 + 40, z * 0.07, 2);

        col.copy(C.grassLush).lerp(C.grassDry, clamp(0.35 + var1 * 0.6, 0, 1));
        col.lerp(C.grassForest, b.forest * 0.85);
        col.lerp(C.grassFrost, b.frost * 0.8);
        // snow patches in the frost lands, full snow on the peak
        const snowy = Math.max(smoothstep(0.15, 0.35, var2 + b.frost * 0.35 - 0.35) * b.frost, smoothstep(105, 135, h + var1 * 12));
        col.lerp(C.snow, snowy);
        // mountains get rocky
        col.lerp(C.rock, b.mountain * 0.35 * (1 - snowy));
        // beaches
        const lakeD = Math.hypot(x - P.lake.x, z - P.lake.z);
        const inLake = lakeD < P.lake.r + 8;
        const wl = waterLevelAt(x, z);
        if (!inLake) {
          const sand = 1 - smoothstep(SEA_LEVEL + 1.8, SEA_LEVEL + 3.6, h);
          col.lerp(C.sand, sand);
          col.lerp(C.sandWet, 1 - smoothstep(SEA_LEVEL - 2, SEA_LEVEL + 0.3, h));
        } else {
          col.lerp(C.lakeBed, 1 - smoothstep(wl - 0.8, wl + 0.6, h));
        }
        // roads & plazas
        const rd = roadDistance(x, z);
        col.lerp(C.dirt, (1 - smoothstep(1.6, 3.6, rd)) * 0.9);
        const vd = Math.hypot(x - P.village.x, z - P.village.z);
        col.lerp(C.dirt, (1 - smoothstep(12, 26, vd)) * 0.7);
        const ad = Math.hypot(x - P.altar.x, z - P.altar.z);
        col.lerp(C.plaza, 1 - smoothstep(26, 32, ad));
        // steep = rock/cliff
        const steep = smoothstep(0.82, 0.62, n.y);
        tmp.copy(C.cliff).lerp(C.rockDark, clamp(0.5 + var2, 0, 1));
        col.lerp(tmp, steep);

        const i = (iz * N + ix) * 3;
        this.colors[i] = col.r;
        this.colors[i + 1] = col.g;
        this.colors[i + 2] = col.b;
      }
    }

    // grass density per cell
    for (let iz = 0; iz < RES; iz++) {
      for (let ix = 0; ix < RES; ix++) {
        const x = -HALF + (ix + 0.5) * CELL, z = -HALF + (iz + 0.5) * CELL;
        const h = this.heightAt(x, z);
        this.normalAt(x, z, n);
        const b = biomeAt(x, z, h);
        let d = 1;
        d *= smoothstep(0.8, 0.9, n.y);
        const wl = waterLevelAt(x, z);
        d *= smoothstep(wl + 0.6, wl + 2.2, h);
        const snow = this.colors[(iz * N + ix) * 3 + 2] > 0.85 && this.colors[(iz * N + ix) * 3] > 0.85;
        if (snow) d *= 0.05;
        d *= smoothstep(2.0, 4.0, roadDistance(x, z));
        d *= 1 - b.mountain * 0.6;
        d *= 1 - b.frost * 0.45;
        d *= 1 - b.forest * 0.35;
        if (Math.hypot(x - P.altar.x, z - P.altar.z) < 34) d = 0;
        if (Math.hypot(x - P.village.x, z - P.village.z) < 22) d *= 0.2;
        if (isFlattened(x, z) && Math.hypot(x - P.village.x, z - P.village.z) > 70) d *= 0.6;
        d *= 0.75 + 0.25 * fbm(x * 0.03, z * 0.03, 2);
        this.grass[iz * RES + ix] = Math.round(clamp(d, 0, 1) * 255);
        this.maskData[(iz * RES + ix) * 4] = this.grass[iz * RES + ix];
      }
    }
  }

  private buildTextures() {
    this.heightTex = new THREE.DataTexture(this.heights, N, N, THREE.RedFormat, THREE.FloatType);
    this.heightTex.magFilter = THREE.NearestFilter;
    this.heightTex.minFilter = THREE.NearestFilter;
    this.heightTex.needsUpdate = true;
    this.maskTex = new THREE.DataTexture(this.maskData, RES, RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.maskTex.magFilter = THREE.LinearFilter;
    this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.needsUpdate = true;
    const cd = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      cd[i * 4] = Math.round(Math.sqrt(this.colors[i * 3]) * 255);
      cd[i * 4 + 1] = Math.round(Math.sqrt(this.colors[i * 3 + 1]) * 255);
      cd[i * 4 + 2] = Math.round(Math.sqrt(this.colors[i * 3 + 2]) * 255);
      cd[i * 4 + 3] = 255;
    }
    this.colorTex = new THREE.DataTexture(cd, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.colorTex.magFilter = THREE.LinearFilter;
    this.colorTex.minFilter = THREE.LinearFilter;
    this.colorTex.needsUpdate = true;
  }

  private buildMesh() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const uniforms = {
      uMask: { value: this.maskTex },
      uWorld: { value: WORLD_SIZE },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWPos;
          varying vec3 vWNormal;
          uniform sampler2D uMask;
          uniform float uWorld;
          float th(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float tnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.-2.*f);
            return mix(mix(th(i),th(i+vec2(1,0)),f.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x), f.y); }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec2 muv = (vWPos.xz + uWorld*0.5) / uWorld;
          vec4 mask = texture2D(uMask, muv);
          float n = tnoise(vWPos.xz*0.7)*0.5 + tnoise(vWPos.xz*0.13)*0.5;
          diffuseColor.rgb *= 0.9 + n*0.2;
          // cliffs: layered rock strata with darker seams, painted rather than noisy
          float steep = 1.0 - smoothstep(0.55, 0.82, normalize(vWNormal).y);
          float warp = tnoise(vWPos.xz * 0.08) * 3.0 + tnoise(vWPos.xz * 0.31) * 0.6;
          float layer = fract(vWPos.y * 0.45 + warp);
          float seam = smoothstep(0.0, 0.08, layer) * (1.0 - smoothstep(0.9, 1.0, layer));
          vec3 rock = diffuseColor.rgb * (0.78 + 0.28 * floor(layer * 3.0) / 3.0);
          rock *= 0.62 + 0.38 * seam;
          diffuseColor.rgb = mix(diffuseColor.rgb, rock, steep);
          float burnt = mask.g;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13,0.11,0.1) + n*0.05, burnt*0.85);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.75,0.8,0.9), mask.b*0.5);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // smouldering ground under the flames
          totalEmissiveRadiance += vec3(1.0, 0.3, 0.04) * smoothstep(0.1, 0.8, mask.a) * (0.55 + n * 0.9);`,
        );
    };
    this.material = mat;

    const chunks = RES / CHUNK;
    for (let cz = 0; cz < chunks; cz++) {
      for (let cx = 0; cx < chunks; cx++) {
        const lod = new THREE.LOD();
        const near = new THREE.Mesh(this.chunkGeometry(cx * CHUNK, cz * CHUNK, 1), mat);
        const far = new THREE.Mesh(this.chunkGeometry(cx * CHUNK, cz * CHUNK, 4), mat);
        for (const m of [near, far]) {
          m.receiveShadow = true;
          m.castShadow = false;
        }
        near.geometry.computeBoundingSphere();
        const center = near.geometry.boundingSphere!.center.clone();
        // LOD distances are measured to the object origin, so centre the chunk on it
        for (const m of [near, far]) m.geometry.translate(-center.x, 0, -center.z);
        lod.position.set(center.x, 0, center.z);
        lod.addLevel(near, 0);
        lod.addLevel(far, 170);
        lod.updateMatrix();
        lod.matrixAutoUpdate = false;
        this.group.add(lod);
      }
    }
  }

  private chunkGeometry(x0: number, z0: number, step = 1) {
    const V = CHUNK / step + 1;
    const pos = new Float32Array(V * V * 3);
    const nor = new Float32Array(V * V * 3);
    const col = new Float32Array(V * V * 3);
    const n = new THREE.Vector3();
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const ix = x0 + i * step, iz = z0 + j * step;
        const x = -HALF + ix * CELL, z = -HALF + iz * CELL;
        const k = (j * V + i) * 3;
        pos[k] = x;
        pos[k + 1] = this.heights[iz * N + ix];
        pos[k + 2] = z;
        this.normalAt(x, z, n);
        nor[k] = n.x;
        nor[k + 1] = n.y;
        nor[k + 2] = n.z;
        const c = (iz * N + ix) * 3;
        col[k] = this.colors[c];
        col[k + 1] = this.colors[c + 1];
        col[k + 2] = this.colors[c + 2];
      }
    }
    const idx: number[] = [];
    const Q = CHUNK / step;
    for (let j = 0; j < Q; j++) {
      for (let i = 0; i < Q; i++) {
        const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
        // alternate diagonal for less visible banding
        if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    if (step > 1) {
      // skirts hide cracks against higher-detail neighbours
      const P = Array.from(pos), N = Array.from(nor), Cc = Array.from(col);
      const edge = (a: number, b: number) => {
        const base = P.length / 3;
        for (const k of [a, b]) {
          P.push(pos[k * 3], pos[k * 3 + 1] - 3, pos[k * 3 + 2]);
          N.push(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]);
          Cc.push(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]);
        }
        idx.push(a, b, base, b, base + 1, base, a, base, b, b, base, base + 1);
      };
      for (let i = 0; i < Q; i++) {
        edge(i, i + 1);
        edge(Q * V + i, Q * V + i + 1);
        edge(i * V, (i + 1) * V);
        edge(i * V + Q, (i + 1) * V + Q);
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    } else {
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  private buildCollider() {
    // Rapier heightfields are column-major with columns along x and rows along z.
    const hf = new Float32Array(N * N);
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) hf[ix * N + iz] = this.heights[iz * N + ix];
    const desc = RAPIER.ColliderDesc.heightfield(RES, RES, hf, { x: WORLD_SIZE, y: 1, z: WORLD_SIZE });
    desc.setCollisionGroups(groups(G.TERRAIN, ALL));
    desc.setFriction(0.9);
    this.collider = physics.world.createCollider(desc);
    physics.setOwner(this.collider, { kind: 'terrain', climbable: true });
  }
}
