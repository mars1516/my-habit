import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { physics, RAPIER, G, groups } from '../core/Physics';
import { Character, CHAR_SCALE } from '../player/Character';
import { assets, type CharacterKey } from '../core/Assets';
import { events } from '../core/Events';
import { angleLerp, damp, clamp, rand, angleDiff } from '../core/math';
import { newStatus, react, elementColor, ELEMENT_INFO, type ElementHit, type StatusState, type DamageElement, type Element } from '../magic/Elements';
import { waterLevelAt } from '../world/WorldGen';
import { ICE_MAT } from '../interact/Props';

export type EnemyKind = 'minion' | 'warrior' | 'rogue' | 'mage' | 'lord';

interface Def {
  model: CharacterKey;
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  range: number;
  cd: number;
  right?: string;
  left?: string;
  ranged?: boolean;
  scale?: number;
  shield?: boolean;
  attack: string;
}

export const ENEMY_DEFS: Record<EnemyKind, Def> = {
  minion: { model: 'skeleton_minion', name: '해골 졸병', hp: 55, speed: 3.7, dmg: 4, range: 1.9, cd: 1.5, right: 'sk_blade', attack: '1H_Melee_Attack_Chop' },
  warrior: { model: 'skeleton_warrior', name: '해골 전사', hp: 125, speed: 3.1, dmg: 6, range: 2.1, cd: 1.9, right: 'sk_axe', left: 'sk_shield', shield: true, attack: '1H_Melee_Attack_Slice_Diagonal' },
  rogue: { model: 'skeleton_rogue', name: '해골 궁수', hp: 50, speed: 4.0, dmg: 3, range: 17, cd: 2.4, right: 'sk_crossbow', ranged: true, attack: '1H_Ranged_Shoot' },
  mage: { model: 'skeleton_mage', name: '해골 마법사', hp: 65, speed: 3.3, dmg: 4, range: 16, cd: 2.8, right: 'sk_staff', ranged: true, attack: 'Spellcast_Shoot' },
  lord: { model: 'skeleton_warrior', name: '해골 군주', hp: 1800, speed: 3.6, dmg: 10, range: 3.6, cd: 1.6, right: 'sk_blade', left: 'sk_shield_large', scale: 1.75, attack: '2H_Melee_Attack_Chop' },
};

type AIState = 'dormant' | 'awaken' | 'idle' | 'alert' | 'chase' | 'attack' | 'hurt' | 'dead' | 'return';

let NEXT_ID = 1;
const RADIUS = 0.42;
const HALF_H = 0.5;

export class Enemy {
  id = NEXT_ID++;
  def: Def;
  char: Character;
  pos = new THREE.Vector3();
  home = new THREE.Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  state: AIState = 'idle';
  stateTime = 0;
  status: StatusState = newStatus();
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  vy = 0;
  knock = new THREE.Vector3();
  cd = rand(0.5, 1.5);
  campId?: string;
  alive = true;
  hpShow = 0;
  alertIcon = 0;
  deadTimer = 0;
  active = true;
  castElement: Element = 'fire';
  scale: number;
  private attackDone = false;
  private wanderTarget = new THREE.Vector3();
  private wanderTimer = 0;
  private iceBlock?: THREE.Mesh;
  private statusTick = 0;
  private strafe = 1;
  /** Boss only. */
  shieldElement: Element | null = null;
  shieldHp = 0;
  onDeath?: (e: Enemy) => void;
  onHurt?: (e: Enemy, dmg: number, hit: ElementHit) => number;
  customAI?: (e: Enemy, dt: number) => boolean;

