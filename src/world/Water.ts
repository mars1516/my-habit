import * as THREE from 'three';
import type { Terrain } from './Terrain';
import { WATER_BODIES, WORLD_SIZE, RES } from './WorldGen';
import type { Sky } from './Sky';

const vert = /* glsl */ `
varying vec3 vWPos;
#include <fog_pars_vertex>
void main(){
  vec4 wp = modelMatrix * vec4(position,1.0);
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
uniform float uTime; uniform sampler2D uHeight; uniform float uWorld; uniform float uRes;
uniform float uLevel; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSky;
uniform vec3 uDeep; uniform vec3 uShallow; uniform float uNight;
varying vec3 vWPos;
#include <fog_pars_fragment>
float hgt(vec2 xz){
  vec2 g = (xz + uWorld*0.5) / uWorld * uRes;
  if (g.x < 0.0 || g.y < 0.0 || g.x > uRes || g.y > uRes) return -40.0;
  ivec2 i = ivec2(floor(g)); vec2 f = fract(g);
  float a = texelFetch(uHeight, i, 0).r, b = texelFetch(uHeight, i+ivec2(1,0), 0).r;
  float c = texelFetch(uHeight, i+ivec2(0,1), 0).r, d = texelFetch(uHeight, i+ivec2(1,1), 0).r;
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1)))*43758.5); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
void main(){
  vec2 p = vWPos.xz;
  float t = uTime;
  // wave normal
  float e = 0.35;
  float w0 = vnoise(p*0.18 + vec2(t*0.25, t*0.18)) + vnoise(p*0.45 - vec2(t*0.3, -t*0.2))*0.5;
  float wx = vnoise((p+vec2(e,0.0))*0.18 + vec2(t*0.25, t*0.18)) + vnoise((p+vec2(e,0.0))*0.45 - vec2(t*0.3, -t*0.2))*0.5;
  float wz = vnoise((p+vec2(0.0,e))*0.18 + vec2(t*0.25, t*0.18)) + vnoise((p+vec2(0.0,e))*0.45 - vec2(t*0.3, -t*0.2))*0.5;
  vec3 n = normalize(vec3((w0-wx)*1.6, 1.0, (w0-wz)*1.6));
  vec3 V = normalize(cameraPosition - vWPos);
  float depth = uLevel - hgt(p);
  vec3 base = mix(uShallow, uDeep, smoothstep(0.2, 6.0, depth));
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  vec3 col = mix(base, uSky, fres*0.65);
  vec3 R = reflect(-uSunDir, n);
  float spec = pow(max(dot(R, V), 0.0), 140.0);
  col += uSunColor * spec * 1.4 * (1.0 - uNight*0.7);
  // sparkles
  col += uSunColor * step(0.985, vnoise(p*2.2 + t*0.6)) * 0.35 * max(uSunDir.y,0.0);
  // shoreline foam
  float band = 0.6 + 0.35*sin(t*1.3 + p.x*0.05 + p.y*0.07);
  float foam = (1.0 - smoothstep(0.0, band, depth)) * step(0.35, vnoise(p*1.4 + vec2(t*0.4, 0.0)));
  foam += (1.0 - smoothstep(0.0, 0.18, depth));
  col = mix(col, vec3(0.95,0.98,1.0) * (1.0-uNight*0.6), clamp(foam,0.0,1.0)*0.85);
  float alpha = mix(0.5, 0.93, smoothstep(0.0, 3.5, depth));
  alpha = max(alpha, clamp(foam,0.0,1.0));
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Water {
  meshes: THREE.Mesh[] = [];
  private mats: THREE.ShaderMaterial[] = [];
  private sea!: THREE.Mesh;

  constructor(scene: THREE.Scene, terrain: Terrain) {
    for (const body of WATER_BODIES) {
      const uniforms = THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uHeight: { value: null },
          uWorld: { value: WORLD_SIZE },
          uRes: { value: RES },
          uLevel: { value: body.level },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color('#ffffff') },
          uSky: { value: new THREE.Color('#bfe4ff') },
          uDeep: { value: new THREE.Color(body.id === 'lake' ? '#1d5f86' : '#12507e') },
          uShallow: { value: new THREE.Color(body.id === 'lake' ? '#5cc6d6' : '#3fc0c8') },
          uNight: { value: 0 },
        },
      ]);
      uniforms.uHeight.value = terrain.heightTex;
      const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        fog: true,
      });
      const geo =
        body.radius === Infinity
          ? new THREE.PlaneGeometry(4200, 4200, 1, 1).rotateX(-Math.PI / 2)
          : new THREE.CircleGeometry(body.radius, 96).rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(body.radius === Infinity ? 0 : body.x, body.level, body.radius === Infinity ? 0 : body.z);
      mesh.renderOrder = 2;
      mesh.frustumCulled = body.radius !== Infinity;
      mesh.userData.body = body;
      scene.add(mesh);
      if (body.radius === Infinity) this.sea = mesh;
      this.meshes.push(mesh);
      this.mats.push(mat);
    }
  }

  update(dt: number, sky: Sky, camera: THREE.Camera) {
    for (const m of this.mats) {
      m.uniforms.uTime.value += dt;
      m.uniforms.uSunDir.value.copy(sky.night > 0.5 ? sky.moonDir : sky.sunDir);
      m.uniforms.uSunColor.value.copy(sky.sun.color).multiplyScalar(Math.min(1.2, sky.sun.intensity / 2.5));
      m.uniforms.uSky.value.copy(sky.uniforms.uHorizon.value);
      m.uniforms.uNight.value = sky.night;
    }
    this.sea.position.x = Math.round(camera.position.x / 50) * 50;
    this.sea.position.z = Math.round(camera.position.z / 50) * 50;
  }
}
