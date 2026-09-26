import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { events } from '../core/Events';
import { clamp } from '../core/math';
import { Projectiles } from './Projectiles';
import { ELEMENTS, ELEMENT_INFO, type Element } from './Elements';
import type { Grabbable } from '../interact/Props';

interface SkillDef {
  basicCost: number;
  basicCd: number;
  skillCost: number;
  skillCd: number;
  name: string;
  skillName: string;
  burstName: string;
  desc: string;
}

export const SKILLS: Record<Element, SkillDef> = {
  fire: {
    name: '화염탄', skillName: '화염 폭발구', burstName: '업화의 비',
    basicCost: 6, basicCd: 0.3, skillCost: 22, skillCd: 4,
    desc: '풀과 나무를 태우고 화로에 불을 붙인다. 불타는 풀 위에는 상승 기류가 생긴다.',
  },
  ice: {
    name: '서리 창', skillName: '빙주 생성', burstName: '절대 영도',
    basicCost: 5, basicCd: 0.28, skillCost: 16, skillCd: 1.1,
    desc: '적을 얼리고 불을 끈다. 물 위를 얼려 길을 만들고, 빙주를 세워 높은 곳에 오른다.',
  },
  wind: {
    name: '돌풍', skillName: '폭풍 파동', burstName: '대선풍',
    basicCost: 6, basicCd: 0.45, skillCost: 20, skillCd: 4,
    desc: '물체와 적을 밀쳐내고 풍차를 돌린다. 폭풍 파동은 주변의 모든 것을 거센 바람으로 크게 밀쳐낸다.',
  },
  lightning: {
    name: '전격', skillName: '낙뢰', burstName: '뇌신의 심판',
    basicCost: 7, basicCd: 0.4, skillCost: 24, skillCd: 6,
    desc: '연쇄 번개로 여러 적을 공격하고 번개 수정을 활성화한다. 젖은 적과 물에 특히 강하다.',
  },
  kinesis: {
    name: '염동 포획', skillName: '투척 / 염동 파동', burstName: '중력 붕괴',
    basicCost: 4, basicCd: 0.25, skillCost: 12, skillCd: 2.5,
    desc: '상자·바위·블록을 붙잡아 옮기고 던진다. 휠로 거리 조절, E를 누르고 있다 떼면 충전 투척.',
  },
};

/** E-skill charge stages: hold E, one stage per second, release to cast. */
export const CHARGE_LEVELS = [
  { radius: 1, damage: 1, cost: 1, cd: 1 },
  { radius: 1.45, damage: 1.7, cost: 1.5, cd: 1.25 },
  { radius: 2, damage: 2.6, cost: 2, cd: 1.5 },
];
export const CHARGE_STEP = 1;

interface ChargeState {
  el: Element;
  t: number;
  level: number;
  /** kinesis: charging a throw of the held object rather than a wave */
  throwing: boolean;
  preview: THREE.Mesh;
}

