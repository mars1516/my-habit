import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { physics, RAPIER, G } from '../core/Physics';
import { assets } from '../core/Assets';
import { events } from '../core/Events';
import { Prop } from '../interact/Props';
import { STONE, DARK_STONE, WOOD, staticCyl, staticBox, Beacon } from '../interact/Mechanisms';
import { ELEMENT_INFO, type Element } from '../magic/Elements';
import { SKILLS } from '../magic/SkillSystem';
import { Character } from '../player/Character';

export const ground = (x: number, z: number, dy = 0) => new THREE.Vector3(x, ctx.terrain.heightAt(x, z) + dy, z);

/** Place a KayKit model with an oriented box collider fitted to its bounds. */
export function place(name: string, pos: THREE.Vector3, rotY = 0, scale = 1, opts: { collide?: boolean; shrink?: number; climbable?: boolean; sink?: number } = {}) {
  const obj = assets.env(name);
  obj.scale.setScalar(scale);
  obj.position.copy(pos);
  obj.position.y -= opts.sink ?? 0;
  ctx.scene.add(obj);
  if (opts.collide !== false) {
    const tmp = assets.env(name);
    tmp.scale.setScalar(scale);
    tmp.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tmp);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const k = opts.shrink ?? 0.92;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    center.applyQuaternion(q).add(pos);
    center.y -= opts.sink ?? 0;
    const c = physics.fixedCollider(RAPIER.ColliderDesc.cuboid((size.x / 2) * k, size.y / 2, (size.z / 2) * k), center, q, G.STATIC);
    physics.setOwner(c, { kind: 'structure', climbable: opts.climbable ?? true });
  }
  obj.rotation.y = rotY;
  return obj;
}

// ---------------------------------------------------------------------------
/** Observation tower: climb it and survey the land to reveal the map. */
export function tower(id: string, name: string, x: number, z: number) {
  const base = ground(x, z);
  ctx.terrain.clearGrass(x, z, 4);
  const H = 22;
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, H, 10), STONE);
  shaft.position.y = H / 2;
  const bands = [4, 11, 18].map((y) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.6, 10), DARK_STONE);
    b.position.y = y;
    return b;
  });
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.2, 0.7, 12), WOOD);
  deck.position.y = H + 0.35;
  const rail = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.12, 4, 24), WOOD);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = H + 1.3;
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.1, 6), STONE);
  pedestal.position.y = H + 1.2;
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color: '#9fe8ff', emissive: '#4ab0ff', emissiveIntensity: 0.4, flatShading: true }));
  orb.position.y = H + 2.2;
  g.add(shaft, ...bands, deck, rail, pedestal, orb);
  for (let i = 0; i < 6; i++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), WOOD);
    const a = (i / 6) * Math.PI * 2;
    post.position.set(Math.cos(a) * 4.4, H + 0.9, Math.sin(a) * 4.4);
    g.add(post);
  }
  const flag = assets.env('flag');
  flag.scale.setScalar(9);
  flag.position.set(0, H + 1.2, -3.2);
  g.add(flag);
  g.traverse((o) => {
    (o as THREE.Mesh).castShadow = true;
    (o as THREE.Mesh).receiveShadow = true;
  });
  g.position.copy(base);
  ctx.scene.add(g);
  staticCyl(base.clone().add(new THREE.Vector3(0, H / 2, 0)), H / 2, 3.0);
  const deckCol = physics.fixedCollider(RAPIER.ColliderDesc.cylinder(0.35, 4.6), base.clone().add(new THREE.Vector3(0, H + 0.35, 0)), undefined, G.STATIC);
  physics.setOwner(deckCol, { kind: 'structure', climbable: true });
  staticCyl(base.clone().add(new THREE.Vector3(0, H + 1.2, 0)), 0.55, 0.6);
  const flagId = 'tower:' + id;
  const light = () => {
    (orb.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.5;
  };
  if (ctx.save.has(flagId)) light();
  ctx.props.add(
    new (class extends Prop {
      override update(dt: number) {
        orb.rotation.y += dt * (ctx.save.has(flagId) ? 2 : 0.5);
      }
    })(),
  );
  ctx.interact.register({
    id: flagId,
    pos: () => base.clone().add(new THREE.Vector3(0, H + 0.7, 0)),
    radius: 3.2,
    verb: () => '관측하기',
    name: () => name,
    enabled: () => !ctx.save.has(flagId),
    action: () => {
      ctx.save.set(flagId);
      light();
      ctx.ui.revealMap(x, z, 300);
      ctx.fx.sphere(base.clone().add(new THREE.Vector3(0, H + 2.2, 0)), '#9fe8ff', 12, 1.2);
      events.emit('banner', { title: '지도 갱신', sub: name, color: '#9fe8ff' });
      events.emit('sound', { name: 'discover', volume: 0.9 });
    },
  });
  // a spirit seed waits at the top
  ctx.interact.spawnPickup('spirit_seed', base.clone().add(new THREE.Vector3(2.6, H + 1.0, 1.5)), false, 'seed:' + id, true);
}

