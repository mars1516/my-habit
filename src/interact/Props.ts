import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { physics, RAPIER, G, groups, ALL, type RayHit } from '../core/Physics';
import { assets } from '../core/Assets';
import { events } from '../core/Events';
import type { ElementHit, DamageElement } from '../magic/Elements';
import { waterLevelAt } from '../world/WorldGen';
import { clamp } from '../core/math';

export interface Grabbable {
  position(): THREE.Vector3;
  setHeld(b: boolean): void;
  moveTowards(target: THREE.Vector3, dt: number): void;
  throwTo(vel: THREE.Vector3): void;
  valid(): boolean;
}

/** Base for every interactive world object. */
export abstract class Prop {
  static nextId = 1;
  uid = Prop.nextId++;
  removed = false;
  pos = new THREE.Vector3();
  /** Radius used for elemental area checks. */
  radius = 1;
  onElement(_hit: ElementHit, _inWater: boolean) {}
  update(_dt: number) {}
  remove() {
    this.removed = true;
  }
}

export type DynKind = 'crate' | 'barrel' | 'bomb' | 'boulder' | 'block' | 'metal' | 'spiritrock' | 'log';

const ICE_MAT = new THREE.MeshStandardMaterial({
  color: '#bfeaff',
  emissive: '#2a6d8a',
  emissiveIntensity: 0.35,
  roughness: 0.15,
  metalness: 0.1,
  transparent: true,
  opacity: 0.88,
  flatShading: true,
});

/** Physics-driven props: crates, barrels, boulders, stone/metal blocks. */
export class DynamicProp extends Prop implements Grabbable {
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  mass: number;
  held = false;
  thrown = 0;
  burning = 0;
  fuse = -1;
  floats: boolean;
  flammable: boolean;
  heavy: boolean;
  home: THREE.Vector3;
  onMoved?: () => void;
  /** Settled props stay frozen until something disturbs them (prevents slow rolling off slopes). */
  restLocked = false;
  private lastPos = new THREE.Vector3();
  private hitCooldown = 0;
  private tint = new THREE.Color();
  private mats: THREE.MeshStandardMaterial[] = [];

