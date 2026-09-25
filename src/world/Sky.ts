import * as THREE from 'three';
import { clamp, smoothstep, lerp } from '../core/math';
import { assets } from '../core/Assets';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main(){
  vec4 wp = modelMatrix * vec4(position,1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // at far plane
}`;

const skyFrag = /* glsl */ `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uMoonDir;
uniform float uNight; uniform float uTime; uniform float uOvercast;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(y,0.0,1.0), 0.55));
  col = mix(col, uGround, smoothstep(0.0, -0.25, y));
  // sun
  float sd = dot(d, uSunDir);
  col += uSunColor * (smoothstep(0.9993, 0.9997, sd) * 6.0 + pow(max(sd,0.0), 48.0) * 0.5 + pow(max(sd,0.0), 6.0)*0.12) * (1.0-uOvercast*0.8);
  // moon
  float md = dot(d, uMoonDir);
  col += vec3(0.85,0.9,1.0) * smoothstep(0.9990, 0.9994, md) * 1.6 * uNight;
  col += vec3(0.3,0.4,0.7) * pow(max(md,0.0), 40.0) * 0.25 * uNight;
  // stars
  if (uNight > 0.01 && y > 0.0) {
    vec3 sp = floor(d * 280.0);
    float h = hash(sp);
    float star = step(0.9965, h) * (0.6 + 0.4*sin(uTime*3.0 + h*100.0));
    col += vec3(star) * uNight * smoothstep(0.0, 0.25, y) * (1.0-uOvercast);
  }
  // overcast grey
  col = mix(col, vec3(dot(col, vec3(0.33)))*vec3(0.85,0.88,0.95), uOvercast*0.7);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

interface Key {
  e: number; // sun elevation (sin)
  zenith: string;
  horizon: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
}

const KEYS: Key[] = [
  { e: -1.0, zenith: '#081030', horizon: '#1c2a52', sun: '#a4b8ff', sunI: 0.9, hemiSky: '#5068a8', hemiGround: '#26302c', hemiI: 1.15 },
  { e: -0.15, zenith: '#0e1838', horizon: '#2c3a66', sun: '#a4b8ff', sunI: 0.8, hemiSky: '#5a6aa8', hemiGround: '#28302a', hemiI: 1.1 },
  { e: 0.0, zenith: '#3b4f86', horizon: '#f39a62', sun: '#ff9a55', sunI: 1.0, hemiSky: '#8a8fb0', hemiGround: '#4a4030', hemiI: 0.8 },
  { e: 0.18, zenith: '#4d86d0', horizon: '#ffd2a0', sun: '#ffd9a8', sunI: 2.2, hemiSky: '#a8c8f0', hemiGround: '#5a5a3a', hemiI: 1.0 },
  { e: 0.45, zenith: '#3f8ee6', horizon: '#bfe4ff', sun: '#fff4e2', sunI: 2.9, hemiSky: '#c4e2ff', hemiGround: '#5c6e3c', hemiI: 1.15 },
  { e: 1.0, zenith: '#3386e8', horizon: '#c6e8ff', sun: '#fffaf0', sunI: 3.1, hemiSky: '#cae6ff', hemiGround: '#627442', hemiI: 1.2 },
];

