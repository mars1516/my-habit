import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { physics, RAPIER, G } from '../core/Physics';
import { events } from '../core/Events';
import { P } from '../world/WorldGen';
import { Prop } from '../interact/Props';
import { STONE, DARK_STONE, staticCyl } from '../interact/Mechanisms';
import { ground, place, Seal } from './Structures';
import { ELEMENT_INFO, type Element, type ElementHit } from '../magic/Elements';
import { beaconsLit, SHRINES } from '../quests/Quests';
import type { Enemy } from '../entities/Enemy';
import { angleLerp, damp, rand } from '../core/math';

const COUNTER: Record<string, Element> = { fire: 'ice', ice: 'fire', lightning: 'wind' };
const SHIELDS: Element[] = ['fire', 'ice', 'lightning'];

export function buildAltar() {
  const C = ground(P.altar.x, P.altar.z);
  ctx.terrain.clearGrass(C.x, C.z, 9);
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(8, 9, 1.2, 16), STONE);
  dais.position.copy(C).add(new THREE.Vector3(0, 0.3, 0));
  dais.receiveShadow = dais.castShadow = true;
  ctx.scene.add(dais);
  physics.setOwner(physics.fixedCollider(RAPIER.ColliderDesc.cylinder(0.6, 8.5), C.clone().add(new THREE.Vector3(0, 0.3, 0)), undefined, G.STATIC), { kind: 'structure' });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    place(i % 4 === 2 ? 'column' : 'pillar_deco', ground(C.x + Math.cos(a) * 31, C.z + Math.sin(a) * 31), -a, 1.5, { shrink: 0.7 });
  }
  // four receivers that glow with each beacon's colour
  const gems: { el: Element; mat: THREE.MeshStandardMaterial }[] = [];
  SHRINES.forEach((s, i) => {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const p = ground(C.x + Math.cos(a) * 19, C.z + Math.sin(a) * 19);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.1, 2.2, 6), DARK_STONE);
    ped.position.copy(p).add(new THREE.Vector3(0, 1.1, 0));
    ped.castShadow = true;
    ctx.scene.add(ped);
    staticCyl(p.clone().add(new THREE.Vector3(0, 1.1, 0)), 1.1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: ELEMENT_INFO[s.element].color, emissive: ELEMENT_INFO[s.element].color, emissiveIntensity: 0.05, flatShading: true });
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), mat);
    gem.position.copy(p).add(new THREE.Vector3(0, 3, 0));
    ctx.scene.add(gem);
    gems.push({ el: s.element, mat });
  });
  const seal = ctx.props.add(new Seal(C, 36, 45, '#e9c979', 'altar_open', true));
  void seal;
  ctx.props.add(
    new (class extends Prop {
      private spawned = false;
      override update() {
        for (const g of gems) g.mat.emissiveIntensity = ctx.save.has('beacon:' + g.el) ? 2.2 : 0.05;
        if (beaconsLit() >= 4 && !ctx.save.has('sig:altar_open')) {
          ctx.props.signal('altar_open');
          events.emit('banner', { title: '제단의 결계가 풀렸다', sub: '섬 중앙, 원소의 제단으로', color: '#e9c979' });
        }
        if (!this.spawned && ctx.save.has('sig:altar_open') && !ctx.save.has('boss:defeated') && ctx.player.alive && ctx.player.pos.distanceTo(C) < 24) {
          this.spawned = true;
          spawnBoss(C, () => (this.spawned = false));
        }
      }
    })(),
  );
}

