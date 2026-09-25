import * as THREE from 'three';
import type { Terrain } from './Terrain';
import { WORLD_SIZE, RES } from './WorldGen';

/**
 * GPU grass: a fixed grid of blade instances that follows the camera.
 * Height comes from the terrain height texture; density and burn state from the mask
 * texture, so burnt cells lose their grass instantly without any CPU work.
 */
export class Grass {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;

  constructor(terrain: Terrain, quality: 'low' | 'medium' | 'high') {
    const spacing = quality === 'high' ? 0.3 : quality === 'medium' ? 0.38 : 0.55;
    const extent = quality === 'high' ? 84 : quality === 'medium' ? 72 : 52;
    const n = Math.floor(extent / spacing);

    // blade: 3 segments, 7 verts
    const bp: number[] = [];
    const segs = 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const w = 0.07 * (1 - t);
      if (i < segs) {
        bp.push(-w, t, 0, w, t, 0);
      } else bp.push(0, 1, 0);
    }
    const idx: number[] = [];
    for (let i = 0; i < segs - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const last = (segs - 1) * 2;
    idx.push(last, last + 1, last + 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    geo.setIndex(idx);
    const offsets = new Float32Array(n * n * 2);
    let k = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        offsets[k++] = (i - n / 2) * spacing;
        offsets[k++] = (j - n / 2) * spacing;
      }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 2));
    geo.instanceCount = n * n;

    this.uniforms = {
      uHeight: { value: terrain.heightTex },
      uMask: { value: terrain.maskTex },
      uColor: { value: terrain.colorTex },
      uNight: { value: 0 },
      uWorld: { value: WORLD_SIZE },
      uRes: { value: RES },
      uCenter: { value: new THREE.Vector2() },
      uSpacing: { value: spacing },
      uExtent: { value: extent },
      uTime: { value: 0 },
      uPlayer: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2(1, 0.3) },
      uBase: { value: new THREE.Color('#3f8a2c') },
      uTip: { value: new THREE.Color('#b9dc62') },
    };

    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec2 aOffset;
          uniform sampler2D uHeight; uniform sampler2D uMask; uniform sampler2D uColor; uniform float uNight;
          uniform float uWorld; uniform float uRes; uniform vec2 uCenter; uniform float uSpacing; uniform float uExtent;
          uniform float uTime; uniform vec3 uPlayer; uniform vec2 uWind;
          uniform vec3 uBase; uniform vec3 uTip;
          varying float vT; varying vec3 vGrassCol;
          float gh(vec2 xz){
            vec2 g = (xz + uWorld*0.5) / uWorld * uRes;
            ivec2 i = ivec2(floor(g)); vec2 f = fract(g);
            float a = texelFetch(uHeight, i, 0).r, b = texelFetch(uHeight, i+ivec2(1,0), 0).r;
            float c = texelFetch(uHeight, i+ivec2(0,1), 0).r, d = texelFetch(uHeight, i+ivec2(1,1), 0).r;
            return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
          }
          float gHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = vec3(0.0, 1.0, 0.0);
          #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
          #endif`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec2 cell = floor(uCenter / uSpacing) * uSpacing + aOffset;
          float r1 = gHash(cell), r2 = gHash(cell + 17.3), r3 = gHash(cell - 5.1);
          vec2 wxz = cell + (vec2(r1, r2) - 0.5) * uSpacing * 1.6;
          vec2 muv = (wxz + uWorld*0.5) / uWorld;
          vec4 mask = texture2D(uMask, muv);
          float dens = mask.r;
          float burnt = mask.g;
          float distC = length(wxz - uCenter);
          float fade = 1.0 - smoothstep(uExtent*0.32, uExtent*0.5, distC);
          float keep = step(r3, dens * 1.05) * fade;
          float height = (0.35 + r1*0.55) * (0.55 + dens*0.75) * keep * (1.0 - burnt*0.92);
          vec3 transformed = vec3(position.x, position.y * height, 0.0);
          float ang = r2 * 6.2831;
          float ca = cos(ang), sa = sin(ang);
          transformed.xz = vec2(transformed.x*ca, transformed.x*sa);
          float t = position.y;
          vT = t;
          // wind sway
          float gust = sin(uTime*1.7 + wxz.x*0.21 + wxz.y*0.13) * 0.5 + sin(uTime*3.1 + wxz.x*0.7) * 0.2;
          vec2 bend = uWind * (0.18 + gust*0.22) * t * t * height;
          // push away from the player
          vec2 away = wxz - uPlayer.xz;
          float pd = length(away);
          float push = (1.0 - smoothstep(0.2, 1.4, pd)) * step(abs(uPlayer.y - gh(wxz)), 1.6);
          bend += normalize(away + 0.0001) * push * 0.55 * t * height;
          transformed.xz += bend;
          transformed.y -= length(bend) * 0.35;
          transformed.xz += wxz;
          transformed.y += gh(wxz) - 0.02;
          vec3 ground = texture2D(uColor, (wxz + uWorld*0.5) / uWorld * (uRes/(uRes+1.0)) + 0.5/(uRes+1.0)).rgb;
          ground = ground * ground; // stored as sqrt for precision
          vec3 tint = mix(vec3(1.0), vec3(1.12, 1.06, 0.75), r1*0.7);
          vGrassCol = mix(ground * 0.62, ground * 1.28 + vec3(0.03,0.05,0.0), t) * tint;
          vGrassCol = mix(vGrassCol, vec3(0.12,0.1,0.08), burnt);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vT; varying vec3 vGrassCol;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vGrassCol * (0.55 + vT*0.6);');
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
  }

  update(dt: number, center: THREE.Vector3, player: THREE.Vector3, windDir: THREE.Vector2, night: number) {
    this.uniforms.uTime.value += dt;
    (this.uniforms.uCenter.value as THREE.Vector2).set(center.x, center.z);
    (this.uniforms.uPlayer.value as THREE.Vector3).copy(player);
    (this.uniforms.uWind.value as THREE.Vector2).copy(windDir);
    this.uniforms.uNight.value = night;
  }
}
