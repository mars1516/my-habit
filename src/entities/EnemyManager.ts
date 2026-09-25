import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { physics, RAPIER } from '../core/Physics';
import { events } from '../core/Events';
import { Enemy, type EnemyKind } from './Enemy';
import type { ElementHit } from '../magic/Elements';
import { G } from '../core/Physics';

export interface CampMember {
  kind: EnemyKind;
  dx: number;
  dz: number;
  dormant?: boolean;
}

interface Camp {
  id: string;
  name: string;
  pos: THREE.Vector3;
  members: CampMember[];
  enemies: Enemy[];
  clearedAt: number;
}

/** Closest-approach parameter between segment AB and vertical segment CD. */
function segSegDist(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
  const d1 = b.clone().sub(a), d2 = d.clone().sub(c), r = a.clone().sub(c);
  const A = d1.dot(d1), E = d2.dot(d2), F = d2.dot(r);
  let s = 0, t = 0;
  if (A <= 1e-8) {
    s = 0;
    t = Math.min(1, Math.max(0, F / E));
  } else {
    const C = d1.dot(r);
    const B = d1.dot(d2);
    const den = A * E - B * B;
    s = den !== 0 ? Math.min(1, Math.max(0, (B * F - C * E) / den)) : 0;
    t = (B * s + F) / E;
    if (t < 0) {
      t = 0;
      s = Math.min(1, Math.max(0, -C / A));
    } else if (t > 1) {
      t = 1;
      s = Math.min(1, Math.max(0, (B - C) / A));
    }
  }
  const p1 = a.clone().addScaledVector(d1, s), p2 = c.clone().addScaledVector(d2, t);
  return { s, dist: p1.distanceTo(p2) };
}

export class EnemyManager {
  list: Enemy[] = [];
  camps = new Map<string, Camp>();
  kcc: RAPIER.KinematicCharacterController;
  boss: Enemy | null = null;

  constructor() {
    this.kcc = physics.world.createCharacterController(0.04);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setSlideEnabled(true);
    this.kcc.enableAutostep(0.5, 0.2, false);
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.enableSnapToGround(0.5);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    events.on('enemyKilled', (e) => e.campId && this.checkCamp(e.campId));
  }

  spawn(kind: EnemyKind, pos: THREE.Vector3, dormant = false) {
    const e = new Enemy(kind, pos, dormant);
    this.list.push(e);
    return e;
  }

  camp(id: string, name: string, pos: THREE.Vector3, members: CampMember[]) {
    const camp: Camp = { id, name, pos: pos.clone(), members, enemies: [], clearedAt: -1 };
    this.camps.set(id, camp);
    this.populate(camp);
    return camp;
  }

  private populate(camp: Camp) {
    camp.enemies = camp.members.map((m) => {
      const x = camp.pos.x + m.dx, z = camp.pos.z + m.dz;
      const e = this.spawn(m.kind, new THREE.Vector3(x, ctx.terrain.heightAt(x, z) + 0.1, z), m.dormant);
      e.campId = camp.id;
      return e;
    });
  }

  campCleared(id: string) {
    return ctx.save.has('camp:' + id);
  }

  private checkCamp(id: string) {
    const camp = this.camps.get(id);
    if (!camp) return;
    if (camp.enemies.every((e) => !e.alive)) {
      camp.clearedAt = ctx.time;
      if (ctx.save.set('camp:' + id)) {
        events.emit('banner', { title: '야영지 소탕', sub: camp.name, color: '#ffd780' });
        events.emit('sound', { name: 'fanfare', volume: 0.7 });
      }
    }
  }

  alertCamp(e: Enemy) {
    if (!e.campId) return;
    const camp = this.camps.get(e.campId);
    if (!camp) return;
    for (const o of camp.enemies) if (o !== e && o.alive && o.pos.distanceTo(e.pos) < 30) o.alert();
  }

  update(dt: number) {
    for (const e of this.list) e.update(dt);
    // remove corpses
    const gone = this.list.filter((e) => !e.alive && e.deadTimer > 3.4);
    if (gone.length) {
      for (const e of gone) e.dispose();
      this.list = this.list.filter((e) => !gone.includes(e));
    }
    // respawn cleared camps after a while, when the player is far away
    for (const camp of this.camps.values()) {
      if (camp.clearedAt < 0) continue;
      if (ctx.time - camp.clearedAt > 420 && ctx.player.pos.distanceTo(camp.pos) > 140) {
        camp.clearedAt = -1;
        this.populate(camp);
      }
    }
  }

  alive() {
    return this.list.filter((e) => e.alive && e.active);
  }

  segmentHit(a: THREE.Vector3, b: THREE.Vector3, radius: number): { enemy: Enemy; t: number } | null {
    let best: { enemy: Enemy; t: number } | null = null;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const half = a.distanceTo(b) / 2;
    for (const e of this.list) {
      if (!e.alive || !e.active) continue;
      if (e.pos.distanceTo(mid) > half + 3 * e.scale) continue;
      const c = e.pos.clone().add(new THREE.Vector3(0, 0.35 * e.scale, 0));
      const d = e.pos.clone().add(new THREE.Vector3(0, 1.75 * e.scale, 0));
      const r = segSegDist(a, b, c, d);
      if (r.dist < radius + 0.45 * e.scale && (!best || r.s < best.t)) best = { enemy: e, t: r.s };
    }
    return best;
  }

