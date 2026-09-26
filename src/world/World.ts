import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { physics, G, type RayHit } from '../core/Physics';
import type { ElementHit } from '../magic/Elements';
import { waterLevelAt, WATER_BODIES } from './WorldGen';
import { events } from '../core/Events';

interface Updraft {
  pos: THREE.Vector3;
  r: number;
  h: number;
  strength: number;
  t: number;
}

export class World {
  private updrafts: Updraft[] = [];
  private timers: { t: number; fn: () => void }[] = [];

  /** Run `fn` after `sec` seconds of game time (pauses with the game, unlike setTimeout). */
  after(sec: number, fn: () => void) {
    this.timers.push({ t: sec, fn });
  }

  raycastStatic(origin: THREE.Vector3, dir: THREE.Vector3, dist: number): RayHit | null {
    return physics.raycast(origin, dir, dist, G.TERRAIN | G.STATIC | G.ICE, ctx.player?.body);
  }

  raycastAll(origin: THREE.Vector3, dir: THREE.Vector3, dist: number, mask: number): RayHit | null {
    return physics.raycast(origin, dir, dist, mask, ctx.player?.body);
  }

  /** First water surface hit along a ray (only where the water is actually above ground). */
  rayWater(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestT = maxDist;
    for (const b of WATER_BODIES) {
      if (Math.abs(dir.y) < 1e-4) continue;
      const t = (b.level - origin.y) / dir.y;
      if (t <= 0 || t >= bestT) continue;
      const p = origin.clone().addScaledVector(dir, t);
      if (waterLevelAt(p.x, p.z) !== b.level) continue;
      if (ctx.terrain.heightAt(p.x, p.z) > b.level - 0.05) continue;
      best = p;
      bestT = t;
    }
    return best;
  }

  isWater(p: THREE.Vector3, depth = 0.1) {
    return waterLevelAt(p.x, p.z) - ctx.terrain.heightAt(p.x, p.z) > depth && p.y <= waterLevelAt(p.x, p.z) + 0.6;
  }

  addUpdraft(pos: THREE.Vector3, r: number, h: number, strength: number, t: number) {
    this.updrafts.push({ pos: pos.clone(), r, h, strength, t });
  }

  updraftAt(pos: THREE.Vector3) {
    let lift = ctx.fire.updraftAt(pos);
    for (const u of this.updrafts) {
      const d = Math.hypot(pos.x - u.pos.x, pos.z - u.pos.z);
      if (d < u.r && pos.y > u.pos.y - 2 && pos.y < u.pos.y + u.h) lift += u.strength * (1 - d / u.r * 0.5);
    }
    return lift;
  }

  /** Dispatches an elemental hit to every system that can react. */
  applyHit(hit: ElementHit) {
    const inWater = this.isWater(hit.pos, 0.3);
    if (hit.source !== 'enemy') ctx.enemies?.applyHit(hit);
    else ctx.player && this.hitPlayer(hit);
    ctx.props?.onElement(hit, inWater);

    const trees = ctx.veg.near(hit.pos.x, hit.pos.z, hit.radius + 0.5);
    switch (hit.element) {
      case 'fire':
        if (hit.kind === 'aura') {
          // surges scorch their own trail; only brushing a tree sets it alight
          for (const t of trees) if (Math.random() < 0.15 && Math.abs(t.y - hit.pos.y) < 4) ctx.veg.ignite(t, 1);
        } else if (!inWater) {
          if (!ctx.weather?.raining || hit.kind === 'burst') ctx.fire.igniteCircle(hit.pos.x, hit.pos.z, Math.max(1.6, hit.radius * 0.8));
          for (const t of trees) if (Math.abs(t.y - hit.pos.y) < 8) ctx.veg.ignite(t);
        } else {
          ctx.particles.emit({ pos: hit.pos, count: 16, vel: new THREE.Vector3(0, 2.5, 0), spread: 1.5, life: [0.8, 1.6], size: [1, 2.5], alpha: [0.5, 0], color: '#e8f0f5', additive: false });
          events.emit('sound', { name: 'sizzle', pos: hit.pos, volume: 0.5 });
        }
        break;
      case 'ice':
        ctx.fire.extinguishCircle(hit.pos.x, hit.pos.z, hit.radius + 1.5, 25);
        ctx.veg.extinguishNear(hit.pos, hit.radius + 1);
        break;
      case 'wind':
        if (hit.dir) ctx.fire.blow(hit.pos, hit.dir, hit.radius + 6);
        for (const t of trees) ctx.veg.shake(t, 1);
        break;
      case 'lightning':
        if (inWater) this.electrifyWater(hit.pos, 9);
        else if (hit.kind !== 'aura' && Math.random() < (hit.kind === 'strike' ? 0.8 : 0.25)) {
          ctx.fire.igniteCircle(hit.pos.x, hit.pos.z, 1.5);
          for (const t of trees) if (Math.random() < 0.5) ctx.veg.ignite(t);
        }
        for (const t of trees) ctx.veg.shake(t, 0.8);
        break;
      case 'kinesis':
      case 'physical':
        for (const t of trees) ctx.veg.shake(t, (hit.push ?? 0) > 8 ? 1 : 0.4);
        break;
    }
  }