// ---------------------------------------------------------------------------
/** Fast-travel stone. */
export function waypoint(id: string, name: string, x: number, z: number) {
  const base = ground(x, z);
  ctx.terrain.clearGrass(x, z, 2.8);
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 0.4, 12), STONE);
  disc.position.y = 0.2;
  g.add(disc);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.35), DARK_STONE);
    s.position.set(Math.cos(a) * 2, 1.1, Math.sin(a) * 2);
    s.rotation.y = -a;
    g.add(s);
  }
  const ringMat = new THREE.MeshBasicMaterial({ map: ctx.fx.runeTex, color: new THREE.Color('#5a6070'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8).rotateX(-Math.PI / 2), ringMat);
  ring.position.y = 0.42;
  const gemMat = new THREE.MeshStandardMaterial({ color: '#6a7a8a', emissive: '#3aa0ff', emissiveIntensity: 0, flatShading: true });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), gemMat);
  gem.position.y = 2.4;
  g.add(ring, gem);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  g.position.copy(base);
  ctx.scene.add(g);
  physics.setOwner(physics.fixedCollider(RAPIER.ColliderDesc.cylinder(0.2, 2.4), base.clone().add(new THREE.Vector3(0, 0.2, 0)), undefined, G.STATIC), { kind: 'structure' });
  const flag = 'wp:' + id;
  const activate = () => {
    ringMat.color.set('#6fd0ff').multiplyScalar(1.6);
    gemMat.emissiveIntensity = 2;
    gemMat.color.set('#9fe8ff');
  };
  if (ctx.save.has(flag)) activate();
  ctx.props.add(
    new (class extends Prop {
      override update(dt: number) {
        gem.rotation.y += dt;
        gem.position.y = 2.4 + Math.sin(ctx.time * 1.5) * 0.15;
        ring.rotation.y += dt * 0.2;
      }
    })(),
  );
  ctx.interact.register({
    id: flag,
    pos: () => base,
    radius: 3.2,
    verb: () => (ctx.save.has(flag) ? '지도 열기' : '활성화'),
    name: () => '텔레포트 지점 · ' + name,
    enabled: () => true,
    action: () => {
      if (!ctx.save.has(flag)) {
        ctx.save.set(flag);
        activate();
        ctx.fx.sphere(base.clone().add(new THREE.Vector3(0, 1.5, 0)), '#6fd0ff', 5, 0.8);
        events.emit('banner', { title: '텔레포트 지점 활성화', sub: name, color: '#6fd0ff' });
        events.emit('sound', { name: 'discover', volume: 0.8 });
        ctx.ui.setRespawn(base.clone().add(new THREE.Vector3(0, 0.6, 3)));
        ctx.ui.autosave();
      } else ctx.ui.openMap();
    },
  });
}