  constructor(public kind: DynKind, pos: THREE.Vector3, rotY = 0) {
    super();
    // Props placed near the ground are snapped onto it and start asleep (they stay put until disturbed).
    const HALF_H: Record<DynKind, number> = { crate: 0.55, barrel: 0.55, bomb: 0.55, boulder: 1.26, spiritrock: 0.53, block: 0.65, metal: 0.65, log: 0.36 };
    const g = ctx.terrain.heightAt(pos.x, pos.z);
    const settle = pos.y - g < 3;
    if (settle) pos = pos.clone().setY(g + HALF_H[kind] + 0.03);
    this.pos.copy(pos);
    this.home = pos.clone();
    let desc: RAPIER.ColliderDesc;
    let density = 10;
    let offsetY = 0;
    switch (kind) {
      case 'crate': {
        this.mesh = assets.env('crate');
        this.mesh.scale.setScalar(5.2);
        desc = RAPIER.ColliderDesc.cuboid(0.55, 0.55, 0.55);
        offsetY = -0.55;
        density = 14;
        break;
      }
      case 'barrel':
      case 'bomb': {
        this.mesh = assets.env('barrel');
        this.mesh.scale.setScalar(5.2);
        desc = RAPIER.ColliderDesc.cylinder(0.55, 0.5);
        offsetY = -0.55;
        density = 16;
        if (kind === 'bomb') {
          this.mesh.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.material = (m.material as THREE.MeshStandardMaterial).clone();
              (m.material as THREE.MeshStandardMaterial).color.set('#ff5a4a');
              (m.material as THREE.MeshStandardMaterial).emissive.set('#401010');
            }
          });
        }
        break;
      }
      case 'boulder':
      case 'spiritrock': {
        const r = kind === 'boulder' ? 1.3 : 0.55;
        const g = new THREE.IcosahedronGeometry(r, 1);
        const p = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(p, i);
          v.multiplyScalar(0.9 + ((Math.sin(v.x * 13.1 + v.y * 7.7 + v.z * 3.3) + 1) / 2) * 0.18);
          p.setXYZ(i, v.x, v.y, v.z);
        }
        g.computeVertexNormals();
        this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: kind === 'boulder' ? '#9a948a' : '#8f9a86', roughness: 0.95, flatShading: true }));
        desc = RAPIER.ColliderDesc.ball(r * 0.97);
        density = kind === 'boulder' ? 32 : 28;
        break;
      }
      case 'block':
      case 'metal': {
        const g = new THREE.BoxGeometry(1.3, 1.3, 1.3);
        const mat = kind === 'metal'
          ? new THREE.MeshStandardMaterial({ color: '#7d8a99', metalness: 0.7, roughness: 0.35 })
          : new THREE.MeshStandardMaterial({ color: '#a39f96', roughness: 0.9, emissive: '#221a3a', emissiveIntensity: 0.3 });
        const mesh = new THREE.Mesh(g, mat);
        // rune stripe
        const rune = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.12, 1.32), new THREE.MeshBasicMaterial({ color: new THREE.Color(kind === 'metal' ? '#9fd8ff' : '#ff9ae6').multiplyScalar(1.5) }));
        mesh.add(rune);
        this.mesh = mesh;
        desc = RAPIER.ColliderDesc.cuboid(0.65, 0.65, 0.65);
        density = kind === 'metal' ? 45 : 36;
        break;
      }
      case 'log': {
        const g = new THREE.CylinderGeometry(0.35, 0.38, 3.2, 8).rotateZ(Math.PI / 2);
        this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#8a6040', roughness: 0.9, flatShading: true }));
        desc = RAPIER.ColliderDesc.capsule(1.3, 0.36).setRotation({ x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) });
        density = 8;
        break;
      }
    }
    if (offsetY !== 0) {
      const inner = this.mesh;
      inner.position.y = offsetY;
      const holder = new THREE.Group();
      holder.add(inner);
      this.mesh = holder;
    }
    this.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        if ((m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          m.material = (m.material as THREE.MeshStandardMaterial).clone();
          this.mats.push(m.material as THREE.MeshStandardMaterial);
        }
      }
    });
    ctx.scene.add(this.mesh);
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY))
      .setLinearDamping(0.15)
      .setAngularDamping(0.6)
      .setCanSleep(true)
      .setCcdEnabled(kind === 'boulder');
    this.body = physics.world.createRigidBody(bd);
    desc.setDensity(density).setFriction(kind === 'boulder' ? 0.9 : 0.7).setRestitution(0.1);
    desc.setCollisionGroups(groups(G.DYNAMIC, ALL));
    const col = physics.world.createCollider(desc, this.body);
    physics.setOwner(col, { kind: 'dynamic', prop: this, climbable: kind === 'block' || kind === 'metal' || kind === 'crate' });
    this.mass = this.body.mass();
    if (settle) {
      this.body.sleep();
      this.restLocked = true;
    }
    this.floats = kind === 'crate' || kind === 'barrel' || kind === 'bomb' || kind === 'log';
    this.flammable = kind === 'crate' || kind === 'barrel' || kind === 'bomb' || kind === 'log';
    this.heavy = this.mass >= 50;
    this.radius = kind === 'boulder' ? 1.4 : 0.8;
    this.lastPos.copy(pos);
    this.sync();
  }

  position() {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  valid() {
    return !this.removed;
  }

  setHeld(b: boolean) {
    this.held = b;
    this.restLocked = false;
    this.body.setGravityScale(b ? 0 : 1, true);
    this.body.wakeUp();
    if (!b) this.thrown = Math.max(this.thrown, 0.8);
  }

  moveTowards(target: THREE.Vector3, _dt: number) {
    const p = this.position();
    const v = target.clone().sub(p).multiplyScalar(9);
    if (v.length() > 22) v.setLength(22);
    this.body.setLinvel(v, true);
    const av = this.body.angvel();
    this.body.setAngvel({ x: av.x * 0.9, y: av.y * 0.9 + 0.05, z: av.z * 0.9 }, true);
  }

  throwTo(vel: THREE.Vector3) {
    this.restLocked = false;
    this.body.setLinvel(vel, true);
    this.body.setAngvel({ x: Math.random() * 4, y: Math.random() * 4, z: Math.random() * 4 }, true);
    this.thrown = 2.5;
  }

  impulse(v: THREE.Vector3) {
    this.restLocked = false;
    this.body.wakeUp();
    this.body.applyImpulse({ x: v.x * this.mass, y: v.y * this.mass, z: v.z * this.mass }, true);
    if (this.kind === 'boulder' || this.kind === 'spiritrock') this.thrown = Math.max(this.thrown, 1.5);
  }

  private sync() {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.pos.set(t.x, t.y, t.z);
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  override onElement(hit: ElementHit, _inWater: boolean) {
    const d = this.pos.distanceTo(hit.pos);
    if (d > hit.radius + this.radius) return;
    const falloff = clamp(1 - d / (hit.radius + this.radius), 0.3, 1);
    if (hit.element === 'fire' && this.flammable && this.burning <= 0 && !this.inWater()) {
      if (this.kind === 'bomb') this.lightFuse();
      else this.burning = 4;
    }
    if (hit.element === 'lightning' && this.kind === 'bomb') this.lightFuse();
    if (hit.element === 'ice' && this.burning > 0) this.burning = 0;
    if (hit.push && hit.kind !== 'gust') {
      const dir = this.pos.clone().sub(hit.pos).setY(0.4).normalize();
      this.impulse(dir.multiplyScalar(hit.push * falloff * (this.heavy ? 0.35 : 0.8)));
    }
  }

  lightFuse() {
    if (this.fuse >= 0) return;
    this.fuse = 1.2;
    events.emit('sound', { name: 'fuse', pos: this.pos, volume: 0.5 });
  }

  private inWater() {
    return this.pos.y < waterLevelAt(this.pos.x, this.pos.z) - 0.2;
  }

  override update(dt: number) {
    if (this.removed) return;
    this.hitCooldown -= dt;
    if (this.restLocked) {
      // wake only when the player or an enemy is close enough to touch it
      const near = this.pos.distanceTo(ctx.player.pos) < this.radius + 2.2 || (ctx.enemies?.inRange(this.pos, this.radius + 1.8).length ?? 0) > 0;
      if (near) this.restLocked = false;
      else {
        if (!this.body.isSleeping()) {
          this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
          this.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
          this.body.sleep();
        }
        return;
      }
    }
    if (!this.body.isSleeping() || this.held) this.sync();
    // buoyancy
    const wl = waterLevelAt(this.pos.x, this.pos.z);
    const depth = wl - this.pos.y + 0.5;
    if (depth > 0 && !this.held) {
      const sub = clamp(depth, 0, 1);
      const lv = this.body.linvel();
      if (this.floats) this.body.applyImpulse({ x: 0, y: this.mass * 24 * 1.7 * sub * dt, z: 0 }, true);
      this.body.setLinvel({ x: lv.x * (1 - dt * 1.5), y: lv.y * (1 - dt * 2.5), z: lv.z * (1 - dt * 1.5) }, true);
      if (this.burning > 0) this.burning = 0;
      if (this.fuse > 0 && this.kind === 'bomb') this.fuse = -1;
    }
    // kinetic damage when thrown / rolling
    const speed = this.pos.distanceTo(this.lastPos) / Math.max(dt, 1e-3);
    if ((this.thrown > 0 || this.kind === 'boulder') && speed > 6 && this.hitCooldown <= 0) {
      const e = ctx.enemies?.segmentHit(this.lastPos, this.pos, this.radius);
      if (e) {
        this.hitCooldown = 0.4;
        const dmg = clamp(speed * (1 + this.mass / 60) * 0.9, 10, 70);
        ctx.world.applyHit({ element: this.kind === 'metal' ? 'physical' : 'kinesis', pos: this.pos.clone(), radius: this.radius + 0.3, damage: dmg, push: 8, source: 'player', kind: 'throw', targetId: e.enemy.id });
        ctx.cam.shake(0.2);
        if (this.kind === 'crate' || this.kind === 'barrel') this.breakApart(true);
        if (this.kind === 'bomb') this.explode();
      }
      ctx.props.crackAt(this.pos, this.radius, speed * this.mass);
    }
    this.thrown = Math.max(0, this.thrown - dt);
    this.lastPos.copy(this.pos);

    if (this.burning > 0) {
      this.burning -= dt;
      this.tint.set('#ff4a10').multiplyScalar(0.3 + Math.random() * 0.2);
      for (const m of this.mats) m.emissive.copy(this.tint);
      ctx.particles.emit({ pos: this.pos, posSpread: 0.6, vel: new THREE.Vector3(0, 2.5, 0), spread: 0.8, life: [0.4, 0.8], size: [1.1, 0.1], color: '#ffc050', color2: '#ff3000', count: 2 });
      if (Math.random() < dt * 2) {
        ctx.fire.igniteCircle(this.pos.x, this.pos.z, 2, 1.5);
        ctx.props.igniteNear(this.pos, 2.2, this);
      }
      if (this.burning <= 0) this.breakApart(false);
    }
    if (this.fuse > 0) {
      this.fuse -= dt;
      ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), count: 2, spread: 3, life: [0.1, 0.3], size: [0.3, 0.05], color: '#ffe080' });
      if (this.fuse <= 0) this.explode();
    }
    if (this.pos.y < -40) this.remove();
  }

  explode() {
    if (this.removed) return;
    const p = this.pos.clone();
    this.remove();
    ctx.fx.sphere(p, '#ff7a2e', 5, 0.4);
    ctx.fx.ring(p, '#ffb050', 7, 0.5);
    ctx.particles.emit({ pos: p, count: 70, spread: 11, life: [0.3, 0.9], size: [2.2, 0.1], color: '#ffe080', color2: '#ff3000', drag: 3 });
    ctx.particles.emit({ pos: p, count: 22, spread: 4, vel: new THREE.Vector3(0, 3, 0), life: [1, 2.2], size: [3, 6], alpha: [0.4, 0], color: '#3a3330', additive: false, drag: 1.5 });
    ctx.lights.flash(p, '#ff8a30', 150, 30, 0.5);
    ctx.cam.shake(0.8);
    events.emit('sound', { name: 'explode', pos: p, volume: 1 });
    ctx.world.applyHit({ element: 'fire', pos: p, radius: 5.5, damage: 45, push: 16, source: 'player', kind: 'blast' });
    ctx.props.crackAt(p, 5.5, 9999);
    if (ctx.player.pos.distanceTo(p) < 5) ctx.player.damage(6, p, 12);
  }

  breakApart(loot: boolean) {
    if (this.removed) return;
    const p = this.pos.clone();
    this.remove();
    ctx.particles.emit({ pos: p, count: 16, spread: 4, gravity: 12, life: [0.5, 1], size: [0.35, 0.2], color: '#8a6040', color2: '#4a3020', additive: false });
    if (this.burning !== 0) ctx.particles.emit({ pos: p, count: 8, spread: 1.5, vel: new THREE.Vector3(0, 2, 0), life: [1, 2], size: [1.5, 3], alpha: [0.35, 0], color: '#2e2a28', additive: false });
    events.emit('sound', { name: 'break', pos: p, volume: 0.5 });
    const roll = Math.random();
    if (loot || roll < 0.6) {
      const item = roll < 0.25 ? 'apple' : roll < 0.45 ? 'crystal' : roll < 0.55 ? 'mushroom' : 'charcoal';
      ctx.interact.spawnPickup(item, p.clone().setY(p.y + 0.4), true);
    }
    events.emit('objectBurned', { kind: this.kind, pos: p });
  }

  override remove() {
    if (this.removed) return;
    super.remove();
    if (ctx.skills?.held === this) ctx.skills.release();
    physics.removeBody(this.body);
    this.mesh.removeFromParent();
  }
}