  private hitPlayer(hit: ElementHit) {
    const p = ctx.player;
    const d = p.chestWorld().distanceTo(hit.pos);
    if (d > hit.radius + 0.6) return;
    const dmgQuarters = Math.max(1, Math.round(hit.damage));
    if (p.damage(dmgQuarters, hit.pos.clone().setY(p.pos.y), hit.push ?? 6)) {
      const s = p.status;
      if (hit.element === 'fire' && s.wet <= 0) s.burning = 3;
      if (hit.element === 'ice') {
        s.chill++;
        if (s.chill >= 2) {
          s.frozen = 1.2;
          s.chill = 0;
        }
      }
      if (hit.element === 'lightning') s.shocked = 1;
    }
  }

  /** Lightning conducts through water: hurts everything swimming nearby. */
  electrifyWater(pos: THREE.Vector3, r: number) {
    const level = waterLevelAt(pos.x, pos.z);
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * r;
      ctx.particles.emit({ pos: new THREE.Vector3(pos.x + Math.cos(a) * rr, level + 0.1, pos.z + Math.sin(a) * rr), count: 1, spread: 2, life: [0.15, 0.35], size: [0.5, 0.1], color: '#e0c8ff' });
    }
    ctx.fx?.bolt(pos.clone().setY(level + 0.2), pos.clone().add(new THREE.Vector3(3, 0, 2)).setY(level + 0.2), '#d8c0ff', 0.25);
    ctx.enemies?.shockInWater(pos, r);
    const p = ctx.player;
    if (p.state === 'swim' && Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < r) {
      p.damage(3, pos);
      p.status.shocked = 1.5;
    }
  }

  private fireflyAcc = 0;

  update(dt: number) {
    if (this.timers.length) {
      for (const t of this.timers) t.t -= dt;
      const due = this.timers.filter((t) => t.t <= 0);
      this.timers = this.timers.filter((t) => t.t > 0);
      for (const t of due) t.fn();
    }
    // fireflies drift over grassy ground at night
    if (ctx.sky.night > 0.55 && !ctx.weather.raining) {
      this.fireflyAcc += dt * 14;
      const p = ctx.player.pos;
      while (this.fireflyAcc >= 1) {
        this.fireflyAcc -= 1;
        const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 26;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        const i = ctx.terrain.cellIndex(x, z);
        if (i < 0 || ctx.terrain.grass[i] < 90) continue;
        const y = ctx.terrain.heightAt(x, z) + 0.4 + Math.random() * 1.6;
        ctx.particles.emit({ pos: new THREE.Vector3(x, y, z), spread: 0.35, vel: new THREE.Vector3(0, 0.15, 0), life: [2.5, 4.5], size: [0.22, 0.12], alpha: [1, 0], color: '#d8ff7a', color2: '#9fff60', drag: 0.1 });
      }
    }
    for (const u of this.updrafts) {
      u.t -= dt;
      if (Math.random() < 0.9) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * u.r;
        ctx.particles.emit({
          pos: new THREE.Vector3(u.pos.x + Math.cos(a) * rr, u.pos.y + Math.random() * 3, u.pos.z + Math.sin(a) * rr),
          vel: new THREE.Vector3(-Math.sin(a) * 3, 14 + Math.random() * 6, Math.cos(a) * 3),
          spread: 0.5,
          life: [0.8, 1.4],
          size: [0.3, 0.05],
          color: '#c8fff0',
          alpha: [0.8, 0],
        });
      }
    }
    this.updrafts = this.updrafts.filter((u) => u.t > 0);
  }
}