// ---------------------------------------------------------------------------
/** Goddess statue: offer 3 spirit seeds for a heart or more stamina. Also restores health. */
export function statue(id: string, name: string, x: number, z: number, rotY: number) {
  const base = ground(x, z);
  ctx.terrain.clearGrass(x, z, 2.5);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 1.4, 8), STONE);
  ped.position.copy(base).add(new THREE.Vector3(0, 0.7, 0));
  ped.castShadow = ped.receiveShadow = true;
  ctx.scene.add(ped);
  const fig = new Character('rogue_hooded', 'adventurer', 1.25);
  fig.hide(['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable']);
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.8, emissive: '#403a30', emissiveIntensity: 0.2 });
  fig.model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.material = stoneMat;
  });
  fig.root.position.copy(base).add(new THREE.Vector3(0, 1.4, 0));
  fig.root.rotation.y = rotY;
  fig.play('Spellcast_Raise', { fade: 0 });
  fig.mixer.update(0.55);
  fig.mixer.timeScale = 0;
  ctx.scene.add(fig.root);
  staticCyl(base.clone().add(new THREE.Vector3(0, 2.2, 0)), 2.2, 2.0);
  const glow = new THREE.PointLight('#ffe8a0', 0, 8);
  ctx.interact.register({
    id: 'statue:' + id,
    pos: () => base,
    radius: 4.2,
    verb: () => '기도하기',
    name: () => name,
    enabled: () => true,
    action: () => {
      ctx.player.heal(999);
      ctx.player.stamina = ctx.player.maxStamina;
      ctx.ui.setRespawn(base.clone().add(new THREE.Vector3(Math.sin(rotY) * 4, 0.5, Math.cos(rotY) * 4)));
      ctx.particles.emit({ pos: ctx.player.pos.clone().add(new THREE.Vector3(0, 1, 0)), count: 30, spread: 2, vel: new THREE.Vector3(0, 2, 0), life: [0.6, 1.2], size: [0.3, 0.05], color: '#fff0b0' });
      events.emit('sound', { name: 'heal', volume: 0.6 });
      ctx.ui.openStatue(name);
    },
  });
  void glow;
}