/** A hexagonal ice column raised by the ice skill (Cryonis-like). */
class IcePillar extends Prop {
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  private t = 0;
  life = 60;
  private base: number;
  private height: number;

  constructor(pos: THREE.Vector3, onWater: boolean, scale = 1) {
    super();
    const wl = waterLevelAt(pos.x, pos.z);
    this.base = onWater ? wl - 2.5 : pos.y - 0.4;
    this.height = (onWater ? 6.2 : 4.6) * scale;
    this.pos.set(pos.x, this.base, pos.z);
    this.radius = 1.5;
    const geo = new THREE.CylinderGeometry(1.25, 1.4, this.height, 6).translate(0, this.height / 2, 0);
    this.mesh = new THREE.Mesh(geo, ICE_MAT);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.position.set(pos.x, this.base - this.height, pos.z);
    ctx.scene.add(this.mesh);
    const desc = RAPIER.ColliderDesc.cylinder(this.height / 2, 1.3).setTranslation(pos.x, this.base - this.height / 2, pos.z);
    desc.setCollisionGroups(groups(G.ICE, ALL)).setFriction(0.6);
    this.collider = physics.world.createCollider(desc);
    physics.setOwner(this.collider, { kind: 'ice', prop: this, climbable: true });
    events.emit('sound', { name: 'freeze', pos, volume: 0.7 });
    ctx.particles.emit({ pos: pos.clone().setY(this.base + this.height), count: 30, spread: 4, gravity: 10, life: [0.4, 0.9], size: [0.4, 0.05], color: '#eafaff', color2: '#7fd8ff' });
  }