  constructor(public kind: EnemyKind, pos: THREE.Vector3, dormant = false) {
    this.def = ENEMY_DEFS[kind];
    this.scale = this.def.scale ?? 1;
    this.char = new Character(this.def.model, 'skeleton', CHAR_SCALE * this.scale);
    this.hp = this.maxHp = this.def.hp;
    this.pos.copy(pos);
    this.home.copy(pos);
    this.yaw = Math.random() * Math.PI * 2;
    ctx.scene.add(this.char.root);
    if (this.def.right) this.char.attach('handslot.r', assets.env(this.def.right));
    if (this.def.left) this.char.attach('handslot.l', assets.env(this.def.left));
    if (kind === 'mage') this.castElement = (['fire', 'ice', 'lightning'] as Element[])[Math.floor(Math.random() * 3)];

    const bd = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + (HALF_H + RADIUS) * this.scale, pos.z);
    this.body = physics.world.createRigidBody(bd);
    const cd = RAPIER.ColliderDesc.capsule(HALF_H * this.scale, RADIUS * this.scale).setCollisionGroups(groups(G.ENEMY, G.TERRAIN | G.STATIC | G.DYNAMIC | G.PLAYER | G.ICE));
    this.collider = physics.world.createCollider(cd, this.body);
    physics.setOwner(this.collider, { kind: 'enemy', enemy: this.id });

