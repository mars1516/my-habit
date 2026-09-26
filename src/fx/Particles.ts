import * as THREE from 'three';

export interface EmitOptions {
  pos: THREE.Vector3;
  count?: number;
  /** Base velocity. */
  vel?: THREE.Vector3;
  /** Random velocity magnitude added in a sphere. */
  spread?: number;
  /** Random position offset radius. */
  posSpread?: number;
  life?: [number, number];
  size?: [number, number];
  color?: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  alpha?: [number, number];
  gravity?: number;
  drag?: number;
  additive?: boolean;
  /** 'flame' draws a flickering flame tongue instead of a soft dot. */
  shape?: 'flame';
}

const vert = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
#include <fog_pars_vertex>
void main(){
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float depth = max(-mvPosition.z, 0.1);
  // cap on-screen size and fade sprites that are almost touching the lens
  gl_PointSize = min(aSize * uScale / depth, uScale * 0.22);
  vColor.a *= smoothstep(0.6, 2.2, depth);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
varying vec4 vColor;
uniform float uSoft;
#include <fog_pars_fragment>
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = uSoft > 0.5 ? pow(max(1.0 - d, 0.0), 1.6) : smoothstep(1.0, 0.7, d);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  #include <fog_fragment>
}`;

/** Stylised flame tongue: round bottom, licking pointed top, hot core. */
const flameVert = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
varying float vSeed;
uniform float uScale;
#include <fog_pars_vertex>
void main(){
  vColor = aColor;
  vSeed = fract(position.x * 1.37 + position.z * 3.11);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float depth = max(-mvPosition.z, 0.1);
  // cap on-screen size and fade sprites that are almost touching the lens
  gl_PointSize = min(aSize * uScale / depth, uScale * 0.22);
  vColor.a *= smoothstep(0.6, 2.2, depth);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const flameFrag = /* glsl */ `
