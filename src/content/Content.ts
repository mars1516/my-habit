import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { mulberry32 } from '../core/math';
import { physics, RAPIER, G } from '../core/Physics';
import { POIS, P, poi, waterLevelAt, HALF } from '../world/WorldGen';
import {
  Brazier, brazierPuzzle, Torch, Campfire, Windmill, Crystal, crystalPuzzle, IceWall, Barricade,
  CrackedRock, Gate, PressurePlate, platePuzzle, Wisp, SpiritRockWatcher, Chest, sign, STONE, DARK_STONE, staticCyl,
} from '../interact/Mechanisms';
import { ground, place, tower, waypoint, statue, shrineBase, shrineBeacon } from './Structures';
import { buildVillage } from './Village';
import { buildAltar } from './Boss';
import type { CampMember } from '../entities/EnemyManager';
import { events } from '../core/Events';

const rng = mulberry32(2024);
const r = (a: number, b: number) => a + rng() * (b - a);

export function buildContent() {
  buildTemple();
  buildVillage();
  buildAltar();
  buildShrines();
  for (const p of POIS) {
    if (p.kind === 'tower') tower(p.id, p.name, p.x, p.z);
    if (p.kind === 'waypoint') waypoint(p.id, p.name, p.x, p.z);
    if (p.kind === 'statue') statue(p.id, p.name, p.x, p.z, Math.atan2(P.village.x - p.x, P.village.z - p.z));
  }
  buildCamps();
  buildBrazierPuzzles();
  buildSecrets();
  scatterForage();
}

// ---------------------------------------------------------------------------
function buildTemple() {
  const c = ground(P.temple.x, P.temple.z);
  const y = c.y;
  ctx.terrain.clearGrass(c.x, c.z, 13.5);
  // floor: weathered, warm grey stone rather than bright white tiles
  const stoneTint = new Map<THREE.Material, THREE.Material>();
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) {
      const t = place((i + j) % 3 === 0 ? 'floor_tile_rocks' : 'floor_tile', new THREE.Vector3(c.x + i * 4.8, y + 0.05, c.z + j * 4.8), 0, 1.2, { collide: false });
      t.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        let tinted = stoneTint.get(src);
        if (!tinted) {
          const cl = src.clone();
          cl.color.setRGB(0.62, 0.6, 0.55);
          stoneTint.set(src, (tinted = cl));
        }
        m.material = tinted;
      });
    }
  // walls: square courtyard with a gate on the north side
  const half = 13;
  const wallPieces: [number, number, number][] = [];
  for (let k = -2; k <= 2; k++) {
    wallPieces.push([c.x + k * 5.2, c.z + half, 0]); // south
    wallPieces.push([c.x - half, c.z + k * 5.2, Math.PI / 2]); // west
    wallPieces.push([c.x + half, c.z + k * 5.2, Math.PI / 2]); // east
    if (k !== 0) wallPieces.push([c.x + k * 5.2, c.z - half, 0]); // north (gate in middle)
  }
  for (const [x, z, rot] of wallPieces) place(Math.random() < 0.25 ? 'wall_broken' : 'wall_arched', new THREE.Vector3(x, y, z), rot, 1.3, { shrink: 1 });
  ctx.props.add(new Gate(new THREE.Vector3(c.x, y, c.z - half), 0, 'temple_gate', 1.3));
  // corner pillars & rubble
  for (const [dx, dz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) place('pillar_deco', new THREE.Vector3(c.x + dx, y, c.z + dz), 0, 1.3, { shrink: 0.7 });
  place('rubble_half', new THREE.Vector3(c.x + 8, y, c.z + 8), 0.6, 0.8, { shrink: 0.6 });
  place('banner', new THREE.Vector3(c.x - 5, y, c.z + half - 0.7), 0, 1.2, { collide: false });
  place('banner', new THREE.Vector3(c.x + 5, y, c.z + half - 0.7), 0, 1.2, { collide: false });
  // braziers that open the gate
  const b1 = ctx.props.add(new Brazier(new THREE.Vector3(c.x - 4.5, y, c.z - half + 3.5)));
  const b2 = ctx.props.add(new Brazier(new THREE.Vector3(c.x + 4.5, y, c.z - half + 3.5)));
  brazierPuzzle([b1, b2], 'temple_gate');
  sign(new THREE.Vector3(c.x + 3, y, c.z + 2), Math.PI, 'controls', '조작법',
    'WASD 이동 · Shift 한 번: 달리기 고정(멈추면 해제) · Shift 3초 유지: 원소 질주\nSpace 점프(공중에서 한 번 더: 활공) · C 회피\n좌클릭 기본 마법 · E 누르고 있기: 원소 스킬 충전(1초마다 1단계, 최대 3단계) · Q 원소 폭발\n우클릭 조준 · 휠 클릭/T 적 주목 · 1~5 원소 선택 · F 상호작용 · Tab 가방 · M 지도 · H 빠른 회복 · Esc 메뉴\n벽에 대고 앞으로 움직이면 기어오를 수 있다.');
  sign(new THREE.Vector3(c.x - 3, y, c.z - half + 6), 0, 'gatehint', '낡은 석판', '「봉인문은 두 개의 불꽃을 기억한다.」\n\n화로를 향해 좌클릭으로 화염탄을 쏘아 불을 붙이자.');
  ctx.props.add(new Campfire(new THREE.Vector3(c.x - 6, y, c.z + 6), 'temple', true));
  // first chest waiting outside the gate
  new Chest(ground(c.x + 7, c.z - half - 6), Math.PI, 'temple_out', [{ item: 'apple', n: 3 }, { item: 'herb', n: 2 }]);
  // a glide hint at the plateau's east ramp and a cliff lookout
  sign(ground(92, 232), -Math.PI / 2, 'glide', '여행자의 메모', '고원의 절벽 끝에서 뛰어내린 뒤 공중에서 Space를 누르면 마력의 날개로 활공할 수 있다.\n불타는 풀 위에서는 뜨거운 공기가 몸을 띄워 준다!');
  sign(ground(-20, 330), Math.PI, 'cliffs', '여행자의 메모', '가파른 절벽도 기력이 남아 있다면 기어오를 수 있다.\n기력 원이 비면 떨어지니 조심하자.');
}