  get top() {
    return this.base + this.height;
  }

  override update(dt: number) {
    if (this.removed) return;
    if (this.t < 0.3) {
      this.t += dt;
      const k = Math.min(1, this.t / 0.3);
      const e = 1 - Math.pow(1 - k, 3);
      const y = this.base - this.height + this.height * e;
      this.mesh.position.y = y;
      this.collider.setTranslation({ x: this.pos.x, y: y + this.height / 2, z: this.pos.z });
      if (k >= 1) {
        // lift anything standing on the spot
        const p = ctx.player;
        if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 1.5 && p.pos.y < this.top + 0.5 && p.pos.y > this.base - 1) {
          p.teleportKeepCam(new THREE.Vector3(p.pos.x, this.top + 0.05, p.pos.z));
        }
        ctx.enemies?.launchNear(new THREE.Vector3(this.pos.x, this.top, this.pos.z), 1.8, 10, 12);
      }
    }
    this.life -= dt;
    if (this.life < 3) this.mesh.scale.setScalar(Math.max(0.05, this.life / 3));
    if (this.life <= 0) this.shatter();
  }

  override onElement(hit: ElementHit) {
    if (hit.element !== 'fire' && !(hit.kind === 'throw' || hit.kind === 'strike')) return;
    const d = Math.hypot(hit.pos.x - this.pos.x, hit.pos.z - this.pos.z);
    if (d < hit.radius + this.radius && hit.pos.y > this.base - 1 && hit.pos.y < this.top + 2) this.shatter();
  }

  shatter() {
    if (this.removed) return;
    this.remove();
    physics.removeCollider(this.collider);
    this.mesh.removeFromParent();
    ctx.particles.emit({ pos: new THREE.Vector3(this.pos.x, this.base + this.height * 0.7, this.pos.z), count: 40, posSpread: 1.5, spread: 6, gravity: 14, life: [0.5, 1.1], size: [0.5, 0.1], color: '#f0fcff', color2: '#7fd8ff' });
    events.emit('sound', { name: 'shatter', pos: this.pos, volume: 0.6 });
  }
}

