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
let _glow: THREE.Texture | null = null;
function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}
const shardGeo = new THREE.OctahedronGeometry(1, 0).scale(0.45, 0.45, 1.6);
const arrowGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4).rotateX(Math.PI / 2);

export class Projectiles {
  list: Proj[] = [];

  spawn(spec: ProjectileSpec) {
    const color = new THREE.Color(elementColor(spec.element));
    const size = spec.size ?? 0.28;
    let mesh: THREE.Object3D;
    if (spec.style === 'shard') {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), transparent: true, opacity: 0.95 });
      for (let i = 0; i < 3; i++) {
        const sh = new THREE.Mesh(shardGeo, mat);
        sh.scale.setScalar(size * (i === 0 ? 1.3 : 0.75));
        sh.position.set(i === 0 ? 0 : (i === 1 ? 0.18 : -0.18), i === 0 ? 0 : 0.1, i === 0 ? 0 : -0.25);
        g.add(sh);
      }
      mesh = g;
    } else if (spec.style === 'arrow') {
      mesh = new THREE.Mesh(arrowGeo, new THREE.MeshLambertMaterial({ color: '#d8d0b8' }));
    } else {
      const g = new THREE.Group();
      const core = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffffff').lerp(color, 0.3).multiplyScalar(2.6) }));
      core.scale.setScalar(size * 0.75);
      const halo = new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.7), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(size * (spec.style === 'big' ? 1.9 : 1.45));
      g.add(core, halo);
      if (spec.source === 'player') {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: color.clone().multiplyScalar(1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.scale.setScalar(size * (spec.style === 'big' ? 7 : 5));
        g.add(glow);
      }
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
    const big = p.style === 'big';
    const back = p.vel.clone().normalize().multiplyScalar(-2);
    switch (p.element) {
      case 'fire':
        ctx.particles.emit({ pos: p.pos, count: big ? 4 : 2, vel: back, spread: 0.8, posSpread: (p.size ?? 0.3) * 0.7, life: [0.25, 0.45], size: [big ? 1.8 : 1.0, 0.25], alpha: [1, 0.1], color: '#ffc04a', color2: '#ff3000', shape: 'flame' });
        ctx.particles.emit({ pos: p.pos, count: 1, spread: 1.5, life: [0.3, 0.6], size: [0.12, 0.03], color: '#ffe080', gravity: -1 });
        if (Math.random() < (big ? 0.6 : 0.3)) ctx.particles.emit({ pos: p.pos, count: 1, spread: 0.4, life: [0.6, 1.1], size: [big ? 1 : 0.5, big ? 2.4 : 1.2], alpha: [0.28, 0], color: '#443a36', additive: false });
        break;
      case 'ice':
        ctx.particles.emit({ pos: p.pos, count: 3, vel: back, spread: 0.5, posSpread: 0.2, life: [0.3, 0.7], size: [0.4, 0.03], color: '#f4fdff', color2: '#6fc8ff' });
        if (Math.random() < 0.5) ctx.particles.emit({ pos: p.pos, count: 1, spread: 0.3, life: [0.5, 0.9], size: [0.6, 1.4], alpha: [0.3, 0], color: '#dff6ff', additive: false });
        break;
      case 'lightning':
        ctx.particles.emit({ pos: p.pos, count: 3, spread: 3, life: [0.1, 0.25], size: [0.4, 0.05], color: '#f0e0ff' });
        break;
      case 'physical':
        break;
      default:
        ctx.particles.emit({ pos: p.pos, count: 2, vel: back, spread: 0.5, life: [0.2, 0.4], size: [0.5, 0.05], color: c });
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
    const up = pos.clone().addScaledVector(normal, 0.3);
    const grounded = normal.y > 0.5 && !water && !air;
    if (p.element === 'fire') {
      const R = p.hit.radius;
      ctx.fx.flare(up, '#ffb050', big ? R * 3.2 : 3.2, big ? 0.35 : 0.22);
      for (let i = 0; i < (big ? 70 : 14); i++) {
        const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize();
        ctx.particles.emit({ pos: up, vel: d.multiplyScalar((big ? R * 2.4 : 5) * (0.4 + Math.random() * 0.6)), spread: 0.4, life: [0.3, big ? 0.7 : 0.45], size: [big ? 2.2 : 1.1, 0.4], alpha: [1, 0.1], color: '#ffc04a', color2: '#ff2a00', drag: 3, shape: 'flame' });
      }
      ctx.particles.emit({ pos: up, count: big ? 40 : 10, spread: big ? 14 : 6, gravity: 9, life: [0.5, 1.1], size: [0.14, 0.03], color: '#ffe080', color2: '#ff6010' });
      ctx.particles.emit({ pos: up, count: big ? 22 : 5, spread: big ? 4 : 1.5, vel: new THREE.Vector3(0, big ? 4 : 2, 0), life: [1, 2.2], size: [big ? 3 : 1.2, big ? 7 : 2.8], alpha: [0.35, 0], color: '#3a3330', additive: false, drag: 1.5 });
      ctx.lights.flash(pos.clone().addScaledVector(normal, 0.8), '#ff8a30', big ? 180 : 40, big ? 34 : 14, big ? 0.5 : 0.25);
      if (grounded) ctx.fx.decal(pos, '#140c08', big ? R * 1.6 : 1.6, big ? 12 : 6);
      ctx.fx.ring(pos, '#ffb050', big ? R * 1.6 : 2.2, big ? 0.55 : 0.3);
      if (big) {
        ctx.fx.dome(pos, '#ff8a3a', R * 1.05, 0.4);
        ctx.fx.ring(pos, '#fff0c0', R * 2.2, 0.8);
        ctx.cam.shake(0.65);
        ctx.world.hitstop(0.07);
        events.emit('sound', { name: 'explode', pos, volume: 0.9 });
      } else events.emit('sound', { name: 'fire_hit', pos, volume: 0.4 });
    } else if (p.element === 'ice') {
      ctx.fx.flare(up, '#bfefff', 2.6, 0.2);
      ctx.particles.emit({ pos: up, count: 26, spread: 5, gravity: 12, life: [0.4, 0.9], size: [0.4, 0.05], color: '#f0fcff', color2: '#80d0ff', drag: 1 });
      ctx.particles.emit({ pos: up, count: 8, spread: 1.4, life: [0.7, 1.3], size: [1.4, 2.6], alpha: [0.35, 0], color: '#d8f4ff', additive: false });
      if (grounded) {
        ctx.fx.spikes(pos, 1.6, 6);
        ctx.fx.decal(pos, '#9fe0ff', 2.4, 5, true);
      }
      ctx.fx.ring(pos, '#dff6ff', 1.8, 0.3);
      events.emit('sound', { name: 'ice_hit', pos, volume: 0.4 });
    } else if (p.element === 'physical') {
      ctx.particles.emit({ pos, count: 6, spread: 2, gravity: 9, life: [0.3, 0.5], size: [0.25, 0.05], color: '#d8c8a0', additive: false });
    } else {
      ctx.fx.flare(up, color, 2.4, 0.2);
      ctx.particles.emit({ pos, count: 20, spread: 5, life: [0.2, 0.5], size: [0.7, 0.05], color });
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