// ---------------------------------------------------------------------------
function buildShrines() {
  // --- Wind: spin the three windmills, then ride an updraft onto the pillar ---
  {
    const p = poi('shrine_wind');
    const c = ground(p.x, p.z);
    const rot = Math.atan2(-p.x, -p.z); // face the island centre
    shrineBase(p.id, 'wind', c, rot);
    const mills: Windmill[] = [];
    let charged = 0;
    for (let i = 0; i < 3; i++) {
      const a = rot + Math.PI + (i - 1) * 0.9;
      const mp = ground(c.x + Math.sin(a) * 19, c.z + Math.cos(a) * 19);
      const m = ctx.props.add(new Windmill(mp, a + Math.PI, 5.5, i === 1));
      mills.push(m);
      if (ctx.save.has('sig:shrine_wind')) m.charged = true;
      else
        m.onCharged = () => {
          charged++;
          events.emit('toast', { text: `풍차가 힘차게 돈다 (${charged}/3)`, kind: 'good' });
          if (charged >= 3) ctx.props.signal('shrine_wind');
        };
    }
    // beacon atop a tall pillar
    const bp = ground(c.x - Math.sin(rot) * 26, c.z - Math.cos(rot) * 26);
    const H = 14;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5, H, 8), STONE);
    col.position.copy(bp).add(new THREE.Vector3(0, H / 2 - 0.5, 0));
    col.castShadow = col.receiveShadow = true;
    ctx.scene.add(col);
    staticCyl(bp.clone().add(new THREE.Vector3(0, H / 2 - 0.5, 0)), H / 2, 4.6);
    shrineBeacon('wind', bp.clone().add(new THREE.Vector3(0, H - 0.5, 0)), 'shrine_wind', 3.4, 12);
    sign(ground(c.x + Math.sin(rot) * 9, c.z + Math.cos(rot) * 9), rot + Math.PI, 'windtrial', '바람의 시련', '「세 풍차가 함께 노래할 때, 봉인은 바람에 흩어지리라.」');
  }
  // --- Ice: freeze a path to a sheer islet, then melt the ice around the beacon ---
  {
    const p = poi('shrine_ice');
    const c = ground(p.x, p.z);
    shrineBase(p.id, 'ice', c, Math.PI);
    const wl = P.lake.level;
    const islet = new THREE.Vector3(p.x, wl, p.z - 58);
    const top = wl + 4.4;
    const rock = new THREE.Mesh(new THREE.CylinderGeometry(6, 7.5, 12, 9), new THREE.MeshStandardMaterial({ color: '#b8d4e0', roughness: 0.4, flatShading: true }));
    rock.position.set(islet.x, top - 6, islet.z);
    rock.castShadow = rock.receiveShadow = true;
    ctx.scene.add(rock);
    const rc = physics.fixedCollider(RAPIER.ColliderDesc.cylinder(6, 6.3), new THREE.Vector3(islet.x, top - 6, islet.z), undefined, G.STATIC);
    physics.setOwner(rc, { kind: 'islet', climbable: false });
    const bpos = new THREE.Vector3(islet.x, top, islet.z);
    shrineBeacon('ice', bpos, 'shrine_ice', 0);
    const wall = ctx.props.add(new IceWall(bpos.clone().add(new THREE.Vector3(0, 0, 0)), 0, 5.5, 11, 5.5, 'icewall:beacon'));
    wall.onMelt = () => ctx.props.signal('shrine_ice');
    if (ctx.save.has('icewall:beacon')) ctx.props.signal('shrine_ice');
    // stepping stones from the south shore to the island
    for (let i = 0; i < 4; i++) {
      const z = p.z + 44 + i * 24, x = p.x + (i % 2 ? 6 : -5);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3, 6, 7), DARK_STONE);
      s.position.set(x, wl - 2.3, z);
      s.castShadow = s.receiveShadow = true;
      ctx.scene.add(s);
      physics.setOwner(physics.fixedCollider(RAPIER.ColliderDesc.cylinder(3, 2.6), new THREE.Vector3(x, wl - 2.3, z), undefined, G.STATIC), { kind: 'rock', climbable: true });
    }
    sign(ground(c.x + 4, c.z - 8), Math.PI, 'icetrial', '서리의 시련', '「미끄러운 바위섬 위, 얼음 속에 잠든 봉화. 물을 걸어 건너고, 불로 깨워라.」');
  }
  // --- Kinesis: carry heavy rune blocks onto both pressure plates ---
  {
    const p = poi('shrine_kinesis');
    const c = ground(p.x, p.z);
    const rot = Math.atan2(P.forest.x - p.x, P.forest.z - p.z);
    shrineBase(p.id, 'kinesis', c, rot);
    const back = new THREE.Vector3(-Math.sin(rot), 0, -Math.cos(rot));
    const right = new THREE.Vector3(Math.cos(rot), 0, -Math.sin(rot));
    const bpos = ground(c.x + back.x * 24, c.z + back.z * 24);
    shrineBeacon('kinesis', bpos, 'shrine_kinesis');
    const plates = [-1, 1].map((s) => {
      const pp = c.clone().addScaledVector(back, 15).addScaledVector(right, s * 7);
      pp.y = ctx.terrain.heightAt(pp.x, pp.z);
      return ctx.props.add(new PressurePlate(pp));
    });
    platePuzzle(plates, 'shrine_kinesis');
    for (let i = 0; i < 3; i++) {
      const bp = c.clone().addScaledVector(right, (i - 1) * 8).addScaledVector(back, -14);
      bp.y = ctx.terrain.heightAt(bp.x, bp.z) + 1;
      ctx.props.dyn(i === 1 ? 'metal' : 'block', bp);
    }
    sign(ground(c.x - back.x * 9, c.z - back.z * 9), rot, 'kinesistrial', '속삭임의 시련', '「무거운 돌은 마음으로 들어 올려라. 두 개의 발판이 봉인을 기억한다.」');
  }
  // --- Lightning: make three crystals shine at once ---
  {
    const p = poi('shrine_lightning');
    const c = ground(p.x, p.z);
    shrineBase(p.id, 'lightning', c, 0);
    const crystals: Crystal[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      crystals.push(ctx.props.add(new Crystal(ground(c.x + Math.cos(a) * 15, c.z + Math.sin(a) * 15), 10)));
    }
    crystalPuzzle(crystals, 'shrine_lightning');
    const bpos = ground(c.x, c.z - 18);
    shrineBeacon('lightning', bpos, 'shrine_lightning');
    sign(ground(c.x + 6, c.z + 6), 0, 'lighttrial', '뇌운의 시련', '「세 수정이 함께 울릴 때 하늘의 문이 열린다.」\n번개는 빛나는 시간이 짧다. 서둘러라.');
  }
}