/** A disc of ice floating on water, created by freezing magic. */
class IceFloe extends Prop {
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  life: number;
  constructor(x: number, z: number, level: number, r: number, life = 40) {
    super();
    this.pos.set(x, level, z);
    this.radius = r;
    this.life = life;
    const geo = new THREE.CylinderGeometry(r, r * 0.9, 0.7, 6).translate(0, 0.05, 0);
    this.mesh = new THREE.Mesh(geo, ICE_MAT);
    this.mesh.position.set(x, level, z);
    this.mesh.rotation.y = Math.random() * Math.PI;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.scale.setScalar(0.1);
    ctx.scene.add(this.mesh);
    const desc = RAPIER.ColliderDesc.cylinder(0.35, r).setTranslation(x, level + 0.05, z);
    desc.setCollisionGroups(groups(G.ICE, ALL)).setFriction(0.3);
    this.collider = physics.world.createCollider(desc);
    physics.setOwner(this.collider, { kind: 'ice', prop: this, climbable: false });
  }
  override update(dt: number) {
    if (this.removed) return;
    this.life -= dt;
    const grow = Math.min(1, this.mesh.scale.x + dt * 6);
    const s = this.life < 3 ? Math.max(0.05, this.life / 3) : grow;
    this.mesh.scale.set(s, 1, s);
    this.mesh.position.y = this.pos.y + Math.sin(ctx.time * 1.5 + this.pos.x) * 0.03;
    if (this.life <= 0) this.melt();
  }
  override onElement(hit: ElementHit) {
    if (hit.element === 'fire' && this.pos.distanceTo(hit.pos) < hit.radius + this.radius) this.melt();
  }
  melt() {
    if (this.removed) return;
    this.remove();
    physics.removeCollider(this.collider);
    this.mesh.removeFromParent();
    ctx.particles.emit({ pos: this.pos.clone().setY(this.pos.y + 0.4), count: 8, posSpread: this.radius, vel: new THREE.Vector3(0, 1.5, 0), spread: 0.8, life: [0.8, 1.6], size: [1, 2], alpha: [0.35, 0], color: '#e8f4fa', additive: false });
  }
}