varying vec4 vColor;
varying float vSeed;
uniform float uTime;
#include <fog_pars_fragment>
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float y = 0.5 - gl_PointCoord.y;           // -0.5 bottom .. 0.5 top
  float k = clamp(y + 0.5, 0.0, 1.0);        // 0 bottom .. 1 top
  // the tongue sways more towards its tip
  float x = c.x + sin(uTime * 9.0 + vSeed * 30.0 + k * 4.0) * 0.08 * k;
  float w = mix(0.36, 0.0, pow(k, 0.85));     // half width along the height
  float body = smoothstep(w, w * 0.55, abs(x)) * smoothstep(0.0, 0.14, k);
  float bottom = smoothstep(0.5, 0.2, length(vec2(x, y + 0.18)) );
  float a = max(body, bottom * step(k, 0.35));
  if (a <= 0.01) discard;
  float core = smoothstep(w * 0.9, 0.0, abs(x)) * (1.0 - k * 0.8);
  vec3 col = mix(vColor.rgb, vec3(1.0, 0.93, 0.62), core * 0.75);
  gl_FragColor = vec4(col, vColor.a * a);
  #include <fog_fragment>
}`;

class Pool {
  max: number;
  count = 0;
  pos: Float32Array;
  vel: Float32Array;
  c0: Float32Array;
  c1: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  phys: Float32Array; // gravity, drag
  geo: THREE.BufferGeometry;
  points: THREE.Points;
  aPos: THREE.BufferAttribute;
  aCol: THREE.BufferAttribute;
  aSize: THREE.BufferAttribute;

  constructor(max: number, additive: boolean, soft: boolean, flame = false) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max * 2);
    this.alpha = new Float32Array(max * 2);
    this.phys = new Float32Array(max * 2);
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('aColor', this.aCol);
    this.geo.setAttribute('aSize', this.aSize);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 }, uSoft: { value: soft ? 1 : 0 }, uTime: { value: 0 } }]),
      vertexShader: flame ? flameVert : vert,
      fragmentShader: flame ? flameFrag : frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  spawn(
    px: number, py: number, pz: number,
    vx: number, vy: number, vz: number,
    c0: THREE.Color, c1: THREE.Color,
    life: number, s0: number, s1: number, a0: number, a1: number, g: number, drag: number,
  ) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.c0[i * 3] = c0.r; this.c0[i * 3 + 1] = c0.g; this.c0[i * 3 + 2] = c0.b;
    this.c1[i * 3] = c1.r; this.c1[i * 3 + 1] = c1.g; this.c1[i * 3 + 2] = c1.b;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i * 2] = s0; this.size[i * 2 + 1] = s1;
    this.alpha[i * 2] = a0; this.alpha[i * 2 + 1] = a1;
    this.phys[i * 2] = g; this.phys[i * 2 + 1] = drag;
  }

  private kill(i: number) {
    const j = --this.count;
    if (i === j) return;
    const copy = (arr: Float32Array, n: number) => {
      for (let k = 0; k < n; k++) arr[i * n + k] = arr[j * n + k];
    };
    copy(this.pos, 3); copy(this.vel, 3); copy(this.c0, 3); copy(this.c1, 3);
    copy(this.life, 1); copy(this.maxLife, 1); copy(this.size, 2); copy(this.alpha, 2); copy(this.phys, 2);
  }

  update(dt: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uTime.value += dt;
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        i--;
        continue;
      }
      const drag = Math.exp(-this.phys[i * 2 + 1] * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - this.phys[i * 2] * dt;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    const p = this.aPos.array as Float32Array;
    const c = this.aCol.array as Float32Array;
    const s = this.aSize.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const t = 1 - this.life[i] / this.maxLife[i];
      p[i * 3] = this.pos[i * 3]; p[i * 3 + 1] = this.pos[i * 3 + 1]; p[i * 3 + 2] = this.pos[i * 3 + 2];
      c[i * 4] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * t;
      c[i * 4 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * t;
      c[i * 4 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * t;
      const fadeIn = Math.min(1, t * 8);
      c[i * 4 + 3] = (this.alpha[i * 2] + (this.alpha[i * 2 + 1] - this.alpha[i * 2]) * t) * fadeIn;
      s[i] = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * t;
    }
    this.geo.setDrawRange(0, this.count);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
}

const _c0 = new THREE.Color();
const _c1 = new THREE.Color();

export class Particles {
  glow: Pool;
  smoke: Pool;
  flame: Pool;
  group = new THREE.Group();

  constructor(quality: 'low' | 'medium' | 'high') {
    const cap = quality === 'low' ? 3000 : 7000;
    this.glow = new Pool(cap, true, true);
    this.smoke = new Pool(Math.floor(cap * 0.6), false, true);
    this.flame = new Pool(Math.floor(cap * 0.5), true, true, true);
    this.group.add(this.glow.points, this.smoke.points, this.flame.points);
  }

  setScale(height: number, fov: number) {
    const scale = height / (2 * Math.tan((fov * Math.PI) / 360));
    (this.glow.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale;
    (this.smoke.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale;
    (this.flame.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale;
  }

  emit(o: EmitOptions) {
    const pool = o.shape === 'flame' ? this.flame : o.additive === false ? this.smoke : this.glow;
    const n = o.count ?? 1;
    _c0.set(o.color ?? '#ffffff');
    _c1.set(o.color2 ?? o.color ?? '#ffffff');
    const life = o.life ?? [0.6, 1.0];
    const size = o.size ?? [0.5, 0.1];
    const alpha = o.alpha ?? [1, 0];
    const spread = o.spread ?? 1;
    const ps = o.posSpread ?? 0;
    for (let k = 0; k < n; k++) {
      let rx = 0, ry = 0, rz = 0;
      do {
        rx = Math.random() * 2 - 1;
        ry = Math.random() * 2 - 1;
        rz = Math.random() * 2 - 1;
      } while (rx * rx + ry * ry + rz * rz > 1);
      let ox = 0, oy = 0, oz = 0;
      if (ps > 0) {
        do {
          ox = Math.random() * 2 - 1;
          oy = Math.random() * 2 - 1;
          oz = Math.random() * 2 - 1;
        } while (ox * ox + oy * oy + oz * oz > 1);
      }
      pool.spawn(
        o.pos.x + ox * ps, o.pos.y + oy * ps, o.pos.z + oz * ps,
        (o.vel?.x ?? 0) + rx * spread, (o.vel?.y ?? 0) + ry * spread, (o.vel?.z ?? 0) + rz * spread,
        _c0, _c1,
        life[0] + Math.random() * (life[1] - life[0]),
        size[0], size[1], alpha[0], alpha[1],
        o.gravity ?? 0, o.drag ?? 0.5,
      );
    }
  }

  update(dt: number) {
    this.glow.update(dt);
    this.smoke.update(dt);
    this.flame.update(dt);
  }
}

/** A fixed set of point lights reused for spells, fires and explosions (keeps shader programs stable). */
export class LightPool {
  lights: THREE.PointLight[] = [];
  private life: number[] = [];
  private maxLife: number[] = [];
  private base: number[] = [];
  private follow: (THREE.Vector3 | null)[] = [];

  constructor(scene: THREE.Scene, n = 6) {
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight('#ffffff', 0, 14, 1.6);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
      this.life.push(0);
      this.maxLife.push(1);
      this.base.push(0);
      this.follow.push(null);
    }
  }

  flash(pos: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, distance: number, duration: number, follow?: THREE.Vector3) {
    let best = 0;
    for (let i = 0; i < this.lights.length; i++) if (this.life[i] < this.life[best]) best = i;
    const l = this.lights[best];
    l.position.copy(pos);
    l.color.set(color);
    l.distance = distance;
    this.life[best] = duration;
    this.maxLife[best] = duration;
    this.base[best] = intensity;
    this.follow[best] = follow ?? null;
    l.intensity = intensity;
    return best;
  }

  update(dt: number) {
    for (let i = 0; i < this.lights.length; i++) {
      if (this.life[i] <= 0) {
        this.lights[i].intensity = 0;
        continue;
      }
      this.life[i] -= dt;
      const f = this.follow[i];
      if (f) this.lights[i].position.copy(f);
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.lights[i].intensity = this.base[i] * Math.min(1, t * 3);
    }
  }
}