// ---------------------------------------------------------------------------
const CAMP_MEMBERS: Record<string, CampMember[]> = {
  camp_plateau: [
    { kind: 'minion', dx: -3, dz: 2, dormant: true },
    { kind: 'minion', dx: 4, dz: -1, dormant: true },
  ],
  camp_plains: [
    { kind: 'minion', dx: -4, dz: 2 },
    { kind: 'minion', dx: 3, dz: 4 },
    { kind: 'rogue', dx: 6, dz: -5 },
    { kind: 'warrior', dx: 0, dz: -3 },
  ],
  camp_forest: [
    { kind: 'minion', dx: -3, dz: 3, dormant: true },
    { kind: 'minion', dx: 5, dz: 1 },
    { kind: 'mage', dx: 1, dz: -6 },
  ],
  camp_lake: [
    { kind: 'warrior', dx: -2, dz: 3 },
    { kind: 'mage', dx: 5, dz: -4 },
    { kind: 'rogue', dx: -6, dz: -4 },
    { kind: 'minion', dx: 2, dz: 6, dormant: true },
  ],
  camp_peak: [
    { kind: 'warrior', dx: 0, dz: 3 },
    { kind: 'warrior', dx: 4, dz: -2 },
    { kind: 'mage', dx: -5, dz: -3 },
  ],
  camp_east: [
    { kind: 'minion', dx: -3, dz: 2 },
    { kind: 'rogue', dx: 5, dz: 5 },
    { kind: 'rogue', dx: -6, dz: -5 },
    { kind: 'mage', dx: 3, dz: -4 },
  ],
  camp_beach: [
    { kind: 'minion', dx: -3, dz: 2, dormant: true },
    { kind: 'minion', dx: 3, dz: 3, dormant: true },
    { kind: 'minion', dx: 0, dz: -4 },
  ],
};