    if (dormant) {
      this.state = 'dormant';
      this.char.play('Skeletons_Inactive_Floor_Pose', { fade: 0 });
    } else this.char.play('Idle', { fade: 0 });
    this.syncVisual();
  }

  get name() {
    return this.def.name;
  }

  chest(out = new THREE.Vector3()) {
    return out.copy(this.pos).add(new THREE.Vector3(0, 1.2 * this.scale, 0));
  }

  feet() {
    return this.pos.clone();
  }

  head() {
    return this.pos.clone().add(new THREE.Vector3(0, 2.2 * this.scale, 0));
  }

  private setState(s: AIState) {
    this.state = s;
    this.stateTime = 0;
  }

  private moveKcc(vel: THREE.Vector3, dt: number) {
    const kcc = ctx.enemies.kcc;
    const desired = { x: (vel.x + this.knock.x) * dt, y: this.vy * dt, z: (vel.z + this.knock.z) * dt };
    // don't walk into deep water on purpose
    const nx = this.pos.x + desired.x, nz = this.pos.z + desired.z;
    if (waterLevelAt(nx, nz) - ctx.terrain.heightAt(nx, nz) > 0.8 && vel.lengthSq() > 0) {
      desired.x = this.knock.x * dt;
      desired.z = this.knock.z * dt;
    }
    kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = kcc.computedMovement();
    const grounded = kcc.computedGrounded();
    this.pos.x += m.x;
    this.pos.y += m.y;
    this.pos.z += m.z;
    const th = ctx.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < th - 0.5) this.pos.y = th;
    if (grounded && this.vy <= 0) this.vy = -2;
    else this.vy -= 24 * dt;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + (HALF_H + RADIUS) * this.scale, z: this.pos.z });
    this.knock.multiplyScalar(Math.exp(-dt * 5));
    return grounded;
  }

  private syncVisual() {
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw;
  }

  private face(target: THREE.Vector3, dt: number, speed = 8) {
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    this.yaw = angleLerp(this.yaw, Math.atan2(dx, dz), damp(speed, dt));
  }

  alert() {
    if (!this.alive) return;
    if (this.state === 'dormant') {
      this.setState('awaken');
      this.char.play('Skeletons_Awaken_Floor', { once: true, fade: 0.1, speed: 1.6, onDone: () => this.setState('alert') });
      return;
    }
    if (this.state === 'idle' || this.state === 'return') {
      this.setState('alert');
      this.alertIcon = 1.4;
      this.char.play('Taunt', { once: true, fade: 0.15, speed: 1.6, onDone: () => this.state === 'alert' && this.setState('chase') });
      events.emit('sound', { name: 'alert', pos: this.pos, volume: 0.5 });
    }
  }

  update(dt: number) {
    const pp = ctx.player.pos;
    const d = this.pos.distanceTo(pp);
    this.active = d < 120;
    this.char.root.visible = d < 170;
    if (!this.active) return;
    this.stateTime += dt;
    this.hpShow = Math.max(0, this.hpShow - dt);
    this.alertIcon = Math.max(0, this.alertIcon - dt);

    if (!this.alive) {
      this.deadTimer += dt;
      if (this.deadTimer > 2.2) this.char.setOpacity(Math.max(0, 1 - (this.deadTimer - 2.2) / 1));
      this.char.update(dt);
      return;
    }

    this.updateStatus(dt);
    if (this.status.frozen > 0) {
      this.moveKcc(new THREE.Vector3(), dt);
      this.syncVisual();
      return;
    }
    const stunned = this.status.shocked > 0;
    const vel = new THREE.Vector3();
    const canSee = ctx.player.alive && d < 26 && (d < 9 || Math.abs(angleDiff(this.yaw, Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z))) < 1.2 || this.hpShow > 0);

    if (this.customAI && this.customAI(this, dt)) {
      // boss logic handled movement/animation
    } else if (!stunned) {
      switch (this.state) {
        case 'dormant':
          if (d < 12 && ctx.player.alive) {
            this.alert();
            ctx.enemies.alertCamp(this);
          }
          break;
        case 'awaken':
          break;
        case 'idle':
          this.wanderTimer -= dt;
          if (this.wanderTimer <= 0) {
            this.wanderTimer = rand(3, 7);
            const a = Math.random() * Math.PI * 2;
            this.wanderTarget.copy(this.home).add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(rand(0, 6)));
          }
          if (this.wanderTarget.distanceTo(this.pos) > 1 && this.wanderTimer < 5) {
            const dir = this.wanderTarget.clone().sub(this.pos).setY(0).normalize();
            vel.copy(dir).multiplyScalar(1.4);
            this.face(this.wanderTarget, dt, 4);
            this.char.play('Walking_D_Skeletons', { speed: 0.9 });
          } else this.char.play('Idle', { fade: 0.3 });
          if (canSee) {
            this.alert();
            ctx.enemies.alertCamp(this);
          }
          break;
        case 'alert':
          this.face(pp, dt, 10);
          if (this.stateTime > 1.2) this.setState('chase');
          break;
        case 'chase':
          this.chase(dt, d, vel);
          break;
        case 'attack':
          this.attack(dt, d);
          break;
        case 'hurt':
          if (this.stateTime > 0.4) this.setState('chase');
          break;
        case 'return': {
          const dir = this.home.clone().sub(this.pos).setY(0);
          if (dir.length() < 2) {
            this.setState('idle');
            this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5);
          } else {
            vel.copy(dir.normalize()).multiplyScalar(this.def.speed);
            this.face(this.home, dt, 6);
            this.char.play('Running_A', { speed: 1 });
          }
          if (canSee && d < 15) this.setState('chase');
          break;
        }
      }
    } else {
      this.char.play('Hit_B', { speed: 0.4 });
    }
    // burning skeletons panic
    if (this.status.burning > 0 && this.kind !== 'lord' && this.state === 'chase' && Math.random() < 0.02) this.knock.add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3)));

    this.moveKcc(vel, dt);
    this.syncVisual();
    const slow = this.status.chill > 0 ? 0.6 : 1;
    this.char.update(dt * slow);
  }

  private chase(dt: number, d: number, vel: THREE.Vector3) {
    const pp = ctx.player.pos;
    this.cd -= dt;
    if (!ctx.player.alive) {
      this.setState('return');
      return;
    }
    if (this.home.distanceTo(this.pos) > 55 && d > 18 && this.kind !== 'lord') {
      this.setState('return');
      return;
    }
    const toP = pp.clone().sub(this.pos).setY(0);
    const dir = toP.clone().normalize();
    const speedMul = this.status.chill > 0 ? 0.55 : 1;
    this.face(pp, dt, 9);
    if (this.def.ranged) {
      const ideal = this.def.range * 0.65;
      if (d > this.def.range) vel.copy(dir).multiplyScalar(this.def.speed * speedMul);
      else if (d < ideal * 0.55) vel.copy(dir).multiplyScalar(-this.def.speed * 0.8 * speedMul);
      else {
        if (Math.random() < dt * 0.5) this.strafe *= -1;
        vel.set(-dir.z, 0, dir.x).multiplyScalar(this.strafe * 1.6);
      }
      if (d < this.def.range && this.cd <= 0) this.startAttack();
    } else {
      if (d > this.def.range * 0.85) vel.copy(dir).multiplyScalar(this.def.speed * speedMul);
      if (d < this.def.range && this.cd <= 0) this.startAttack();
    }
    const hs = vel.length();
    if (hs > 0.3) this.char.play(this.def.ranged && hs < 2 ? 'Walking_B' : 'Running_A', { speed: clamp(hs / 4, 0.6, 1.3) });
    else this.char.play('Idle_Combat', { fade: 0.25 });
  }

  private startAttack() {
    this.setState('attack');
    this.attackDone = false;
    const speed = this.kind === 'lord' ? 1.1 : 1.25;
    this.char.play(this.def.attack, { once: true, fade: 0.1, speed, onDone: () => this.state === 'attack' && this.endAttack() });
  }

  private endAttack() {
    this.cd = this.def.cd * rand(0.8, 1.3);
    this.setState('chase');
  }

  private attack(dt: number, d: number) {
    const pp = ctx.player.pos;
    const hitTime = this.def.ranged ? 0.45 : 0.5;
    if (this.stateTime < hitTime) this.face(pp, dt, this.def.ranged ? 10 : 5);
    if (!this.attackDone && this.stateTime >= hitTime) {
      this.attackDone = true;
      if (this.def.ranged) this.shoot();
      else {
        const toP = pp.clone().sub(this.pos).setY(0);
        const facing = Math.abs(angleDiff(this.yaw, Math.atan2(toP.x, toP.z)));
        if (d < this.def.range + 0.7 && facing < 1.1 && Math.abs(pp.y - this.pos.y) < 2.2 * this.scale) {
          if (ctx.player.damage(this.def.dmg, this.pos, this.kind === 'lord' ? 12 : 6)) events.emit('sound', { name: 'hit', volume: 0.6 });
        }
        events.emit('sound', { name: 'swing', pos: this.pos, volume: 0.4 });
      }
    }
    if (this.stateTime > 2.5) this.endAttack();
  }

  private shoot() {
    const hand = this.char.bone('handslot.r')?.getWorldPosition(new THREE.Vector3()) ?? this.chest();
    const target = ctx.player.chestWorld();
    target.addScaledVector(ctx.player.vel.clone().setY(0), 0.25);
    const dir = target.sub(hand).normalize();
    if (this.kind === 'rogue') {
      ctx.skills.projectiles.spawn({ element: 'physical', from: hand, dir, speed: 34, range: 40, size: 0.2, source: 'enemy', style: 'arrow', hit: { element: 'physical', radius: 0.5, damage: this.def.dmg, source: 'enemy', kind: 'bolt', push: 4 } });
      events.emit('sound', { name: 'bow', pos: this.pos, volume: 0.4 });
    } else {
      const el = this.castElement;
      ctx.skills.projectiles.spawn({ element: el, from: hand, dir, speed: 17, range: 40, size: 0.32, source: 'enemy', style: el === 'ice' ? 'shard' : 'orb', hit: { element: el, radius: 1.2, damage: this.def.dmg, source: 'enemy', kind: 'bolt', push: 5 } });
      events.emit('sound', { name: `cast_${el}`, pos: this.pos, volume: 0.35 });
    }
  }

  private updateStatus(dt: number) {
    const s = this.status;
    const wl = waterLevelAt(this.pos.x, this.pos.z);
    if (wl - this.pos.y > 0.3 || ctx.weather.raining) s.wet = Math.max(s.wet, 3);
    if (s.wet > 0 && s.burning > 0) s.burning = 0;
    s.wet = Math.max(0, s.wet - dt);
    s.shocked = Math.max(0, s.shocked - dt);
    if (s.chill > 0 && Math.random() < dt * 0.2) s.chill = Math.max(0, s.chill - 1);
    if (s.frozen > 0) {
      s.frozen -= dt;
      if (!this.iceBlock) {
        this.iceBlock = new THREE.Mesh(new THREE.CylinderGeometry(0.85 * this.scale, 0.95 * this.scale, 2.3 * this.scale, 6), ICE_MAT);
        this.iceBlock.position.y = 1.1 * this.scale;
        this.char.root.add(this.iceBlock);
        this.char.mixer.timeScale = 0;
      }
      if (s.frozen <= 0) this.unfreeze();
    }
    this.statusTick -= dt;
    if (s.burning > 0) {
      s.burning -= dt;
      if (this.statusTick <= 0) {
        this.statusTick = 0.5;
        this.damage(4, 'fire', false);
      }
      if (Math.random() < 0.7)
        ctx.particles.emit({ pos: this.chest(), posSpread: 0.4 * this.scale, vel: new THREE.Vector3(0, 2.2, 0), spread: 0.6, life: [0.3, 0.6], size: [0.9, 0.1], color: '#ffc050', color2: '#ff3000' });
      if (Math.random() < dt * 1.5) ctx.fire.igniteCircle(this.pos.x, this.pos.z, 1.2, 1);
    }
    // tint
    if (s.frozen > 0) this.char.setTint('#80d8ff', 0.5);
    else if (s.burning > 0) this.char.setTint('#ff5a10', 0.4);
    else if (s.shocked > 0) this.char.setTint('#b58cff', Math.sin(ctx.time * 40) > 0 ? 0.6 : 0.1);
    else if (s.chill > 0) this.char.setTint('#6fb8ff', 0.25);
    else if (this.shieldElement) this.char.setTint(ELEMENT_INFO[this.shieldElement].color, 0.2 + Math.sin(ctx.time * 4) * 0.1);
    else if (s.wet > 0) this.char.setTint('#3a70ff', 0.12);
    else this.char.setTint('#000', 0);
    if (s.shocked > 0 && Math.random() < 0.3) ctx.particles.emit({ pos: this.chest(), posSpread: 0.5, spread: 3, life: [0.1, 0.2], size: [0.3, 0.05], color: '#e0d0ff' });
  }

  private unfreeze() {
    this.status.frozen = 0;
    if (this.iceBlock) {
      this.iceBlock.removeFromParent();
      this.iceBlock = undefined;
      ctx.particles.emit({ pos: this.chest(), count: 20, spread: 4, gravity: 12, life: [0.4, 0.8], size: [0.4, 0.05], color: '#e8faff' });
    }
    this.char.mixer.timeScale = 1;
  }

  /** Entry point for all player-sourced hits. */
  takeHit(hit: ElementHit, falloff = 1) {
    if (!this.alive) return;
    const r = react(this.status, hit);
    let dmg = hit.damage * r.multiplier * falloff;
    // shield blocks frontal non-elemental and weak bolts
    if (this.def.shield && hit.dir && hit.kind !== 'strike' && hit.kind !== 'burst') {
      const facing = Math.abs(angleDiff(this.yaw, Math.atan2(-hit.dir.x, -hit.dir.z)));
      if (facing < 0.9 && this.state !== 'attack' && this.status.frozen <= 0) {
        dmg *= 0.35;
        ctx.particles.emit({ pos: this.chest(), count: 6, spread: 3, life: [0.1, 0.3], size: [0.3, 0.05], color: '#ffe8a0' });
        events.emit('sound', { name: 'block', pos: this.pos, volume: 0.4 });
      }
    }
    if (this.onHurt) dmg = this.onHurt(this, dmg, hit);
    if (r.name) events.emit('reaction', { pos: this.head(), name: r.name, color: r.color ?? '#fff' });
    if (r.shatter) ctx.particles.emit({ pos: this.chest(), count: 30, spread: 6, gravity: 14, life: [0.4, 0.9], size: [0.5, 0.1], color: '#f0fcff', color2: '#8fd8ff' });
    if (r.overload) {
      ctx.fx.sphere(this.chest(), '#ff6a4a', 3, 0.3);
      ctx.particles.emit({ pos: this.chest(), count: 30, spread: 7, life: [0.2, 0.5], size: [1, 0.1], color: '#ffb070', color2: '#ff3050' });
      events.emit('sound', { name: 'explode', pos: this.pos, volume: 0.6 });
      ctx.enemies.applyHit({ element: 'physical', pos: this.chest(), radius: 3.5, damage: 18, push: 12, source: 'player', kind: 'aura' }, this);
    }
    if (r.swirl && hit.kind !== 'aura') {
      ctx.fx.ring(this.feet(), elementColor(r.swirl), 5, 0.5);
      ctx.enemies.applyHit({ element: r.swirl, pos: this.chest(), radius: 5, damage: 8, source: 'player', kind: 'aura' }, this);
      if (r.swirl === 'fire') ctx.fire.igniteCircle(this.pos.x, this.pos.z, 4);
    }
    if (r.chainWet && hit.kind !== 'aura') {
      for (const o of ctx.enemies.inRange(this.pos, 7)) {
        if (o === this || o.status.wet <= 0) continue;
        ctx.fx.bolt(this.chest(), o.chest(), '#c8a8ff', 0.2, 0.2, false);
        o.takeHit({ element: 'lightning', pos: o.chest(), radius: 0.5, damage: hit.damage * 0.7, source: 'player', kind: 'aura' });
      }
    }
    if (hit.push && hit.push > 0) {
      const dir = hit.dir && hit.kind === 'bolt' ? hit.dir.clone().setY(0).normalize() : this.pos.clone().sub(hit.pos).setY(0).normalize();
      this.knock.addScaledVector(dir, (hit.push * falloff) / this.scale);
    }
    ctx.skills.addEnergy(r.name ? 6 : 3);
    this.damage(dmg, hit.element, true);
    if (this.alive && this.state !== 'attack' && this.state !== 'dormant' && this.state !== 'awaken' && dmg > 8 && this.kind !== 'lord' && this.status.frozen <= 0) {
      this.setState('hurt');
      this.char.play(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', { once: true, fade: 0.05, speed: 1.5 });
    }
    if (this.state === 'idle' || this.state === 'dormant' || this.state === 'return') {
      this.alert();
      ctx.enemies.alertCamp(this);
    }
  }

  damage(amount: number, element: DamageElement, show: boolean) {
    if (!this.alive) return;
    const a = Math.max(1, Math.round(amount));
    this.hp -= a;
    this.hpShow = 5;
    if (show || element === 'fire') events.emit('damageNumber', { pos: this.head(), amount: a, color: elementColor(element), big: a >= 30 });
    events.emit('sound', { name: 'enemy_hit', pos: this.pos, volume: 0.35 });
    if (this.hp <= 0) this.die();
  }

  launch(vy: number) {
    this.vy = Math.max(this.vy, vy / Math.sqrt(this.scale));
    this.pos.y += 0.2;
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.unfreeze();
    this.status = newStatus();
    this.char.setTint('#000', 0);
    this.setState('dead');
    this.char.play(this.kind === 'lord' ? 'Death_A' : 'Death_C_Skeletons', { once: true, fade: 0.1 });
    physics.removeCollider(this.collider);
    events.emit('sound', { name: 'enemy_die', pos: this.pos, volume: 0.6 });
    events.emit('enemyKilled', { kind: this.kind, pos: this.pos.clone(), campId: this.campId });
    ctx.particles.emit({ pos: this.chest(), count: 20, spread: 3, life: [0.6, 1.2], size: [0.4, 0.05], color: '#b8a8ff' });
    // loot
    const drops: string[] = [];
    if (Math.random() < 0.65) drops.push('bone');
    if (Math.random() < 0.35) drops.push('crystal');
    if (this.kind === 'mage' && Math.random() < 0.5) drops.push('glow_mushroom');
    for (const item of drops) ctx.interact.spawnPickup(item, this.chest().add(new THREE.Vector3(rand(-0.5, 0.5), 0.3, rand(-0.5, 0.5))), true, undefined, true);
    this.onDeath?.(this);
  }

  dispose() {
    this.char.dispose();
    if (this.alive) physics.removeCollider(this.collider);
    physics.world.removeRigidBody(this.body);
  }
}