/** Wind burst: a tornado that drags things in and lifts them. */
class Tornado extends Prop {
  life = 6;
  private tick = 0;
  constructor(pos: THREE.Vector3, public r: number) {
    super();
    this.pos.copy(pos);
    this.pos.y = ctx.terrain.heightAt(pos.x, pos.z);
    this.radius = r;
    ctx.world.addUpdraft(this.pos, r, 40, 55, 6);
    events.emit('sound', { name: 'tornado', pos, volume: 0.8 });
  }
  override update(dt: number) {
    this.life -= dt;
    this.pos.x += ctx.wind.x * dt * 0.8;
    this.pos.z += ctx.wind.y * dt * 0.8;
    this.pos.y = ctx.terrain.heightAt(this.pos.x, this.pos.z);
    for (let i = 0; i < 10; i++) {
      const h = Math.random() * 16;
      const a = ctx.time * 6 + Math.random() * Math.PI * 2;
      const rr = 0.6 + (h / 16) * this.r;
      ctx.particles.emit({
        pos: this.pos.clone().add(new THREE.Vector3(Math.cos(a) * rr, h, Math.sin(a) * rr)),
        vel: new THREE.Vector3(-Math.sin(a) * 9, 3, Math.cos(a) * 9),
        spread: 0.4,
        life: [0.3, 0.6],
        size: [0.6, 1.4],
        alpha: [0.5, 0],
        color: '#e8fff4',
        additive: i % 2 === 0,
        drag: 1,
      });
    }
    ctx.enemies?.pull(this.pos.clone().setY(this.pos.y + 3), this.r * 1.8, 9, dt, true);
    ctx.props.pull(this.pos.clone().setY(this.pos.y + 4), this.r * 1.8, 10, dt, true);
    this.tick -= dt;
    if (this.tick <= 0) {
      this.tick = 0.5;
      ctx.world.applyHit({ element: 'wind', pos: this.pos.clone().setY(this.pos.y + 2), radius: this.r, damage: 6, source: 'player', kind: 'tick', dir: new THREE.Vector3(ctx.wind.x, 0, ctx.wind.y).normalize() });
    }
    if (this.life <= 0) this.remove();
  }
}