export class Sky {
  mesh: THREE.Mesh;
  uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color('#3a4a5a') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uNight: { value: 0 },
    uTime: { value: 0 },
    uOvercast: { value: 0 },
  };
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.Fog;
  /** Hours [0,24). */
  time = 8.5;
  /** Real seconds per in-game hour. */
  secondsPerHour = 50;
  sunDir = new THREE.Vector3();
  moonDir = new THREE.Vector3();
  overcast = 0;
  night = 0;
  clouds = new THREE.Group();
  private cloudData: { obj: THREE.Object3D; speed: number }[] = [];
  private cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#bfc8d8', emissiveIntensity: 0.55, flatShading: true });

  constructor(private scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(4000, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight('#ffffff', 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -60;
    s.right = 60;
    s.top = 60;
    s.bottom = -60;
    s.near = 1;
    s.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight('#cae6ff', '#627442', 1.1);
    scene.add(this.hemi);

    this.fog = new THREE.Fog('#c6e8ff', 160, 1100);
    scene.fog = this.fog;
  }

  buildClouds() {
    const rng = (i: number) => (Math.sin(i * 91.7) * 43758.5453) % 1;
    for (let i = 0; i < 46; i++) {
      const obj = assets.env(i % 3 === 0 ? 'cloud_small' : 'cloud_big');
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = this.cloudMat;
          m.castShadow = false;
          m.receiveShadow = false;
        }
      });
      const s = 14 + Math.abs(rng(i + 3)) * 22;
      obj.scale.set(s, s * 0.8, s);
      obj.position.set(rng(i) * 700, 200 + Math.abs(rng(i + 7)) * 90, rng(i + 13) * 700);
      obj.rotation.y = rng(i + 21) * 6;
      this.clouds.add(obj);
      this.cloudData.push({ obj, speed: 2 + Math.abs(rng(i + 5)) * 3 });
    }
    this.scene.add(this.clouds);
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera, timeScale = 1) {
    this.time = (this.time + (dt * timeScale) / this.secondsPerHour) % 24;
    this.uniforms.uTime.value += dt;
    const a = ((this.time - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(a), Math.sin(a), 0.32).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);
    this.moonDir.z = 0.25;
    this.moonDir.normalize();

    const e = this.sunDir.y;
    let k0 = KEYS[0], k1 = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (e >= KEYS[i].e && e <= KEYS[i + 1].e) {
        k0 = KEYS[i];
        k1 = KEYS[i + 1];
        break;
      }
    }
    const t = clamp((e - k0.e) / (k1.e - k0.e || 1), 0, 1);
    const mix = (a: string, b: string, out: THREE.Color) => out.set(a).lerp(new THREE.Color(b), t);
    const u = this.uniforms;
    mix(k0.zenith, k1.zenith, u.uZenith.value);
    mix(k0.horizon, k1.horizon, u.uHorizon.value);
    mix(k0.sun, k1.sun, u.uSunColor.value);
    this.night = 1 - smoothstep(-0.2, 0.05, e);
    u.uNight.value = this.night;
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uOvercast.value = this.overcast;

    const oc = this.overcast;
    const sunI = lerp(k0.sunI, k1.sunI, t) * (1 - oc * 0.65);
    this.sun.intensity = sunI;
    this.sun.color.copy(u.uSunColor.value);
    const lightDir = e > -0.05 ? this.sunDir : this.moonDir;
    this.sun.position.copy(focus).addScaledVector(lightDir, 250);
    this.sun.target.position.copy(focus);
    // snap to shadow texels to reduce shimmering
    const texel = 120 / 2048;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.position.x = this.sun.target.position.x + lightDir.x * 250;
    this.sun.position.z = this.sun.target.position.z + lightDir.z * 250;

    this.hemi.color.set(k0.hemiSky).lerp(new THREE.Color(k1.hemiSky), t);
    this.hemi.groundColor.set(k0.hemiGround).lerp(new THREE.Color(k1.hemiGround), t);
    this.hemi.intensity = lerp(k0.hemiI, k1.hemiI, t) * (1 - oc * 0.3);

    this.fog.color.copy(u.uHorizon.value).lerp(new THREE.Color('#8a94a0'), oc * 0.6);
    this.fog.near = lerp(160, 40, oc);
    this.fog.far = lerp(1100, 420, oc);

    this.mesh.position.copy(camera.position);

    // clouds drift and wrap around the focus
    this.cloudMat.emissive.copy(u.uHorizon.value).lerp(new THREE.Color('#ffffff'), 0.4).multiplyScalar(0.55 * (1 - this.night * 0.8));
    this.cloudMat.color.set('#ffffff').lerp(new THREE.Color('#7d8796'), oc);
    for (const c of this.cloudData) {
      c.obj.position.x += c.speed * dt;
      if (c.obj.position.x - focus.x > 700) c.obj.position.x -= 1400;
      if (c.obj.position.x - focus.x < -700) c.obj.position.x += 1400;
      if (c.obj.position.z - focus.z > 700) c.obj.position.z -= 1400;
      if (c.obj.position.z - focus.z < -700) c.obj.position.z += 1400;
    }
  }

  isNight() {
    return this.night > 0.6;
  }
}
