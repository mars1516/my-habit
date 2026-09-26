import * as THREE from 'three';

/**
 * Soft cloud shadows drifting across the land with the wind (terrain, grass and trees
 * all sample the same field so they darken together).
 */
export const cloudUniforms = {
  uCloudOff: { value: new THREE.Vector2() },
  uCloudK: { value: 0.3 },
};

export const CLOUD_GLSL = /* glsl */ `
uniform vec2 uCloudOff;
uniform float uCloudK;
float cs_h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cs_n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(cs_h(i), cs_h(i+vec2(1,0)), f.x), mix(cs_h(i+vec2(0,1)), cs_h(i+vec2(1,1)), f.x), f.y); }
float cloudShade(vec2 xz){
  vec2 q = xz * 0.0065 + uCloudOff;
  float n = cs_n(q) * 0.6 + cs_n(q * 2.13 + 7.1) * 0.3 + cs_n(q * 4.7 - 3.3) * 0.1;
  return 1.0 - uCloudK * smoothstep(0.52, 0.68, n);
}
`;

export function updateCloudShadows(dt: number, wind: THREE.Vector2, day: number, overcast: number) {
  cloudUniforms.uCloudOff.value.addScaledVector(wind, -dt * 0.012);
  // no distinct cloud shadows at night or under a fully grey sky
  cloudUniforms.uCloudK.value = 0.32 * day * (1 - overcast * 0.8);
}