export class Props {
  list: Prop[] = [];
  dynamics: DynamicProp[] = [];
  private pillars: IcePillar[] = [];
  private floes: IceFloe[] = [];
  private listeners = new Map<string, (() => void)[]>();
  private crackables: { pos: THREE.Vector3; r: number; threshold: number; fn: () => void; done: boolean }[] = [];

  add<T extends Prop>(p: T) {
    this.list.push(p);
    if (p instanceof DynamicProp) this.dynamics.push(p);
    return p;
  }

  dyn(kind: DynKind, pos: THREE.Vector3, rotY = 0) {
    return this.add(new DynamicProp(kind, pos, rotY));
  }

  // ---- signals (puzzle wiring) ---------------------------------------------
  on(signal: string, fn: () => void) {
    let l = this.listeners.get(signal);
    if (!l) this.listeners.set(signal, (l = []));
    l.push(fn);
    if (ctx.save.has('sig:' + signal)) fn();
  }

  signal(name: string) {
    if (!ctx.save.set('sig:' + name)) return;
    for (const fn of this.listeners.get(name) ?? []) fn();
  }

  /** Register something that breaks under enough impact energy (explosions, boulders, strikes). */
  crackable(pos: THREE.Vector3, r: number, threshold: number, fn: () => void) {
    this.crackables.push({ pos, r, threshold, fn, done: false });
  }

  crackAt(pos: THREE.Vector3, r: number, energy: number) {
    for (const c of this.crackables) {
      if (c.done || energy < c.threshold) continue;
      if (c.pos.distanceTo(pos) < c.r + r) {
        c.done = true;
        c.fn();
      }
    }
  }

  // ---- elemental dispatch ---------------------------------------------------
  onElement(hit: ElementHit, inWater: boolean) {
    for (const p of this.list) if (!p.removed) p.onElement(hit, inWater);
    if (hit.kind === 'strike' || hit.kind === 'blast' || hit.kind === 'burst') this.crackAt(hit.pos, hit.radius, hit.damage * 30);
  }

  /** A projectile / bolt touched a collider directly. */
  directHit(rh: RayHit, _proj: unknown, element?: DamageElement) {
    const owner = rh.owner as { prop?: Prop } | undefined;
    void element;
    void owner;
  }

  igniteNear(pos: THREE.Vector3, r: number, except?: Prop) {
    const hit: ElementHit = { element: 'fire', pos, radius: r, damage: 0, source: 'world', kind: 'tick' };
    for (const p of this.list) if (p !== except && !p.removed && p.pos.distanceTo(pos) < r + p.radius) p.onElement(hit, false);
  }