const CAMP_LOOT: Record<string, { item: string; n: number }[]> = {
  camp_plateau: [{ item: 'crystal', n: 2 }, { item: 'apple', n: 2 }],
  camp_plains: [{ item: 'crystal', n: 4 }, { item: 'skewer', n: 1 }],
  camp_forest: [{ item: 'doll', n: 1 }, { item: 'glow_mushroom', n: 2 }],
  camp_lake: [{ item: 'crystal', n: 5 }, { item: 'herb_soup', n: 1 }],
  camp_peak: [{ item: 'crystal', n: 6 }, { item: 'feast', n: 1 }],
  camp_east: [{ item: 'crystal', n: 5 }, { item: 'mana_tea', n: 1 }],
  camp_beach: [{ item: 'crystal', n: 3 }, { item: 'spirit_seed', n: 1 }],
};

function buildCamps() {
  for (const p of POIS.filter((q) => q.kind === 'camp')) {
    const c = ground(p.x, p.z);
    ctx.terrain.clearGrass(c.x, c.z, 4);
    const members = CAMP_MEMBERS[p.id] ?? [];
    ctx.enemies.camp(p.id, p.name, c, members);
    const rot = r(0, Math.PI * 2);
    // tents & props
    for (let i = 0; i < 2; i++) {
      const a = rot + i * 2.2;
      place('tent', ground(c.x + Math.cos(a) * 8, c.z + Math.sin(a) * 8), -a + Math.PI / 2, 7, { shrink: 0.85 });
    }
    ctx.props.add(new Campfire(c.clone(), p.id, true));
    for (let i = 0; i < 3; i++) {
      const a = rot + 0.9 + i * 2.1;
      ctx.props.add(new Torch(ground(c.x + Math.cos(a) * 10.5, c.z + Math.sin(a) * 10.5), true));
    }
    place('weaponrack', ground(c.x + Math.cos(rot + 3) * 6, c.z + Math.sin(rot + 3) * 6), rot, 6, { shrink: 0.8 });
    for (let i = 0; i < 3; i++) {
      const a = rot + 4 + i * 0.4;
      ctx.props.dyn(i === 1 ? 'bomb' : i === 0 ? 'crate' : 'barrel', ground(c.x + Math.cos(a) * 7, c.z + Math.sin(a) * 7, 0.7));
    }
    const chestPos = ground(c.x + Math.cos(rot + 1.6) * 5, c.z + Math.sin(rot + 1.6) * 5);
    new Chest(chestPos, rot, p.id, CAMP_LOOT[p.id] ?? [{ item: 'crystal', n: 3 }], {
      lockedWhile: () => (ctx.enemies.campCleared(p.id) ? null : '단단히 잠겨 있다… 야영지의 해골을 모두 쓰러뜨리자'),
    });
    // boulder on a nearby slope to roll into the camp
    const bpos = ground(c.x + Math.cos(rot - 1) * 22, c.z + Math.sin(rot - 1) * 22, 1.5);
    if (waterLevelAt(bpos.x, bpos.z) < bpos.y - 2) ctx.props.dyn('boulder', bpos);
  }
}