export class SkillSystem {
  projectiles = new Projectiles();
  private basicCd: Record<Element, number> = { fire: 0, ice: 0, wind: 0, lightning: 0, kinesis: 0 };
  private skillCd: Record<Element, number> = { fire: 0, ice: 0, wind: 0, lightning: 0, kinesis: 0 };
  energy = 0;
  held: Grabbable | null = null;
  private holdDist = 6;
  private tether?: THREE.Mesh;
  private handGlow: THREE.Sprite;
  private glowPulse = 0;
  private pending: { t: number; fn: () => void }[] = [];
  charge: ChargeState | null = null;
  private previewMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  private previewGeo = new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2);

  constructor() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.handGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.handGlow.scale.setScalar(0.5);
    ctx.scene.add(this.handGlow);

    const tg = new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    this.tether = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7ad9').multiplyScalar(2), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tether.visible = false;
    ctx.scene.add(this.tether);
  }

  get selected() {
    return ctx.save.selected;
  }

  unlocked(e: Element) {
    return ctx.save.skills.has(e);
  }

  select(e: Element) {
    if (!this.unlocked(e)) {
      events.emit('toast', { text: `아직 ${ELEMENT_INFO[e].name} 마법을 익히지 못했다`, kind: 'warn' });
      return;
    }
    if (this.selected === e) return;
    if (this.held) this.release();
    ctx.save.selected = e;
    this.glowPulse = 1;
    events.emit('sound', { name: 'select', volume: 0.3 });
  }

  cooldown(e: Element) {
    return { basic: this.basicCd[e], skill: this.skillCd[e], skillMax: SKILLS[e].skillCd };
  }

  addEnergy(n: number) {
    this.energy = clamp(this.energy + n, 0, 100);
  }

  private later(t: number, fn: () => void) {
    this.pending.push({ t, fn });
  }

  /**
   * Where the spell should go: the crosshair (screen centre), with a little aim assist
   * toward an enemy close to the crosshair, or the locked-on target.
   */
  private target(maxDist: number) {
    const ray = ctx.cam.aimRay(maxDist + 20);
    const hand = ctx.player.handWorld(new THREE.Vector3());
    const locked = ctx.cam.lock;
    if (locked && locked.alive) return { point: locked.chest(), enemy: locked, water: false, hand };
    const assist = ctx.input.isDown('Mouse2') ? 0.05 : 0.11; // radians around the crosshair
    let best: { e: NonNullable<typeof locked>; a: number } | null = null;
    for (const e of ctx.enemies?.list ?? []) {
      if (!e.alive || !e.active) continue;
      const to = e.chest().sub(ray.origin);
      const d = to.length();
      if (d > maxDist + 6) continue;
      const a = Math.acos(Math.min(1, to.normalize().dot(ray.dir)));
      const tol = assist + Math.atan2(0.8, d);
      if (a > tol || (best && a >= best.a)) continue;
      if (ray.hit && ray.hit.distance < d - 1.5) continue; // something is in the way
      best = { e, a };
    }
    if (best) return { point: best.e.chest(), enemy: best.e, water: false, hand };
    return { point: ray.point, enemy: undefined, water: ray.water, hand };
  }

  update(dt: number) {
    for (const e of ELEMENTS) {
      this.basicCd[e] = Math.max(0, this.basicCd[e] - dt);
      this.skillCd[e] = Math.max(0, this.skillCd[e] - dt);
    }
    for (const p of this.pending) p.t -= dt;
    const due = this.pending.filter((p) => p.t <= 0);
    this.pending = this.pending.filter((p) => p.t > 0);
    for (const p of due) p.fn();
    this.projectiles.update(dt);

    const input = ctx.input;
    const player = ctx.player;
    const canCast = player.alive && ['ground', 'air', 'swim', 'glide'].includes(player.state) && player.status.frozen <= 0;

    // element selection
    for (const e of ELEMENTS) if (input.wasPressed(`Digit${ELEMENT_INFO[e].key}`)) this.select(e);
    if (input.wasPressed('KeyR')) {
      const owned = ELEMENTS.filter((e) => this.unlocked(e));
      const i = owned.indexOf(this.selected);
      this.select(owned[(i + 1) % owned.length]);
    }

    const el = this.selected;
    if (canCast && player.state !== 'glide' && player.state !== 'swim') {
      if (el === 'kinesis') {
        if (input.wasPressed('Mouse0') && !this.charge) this.held ? this.release() : this.grab();
      } else if (input.isDown('Mouse0') && this.basicCd[el] <= 0 && !this.charge) this.basic(el);
      if (input.wasPressed('KeyE') && !this.charge) this.startCharge(el);
      if (input.wasPressed('KeyQ') && !this.charge) this.burst(el);
    } else if (canCast && input.wasPressed('Mouse0') && player.state === 'glide' && el !== 'kinesis' && this.basicCd[el] <= 0) {
      this.basic(el);
    }
    if (this.held) this.updateHeld(dt);
    if (this.charge) this.updateCharge(dt, canCast);

    // hand glow
    const c = new THREE.Color(ELEMENT_INFO[el].color);
    this.glowPulse = Math.max(0, this.glowPulse - dt * 3);
    const hand = player.handWorld(new THREE.Vector3());
    this.handGlow.position.copy(hand);
    const chargeK = this.charge ? this.charge.level * 0.35 + (this.charge.t % CHARGE_STEP) * 0.25 : 0;
    const s = 0.35 + this.glowPulse * 0.9 + chargeK + Math.sin(ctx.time * (this.charge ? 18 : 6)) * (0.04 + chargeK * 0.1);
    this.handGlow.scale.setScalar(s);
    (this.handGlow.material as THREE.SpriteMaterial).color.copy(c).multiplyScalar(1.4 + this.glowPulse * 2);
    this.handGlow.visible = player.alive;
    if (player.alive && Math.random() < dt * 14)
      ctx.particles.emit({ pos: hand, count: 1, spread: 0.35, vel: new THREE.Vector3(0, 0.4, 0), life: [0.3, 0.6], size: [0.16, 0.02], color: ELEMENT_INFO[el].glow, color2: ELEMENT_INFO[el].color });
  }

  private castAnim(kind: 'shoot' | 'raise' | 'long', dir: THREE.Vector3) {
    const p = ctx.player;
    p.faceDirection(dir, kind === 'shoot' ? 0.35 : 0.6);
    p.castSlow = kind === 'shoot' ? 0.25 : 0.5;
    const anim = kind === 'shoot' ? 'Spellcast_Shoot' : kind === 'raise' ? 'Spellcast_Raise' : 'Spellcast_Long';
    p.char.playUpper(anim, { speed: kind === 'shoot' ? 2.2 : 1.6 });
    this.glowPulse = 1;
  }

  // ---- basic attacks -----------------------------------------------------
  private basic(el: Element) {
    const def = SKILLS[el];
    if (!ctx.player.useMana(def.basicCost)) {
      this.noMana();
      return;
    }
    this.basicCd[el] = def.basicCd;
    const t = this.target(el === 'lightning' ? 32 : el === 'wind' ? 12 : 45);
    const dir = t.point.clone().sub(ctx.player.chestWorld()).normalize();
    this.castAnim('shoot', dir);
    events.emit('sound', { name: `cast_${el}`, volume: 0.45 });
    this.later(0.1, () => {
      const hand = ctx.player.handWorld(new THREE.Vector3());
      const aim = t.enemy ? t.enemy.chest() : t.point;
      const d = aim.clone().sub(hand).normalize();
      switch (el) {
        case 'fire':
          this.projectiles.spawn({ element: 'fire', from: hand, dir: d, speed: 36, range: 48, size: 0.3, source: 'player', style: 'orb', hit: { element: 'fire', radius: 1.3, damage: 14, source: 'player', kind: 'bolt' } });
          break;
        case 'ice':
          this.projectiles.spawn({
            element: 'ice', from: hand, dir: d, speed: 40, range: 46, size: 0.3, source: 'player', style: 'shard',
            hit: { element: 'ice', radius: 1.1, damage: 10, source: 'player', kind: 'bolt' },
            onImpact: (pos, _n, water) => {
              if (water) ctx.props.freezeWater(pos, 2.2);
            },
          });
          break;
        case 'wind':
          this.gust(hand, ctx.cam.forward(new THREE.Vector3()).lerp(d.clone().setY(0).normalize(), 0.5).normalize());
          break;
        case 'lightning':
          this.spark(hand, aim, t.enemy?.id);
          break;
      }
      ctx.particles.emit({ pos: hand, count: 8, spread: 2, life: [0.15, 0.3], size: [0.4, 0.05], color: ELEMENT_INFO[el].glow });
    });
  }

  private gust(from: THREE.Vector3, dir: THREE.Vector3) {
    const range = 12;
    const cone = Math.cos(0.6);
    for (let i = 0; i < 40; i++) {
      const spread = new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.3) * 0.5, (Math.random() - 0.5) * 0.9);
      const v = dir.clone().add(spread).normalize().multiplyScalar(18 + Math.random() * 10);
      ctx.particles.emit({ pos: from.clone().addScaledVector(dir, 0.5), vel: v, spread: 0.5, life: [0.35, 0.6], size: [0.35, 0.9], alpha: [0.7, 0], color: '#e8fff6', drag: 2.5 });
    }
    ctx.fx.ring(from.clone().addScaledVector(dir, 2).setY(from.y - 0.8), '#bfffe8', 3, 0.35);
    const pushed = ctx.props.push(from, dir, range, cone, 13);
    ctx.enemies?.push(from, dir, range, cone, 11);
    const center = from.clone().addScaledVector(dir, range * 0.5);
    ctx.world.applyHit({ element: 'wind', pos: center, radius: range * 0.5, dir, damage: 7, push: 11, source: 'player', kind: 'gust' });
    if (pushed > 0) this.addEnergy(2);
  }

  private spark(from: THREE.Vector3, to: THREE.Vector3, targetId?: number) {
    let end = to.clone();
    const dir = end.clone().sub(from).normalize();
    const dist = Math.min(32, from.distanceTo(end));
    const rh = ctx.world.raycastAll(from, dir, dist, 1 | 2 | 4 | 32);
    if (rh && !targetId) end = rh.point;
    else end = from.clone().addScaledVector(dir, dist);
    ctx.fx.bolt(from, end, '#c8a8ff', 0.2, 0.28);
    ctx.lights.flash(end, '#c0a0ff', 40, 14, 0.15);
    if (rh) ctx.props?.directHit(rh, null, 'lightning');
    ctx.world.applyHit({ element: 'lightning', pos: end, radius: 1.1, damage: 13, source: 'player', kind: 'bolt', targetId });
    // chain to nearby enemies
    const chained = new Set<number>();
    if (targetId !== undefined) chained.add(targetId);
    let last = end;
    for (let i = 0; i < 2; i++) {
      const next = ctx.enemies?.nearest(last, 8, chained);
      if (!next) break;
      chained.add(next.id);
      const p = next.chest();
      ctx.fx.bolt(last, p, '#b58cff', 0.2, 0.2, false);
      ctx.world.applyHit({ element: 'lightning', pos: p, radius: 0.6, damage: 8, source: 'player', kind: 'bolt', targetId: next.id });
      last = p;
    }
  }

  // ---- elemental skills (E) ---------------------------------------------
  private skill(el: Element, level = 1) {
    const def = SKILLS[el];
    const L = CHARGE_LEVELS[level - 1];
    if (!ctx.player.useMana(def.skillCost * L.cost)) {
      this.noMana();
      return;
    }
    this.skillCd[el] = def.skillCd * L.cd;
    if (level > 1) ctx.cam.shake(0.15 * level);
    const t = this.target(el === 'ice' ? 24 : 34);
    const chest = ctx.player.chestWorld();
    const dir = t.point.clone().sub(chest).normalize();
    events.emit('sound', { name: `skill_${el}`, volume: 0.6 });
    switch (el) {
      case 'fire': {
        this.castAnim('shoot', dir);
        ctx.fx.rune(ctx.player.handWorld(new THREE.Vector3()), dir, '#ff8a3a', 1.2 * L.radius, 0.4, () => ctx.player.handWorld(new THREE.Vector3()));
        this.later(0.18, () => {
          const hand = ctx.player.handWorld(new THREE.Vector3());
          const aim = t.enemy ? t.enemy.chest() : t.point;
          const d = aim.clone().sub(hand).normalize();
          d.y += 0.04;
          this.projectiles.spawn({
            element: 'fire', from: hand, dir: d, speed: 26 + level * 3, gravity: 4, range: 55, size: 0.6 * (0.7 + level * 0.3), source: 'player', style: 'big',
            hit: { element: 'fire', radius: 4.5 * L.radius, damage: 32 * L.damage, push: 8 + level * 2, source: 'player', kind: 'blast', potency: level },
            onImpact: level >= 3 ? (pos) => {
              // a stage-3 fireball leaves a ring of flames
              for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                const q = pos.clone().add(new THREE.Vector3(Math.cos(a) * 5, 0, Math.sin(a) * 5));
                ctx.fire.ignite(q, 1, 2);
              }
              ctx.fx.ring(pos, '#ff9a4a', 10, 0.6);
            } : undefined,
          });
        });
        break;
      }
      case 'ice': {
        this.castAnim('raise', dir);
        // place a pillar at the aimed ground/water spot (clamped to range)
        let point = t.point.clone();
        const flat = point.clone().sub(ctx.player.pos).setY(0);
        if (flat.length() > 22) point = ctx.player.pos.clone().add(flat.setLength(22));
        if (flat.length() < 1.6) point = ctx.player.pos.clone().add(ctx.cam.forward(new THREE.Vector3()).multiplyScalar(2.5));
        const wl = ctx.world.isWater(new THREE.Vector3(point.x, 0, point.z).setY(-999), 0.3);
        const onWater = ctx.terrain.waterDepth(point.x, point.z) > 0.3 || wl;
        if (!onWater) point.y = ctx.terrain.heightAt(point.x, point.z);
        const hitDown = ctx.world.raycastStatic(point.clone().setY(point.y + 6), new THREE.Vector3(0, -1, 0), 14);
        if (!onWater && hitDown) point.y = hitDown.point.y;
        ctx.fx.rune(point.clone().setY(point.y + 0.1), new THREE.Vector3(0, 1, 0), '#9fe8ff', 3 * L.radius, 0.7);
        this.later(0.15, () => {
          ctx.props.spawnIcePillar(point, onWater, [1, 1.4, 1.85][level - 1]);
          if (level >= 2) {
            // frost nova around the pillar
            const r = 3.2 * L.radius;
            ctx.fx.ring(point, '#dff8ff', r, 0.6);
            ctx.world.applyHit({ element: 'ice', pos: point, radius: r, damage: 12 * L.damage, source: 'player', kind: 'burst', potency: level });
            if (onWater) ctx.props.freezeWater(point, r * 1.3);
            if (level >= 3) ctx.enemies?.freezeNear(point, r, 3.5);
            for (let i = 0; i < 24 * level; i++) {
              const a = Math.random() * Math.PI * 2, rr = Math.random() * r;
              ctx.particles.emit({ pos: point.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0.3, Math.sin(a) * rr)), vel: new THREE.Vector3(0, 2.5, 0), spread: 1.2, life: [0.6, 1.2], size: [0.45, 0.05], color: '#eafaff' });
            }
          }
        });
        break;
      }
      case 'wind': {
        this.castAnim('raise', new THREE.Vector3(Math.sin(ctx.player.yaw), 0, Math.cos(ctx.player.yaw)));
        this.windBlast(ctx.player.pos.clone(), level);
        break;
      }
      case 'lightning': {
        this.castAnim('raise', dir);
        let point = t.enemy ? t.enemy.feet() : t.point.clone();
        const flat = point.clone().sub(ctx.player.pos).setY(0);
        if (flat.length() > 30) point = ctx.player.pos.clone().add(flat.setLength(30));
        const ground = ctx.world.raycastStatic(point.clone().setY(point.y + 20), new THREE.Vector3(0, -1, 0), 40);
        if (ground) point = ground.point;
        const wp = ctx.world.rayWater(point.clone().setY(point.y + 20), new THREE.Vector3(0, -1, 0), 40);
        if (wp) point = wp;
        const r = 3.8 * L.radius;
        ctx.fx.rune(point.clone().setY(point.y + 0.1), new THREE.Vector3(0, 1, 0), '#c9a8ff', 5 * L.radius, 0.75);
        const strikes = level >= 3 ? [point, ...[0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2 + Math.random();
          const q = point.clone().add(new THREE.Vector3(Math.cos(a) * r * 0.8, 0, Math.sin(a) * r * 0.8));
          q.y = ctx.terrain.heightAt(q.x, q.z);
          return q;
        })] : [point];
        strikes.forEach((pt, i) => this.later(0.55 + i * 0.12, () => {
          const main = i === 0;
          ctx.fx.bolt(pt.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 60, (Math.random() - 0.5) * 6)), pt, '#e0d0ff', 0.35, main ? 1.4 * (0.8 + level * 0.2) : 1);
          ctx.fx.sphere(pt, '#b58cff', main ? r : r * 0.5, 0.3);
          ctx.fx.ring(pt, '#d0b8ff', main ? r * 1.45 : r * 0.7, 0.45);
          ctx.lights.flash(pt.clone().setY(pt.y + 4), '#d8c8ff', 250, 40, 0.3);
          ctx.cam.shake(main ? 0.4 + level * 0.15 : 0.3);
          events.emit('sound', { name: 'thunder', pos: pt, volume: 0.9 });
          ctx.particles.emit({ pos: pt, count: 30 + level * 15, spread: 7, gravity: 6, life: [0.2, 0.6], size: [0.5, 0.05], color: '#efe0ff' });
          ctx.world.applyHit({ element: 'lightning', pos: pt, radius: main ? r : r * 0.55, damage: (main ? 42 : 24) * L.damage, source: 'player', kind: 'strike', push: 6, potency: level });
        }));
        break;
      }
      case 'kinesis':
        break;
    }
  }

  /** Storm wave: a huge radial gust that hurls everything around the caster outward. */
  private windBlast(base: THREE.Vector3, level: number) {
    const L = CHARGE_LEVELS[level - 1];
    const r = 8 * L.radius;
    const push = 16 + level * 7;
    const centre = base.clone().setY(base.y + 1);
    ctx.grass.blast(base, r * 1.15);
    ctx.fx.ring(base, '#e8fff6', r * 1.15, 0.5);
    this.later(0.08, () => ctx.fx.ring(base, '#9ff5d8', r * 0.85, 0.45));
    ctx.fx.dome(centre, '#bfffe8', r, 0.45);
    ctx.fx.rune(base.clone().setY(base.y + 0.12), new THREE.Vector3(0, 1, 0), '#9ff5d8', 3 + level * 1.5, 0.6);
    ctx.fx.windSwirl(base, r, level);
    // streaks racing outward along the ground
    const n = 40 + level * 30;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
      const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const sp = r * (2.2 + Math.random());
      ctx.particles.emit({ pos: base.clone().addScaledVector(d, 0.8).setY(base.y + 0.3 + Math.random() * 1.6), vel: d.multiplyScalar(sp).setY(0.5 + Math.random()), spread: 0.4, life: [0.35, 0.6], size: [0.55, 1.3], alpha: [0.85, 0], color: '#f2fffa', color2: '#8ff5d0', drag: 2.2 });
    }
    // kicked-up dust and leaves
    for (let i = 0; i < 24 + level * 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const p = base.clone().addScaledVector(d, 1 + Math.random() * 2);
      ctx.particles.emit({ pos: p.setY(ctx.terrain.heightAt(p.x, p.z) + 0.2), vel: d.multiplyScalar(r * 1.4).setY(1.5), spread: 1, life: [0.6, 1.1], size: [1.2, 3], alpha: [0.45, 0], color: '#e0d6b8', additive: false, drag: 2.5 });
    }
    ctx.lights.flash(centre, '#b8ffe6', 60 + level * 30, r * 1.5, 0.35);
    ctx.cam.shake(0.3 + level * 0.15);
    events.emit('sound', { name: 'windblast', pos: base, volume: 0.8 });
    const hit = { element: 'wind' as const, pos: centre, radius: r, damage: 12 * L.damage, push, source: 'player' as const, kind: 'burst' as const, dir: new THREE.Vector3(0, 0.2, 0), potency: level };
    ctx.props.push(centre, new THREE.Vector3(0, 0.35, 0), r, -1, push);
    ctx.enemies?.push(centre, new THREE.Vector3(0, 0.3 + level * 0.1, 0), r, -1, push);
    ctx.world.applyHit(hit);
    // the blast snuffs out flames near the caster and knocks enemy arrows away
    ctx.fire.extinguishCircle(base.x, base.z, r * 0.6);
    this.projectiles.deflect(base, r);
    this.addEnergy(4);
  }

  // ---- bursts (Q) --------------------------------------------------------
  private burst(el: Element) {
    if (this.energy < 100) {
      events.emit('toast', { text: '원소 에너지가 부족하다 (적을 공격해 충전)', kind: 'warn' });
      return;
    }
    this.energy = 0;
    const p = ctx.player;
    const base = p.pos.clone();
    this.castAnim('long', ctx.cam.forward(new THREE.Vector3()));
    ctx.fx.rune(base.clone().setY(base.y + 0.1), new THREE.Vector3(0, 1, 0), ELEMENT_INFO[el].color, 9, 1.4);
    events.emit('banner', { title: SKILLS[el].burstName, color: ELEMENT_INFO[el].color });
    events.emit('sound', { name: 'burst', volume: 0.9 });
    const t = this.target(30);
    switch (el) {
      case 'fire':
        for (let i = 0; i < 9; i++) {
          this.later(0.3 + i * 0.14, () => {
            const a = Math.random() * Math.PI * 2, r = Math.random() * 7;
            const tgt = t.point.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
            tgt.y = ctx.terrain.heightAt(tgt.x, tgt.z);
            const from = tgt.clone().add(new THREE.Vector3(-6, 38, -4));
            this.projectiles.spawn({ element: 'fire', from, dir: tgt.clone().sub(from), speed: 45, range: 70, size: 0.7, source: 'player', style: 'big', hit: { element: 'fire', radius: 3.8, damage: 30, push: 7, source: 'player', kind: 'burst' } });
          });
        }
        break;
      case 'ice':
        this.later(0.5, () => {
          ctx.fx.sphere(base, '#9fe8ff', 11, 0.6);
          ctx.fx.ring(base, '#dff8ff', 13, 0.8);
          ctx.cam.shake(0.5);
          ctx.world.applyHit({ element: 'ice', pos: base, radius: 11, damage: 26, source: 'player', kind: 'burst', potency: 3 });
          ctx.enemies?.freezeNear(base, 11, 5);
          ctx.props.freezeWater(base, 12);
          for (let i = 0; i < 80; i++) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * 11;
            ctx.particles.emit({ pos: base.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3, Math.sin(a) * r)), vel: new THREE.Vector3(0, 3, 0), spread: 1.5, life: [0.8, 1.5], size: [0.5, 0.05], color: '#eafaff' });
          }
        });
        break;
      case 'wind':
        this.later(0.4, () => ctx.props.spawnTornado(t.point.clone(), 5.5));
        break;
      case 'lightning': {
        const targets = ctx.enemies?.inRange(base, 26).slice(0, 7) ?? [];
        for (let i = 0; i < 7; i++) {
          this.later(0.35 + i * 0.18, () => {
            const e = targets[i];
            let pt: THREE.Vector3;
            if (e && e.alive) pt = e.feet();
            else {
              const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 14;
              pt = base.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
              pt.y = ctx.terrain.heightAt(pt.x, pt.z);
            }
            ctx.fx.bolt(pt.clone().add(new THREE.Vector3(0, 55, 0)), pt, '#e8d8ff', 0.3, 1.2);
            ctx.lights.flash(pt.clone().setY(pt.y + 4), '#d8c8ff', 200, 36, 0.25);
            ctx.cam.shake(0.35);
            events.emit('sound', { name: 'thunder', pos: pt, volume: 0.7 });
            ctx.world.applyHit({ element: 'lightning', pos: pt, radius: 3.2, damage: 38, source: 'player', kind: 'strike' });
          });
        }
        break;
      }
      case 'kinesis':
        this.later(0.3, () => {
          const center = base.clone().addScaledVector(ctx.cam.forward(new THREE.Vector3()), 6).setY(base.y + 3);
          ctx.fx.sphere(center, '#ff7ad9', 3, 1.2);
          ctx.props.pull(center, 14, 16);
          ctx.enemies?.pull(center, 14, 12);
          this.later(1.1, () => {
            ctx.fx.sphere(center, '#ffb0ec', 9, 0.4);
            ctx.fx.ring(center.clone().setY(ctx.terrain.heightAt(center.x, center.z)), '#ff7ad9', 12, 0.5);
            ctx.cam.shake(0.6);
            ctx.world.applyHit({ element: 'kinesis', pos: center, radius: 7, damage: 34, push: 14, source: 'player', kind: 'burst' });
            ctx.enemies?.push(center, new THREE.Vector3(0, 1, 0), 9, -1, 14);
            ctx.props.push(center, new THREE.Vector3(0, 1, 0), 9, -1, 16);
          });
        });
        break;
    }
  }

  // ---- kinesis -----------------------------------------------------------
  private grab() {
    const ray = ctx.cam.aimRay(28);
    const g = ctx.props.findGrabbable(ray.origin, ray.dir, 26);
    if (!g) {
      events.emit('toast', { text: '염동력으로 잡을 수 있는 물체가 없다', kind: 'warn' });
      return;
    }
    if (!ctx.player.useMana(SKILLS.kinesis.basicCost)) {
      this.noMana();
      return;
    }
    this.held = g;
    g.setHeld(true);
    this.holdDist = clamp(g.position().distanceTo(ctx.player.chestWorld()), 3, 16);
    ctx.cam.wheelLocked = true;
    this.castAnim('long', ray.dir);
    ctx.player.char.playUpper('Spellcasting', { hold: true, speed: 1 });
    events.emit('sound', { name: 'cast_kinesis', volume: 0.5 });
  }

  release() {
    if (!this.held) return;
    this.held.setHeld(false);
    this.held = null;
    ctx.cam.wheelLocked = false;
    this.tether!.visible = false;
    ctx.player.char.stopUpper();
  }

  private throwHeld(level = 1) {
    const g = this.held!;
    const dir = ctx.cam.aimRay(40).point.clone().sub(g.position()).normalize();
    this.release();
    g.throwTo(dir.multiplyScalar(30 * [1, 1.35, 1.75][level - 1]));
    if (level > 1) ctx.fx.ring(g.position(), '#ff7ad9', 2 * level, 0.35);
    this.castAnim('shoot', dir);
    events.emit('sound', { name: 'throw', volume: 0.5 });
  }

  private kinesisWave(level = 1) {
    if (this.skillCd.kinesis > 0) return;
    const L = CHARGE_LEVELS[level - 1];
    if (!ctx.player.useMana(SKILLS.kinesis.skillCost * L.cost)) {
      this.noMana();
      return;
    }
    this.skillCd.kinesis = SKILLS.kinesis.skillCd * L.cd;
    const base = ctx.player.pos.clone().setY(ctx.player.pos.y + 1);
    const r = 6 * L.radius;
    this.castAnim('raise', ctx.cam.forward(new THREE.Vector3()));
    ctx.fx.sphere(base, '#ff7ad9', r, 0.35);
    ctx.fx.ring(ctx.player.pos, '#ffb0ec', r * 1.15, 0.4);
    if (level > 1) ctx.cam.shake(0.15 * level);
    ctx.props.push(base, new THREE.Vector3(0, 0.3, 0), r * 1.15, -1, 12 + level * 3);
    ctx.enemies?.push(base, new THREE.Vector3(0, 0.3, 0), r * 1.15, -1, 12 + level * 3);
    ctx.world.applyHit({ element: 'kinesis', pos: base, radius: r, damage: 9 * L.damage, push: 10 + level * 3, source: 'player', kind: 'burst' });
    events.emit('sound', { name: 'skill_kinesis', volume: 0.6 });
  }

  private updateHeld(dt: number) {
    const g = this.held!;
    if (!g.valid() || !ctx.player.alive || ctx.player.state === 'swim') {
      this.release();
      return;
    }
    if (ctx.input.wheel !== 0) this.holdDist = clamp(this.holdDist - ctx.input.wheel * 0.9, 2.5, 18);
    if (!ctx.player.useMana(3.5 * dt)) {
      this.release();
      return;
    }
    ctx.player.manaDelay = 0.8;
    const look = ctx.cam.lookDir(new THREE.Vector3());
    const target = ctx.player.chestWorld().addScaledVector(look, this.holdDist);
    target.y += 0.8;
    g.moveTowards(target, dt);
    ctx.player.faceDirection(look.clone().setY(0), 0.2);
    // tether visual
    const hand = ctx.player.handWorld(new THREE.Vector3());
    const pos = g.position();
    const t = this.tether!;
    t.visible = true;
    t.position.copy(hand);
    t.lookAt(pos);
    t.scale.set(1 + Math.sin(ctx.time * 20) * 0.3, 1, hand.distanceTo(pos));
    if (Math.random() < 0.6) ctx.particles.emit({ pos: pos, count: 1, posSpread: 0.8, spread: 0.6, life: [0.3, 0.6], size: [0.3, 0.02], color: '#ffb0ec' });
    if (Math.random() < 0.4) ctx.particles.emit({ pos: hand.clone().lerp(pos, Math.random()), count: 1, spread: 0.3, life: [0.2, 0.4], size: [0.2, 0.02], color: '#ff7ad9' });
  }

  // ---- charging (hold E) ---------------------------------------------------
  private chargeRadius(c: ChargeState) {
    const L = CHARGE_LEVELS[c.level - 1];
    switch (c.el) {
      case 'fire': return 4.5 * L.radius;
      case 'ice': return c.level > 1 ? 3.2 * L.radius : 1.5;
      case 'wind': return 8 * L.radius;
      case 'lightning': return 3.8 * L.radius;
      case 'kinesis': return c.throwing ? 0 : 6 * L.radius;
    }
  }

  private startCharge(el: Element) {
    const throwing = el === 'kinesis' && !!this.held;
    if (!throwing && this.skillCd[el] > 0) {
      events.emit('sound', { name: 'error', volume: 0.2 });
      return;
    }
    if (!throwing && ctx.player.mana < SKILLS[el].skillCost) {
      this.noMana();
      return;
    }
    const preview = new THREE.Mesh(this.previewGeo, this.previewMat.clone());
    (preview.material as THREE.MeshBasicMaterial).color.set(ELEMENT_INFO[el].color).multiplyScalar(1.4);
    preview.frustumCulled = false;
    ctx.scene.add(preview);
    this.charge = { el, t: 0, level: 1, throwing, preview };
    if (!throwing) ctx.player.char.playUpper('Spellcasting', { hold: true, speed: 1.2 });
    events.emit('sound', { name: 'charge', volume: 0.35 });
  }

  private updateCharge(dt: number, canCast: boolean) {
    const c = this.charge!;
    const p = ctx.player;
    const castable = canCast && p.state !== 'glide' && p.state !== 'swim' && p.state !== 'climb';
    if (!castable || c.el !== this.selected) {
      this.endCharge(false);
      return;
    }
    c.t += dt;
    const want = Math.min(3, 1 + Math.floor(c.t / CHARGE_STEP));
    if (want > c.level) {
      const cost = SKILLS[c.el].skillCost * CHARGE_LEVELS[want - 1].cost;
      if (c.throwing || p.mana >= cost || p.godMode) {
        c.level = want;
        const hand = p.handWorld(new THREE.Vector3());
        const col = ELEMENT_INFO[c.el].color;
        ctx.fx.sphere(hand, col, 0.6 + c.level * 0.3, 0.25);
        ctx.fx.ring(p.pos, col, 1.5 + c.level, 0.35);
        ctx.particles.emit({ pos: hand, count: 16 * c.level, spread: 3, life: [0.2, 0.45], size: [0.35, 0.03], color: ELEMENT_INFO[c.el].glow, color2: col });
        events.emit('sound', { name: 'chargeLevel', volume: 0.45 + c.level * 0.1 });
        this.glowPulse = 1;
      }
    }
    p.castSlow = Math.max(p.castSlow, 0.1);
    const look = ctx.cam.forward(new THREE.Vector3());
    p.faceDirection(look, 0.15);
    // particles spiralling into the right hand
    const hand = p.handWorld(new THREE.Vector3());
    if (Math.random() < dt * (20 + c.level * 25)) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.9 + c.level * 0.35;
      const from = hand.clone().add(new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * r, Math.sin(a) * r));
      ctx.particles.emit({ pos: from, vel: hand.clone().sub(from).multiplyScalar(3.2), spread: 0.1, life: [0.25, 0.3], size: [0.12, 0.28], color: ELEMENT_INFO[c.el].glow, color2: ELEMENT_INFO[c.el].color });
    }
    // area preview on the ground
    const r = this.chargeRadius(c);
    const pv = c.preview;
    pv.visible = r > 0;
    if (pv.visible) {
      let at = p.pos.clone();
      if (c.el === 'fire' || c.el === 'lightning' || c.el === 'ice') {
        const t = this.target(c.el === 'ice' ? 24 : 34);
        at = t.enemy ? t.enemy.feet() : t.point.clone();
        const flat = at.clone().sub(p.pos).setY(0);
        const lim = c.el === 'ice' ? 22 : c.el === 'lightning' ? 30 : 40;
        if (flat.length() > lim) at = p.pos.clone().add(flat.setLength(lim));
        at.y = Math.max(at.y, ctx.terrain.heightAt(at.x, at.z));
      }
      const cur = pv.scale.x || r;
      pv.scale.setScalar(cur + (r - cur) * Math.min(1, dt * 12));
      pv.position.copy(at).add(new THREE.Vector3(0, 0.2, 0));
      (pv.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(ctx.time * 10) * 0.12;
    }
    if (!ctx.input.isDown('KeyE')) this.endCharge(true);
  }

  private endCharge(cast: boolean) {
    const c = this.charge;
    if (!c) return;
    this.charge = null;
    c.preview.removeFromParent();
    (c.preview.material as THREE.Material).dispose();
    if (!c.throwing) ctx.player.char.stopUpper(0.1);
    if (!cast) return;
    if (c.el === 'kinesis') {
      if (c.throwing && this.held) this.throwHeld(c.level);
      else if (!c.throwing) this.kinesisWave(c.level);
    } else this.skill(c.el, c.level);
  }

  private noMana() {
    events.emit('toast', { text: '마력이 부족하다', kind: 'warn' });
    events.emit('sound', { name: 'error', volume: 0.3 });
  }
}
