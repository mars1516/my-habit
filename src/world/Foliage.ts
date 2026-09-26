import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from '../fx/Toon';

/**
 * Stylised "fluffy" foliage in the Genshin / Breath of the Wild manner: canopies are
 * clouds of alpha-cut leaf cards whose normals are bent outward from the canopy centre,
 * so the whole crown shades like one soft volume (with toon bands) instead of showing
 * every card.
 */

let leafTex: THREE.Texture | null = null;
function leafTexture() {
  if (leafTex) return leafTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  // a dense clump of small rounded leaves, lighter towards the rim
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#bdbdbd';
  g.beginPath();
  g.arc(0, 0, 30, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 8 + Math.sqrt(rnd()) * 40;
    const len = 12 + rnd() * 9;
    g.save();
    g.translate(Math.cos(a) * d, Math.sin(a) * d);
    g.rotate(a + (rnd() - 0.5) * 0.9);
    const v = Math.round(190 + (d / 48) * 60 + rnd() * 10);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath();
    g.ellipse(0, 0, len, len * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  leafTex = t;
  return t;
}

/** Leaf-card material: alpha cut, double sided without flipping the bent normals, wind sway. */
export function foliageMaterial(uTime: { value: number }, sway: number) {
  const mat = new THREE.MeshLambertMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true });
  toon(mat, 0.12);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
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
        float flutter = sin(uTime*3.3 + position.x*2.1 + position.z*1.7 + ph) * 0.035;
        transformed.x += sin(uTime*1.3 + ph) * ${sway.toFixed(4)} * hy * hy + flutter * step(0.5, hy);
        transformed.z += cos(uTime*1.05 + ph*1.3) * ${(sway * 0.6).toFixed(4)} * hy * hy;
        transformed.y += flutter * 0.5 * step(0.5, hy);`,
      );
    // the bent normals already describe the crown: never flip them for back faces
    shader.fragmentShader = shader.fragmentShader
      .replace('normal *= faceDirection;', '')
      // dissolve leaves right in front of the camera instead of filling the screen
      .replace(
        '#include <alphatest_fragment>',
        `#include <alphatest_fragment>
        {
          float camD = length(vViewPosition);
          float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (camD < 2.4 && dither > (camD - 0.9) / 1.5) discard;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'foliage' + sway;
  return mat;
}

/** Bark material with the same sway so trunks move with their crowns. */
export function barkMaterial(uTime: { value: number }, sway: number) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  toon(mat, 0.1);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
      float ph = instanceMatrix[3].x*0.21 + instanceMatrix[3].z*0.17;
      #else
      float ph = 0.0;
      #endif
      float hy = max(position.y, 0.0);
      transformed.x += sin(uTime*1.3 + ph) * ${sway.toFixed(4)} * hy * hy;
      transformed.z += cos(uTime*1.05 + ph*1.3) * ${(sway * 0.6).toFixed(4)} * hy * hy;`,
    );
  };
  mat.customProgramCacheKey = () => 'bark' + sway;
  return mat;
}

type Rng = () => number;
const tmp = new THREE.Vector3();

interface Blob {
  c: THREE.Vector3;
  r: number;
}

/** A cloud of leaf cards filling the given blobs. */
function cards(blobs: Blob[], perBlob: number, size: number, rng: Rng, low: THREE.Color, high: THREE.Color, centre: THREE.Vector3, down = 0) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  let minY = Infinity, maxY = -Infinity;
  for (const b of blobs) {
    minY = Math.min(minY, b.c.y - b.r);
    maxY = Math.max(maxY, b.c.y + b.r);
  }
  const up = new THREE.Vector3(0, 1, 0);
  for (const b of blobs) {
    for (let i = 0; i < perBlob; i++) {
      const dir = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1 + 0.25, rng() * 2 - 1).normalize();
      const dist = b.r * (0.35 + 0.65 * Math.sqrt(rng()));
      const p = b.c.clone().addScaledVector(dir, dist);
      const s = size * b.r * (0.75 + rng() * 0.55);
      // card faces roughly outward, with some randomness
      const n = dir.clone().add(new THREE.Vector3(rng() - 0.5, rng() - 0.5 - down, rng() - 0.5).multiplyScalar(1.1)).normalize();
      const t = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize();
      const bt = new THREE.Vector3().crossVectors(n, t);
      const rot = rng() * Math.PI * 2;
      const tx = t.clone().multiplyScalar(Math.cos(rot)).addScaledVector(bt, Math.sin(rot));
      const ty = t.clone().multiplyScalar(-Math.sin(rot)).addScaledVector(bt, Math.cos(rot));
      const base = pos.length / 3;
      const shade = 0.9 + rng() * 0.2;
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const q = p.clone().addScaledVector(tx, (u - 0.5) * s).addScaledVector(ty, (v - 0.5) * s);
        pos.push(q.x, q.y, q.z);
        // bent normal: mostly the blob's sphere, partly the whole crown
        const nb = tmp.copy(q).sub(b.c).normalize().multiplyScalar(0.55);
        const nc = q.clone().sub(centre).normalize().multiplyScalar(0.45);
        const nn = nb.add(nc).normalize();
        nor.push(nn.x, nn.y, nn.z);
        uv.push(u, v);
        const h = (q.y - minY) / (maxY - minY || 1);
        const outer = Math.min(1, q.distanceTo(b.c) / b.r);
        const k = Math.min(1, h * 0.75 + outer * 0.35);
        const c = low.clone().lerp(high, k).multiplyScalar(shade);
        col.push(c.r, c.g, c.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function trunk(h: number, r0: number, r1: number, color: string, rng: Rng, branches: [number, number, number, number][] = []) {
  const parts: THREE.BufferGeometry[] = [];
  const t = new THREE.CylinderGeometry(r1, r0, h, 8, 3).translate(0, h / 2, 0);
  // gentle wobble so trunks aren't perfect cylinders
  const p = t.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + Math.sin(y * 1.3) * 0.06);
    p.setZ(i, p.getZ(i) + Math.cos(y * 1.1) * 0.05);
  }
  t.computeVertexNormals();
  parts.push(t);
  for (const [y, a, len, r] of branches) {
    const b = new THREE.CylinderGeometry(r * 0.5, r, len, 6, 1).translate(0, len / 2, 0);
    b.rotateZ(-0.9);
    b.rotateY(a);
    b.translate(0, y, 0);
    parts.push(b);
  }
  const g = mergeGeometries(parts.map((x) => (x.index ? x.toNonIndexed() : x)));
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = g.attributes.position.getY(i);
    const k = 0.75 + Math.min(1, y / h) * 0.35 + (rng() - 0.5) * 0.04;
    col[i * 3] = c.r * k;
    col[i * 3 + 1] = c.g * k;
    col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Broadleaf tree ~6 m tall (scale 1): a round, cloudy crown. */
export function oakParts(rng: Rng) {
  const blobs: Blob[] = [
    { c: new THREE.Vector3(0, 4.4, 0), r: 2.0 },
    { c: new THREE.Vector3(1.1, 3.9, 0.5), r: 1.5 },
    { c: new THREE.Vector3(-1.0, 4.0, -0.4), r: 1.6 },
    { c: new THREE.Vector3(0.3, 5.3, -0.7), r: 1.4 },
    { c: new THREE.Vector3(-0.4, 3.7, 1.1), r: 1.3 },
    { c: new THREE.Vector3(0.6, 5.1, 0.9), r: 1.2 },
  ];
  const centre = new THREE.Vector3(0, 4.4, 0);
  const leaves = cards(blobs, 44, 0.85, rng, new THREE.Color('#2f6a2a'), new THREE.Color('#a8d65a'), centre, 0);
  const wood = trunk(3.8, 0.42, 0.24, '#6e4a30', rng, [
    [2.6, 0.4, 1.6, 0.14],
    [2.9, 2.6, 1.4, 0.12],
    [3.2, 4.5, 1.3, 0.1],
  ]);
  return { leaves, wood };
}

/** Conifer: stacked tiers of drooping leaf cards around a straight trunk (~9 m). */
export function pineParts(rng: Rng) {
  const blobs: Blob[] = [];
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1);
    const y = 2.3 + k * 6.2;
    const r = 2.3 * (1 - k * 0.75);
    // each tier is a flattened ring of blobs
    const n = Math.max(3, Math.round(6 * (1 - k * 0.6)));
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + i * 0.7;
      blobs.push({ c: new THREE.Vector3(Math.cos(a) * r * 0.55, y, Math.sin(a) * r * 0.55), r: r * 0.55 + 0.25 });
    }
  }
  blobs.push({ c: new THREE.Vector3(0, 9.0, 0), r: 0.55 });
  const centre = new THREE.Vector3(0, 5.2, 0);
  const leaves = cards(blobs, 16, 1.05, rng, new THREE.Color('#123d33'), new THREE.Color('#4d8f55'), centre, 0.8);
  // flatten tiers a little so they read as layered skirts
  const p = leaves.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const tier = Math.round((y - 2.3) / (6.2 / (tiers - 1)));
    const ty = 2.3 + (tier * 6.2) / (tiers - 1);
    p.setY(i, ty + (y - ty) * 0.7);
  }
  const wood = trunk(8.8, 0.34, 0.1, '#5b3d2a', rng);
  return { leaves, wood };
}

/** Round shrub ~1.3 m. */
export function bushParts(rng: Rng, color: string) {
  const blobs: Blob[] = [
    { c: new THREE.Vector3(0, 0.6, 0), r: 0.75 },
    { c: new THREE.Vector3(0.55, 0.45, 0.2), r: 0.55 },
    { c: new THREE.Vector3(-0.5, 0.5, -0.25), r: 0.6 },
  ];
  const base = new THREE.Color(color);
  return cards(blobs, 26, 0.95, rng, base.clone().multiplyScalar(0.55), base.clone().multiplyScalar(1.35), new THREE.Vector3(0, 0.5, 0));
}