// ---------------------------------------------------------------------------
function buildBrazierPuzzles() {
  const defs: { id: string; n: number; rad: number; loot: { item: string; n: number }[] }[] = [
    { id: 'braziers_temple', n: 3, rad: 5.5, loot: [{ item: 'glow_mushroom', n: 2 }, { item: 'crystal', n: 2 }] },
    { id: 'braziers_forest', n: 4, rad: 6.5, loot: [{ item: 'spirit_seed', n: 1 }, { item: 'crystal', n: 4 }] },
    { id: 'braziers_cliff', n: 3, rad: 6, loot: [{ item: 'feast', n: 1 }, { item: 'crystal', n: 3 }] },
  ];
  for (const d of defs) {
    const p = poi(d.id);
    const c = ground(p.x, p.z);
    const braziers: Brazier[] = [];
    for (let i = 0; i < d.n; i++) {
      const a = (i / d.n) * Math.PI * 2;
      braziers.push(ctx.props.add(new Brazier(ground(c.x + Math.cos(a) * d.rad, c.z + Math.sin(a) * d.rad))));
    }
    brazierPuzzle(braziers, d.id);
    ctx.terrain.clearGrass(c.x, c.z, d.rad + 2);
    new Chest(c.clone(), 0, d.id, d.loot, { hiddenUntil: d.id, gold: d.id === 'braziers_cliff' });
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(d.rad + 1.8, d.rad + 2.2, 0.4, 16), STONE);
    floor.position.copy(c).add(new THREE.Vector3(0, -0.05, 0));
    floor.receiveShadow = true;
    ctx.scene.add(floor);
  }
}