function spawnBoss(C: THREE.Vector3, onReset: () => void) {
  ctx.save.set('boss:started');
  const boss = ctx.enemies.spawn('lord', C.clone().add(new THREE.Vector3(0, 1, 0)));
  ctx.enemies.boss = boss;
  boss.yaw = Math.atan2(ctx.player.pos.x - C.x, ctx.player.pos.z - C.z);
  events.emit('banner', { title: '해골 군주', sub: '제단을 빼앗은 자', color: '#ff6a6a' });
  events.emit('sound', { name: 'boss', volume: 1 });
  ctx.cam.shake(0.8);
  boss.char.play('Skeletons_Awaken_Standing', { once: true, fade: 0 });

  let shieldIdx = 0;
  let shieldTimer = 0;
  let stagger = 0;
  let phase = 0;
  let action: 'intro' | 'move' | 'slam' | 'spin' | 'leap' | 'summon' = 'intro';
  let t = 0;
  let hitDone = 0;
  let summoned = 0;
  const leapFrom = new THREE.Vector3();
  const leapTo = new THREE.Vector3();

  const raiseShield = () => {
    boss.shieldElement = SHIELDS[shieldIdx % 3];
    boss.shieldHp = 3;
    shieldIdx++;
    events.emit('toast', { text: `해골 군주가 ${ELEMENT_INFO[boss.shieldElement].name}의 방패를 둘렀다! (약점: ${ELEMENT_INFO[COUNTER[boss.shieldElement]].name})`, kind: 'warn' });
    ctx.fx.sphere(boss.chest(), ELEMENT_INFO[boss.shieldElement].color, 4, 0.6);
  };

  boss.onHurt = (e: Enemy, dmg: number, hit: ElementHit) => {
    if (e.shieldElement) {
      if (hit.element === COUNTER[e.shieldElement]) {
        e.shieldHp--;
        ctx.particles.emit({ pos: e.chest(), count: 20, spread: 5, life: [0.3, 0.6], size: [0.6, 0.05], color: ELEMENT_INFO[e.shieldElement].glow });
        if (e.shieldHp <= 0) {
          events.emit('reaction', { pos: e.head(), name: '방패 파괴!', color: '#ffe080' });
          events.emit('sound', { name: 'shatter', pos: e.pos, volume: 1 });
          ctx.cam.shake(0.5);
          e.shieldElement = null;
          stagger = 5;
          shieldTimer = 16;
          e.char.play('Hit_B', { once: true, fade: 0.1, speed: 0.6 });
          return dmg * 2;
        }
        return dmg * 0.5;
      }
      return dmg * 0.1;
    }
    return stagger > 0 ? dmg * 1.5 : dmg;
  };
  boss.onDeath = () => {
    ctx.save.set('boss:defeated');
    ctx.enemies.boss = null;
    events.emit('bossDefeated', {});
    for (const e of ctx.enemies.list) if (e.alive && e.kind !== 'lord' && e.pos.distanceTo(C) < 60) e.die();
    ctx.fx.sphere(boss.chest(), '#ffe8a0', 14, 2);
    ctx.cam.shake(1);
    setTimeout(() => ctx.quests.evaluate(), 3500);
  };

  const ring = (radius: number, dmg: number, color: string) => {
    const p = boss.feet();
    ctx.fx.ring(p, color, radius, 0.5);
    ctx.particles.emit({ pos: p.clone().add(new THREE.Vector3(0, 0.3, 0)), count: 40, spread: radius * 1.5, life: [0.3, 0.7], size: [1.4, 0.2], alpha: [0.6, 0], color: '#c8b8a8', additive: false, drag: 4 });
    ctx.cam.shake(0.6);
    events.emit('sound', { name: 'slam', pos: p, volume: 1 });
    const pp = ctx.player;
    if (pp.pos.distanceTo(p) < radius + 0.4 && pp.pos.y - p.y < 2.5) pp.damage(dmg, p, 13);
    if (boss.shieldElement === 'fire') ctx.fire.igniteCircle(p.x, p.z, radius);
  };

  boss.customAI = (e: Enemy, dt: number) => {
    if (!ctx.player.alive) {
      e.char.play('Taunt', { fade: 0.3 });
      if (ctx.player.pos.distanceTo(C) > 60) {
        // player respawned elsewhere: reset the fight
        e.dispose();
        ctx.enemies.list = ctx.enemies.list.filter((x) => x !== e);
        ctx.enemies.boss = null;
        onReset();
      }
      return true;
    }
    t += dt;
    const pp = ctx.player.pos;
    const toP = pp.clone().sub(e.pos).setY(0);
    const d = toP.length();
    const hpFrac = e.hp / e.maxHp;
    if (stagger > 0) {
      stagger -= dt;
      e.char.play('Hit_B', { speed: 0.3 });
      return true;
    }
    if (!e.shieldElement) {
      shieldTimer -= dt;
      if (shieldTimer <= 0) raiseShield();
    }
    if (hpFrac < 0.66 && phase === 0) phase = 1;
    if (hpFrac < 0.33 && phase === 1) phase = 2;
    const face = (k = 6) => (e.yaw = angleLerp(e.yaw, Math.atan2(toP.x, toP.z), damp(k, dt)));
    switch (action) {
      case 'intro':
        if (t > 2.2) {
          raiseShield();
          action = 'move';
          t = 0;
        }
        break;
      case 'move': {
        face(5);
        if (d > 3) {
          e.knock.addScaledVector(toP.normalize(), e.def.speed * (phase === 2 ? 1.3 : 1) * dt * 5);
          e.char.play('Running_A', { speed: 0.8 });
        } else e.char.play('Idle_Combat', { fade: 0.2 });
        if (summoned < phase && t > 1) {
          action = 'summon';
          t = 0;
          e.char.play('Spellcast_Summon', { once: true, fade: 0.15 });
          summoned++;
          break;
        }
        if (t > 1.4) {
          t = 0;
          hitDone = 0;
          if (d > 11) {
            action = 'leap';
            leapFrom.copy(e.pos);
            leapTo.copy(pp);
            e.char.play('1H_Melee_Attack_Jump_Chop', { once: true, fade: 0.1, speed: 0.8 });
          } else if (d < 4.5) {
            action = Math.random() < 0.5 ? 'spin' : 'slam';
            e.char.play(action === 'spin' ? '2H_Melee_Attack_Spin' : '2H_Melee_Attack_Chop', { once: true, fade: 0.1, speed: 0.85 });
          }
        }
        break;
      }
      case 'slam':
        if (t < 0.5) face(8);
        if (t > 0.85 && hitDone === 0) {
          hitDone = 1;
          ring(4.6, 8, '#ffb070');
        }
        if (t > 1.8) {
          action = 'move';
          t = 0;
        }
        break;
      case 'spin':
        if ((t > 0.5 && hitDone === 0) || (t > 1.0 && hitDone === 1)) {
          hitDone++;
          ring(3.8, 6, '#ffd0a0');
        }
        if (t > 1.8) {
          action = 'move';
          t = 0;
        }
        break;
      case 'leap': {
        const k = Math.min(1, t / 1.1);
        const p = leapFrom.clone().lerp(leapTo, k);
        p.y = ctx.terrain.heightAt(p.x, p.z) + Math.sin(k * Math.PI) * 8;
        e.pos.copy(p);
        e.body.setNextKinematicTranslation({ x: p.x, y: p.y + 1.6, z: p.z });
        face(10);
        if (k >= 1 && hitDone === 0) {
          hitDone = 1;
          ring(5.5, 10, '#ff8a60');
        }
        if (t > 2) {
          action = 'move';
          t = 0;
        }
        break;
      }
      case 'summon':
        if (t > 1.2 && hitDone === 0) {
          hitDone = 1;
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + rand(0, 1);
            const sp = ground(e.pos.x + Math.cos(a) * 7, e.pos.z + Math.sin(a) * 7);
            const m = ctx.enemies.spawn(i === 2 && phase === 2 ? 'mage' : 'minion', sp, true);
            m.alert();
            ctx.fx.ring(sp, '#8a60ff', 3, 0.6);
          }
          events.emit('sound', { name: 'summon', volume: 0.8 });
        }
        if (t > 2.2) {
          action = 'move';
          t = 0;
          hitDone = 0;
        }
        break;
    }
    return true;
  };
}
