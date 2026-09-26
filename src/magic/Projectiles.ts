import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { G } from '../core/Physics';
import type { DamageElement, ElementHit } from './Elements';
import { elementColor } from './Elements';
import { events } from '../core/Events';

export interface ProjectileSpec {
  element: DamageElement;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  gravity?: number;
  range?: number;
  size?: number;
  hit: Omit<ElementHit, 'pos' | 'dir' | 'targetId'>;
  source: 'player' | 'enemy';
  style?: 'orb' | 'shard' | 'big' | 'arrow';
  onImpact?: (pos: THREE.Vector3, normal: THREE.Vector3, water: boolean) => void;
}

interface Proj extends ProjectileSpec {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  travelled: number;
  mesh: THREE.Object3D;
  light: THREE.Vector3;
  dead: boolean;
  age: number;
}

const orbGeo = new THREE.IcosahedronGeometry(1, 1);
const shardGeo = new THREE.OctahedronGeometry(1, 0).scale(0.45, 0.45, 1.6);
const arrowGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4).rotateX(Math.PI / 2);

export class Projectiles {
  list: Proj[] = [];

  spawn(spec: ProjectileSpec) {
    const color = new THREE.Color(elementColor(spec.element));
    const size = spec.size ?? 0.28;
    let mesh: THREE.Object3D;
    if (spec.style === 'shard') {
      mesh = new THREE.Mesh(shardGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), transparent: true, opacity: 0.95 }));
      mesh.scale.setScalar(size);
    } else if (spec.style === 'arrow') {
      mesh = new THREE.Mesh(arrowGeo, new THREE.MeshLambertMaterial({ color: '#d8d0b8' }));
    } else {
      const g = new THREE.Group();
      const core = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').lerp(color, 0.35).multiplyScalar(2.5) }));
      core.scale.setScalar(size * 0.6);
      const halo = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.6), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(size * (spec.style === 'big' ? 1.6 : 1.2));
      g.add(core, halo);
      mesh = g;
    }
    mesh.position.copy(spec.from);
    ctx.scene.add(mesh);
    const p: Proj = {
      ...spec,
      pos: spec.from.clone(),
      vel: spec.dir.clone().normalize().multiplyScalar(spec.speed),
      travelled: 0,
      mesh,
      light: spec.from.clone(),
      dead: false,
      age: 0,
    };
    if (spec.style !== 'arrow') ctx.lights.flash(p.pos, color, spec.style === 'big' ? 40 : 18, spec.style === 'big' ? 16 : 9, (spec.range ?? 40) / spec.speed + 0.1, p.light);
    this.list.push(p);
    return p;
  }

  update(dt: number) {
    for (const p of this.list) {
      if (p.dead) continue;
      p.age += dt;
      const from = p.pos.clone();
      p.vel.y -= (p.gravity ?? 0) * dt;
      const step = p.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const dir = step.clone().normalize();
      const to = from.clone().add(step);
      let best = len;
      let hitPos: THREE.Vector3 | null = null;
      let hitNormal = new THREE.Vector3(0, 1, 0);
      let targetId: number | undefined;
      let water = false;

      // actors
      if (p.source === 'player') {
        const e = ctx.enemies?.segmentHit(from, to, p.size ?? 0.3);
        if (e && e.t * len < best) {
          best = e.t * len;
          hitPos = from.clone().addScaledVector(dir, best);
          targetId = e.enemy.id;
          hitNormal = dir.clone().negate();
        }
      } else if (ctx.player.alive) {
        const c = ctx.player.chestWorld();
        const t = segSphere(from, to, c, 0.6);
        if (t !== null && t * len < best) {
          best = t * len;
          hitPos = from.clone().addScaledVector(dir, best);
          hitNormal = dir.clone().negate();
        }
      }
      // world geometry
      const mask = G.TERRAIN | G.STATIC | G.DYNAMIC | G.ICE | (p.source === 'enemy' ? 0 : 0);
      const rh = ctx.world.raycastAll(from, dir, len + 0.01, mask);
      if (rh && rh.distance < best) {
        best = rh.distance;
        hitPos = rh.point;
        hitNormal = rh.normal;
        targetId = undefined;
        ctx.props?.directHit(rh, p);
      }
      const wp = ctx.world.rayWater(from, dir, best);
      if (wp) {
        hitPos = wp;
        hitNormal = new THREE.Vector3(0, 1, 0);
        water = true;
        targetId = undefined;
      }

      if (hitPos) {
        this.impact(p, hitPos, hitNormal, targetId, water);
        continue;
      }
      p.pos.copy(to);
      p.travelled += len;
      p.light.copy(p.pos);
      p.mesh.position.copy(p.pos);
      if (p.style === 'shard' || p.style === 'arrow') p.mesh.lookAt(p.pos.clone().add(p.vel));
      else p.mesh.rotation.y += dt * 8;
      this.trail(p, dt);
      if (p.travelled > (p.range ?? 45)) {
        // fizzle at max range: still applies the element in the air (no ground effect)
        this.impact(p, p.pos.clone(), dir.clone().negate(), undefined, false, true);
      }
    }
    const alive: Proj[] = [];
    for (const p of this.list) {
      if (p.dead) {
        p.mesh.removeFromParent();
        p.mesh.traverse((o) => ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose?.());
      } else alive.push(p);
    }
    this.list = alive;
  }

  private trail(p: Proj, dt: number) {
    const c = elementColor(p.element);
    switch (p.element) {
      case 'fire':
        ctx.particles.emit({ pos: p.pos, count: p.style === 'big' ? 3 : 2, spread: 0.6, posSpread: (p.size ?? 0.3) * 0.8, life: [0.2, 0.45], size: [p.style === 'big' ? 1.1 : 0.6, 0.05], color: '#ffd070', color2: '#ff3a00' });
        if (Math.random() < 0.3) ctx.particles.emit({ pos: p.pos, count: 1, spread: 0.4, life: [0.5, 0.9], size: [0.5, 1.2], alpha: [0.25, 0], color: '#443a36', additive: false });
        break;
      case 'ice':
        ctx.particles.emit({ pos: p.pos, count: 2, spread: 0.4, posSpread: 0.15, life: [0.3, 0.6], size: [0.3, 0.02], color: '#e8fbff', color2: '#6fc8ff' });
        break;
      case 'lightning':
        ctx.particles.emit({ pos: p.pos, count: 2, spread: 2, life: [0.1, 0.25], size: [0.35, 0.05], color: '#f0e0ff' });
        break;
      case 'physical':
        break;
      default:
        ctx.particles.emit({ pos: p.pos, count: 1, spread: 0.5, life: [0.2, 0.4], size: [0.4, 0.05], color: c });
    }
    void dt;
  }

  private impact(p: Proj, pos: THREE.Vector3, normal: THREE.Vector3, targetId: number | undefined, water: boolean, air = false) {
    p.dead = true;
    const hit: ElementHit = { ...p.hit, pos: pos.clone(), dir: p.vel.clone().normalize(), targetId, source: p.source };
    if (!air || p.hit.radius > 2) ctx.world.applyHit(hit);
    else if (p.source === 'player') ctx.enemies?.applyHit(hit);
    p.onImpact?.(pos, normal, water);
    const color = elementColor(p.element);
    const big = p.style === 'big';
    if (p.element === 'fire') {
      ctx.particles.emit({ pos, count: big ? 60 : 16, spread: big ? 9 : 4, life: [0.3, big ? 0.9 : 0.5], size: [big ? 2.2 : 1, 0.1], color: '#ffe080', color2: '#ff3000', drag: 3 });
      ctx.particles.emit({ pos, count: big ? 20 : 5, spread: big ? 4 : 1.5, vel: new THREE.Vector3(0, 2, 0), life: [0.8, 1.8], size: [big ? 3 : 1.2, big ? 6 : 2.5], alpha: [0.35, 0], color: '#3a3330', additive: false, drag: 1.5 });
      ctx.lights.flash(pos.clone().addScaledVector(normal, 0.5), '#ff8a30', big ? 120 : 30, big ? 26 : 12, big ? 0.45 : 0.25);
      if (big) {
        ctx.fx.sphere(pos, '#ff7a2e', p.hit.radius, 0.35);
        ctx.fx.ring(pos, '#ffb050', p.hit.radius * 1.4, 0.5);
        ctx.cam.shake(0.45);
        events.emit('sound', { name: 'explode', pos, volume: 0.8 });
      } else events.emit('sound', { name: 'fire_hit', pos, volume: 0.35 });
    } else if (p.element === 'ice') {
      ctx.particles.emit({ pos, count: 18, spread: 4, gravity: 12, life: [0.4, 0.8], size: [0.35, 0.05], color: '#f0fcff', color2: '#80d0ff', drag: 1 });
      ctx.particles.emit({ pos, count: 6, spread: 1, life: [0.6, 1.1], size: [1.2, 2], alpha: [0.35, 0], color: '#d8f4ff', additive: false });
      events.emit('sound', { name: 'ice_hit', pos, volume: 0.35 });
    } else if (p.element === 'physical') {
      ctx.particles.emit({ pos, count: 6, spread: 2, gravity: 9, life: [0.3, 0.5], size: [0.25, 0.05], color: '#d8c8a0', additive: false });
    } else {
      ctx.particles.emit({ pos, count: 14, spread: 4, life: [0.2, 0.5], size: [0.6, 0.05], color });
    }
  }

  /** Blow enemy projectiles out of the air around a point. */
  deflect(center: THREE.Vector3, r: number) {
    for (const p of this.list) {
      if (p.dead || p.source !== 'enemy' || p.pos.distanceTo(center) > r) continue;
      p.dead = true;
      ctx.particles.emit({ pos: p.pos, count: 8, spread: 3, life: [0.2, 0.4], size: [0.4, 0.05], color: '#e8fff6' });
    }
  }

  clear() {
    for (const p of this.list) p.mesh.removeFromParent();
    this.list = [];
  }
}

/** Parametric t in [0,1] where a segment first touches a sphere, or null. */
export function segSphere(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, r: number): number | null {
  const d = b.clone().sub(a);
  const f = a.clone().sub(c);
  const A = d.dot(d);
  const B = 2 * f.dot(d);
  const C = f.dot(f) - r * r;
  if (C <= 0) return 0;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A === 0) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : null;
}
