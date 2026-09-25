import { createNoise2D } from 'simplex-noise';
import { mulberry32, smoothstep, lerp, clamp, segmentDistance } from '../core/math';

/** World extents: x,z in [-HALF, HALF]. North is -z. */
export const WORLD_SIZE = 1024;
export const HALF = WORLD_SIZE / 2;
export const RES = 512; // cells per side
export const CELL = WORLD_SIZE / RES; // 2m
export const SEA_LEVEL = 0;

const noiseA = createNoise2D(mulberry32(1337));
const noiseB = createNoise2D(mulberry32(4242));
const noiseC = createNoise2D(mulberry32(9001));

export function fbm(x: number, z: number, oct = 4, n = noiseA) {
  let a = 1, f = 1, s = 0, t = 0;
  for (let i = 0; i < oct; i++) {
    s += n(x * f, z * f) * a;
    t += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / t;
}

function ridged(x: number, z: number, oct = 4) {
  let a = 1, f = 1, s = 0, t = 0;
  for (let i = 0; i < oct; i++) {
    s += (1 - Math.abs(noiseB(x * f, z * f))) * a;
    t += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / t;
}

export const P = {
  plateau: { x: 0, z: 250, r: 100, h: 46 },
  temple: { x: 0, z: 292 },
  village: { x: 290, z: 130 },
  forest: { x: -270, z: 210 },
  lake: { x: -250, z: -170, r: 130, level: 8 },
  peak: { x: 40, z: -290 },
  eastCliffs: { x: 405, z: -60 },
  altar: { x: 20, z: -40 },
} as const;

export interface WaterBody {
  id: string;
  level: number;
  x: number;
  z: number;
  radius: number; // Infinity for the sea
}

export const WATER_BODIES: WaterBody[] = [
  { id: 'sea', level: SEA_LEVEL, x: 0, z: 0, radius: Infinity },
  { id: 'lake', level: P.lake.level, x: P.lake.x, z: P.lake.z, radius: P.lake.r + 22 },
];

export interface Flatten {
  x: number;
  z: number;
  r: number;
  fall: number;
  offset?: number;
  /** Absolute target height (otherwise raw height at the center). */
  height?: number;
}

export type PoiKind =
  | 'shrine'
  | 'tower'
  | 'waypoint'
  | 'statue'
  | 'camp'
  | 'village'
  | 'altar'
  | 'temple'
  | 'braziers'
  | 'windmills';

export interface Poi {
  id: string;
  kind: PoiKind;
  x: number;
  z: number;
  name: string;
  element?: 'fire' | 'ice' | 'wind' | 'lightning' | 'kinesis';
  flatten?: number;
}

export const POIS: Poi[] = [
  { id: 'temple', kind: 'temple', x: P.temple.x, z: P.temple.z, name: '새벽의 사원', flatten: 26 },
  { id: 'village', kind: 'village', x: P.village.x, z: P.village.z, name: '바람골 마을' },
  { id: 'altar', kind: 'altar', x: P.altar.x, z: P.altar.z, name: '원소의 제단' },
  // shrines grant a new element each
  { id: 'shrine_wind', kind: 'shrine', x: 412, z: -78, name: '바람의 사당', element: 'wind', flatten: 20 },
  { id: 'shrine_ice', kind: 'shrine', x: P.lake.x, z: P.lake.z, name: '서리의 사당', element: 'ice', flatten: 17 },
  { id: 'shrine_kinesis', kind: 'shrine', x: -330, z: 290, name: '속삭임의 사당', element: 'kinesis', flatten: 20 },
  { id: 'shrine_lightning', kind: 'shrine', x: P.peak.x, z: P.peak.z, name: '뇌운의 사당', element: 'lightning', flatten: 20 },
  // observation towers reveal the map
  { id: 'tower_plains', kind: 'tower', x: 175, z: 20, name: '평원 관측탑', flatten: 8 },
  { id: 'tower_forest', kind: 'tower', x: -170, z: 300, name: '숲 관측탑', flatten: 8 },
  { id: 'tower_lake', kind: 'tower', x: -110, z: -150, name: '호수 관측탑', flatten: 8 },
  { id: 'tower_peak', kind: 'tower', x: 170, z: -210, name: '산기슭 관측탑', flatten: 8 },
  // fast travel
  { id: 'wp_temple', kind: 'waypoint', x: 22, z: 268, name: '새벽 고원', flatten: 6 },
  { id: 'wp_village', kind: 'waypoint', x: 262, z: 170, name: '바람골 마을', flatten: 6 },
  { id: 'wp_forest', kind: 'waypoint', x: -290, z: 245, name: '속삭임의 숲', flatten: 6 },
  { id: 'wp_lake', kind: 'waypoint', x: -120, z: -210, name: '서리 호숫가', flatten: 6 },
  { id: 'wp_peak', kind: 'waypoint', x: 95, z: -170, name: '뇌운산 기슭', flatten: 6 },
  { id: 'wp_cliffs', kind: 'waypoint', x: 372, z: -40, name: '동쪽 절벽', flatten: 6 },
  { id: 'wp_altar', kind: 'waypoint', x: 30, z: 30, name: '제단 입구', flatten: 6 },
  { id: 'wp_beach', kind: 'waypoint', x: -110, z: 385, name: '남서 해안', flatten: 6 },
  // goddess statues (offer spirit seeds)
  { id: 'statue_village', kind: 'statue', x: 318, z: 104, name: '바람골 여신상', flatten: 6 },
  { id: 'statue_forest', kind: 'statue', x: -215, z: 165, name: '숲의 여신상', flatten: 6 },
  { id: 'statue_lake', kind: 'statue', x: -140, z: -95, name: '호숫가 여신상', flatten: 6 },
  // skeleton camps
  { id: 'camp_plains', kind: 'camp', x: 165, z: -45, name: '평원 해골 야영지', flatten: 14 },
  { id: 'camp_forest', kind: 'camp', x: -190, z: 105, name: '숲 해골 야영지', flatten: 14 },
  { id: 'camp_lake', kind: 'camp', x: -330, z: -330, name: '호수 북쪽 야영지', flatten: 14 },
  { id: 'camp_peak', kind: 'camp', x: 130, z: -130, name: '산길 야영지', flatten: 14 },
  { id: 'camp_east', kind: 'camp', x: 320, z: -160, name: '동쪽 야영지', flatten: 14 },
  { id: 'camp_beach', kind: 'camp', x: -40, z: 400, name: '해안 야영지', flatten: 14 },
  { id: 'camp_plateau', kind: 'camp', x: -45, z: 215, name: '고원 폐허', flatten: 10 },
  // brazier puzzles
  { id: 'braziers_temple', kind: 'braziers', x: 0, z: 262, name: '사원의 화로' },
  { id: 'braziers_forest', kind: 'braziers', x: -140, z: 230, name: '숲의 화로', flatten: 10 },
  { id: 'braziers_cliff', kind: 'braziers', x: 250, z: -110, name: '바위 언덕의 화로', flatten: 10 },
];

export const poi = (id: string) => POIS.find((p) => p.id === id)!;

/** Dirt roads (polylines). */
export const ROADS: [number, number][][] = [
  [[0, 285], [50, 262], [115, 238], [185, 205], [262, 170], [290, 140]],
  [[290, 140], [330, 60], [360, -10], [372, -40]],
  [[262, 170], [180, 90], [100, 40], [30, 30], [20, -10]],
  [[30, 30], [-60, -40], [-110, -100], [-120, -200]],
  [[20, -80], [70, -130], [95, -170]],
  [[0, 285], [-60, 280], [-140, 262], [-220, 250], [-290, 245]],
  [[-290, 245], [-250, 150], [-215, 60], [-170, -30], [-110, -100]],
  [[-60, 280], [-80, 340], [-110, 385]],
];

const FLATTENS: Flatten[] = [
  { x: P.village.x, z: P.village.z, r: 62, fall: 34 },
  { x: P.altar.x, z: P.altar.z, r: 40, fall: 26, offset: -3 },
];
for (const p of POIS) if (p.flatten) FLATTENS.push({ x: p.x, z: p.z, r: p.flatten, fall: p.flatten * 0.8 });

const dist = (x: number, z: number, p: { x: number; z: number }) => Math.hypot(x - p.x, z - p.z);

/** Terrain height before local flattening. */
function rawHeight(x: number, z: number) {
  const warp = noiseC(x * 0.0026, z * 0.0026) * 70;
  const r = Math.hypot(x, z * 1.04) + warp;
  const land = 1 - smoothstep(370, 470, r);

  let h = -24 + land * 32;
  h += land * fbm(x * 0.0042, z * 0.0042, 4) * 11;
  h += land * Math.max(0, fbm(x * 0.0017 + 11, z * 0.0017 - 7, 3)) * 26;

  // Thunder peak
  const dm = dist(x, z, P.peak);
  const m = Math.max(0, 1 - dm / 245);
  h += Math.pow(m, 1.7) * 160 + ridged(x * 0.012, z * 0.012) * m * m * 34;

  // East cliff highland dropping into the sea
  const de = dist(x, z, P.eastCliffs);
  const eBlend = 1 - smoothstep(70, 115, de + noiseA(x * 0.02, z * 0.02) * 12);
  h = lerp(h, 54 + fbm(x * 0.03, z * 0.03, 2) * 4, eBlend);

  // Dawn plateau: cliffs all around except two ramps (east and west)
  const dp = dist(x, z, P.plateau) + noiseB(x * 0.02, z * 0.02) * 9;
  const ang = Math.atan2(z - P.plateau.z, x - P.plateau.x);
  const rampE = Math.pow(Math.max(0, Math.cos(ang + 0.35)), 18);
  const rampW = Math.pow(Math.max(0, Math.cos(ang - Math.PI + 0.2)), 18);
  const width = 16 + 150 * Math.max(rampE, rampW);
  const pBlend = 1 - smoothstep(P.plateau.r, P.plateau.r + width, dp);
  const plateauH = P.plateau.h + fbm(x * 0.01, z * 0.01, 3) * 3;
  h = lerp(h, Math.max(h, plateauH), pBlend);

  // Frost lake basin with a raised rim and an island
  const dl = dist(x, z, P.lake) + noiseA(x * 0.015 + 3, z * 0.015) * 10;
  const L = P.lake.level;
  const R = P.lake.r;
  if (dl < R + 40) {
    const bed = L - 1.2 - 8 * smoothstep(R, R * 0.45, dl);
    const inner = 1 - smoothstep(R - 2, R + 4, dl);
    h = lerp(h, Math.min(h, bed), inner);
    const rim = smoothstep(R, R + 6, dl) * (1 - smoothstep(R + 26, R + 40, dl));
    h = lerp(h, Math.max(h, L + 1.4 + fbm(x * 0.03, z * 0.03, 2) * 1.2), rim);
    const island = L + 6 - smoothstep(14, 34, dl) * 11;
    h = Math.max(h, island);
  }
  return h;
}

const flattenTargets = FLATTENS.map((f) => (f.height ?? rawHeight(f.x, f.z)) + (f.offset ?? 0));

export function computeHeight(x: number, z: number) {
  let h = rawHeight(x, z);
  for (let i = 0; i < FLATTENS.length; i++) {
    const f = FLATTENS[i];
    const d = Math.hypot(x - f.x, z - f.z);
    if (d > f.r + f.fall) continue;
    const t = 1 - smoothstep(f.r, f.r + f.fall, d);
    h = lerp(h, flattenTargets[i], t);
  }
  // Roads are gently smoothed so they read as paths.
  const rd = roadDistance(x, z);
  if (rd < 5) h -= (1 - smoothstep(1.5, 5, rd)) * 0.25;
  return h;
}

export function roadDistance(x: number, z: number) {
  let best = Infinity;
  for (const road of ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      const a = road[i], b = road[i + 1];
      // quick reject
      const minx = Math.min(a[0], b[0]) - 8, maxx = Math.max(a[0], b[0]) + 8;
      const minz = Math.min(a[1], b[1]) - 8, maxz = Math.max(a[1], b[1]) + 8;
      if (x < minx || x > maxx || z < minz || z > maxz) continue;
      const wob = noiseC(x * 0.05, z * 0.05) * 1.2;
      best = Math.min(best, segmentDistance(x, z, a[0], a[1], b[0], b[1]) + wob);
    }
  }
  return best;
}

export function isFlattened(x: number, z: number, pad = 0) {
  for (const f of FLATTENS) if (Math.hypot(x - f.x, z - f.z) < f.r + pad) return true;
  return false;
}

export interface Biome {
  forest: number;
  frost: number;
  plains: number;
  mountain: number;
}

export function biomeAt(x: number, z: number, h: number): Biome {
  const forest = 1 - smoothstep(130, 210, dist(x, z, P.forest) + noiseA(x * 0.01, z * 0.01) * 30);
  const frost = clamp((1 - smoothstep(150, 260, dist(x, z, P.lake))) + smoothstep(-120, -260, z) * 0.5 * (x < 120 ? 1 : 0), 0, 1);
  const mountain = smoothstep(55, 110, h);
  const plains = clamp(1 - forest - frost * 0.7, 0, 1);
  return { forest, frost, plains, mountain };
}

export function regionName(x: number, z: number): string {
  if (Math.hypot(x, z) > 470) return '에테리아 앞바다';
  if (dist(x, z, P.plateau) < 125) return '새벽 고원';
  if (dist(x, z, P.village) < 95) return '바람골 마을';
  if (dist(x, z, P.altar) < 70) return '원소의 제단';
  if (dist(x, z, P.lake) < 175) return '서리 호수';
  if (dist(x, z, P.peak) < 170) return '뇌운산';
  if (dist(x, z, P.eastCliffs) < 120) return '동쪽 바람 절벽';
  if (dist(x, z, P.forest) < 200) return '속삭임의 숲';
  if (z < -150) return '북부 설원';
  if (x > 100) return '바람의 평원';
  if (z > 330) return '남쪽 해안';
  return '에테리아 중부 초원';
}

export function waterLevelAt(x: number, z: number) {
  const lake = WATER_BODIES[1];
  if (Math.hypot(x - lake.x, z - lake.z) < lake.radius) return lake.level;
  return SEA_LEVEL;
}