// ---------------------------------------------------------------------------
function buildSecrets() {
  // Spirit rocks (lift or blow them away to find a seed)
  const rocks: [number, number][] = [
    [30, 230], [-70, 300], [140, 150], [210, 60], [-230, 300], [-300, 150], [-60, -120],
    [100, -60], [350, 40], [-170, -250], [250, -200], [60, 380], [-380, 60], [180, 330],
  ];
  rocks.forEach(([x, z], i) => {
    // nudge to the flattest nearby spot so the rock doesn't roll away
    let bx = x, bz = z, best = -1;
    for (let k = 0; k < 16; k++) {
      const tx = x + (k % 4) * 3 - 4.5, tz = z + Math.floor(k / 4) * 3 - 4.5;
      const ny = ctx.terrain.normalAt(tx, tz).y;
      if (ny > best) {
        best = ny;
        bx = tx;
        bz = tz;
      }
    }
    x = bx;
    z = bz;
    if (waterLevelAt(x, z) > ctx.terrain.heightAt(x, z) - 0.5) return;
    ctx.props.add(new SpiritRockWatcher(ground(x, z), 'seed:rock' + i));
  });
  // Shy wisps
  const wisps: [number, number][] = [[-20, 210], [230, 250], [-250, 240], [-190, -60], [120, -250], [380, -120], [-330, -250], [300, 220], [-100, 60]];
  wisps.forEach(([x, z], i) => ctx.props.add(new Wisp(ground(x, z, 1.5), 'seed:wisp' + i)));
  // Seeds in lofty places
  ctx.interact.spawnPickup('spirit_seed', ground(P.peak.x + 6, P.peak.z + 6, 0.4), false, 'seed:peak', true);
  // Cracked rock guarding a nook on the plateau cliff base
  crackedNook(ground(60, 345), 'nook_south', [{ item: 'crystal', n: 5 }, { item: 'spirit_seed', n: 1 }]);
  crackedNook(ground(-150, -20), 'nook_mid', [{ item: 'feast', n: 1 }, { item: 'crystal', n: 4 }]);
  // Barricaded cache in the forest
  {
    const c = ground(-360, 190);
    const bar = ctx.props.add(new Barricade(c.clone().add(new THREE.Vector3(0, 0, 4)), 0, 5, 3.2, 'barricade:forest'));
    void bar;
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3.4, 7), DARK_STONE);
      w.position.copy(c).add(new THREE.Vector3(s * 2.9, 1.7, 0.6));
      w.castShadow = true;
      ctx.scene.add(w);
      staticCylBox(w.position, 0.4, 1.7, 3.5);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(6.6, 3.4, 0.8), DARK_STONE);
    back.position.copy(c).add(new THREE.Vector3(0, 1.7, -2.8));
    ctx.scene.add(back);
    staticCylBox(back.position, 3.3, 1.7, 0.4);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.6, 7.6), DARK_STONE);
    roof.position.copy(c).add(new THREE.Vector3(0, 3.6, 0.6));
    ctx.scene.add(roof);
    staticCylBox(roof.position, 3.3, 0.3, 3.8);
    new Chest(c.clone(), 0, 'barricade_forest', [{ item: 'spirit_seed', n: 2 }, { item: 'crystal', n: 3 }]);
  }
  // Frozen cache in the frost lands
  {
    const c = ground(-80, -300);
    new Chest(c.clone(), Math.PI / 4, 'frozen_cache', [{ item: 'mana_tea', n: 2 }, { item: 'crystal', n: 4 }]);
    const w = ctx.props.add(new IceWall(c.clone().add(new THREE.Vector3(0, -0.3, 0)), 0, 4, 3.5, 4, 'icewall:cache'));
    void w;
  }
}

function staticCylBox(pos: THREE.Vector3, hx: number, hy: number, hz: number) {
  const c = physics.fixedCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), pos, undefined, G.STATIC);
  physics.setOwner(c, { kind: 'structure', climbable: true });
}

function crackedNook(c: THREE.Vector3, id: string, loot: { item: string; n: number }[]) {
  new Chest(c.clone(), 0, id, loot);
  new CrackedRock(c.clone().add(new THREE.Vector3(0, -0.8, 0)), 2.6, 'crack:' + id);
}

// ---------------------------------------------------------------------------
function scatterForage() {
  const place = (item: string, n: number, test: (x: number, z: number, h: number) => boolean, spread = HALF - 40) => {
    let made = 0;
    for (let tries = 0; tries < n * 40 && made < n; tries++) {
      const x = r(-spread, spread), z = r(-spread, spread);
      const h = ctx.terrain.heightAt(x, z);
      if (h < waterLevelAt(x, z) + 1) continue;
      if (ctx.terrain.normalAt(x, z).y < 0.85) continue;
      if (!test(x, z, h)) continue;
      ctx.interact.spawnPickup(item, new THREE.Vector3(x, h, z));
      made++;
    }
  };
  const dist = (x: number, z: number, p: { x: number; z: number }) => Math.hypot(x - p.x, z - p.z);
  place('mushroom', 45, (x, z) => dist(x, z, P.forest) < 190);
  place('glow_mushroom', 16, (x, z) => dist(x, z, P.forest) < 170 || dist(x, z, P.lake) < 175);
  place('herb', 45, (x, z, h) => h > 4 && h < 90 && dist(x, z, P.forest) > 120);
  place('mushroom', 10, (x, z) => dist(x, z, P.plateau) < 95);
  place('herb', 8, (x, z) => dist(x, z, P.plateau) < 95);
  // dynamic toys around the world
  for (let i = 0; i < 14; i++) {
    const x = r(-420, 420), z = r(-420, 420);
    const h = ctx.terrain.heightAt(x, z);
    if (h < waterLevelAt(x, z) + 2 || ctx.terrain.normalAt(x, z).y < 0.8) continue;
    ctx.props.dyn(i % 3 === 0 ? 'boulder' : i % 3 === 1 ? 'log' : 'crate', new THREE.Vector3(x, h + 1.5, z), r(0, 6));
  }
  void staticCyl;
}