  push(origin: THREE.Vector3, dir: THREE.Vector3, range: number, coneCos: number, strength: number) {
    let n = 0;
    for (const d of this.dynamics) {
      if (d.removed || d.held) continue;
      const to = d.pos.clone().sub(origin);
      const dist = to.length();
      if (dist > range + d.radius) continue;
      const nd = to.clone().normalize();
      if (coneCos > -1 && nd.dot(dir) < coneCos) continue;
      const f = strength * (1 - (dist / (range + d.radius)) * 0.6) * (d.heavy ? 0.45 : 1);
      const v = coneCos > -1 ? dir.clone().multiplyScalar(f).add(new THREE.Vector3(0, f * 0.25, 0)) : nd.multiplyScalar(f).add(dir.clone().multiplyScalar(f * 0.5));
      d.impulse(v);
      n++;
    }
    return n;
  }

  pull(center: THREE.Vector3, range: number, strength: number, dt = 1, lift = false) {
    for (const d of this.dynamics) {
      if (d.removed || d.held) continue;
      const to = center.clone().sub(d.pos);
      const dist = to.length();
      if (dist > range || dist < 0.5) continue;
      const v = to.normalize().multiplyScalar(strength * (d.heavy ? 0.4 : 1) * (dt < 1 ? dt * 3 : 1));
      if (lift) v.y += strength * dt * 1.2;
      d.impulse(v);
    }
  }

  findGrabbable(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): Grabbable | null {
    let best: DynamicProp | null = null;
    let bestScore = Infinity;
    for (const d of this.dynamics) {
      if (d.removed) continue;
      const to = d.pos.clone().sub(origin);
      const along = to.dot(dir);
      if (along < 0 || along > maxDist) continue;
      const perp = to.clone().sub(dir.clone().multiplyScalar(along)).length();
      const tol = d.radius + 1.2 + along * 0.04;
      if (perp > tol) continue;
      const score = perp + along * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }

  // ---- ice ----------------------------------------------------------------
  spawnIcePillar(point: THREE.Vector3, onWater: boolean, scale = 1) {
    if (this.pillars.length >= 3) this.pillars.shift()!.shatter();
    const p = this.add(new IcePillar(point, onWater, scale));
    this.pillars.push(p);
    this.pillars = this.pillars.filter((x) => !x.removed);
    return p;
  }

  freezeWater(center: THREE.Vector3, radius: number) {
    const level = waterLevelAt(center.x, center.z);
    const spacing = 2.3;
    let made = 0;
    for (let dz = -radius; dz <= radius; dz += spacing) {
      for (let dx = -radius; dx <= radius; dx += spacing) {
        const ox = (Math.round(dz / spacing) % 2) * spacing * 0.5;
        const x = center.x + dx + ox, z = center.z + dz;
        if (Math.hypot(x - center.x, z - center.z) > radius) continue;
        if (waterLevelAt(x, z) !== level) continue;
        if (level - ctx.terrain.heightAt(x, z) < 0.3) continue;
        if (this.floes.some((f) => !f.removed && Math.hypot(f.pos.x - x, f.pos.z - z) < spacing * 0.8)) continue;
        const f = this.add(new IceFloe(x, z, level, 1.45));
        this.floes.push(f);
        made++;
      }
    }
    this.floes = this.floes.filter((f) => !f.removed);
    while (this.floes.length > 90) this.floes.shift()!.melt();
    if (made) {
      events.emit('sound', { name: 'freeze', pos: center, volume: 0.5 });
      ctx.particles.emit({ pos: center.clone().setY(level + 0.3), count: 14 + made * 2, posSpread: radius * 0.7, spread: 1.5, life: [0.5, 1], size: [0.4, 0.05], color: '#eafaff' });
    }
    return made;
  }

  spawnTornado(point: THREE.Vector3, r: number) {
    this.add(new Tornado(point, r));
  }

  update(dt: number) {
    for (const p of this.list) if (!p.removed) p.update(dt);
    if (this.list.some((p) => p.removed)) {
      this.list = this.list.filter((p) => !p.removed);
      this.dynamics = this.dynamics.filter((p) => !p.removed);
    }
  }
}

export { ICE_MAT };
