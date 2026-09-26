import * as THREE from 'three';

/**
 * Anime-style shading, opt-in per material:
 *  - `TOON`: direct light is quantised into a soft two-band ramp (lit / shade),
 *  - `TOON_RIM <k>`: a crisp fresnel rim of strength k,
 * plus inverted-hull outlines for skinned characters.
 * The chunks are patched once, before any material compiles.
 */
const BAND = `
	#ifdef TOON
	dotNL = mix( smoothstep( 0.0, 0.08, dotNL ) * 0.7, 1.0, smoothstep( 0.28, 0.45, dotNL ) );
	#endif
`;
const DOT = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
for (const key of ['lights_physical_pars_fragment', 'lights_lambert_pars_fragment'] as const) {
  const src = THREE.ShaderChunk[key];
  if (!src.includes(DOT)) console.warn('toon: chunk changed', key);
  (THREE.ShaderChunk as Record<string, string>)[key] = src.replace(DOT, DOT + BAND);
}
THREE.ShaderChunk.opaque_fragment =
  `
#ifdef TOON_RIM
{
	float ndv = saturate( dot( normalize( vViewPosition ), normal ) );
	float rim = smoothstep( 0.62, 0.78, 1.0 - ndv );
	outgoingLight += ( diffuseColor.rgb * 0.6 + 0.4 ) * rim * TOON_RIM;
}
#endif
` + THREE.ShaderChunk.opaque_fragment;

/** Enable toon shading on a lit material (Standard/Physical/Lambert). */
export function toon(mat: THREE.Material, rim = 0) {
  const m = mat as THREE.MeshStandardMaterial;
  m.defines = { ...(m.defines ?? {}), TOON: '' };
  if (rim > 0) m.defines.TOON_RIM = rim.toFixed(3);
  m.needsUpdate = true;
  return mat;
}

const outlineMat = new THREE.MeshBasicMaterial({ color: '#1d1826', side: THREE.BackSide });
outlineMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <skinning_vertex>',
    `#include <skinning_vertex>
    #ifdef USE_SKINNING
    transformed += normalize( objectNormal ) * OUTLINE_W;
    #else
    transformed += normalize( normal ) * OUTLINE_W;
    #endif`,
  );
};
outlineMat.defines = { OUTLINE_W: '0.022' };

/**
 * Adds an inverted-hull outline to every mesh under `root` (skinned body parts and rigid
 * hats/gear). The hull is a child of its mesh, so it follows its transform and visibility.
 */
export function addOutlines(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.outline) meshes.push(o as THREE.Mesh);
  });
  for (const m of meshes) {
    let o: THREE.Mesh;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = m as THREE.SkinnedMesh;
      const so = new THREE.SkinnedMesh(sm.geometry, outlineMat);
      so.bind(sm.skeleton, sm.bindMatrix);
      o = so;
    } else o = new THREE.Mesh(m.geometry, outlineMat);
    o.name = m.name + '_outline';
    o.userData.outline = true;
    o.castShadow = false;
    o.receiveShadow = false;
    o.frustumCulled = false;
    m.add(o);
  }
}