// ---------------------------------------------------------------------------
const sealMat = (color: string) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.4) }, uTime: { value: 0 }, uFade: { value: 1 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying float vDist; void main(){ vUv=uv; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vDist = -mv.z; gl_Position = projectionMatrix*mv;} `,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uFade; varying vec2 vUv; varying vec3 vN; varying float vDist;
      void main(){ float hex = abs(sin(vUv.x*60.0 + sin(vUv.y*30.0)*0.5)) * abs(sin(vUv.y*28.0 + uTime*0.8));
        float rim = 1.0 - abs(vN.z);
        float a = (0.1 + smoothstep(0.85, 1.0, hex)*0.35 + rim*0.3) * uFade;
        a *= 0.6 + 0.4*sin(uTime*2.0 + vUv.y*10.0);
        // a veil that thins towards the top and melts into the haze far away
        a *= (1.0 - smoothstep(0.35, 1.0, vUv.y)) * (0.4 + 0.6 * smoothstep(0.0, 0.08, vUv.y));
        a *= 1.0 - smoothstep(60.0, 220.0, vDist) * 0.85;
        gl_FragColor = vec4(uColor, a); }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

/** A translucent barrier that dissolves when its signal fires. */
export class Seal extends Prop {
  mesh: THREE.Mesh;
  colliders: RAPIER.Collider[] = [];
  open = false;
  private fade = -1;
  constructor(center: THREE.Vector3, r: number, h: number, color: string, public signal: string, solidRing = false) {
    super();
    this.pos.copy(center);
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32, 1, true).translate(0, h / 2, 0), sealMat(color));
    this.mesh.position.copy(center);
    ctx.scene.add(this.mesh);
    if (solidRing) {
      const n = Math.max(12, Math.round(r * 1.2));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const p = center.clone().add(new THREE.Vector3(Math.cos(a) * r, h / 2, Math.sin(a) * r));
        this.colliders.push(staticBox(p, (Math.PI * r) / n + 0.2, h / 2, 0.4, -a + Math.PI / 2, { kind: 'seal', climbable: false }));
      }
    } else {
      const c = physics.fixedCollider(RAPIER.ColliderDesc.cylinder(h / 2, r), center.clone().add(new THREE.Vector3(0, h / 2, 0)), undefined, G.STATIC);
      physics.setOwner(c, { kind: 'seal', climbable: false });
      this.colliders.push(c);
    }
    const already = ctx.save.has('sig:' + signal);
    ctx.props.on(signal, () => this.dissolve(already));
  }
  dissolve(silent: boolean) {
    if (this.open) return;
    this.open = true;
    for (const c of this.colliders) physics.removeCollider(c);
    this.colliders = [];
    if (silent) {
      this.mesh.removeFromParent();
      return;
    }
    this.fade = 1;
    events.emit('sound', { name: 'seal', pos: this.pos, volume: 0.8 });
  }
  override update(dt: number) {
    const u = (this.mesh.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value += dt;
    if (this.fade >= 0) {
      this.fade -= dt * 0.6;
      u.uFade.value = Math.max(0, this.fade);
      this.mesh.scale.set(1 + (1 - this.fade) * 0.3, 1, 1 + (1 - this.fade) * 0.3);
      if (this.fade <= 0) {
        this.mesh.removeFromParent();
        this.fade = -2;
      }
    }
  }
}

// ---------------------------------------------------------------------------
/** Shrine plaza: altar grants an element; the beacon is sealed until the trial is solved. */
export function shrineBase(id: string, element: Element, center: THREE.Vector3, rotY: number) {
  const color = ELEMENT_INFO[element].color;
  ctx.terrain.clearGrass(center.x, center.z, 12.6);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(12, 12.6, 1.2, 16), STONE);
  floor.position.copy(center).add(new THREE.Vector3(0, -0.4, 0));
  floor.receiveShadow = true;
  ctx.scene.add(floor);
  physics.setOwner(physics.fixedCollider(RAPIER.ColliderDesc.cylinder(0.6, 12.4), center.clone().add(new THREE.Vector3(0, -0.4, 0)), undefined, G.STATIC), { kind: 'structure' });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rotY + Math.PI / 8;
    const p = center.clone().add(new THREE.Vector3(Math.cos(a) * 10.8, 0.2, Math.sin(a) * 10.8));
    const broken = i % 3 === 1;
    const pil = place(broken ? 'column' : 'pillar_deco', p, a, broken ? 1.3 : 1.05, { shrink: 0.7 });
    void pil;
  }
  // runic floor mark + altar
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ctx.fx.runeTex, color: new THREE.Color(color).multiplyScalar(0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  mark.position.copy(center).add(new THREE.Vector3(0, 0.22, 0));
  ctx.scene.add(mark);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 1.3, 8), DARK_STONE);
  ped.position.copy(center).add(new THREE.Vector3(0, 0.85, 0));
  ped.castShadow = true;
  ctx.scene.add(ped);
  staticCyl(center.clone().add(new THREE.Vector3(0, 0.8, 0)), 0.75, 1.2);
  const orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2) });
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 2), orbMat);
  orb.position.copy(center).add(new THREE.Vector3(0, 2.4, 0));
  orb.userData.noCull = true;
  ctx.scene.add(orb);
  const flag = 'skill:' + element;
  ctx.props.add(
    new (class extends Prop {
      override update(dt: number) {
        orb.position.y = center.y + 2.4 + Math.sin(ctx.time * 2) * 0.2;
        orb.visible = !ctx.save.skills.has(element);
        mark.rotation.y += dt * 0.2;
        if (orb.visible && Math.random() < 0.4 && ctx.player.pos.distanceTo(center) < 80)
          ctx.particles.emit({ pos: orb.position, posSpread: 0.4, spread: 1, vel: new THREE.Vector3(0, 0.8, 0), life: [0.5, 1], size: [0.3, 0.02], color: ELEMENT_INFO[element].glow });
      }
    })(),
  );
  ctx.interact.register({
    id: 'altar:' + id,
    pos: () => center,
    radius: 3.4,
    verb: () => '기도하기',
    name: () => '원소의 제단',
    enabled: () => !ctx.save.skills.has(element),
    action: () => {
      ctx.save.skills.add(element);
      ctx.save.set(flag);
      ctx.player.busy('Cheer', 1.6, 1);
      ctx.fx.sphere(orb.position.clone(), color, 6, 1);
      ctx.fx.ring(center, color, 10, 1);
      events.emit('skillUnlocked', { element });
      events.emit('sound', { name: 'skill_unlock', volume: 1 });
      events.emit('banner', { title: `새로운 마법: ${ELEMENT_INFO[element].name}`, sub: `${SKILLS[element].name} · ${SKILLS[element].skillName}`, color });
      ctx.world.after(1.5, () => {
        ctx.skills.select(element);
        ctx.ui.showDialog(SKILL_TUTORIAL[element]);
      });
    },
  });
}

export const SKILL_TUTORIAL: Record<Element, { who: string; text: string }[]> = {
  fire: [],
  ice: [
    { who: '원소의 목소리', text: '서리의 힘이 오른손에 깃들었다. [2]를 눌러 빙결을 선택하라.' },
    { who: '원소의 목소리', text: '좌클릭 「서리 창」은 적을 얼리고, 물 위에 쏘면 수면을 얼려 발판을 만든다.' },
    { who: '원소의 목소리', text: 'E 「빙주 생성」은 겨냥한 땅이나 물 위에 얼음 기둥을 세운다. 기둥에 올라 높은 곳으로 가라.' },
    { who: '원소의 목소리', text: '봉화는 저 너머 작은 바위섬에 있다. 얼음벽은… 불이면 녹겠지.' },
  ],
  wind: [
    { who: '원소의 목소리', text: '바람의 힘이 오른손에 깃들었다. [3]을 눌러 바람을 선택하라.' },
    { who: '원소의 목소리', text: '좌클릭 「돌풍」은 적과 물체를 밀쳐내고, 풍차를 돌리며, 불을 바람 방향으로 번지게 한다.' },
    { who: '원소의 목소리', text: 'E 「폭풍 파동」은 주변의 모든 것을 거센 바람으로 밀쳐낸다. 길게 충전할수록 더 멀리, 더 세게.' },
    { who: '원소의 목소리', text: '사당 주변 세 풍차를 모두 돌려 봉인을 풀어라. 봉인이 풀리면 돌기둥 옆에서 바람이 솟구칠 것이다.' },
  ],
  lightning: [
    { who: '원소의 목소리', text: '뇌운의 힘이 오른손에 깃들었다. [4]를 눌러 번개를 선택하라.' },
    { who: '원소의 목소리', text: '좌클릭 「전격」은 주변 적에게 연쇄된다. 젖은 적이나 물에 특히 강하다.' },
    { who: '원소의 목소리', text: 'E 「낙뢰」는 잠시 후 하늘에서 벼락을 떨어뜨린다. 금 간 바위도 부술 수 있다.' },
    { who: '원소의 목소리', text: '세 개의 번개 수정을 동시에 빛나게 하라. 봉인이 풀릴 것이다.' },
  ],
  kinesis: [
    { who: '원소의 목소리', text: '염동의 힘이 오른손에 깃들었다. [5]를 눌러 염동력을 선택하라.' },
    { who: '원소의 목소리', text: '좌클릭으로 상자·바위·돌 블록을 붙잡고, 마우스로 움직여라. 휠로 거리를 조절한다.' },
    { who: '원소의 목소리', text: '붙잡은 채로 E를 누르면 던진다. 빈손일 때 E는 주변을 밀어내는 파동이다.' },
    { who: '원소의 목소리', text: '무거운 돌 블록을 두 발판 위에 올려 봉인을 풀어라.' },
  ],
};

/** Sealed beacon that the player lights to complete a shrine. */
export function shrineBeacon(element: Element, pos: THREE.Vector3, signal: string, sealR = 3.6, sealH = 13) {
  const beacon = ctx.props.add(new Beacon(pos, element));
  const flag = 'beacon:' + element;
  if (ctx.save.has(flag)) beacon.light(true);
  const seal = sealR > 0 ? ctx.props.add(new Seal(pos, sealR, sealH, ELEMENT_INFO[element].color, signal)) : null;
  ctx.interact.register({
    id: flag,
    pos: () => pos.clone().add(new THREE.Vector3(0, 1, 0)),
    radius: 4.5,
    verb: () => '봉화 점화',
    name: () => `${ELEMENT_INFO[element].name}의 봉화`,
    enabled: () => !ctx.save.has(flag) && (!seal || seal.open) && ctx.save.skills.has(element),
    action: () => {
      ctx.save.set(flag);
      beacon.light(false);
      ctx.player.hearts += 1;
      ctx.player.heal(999);
      events.emit('banner', { title: `${ELEMENT_INFO[element].name}의 봉화가 밝혀졌다`, sub: '생명의 결정 획득 · 최대 하트 +1', color: ELEMENT_INFO[element].color });
      ctx.ui.autosave();
      ctx.quests.evaluate();
    },
  });
  return beacon;
}