  byId(id: number) {
    return this.list.find((e) => e.id === id);
  }

  findTarget(origin: THREE.Vector3, fwd: THREE.Vector3, maxDist: number, coneCos: number) {
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of this.list) {
      if (!e.alive || !e.active) continue;
      const to = e.pos.clone().sub(origin).setY(0);
      const d = to.length();
      if (d > maxDist || d < 0.5) continue;
      const cos = to.normalize().dot(fwd);
      if (cos < coneCos) continue;
      const score = d * (2 - cos);
      if (score >= bestScore) continue;
      const eye = ctx.player.chestWorld();
      const dir = e.chest().sub(eye);
      const hit = ctx.world.raycastAll(eye, dir.clone().normalize(), dir.length(), G.TERRAIN | G.STATIC);
      if (hit) continue;
      best = e;
      bestScore = score;
    }
    return best;
  }

  nearest(pos: THREE.Vector3, r: number, exclude: Set<number>) {
    let best: Enemy | null = null;
    let bd = r;
    for (const e of this.list) {
      if (!e.alive || exclude.has(e.id)) continue;
      const d = e.chest().distanceTo(pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  inRange(pos: THREE.Vector3, r: number) {
    return this.list
      .filter((e) => e.alive && e.pos.distanceTo(pos) < r)
      .sort((a, b) => a.pos.distanceTo(pos) - b.pos.distanceTo(pos));
  }

  applyHit(hit: ElementHit, except?: Enemy) {
    for (const e of this.list) {
      if (!e.alive || e === except) continue;
      if (hit.targetId === e.id) {
        e.takeHit(hit, 1);
        continue;
      }
      const d = e.chest().distanceTo(hit.pos);
      const reach = hit.radius + 0.5 * e.scale;
      if (d > reach) continue;
      const falloff = hit.radius > 2 ? Math.max(0.45, 1 - (d / reach) * 0.55) : 1;
      e.takeHit(hit, falloff);
    }
  }

  push(origin: THREE.Vector3, dir: THREE.Vector3, range: number, coneCos: number, strength: number) {
    for (const e of this.list) {
      if (!e.alive) continue;
      const to = e.pos.clone().sub(origin);
      const d = to.length();
      if (d > range) continue;
      const nd = to.setY(0).normalize();
      if (coneCos > -1 && nd.dot(dir.clone().setY(0).normalize()) < coneCos) continue;
      const f = (strength * (1 - (d / range) * 0.5)) / e.scale;
      const push = coneCos > -1 ? dir.clone().setY(0).normalize().multiplyScalar(f) : nd.multiplyScalar(f);
      e.knock.add(push);
      if (dir.y > 0.5) e.launch(f * 0.7);
    }
  }

  pull(center: THREE.Vector3, range: number, strength: number, dt = 1, lift = false) {
    for (const e of this.list) {
      if (!e.alive || e.kind === 'lord') continue;
      const to = center.clone().sub(e.pos).setY(0);
      const d = to.length();
      if (d > range || d < 0.6) continue;
      e.knock.addScaledVector(to.normalize(), strength * (dt < 1 ? dt * 4 : 1));
      if (lift && d < range * 0.6) e.vy = Math.max(e.vy, 5);
    }
  }

  launchNear(pos: THREE.Vector3, r: number, vy: number, dmg = 0) {
    for (const e of this.list) {
      if (!e.alive) continue;
      if (Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) > r || Math.abs(e.pos.y - pos.y) > 4) continue;
      e.launch(vy);
      if (dmg > 0) e.takeHit({ element: 'ice', pos: e.chest(), radius: 0.5, damage: dmg, source: 'player', kind: 'pillar' });
    }
  }

  freezeNear(pos: THREE.Vector3, r: number, seconds: number) {
    for (const e of this.inRange(pos, r)) e.status.frozen = Math.max(e.status.frozen, e.kind === 'lord' ? seconds * 0.35 : seconds);
  }

  shockInWater(pos: THREE.Vector3, r: number) {
    for (const e of this.inRange(pos, r)) {
      if (e.status.wet > 0 || ctx.world.isWater(e.pos, 0.3)) e.takeHit({ element: 'lightning', pos: e.chest(), radius: 0.5, damage: 16, source: 'player', kind: 'aura' });
    }
  }

  burnInFire() {
    for (const e of this.list) {
      if (!e.alive || !e.active) continue;
      if (ctx.fire.isBurningAt(e.pos.x, e.pos.z) && e.status.wet <= 0 && e.status.burning <= 0) {
        e.status.burning = 3;
        if (e.state === 'idle' || e.state === 'dormant') {
          e.alert();
          this.alertCamp(e);
        }
      }
    }
  }

  anyAlert(r = 40) {
    return this.list.some((e) => e.alive && (e.state === 'chase' || e.state === 'attack' || e.state === 'alert') && e.pos.distanceTo(ctx.player.pos) < r);
  }
}
