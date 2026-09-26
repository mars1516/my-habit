import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { RES, CELL, HALF } from './WorldGen';
import { events } from '../core/Events';

interface Burning {
  t: number;
  dur: number;
  /** Spread budget: each hop to a neighbour costs some; at 0 the flames stay put. */
  energy: number;
}

/** Default spread budget of a new fire (~2-3 cells = 4-6 m with no wind). */
const IGNITE_ENERGY = 2.4;

const MAX_BURNING = 1800;
const TICK = 0.12;
const NEIGH = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
];

/**
 * Cellular fire simulation over the terrain grass grid (2m cells).
 * Grass burns, fire spreads downwind, burnt grass slowly grows back, hot air lifts gliders.
 */
export class FireGrid {
  burning = new Map<number, Burning>();
  /** Cells that are regrowing: remaining burn-mark value. */
  private scorched = new Map<number, number>();
  private acc = 0;
  private tmp = new THREE.Vector3();
  private wetUntil = new Map<number, number>();
  private soundTimer = 0;

  get count() {
    return this.burning.size;
  }

  private fuel(i: number) {
    return ctx.terrain.grass[i] / 255;
  }

  canBurn(i: number) {
    if (i < 0) return false;
    if (this.burning.has(i)) return false;
    if (ctx.terrain.getBurnt(i) > 40) return false;
    const w = this.wetUntil.get(i);
    if (w !== undefined && w > ctx.time) return false;
    return this.fuel(i) > 0.18;
  }

  igniteCell(i: number, energy = IGNITE_ENERGY) {
    if (!this.canBurn(i) || this.burning.size >= MAX_BURNING) return false;
    this.burning.set(i, { t: 0, dur: 2.2 + Math.random() * 2.2, energy });
    ctx.terrain.setBurning(i, 255);
    return true;
  }

  /** Ignite grass around a world point (radius in metres). */
  ignite(pos: THREE.Vector3, r: number, energy = IGNITE_ENERGY) {
    return this.igniteCircle(pos.x, pos.z, r, energy);
  }

  /** Ignite grass around a point. Returns number of cells lit. */
  igniteCircle(x: number, z: number, r: number, energy = IGNITE_ENERGY) {
    let n = 0;
    const cr = Math.ceil(r / CELL);
    const cx = Math.floor((x + HALF) / CELL), cz = Math.floor((z + HALF) / CELL);
    for (let dz = -cr; dz <= cr; dz++)
      for (let dx = -cr; dx <= cr; dx++) {
        if (dx * dx + dz * dz > cr * cr) continue;
        const ix = cx + dx, iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= RES || iz >= RES) continue;
        if (this.igniteCell(iz * RES + ix, energy)) n++;
      }
    if (n > 0) events.emit('sound', { name: 'ignite', pos: new THREE.Vector3(x, ctx.terrain.heightAt(x, z), z), volume: 0.5 });
    return n;
  }

  extinguishCircle(x: number, z: number, r: number, wetSeconds = 0) {
    const cr = Math.ceil(r / CELL);
    const cx = Math.floor((x + HALF) / CELL), cz = Math.floor((z + HALF) / CELL);
    let n = 0;
    for (let dz = -cr; dz <= cr; dz++)
      for (let dx = -cr; dx <= cr; dx++) {
        if (dx * dx + dz * dz > cr * cr) continue;
        const ix = cx + dx, iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= RES || iz >= RES) continue;
        const i = iz * RES + ix;
        if (this.burning.delete(i)) {
          n++;
          ctx.terrain.setBurning(i, 0);
        }
        if (wetSeconds > 0) this.wetUntil.set(i, ctx.time + wetSeconds);
      }
    if (n > 0) {
      ctx.particles.emit({ pos: new THREE.Vector3(x, ctx.terrain.heightAt(x, z) + 0.5, z), count: Math.min(30, n * 2), posSpread: r * 0.7, vel: new THREE.Vector3(0, 2, 0), spread: 1, life: [1, 2], size: [1, 2.5], alpha: [0.4, 0], color: '#d8dde0', additive: false });
      events.emit('sound', { name: 'sizzle', pos: new THREE.Vector3(x, 0, z), volume: 0.4 });
    }
    return n;
  }

  /** Wind blows flames forward, spreading the fire in its direction. */
  blow(origin: THREE.Vector3, dir: THREE.Vector3, range: number) {
    const spawned: [number, number][] = [];
    for (const [i, b] of this.burning) {
      const c = ctx.terrain.cellCenter(i, this.tmp);
      const dx = c.x - origin.x, dz = c.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      if ((dx * dir.x + dz * dir.z) / (d || 1) < 0.3 && d > 2) continue;
      for (let s = 1; s <= 3; s++) {
        const j = ctx.terrain.cellIndex(c.x + dir.x * CELL * s, c.z + dir.z * CELL * s);
        if (j >= 0) spawned.push([j, Math.min(IGNITE_ENERGY, b.energy + 1.5 - s)]);
      }
    }
    for (const [j, e] of spawned) this.igniteCell(j, e);
    return spawned.length;
  }

  isBurningAt(x: number, z: number) {
    return this.burning.has(ctx.terrain.cellIndex(x, z));
  }

  /** Hot air above burning grass (m/s^2 of lift). */
  updraftAt(pos: THREE.Vector3) {
    if (this.burning.size === 0) return 0;
    const ground = ctx.terrain.heightAt(pos.x, pos.z);
    const above = pos.y - ground;
    if (above > 45 || above < -1) return 0;
    let n = 0;
    const cx = Math.floor((pos.x + HALF) / CELL), cz = Math.floor((pos.z + HALF) / CELL);
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) if (this.burning.has((cz + dz) * RES + cx + dx)) n++;
    if (n === 0) return 0;
    return Math.min(1, n / 5) * 42 * (1 - above / 50);
  }

  update(dt: number) {
    this.acc += dt;
    const raining = ctx.weather?.raining ?? false;
    const wind = ctx.wind;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      const toIgnite: [number, number][] = [];
      const done: number[] = [];
      for (const [i, b] of this.burning) {
        b.t += TICK * (raining ? 2.5 : 1);
        if (b.t >= b.dur) {
          done.push(i);
          continue;
        }
        if (raining || b.energy <= 0) continue;
        const ix = i % RES, iz = (i / RES) | 0;
        for (const [dx, dz] of NEIGH) {
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= RES || jz >= RES) continue;
          const j = jz * RES + jx;
          if (!this.canBurn(j)) continue;
          const len = Math.hypot(dx, dz);
          const align = (dx * wind.x + dz * wind.y) / len;
          const p = 0.05 * this.fuel(j) * (1 + align * 0.8) * (len > 1 ? 0.6 : 1);
          // downwind hops are cheap, upwind ones expensive
          const cost = (1.1 - align * 0.45) * len;
          if (Math.random() < p) toIgnite.push([j, b.energy - cost]);
        }
      }
      for (const i of done) {
        this.burning.delete(i);
        ctx.terrain.setBurning(i, 0);
        ctx.terrain.setBurnt(i, 255);
        this.scorched.set(i, 255);
      }
      for (const [j, e] of toIgnite) this.igniteCell(j, e);
      // damage and ignite things standing in the flames
      this.burnActors();
    }

    // scorched grass regrows
    if (this.scorched.size > 0) {
      const dec = dt * 2.2; // ~2 minutes to regrow
      for (const [i, v] of this.scorched) {
        if (this.burning.has(i)) continue;
        const nv = v - dec;
        if (nv <= 0) {
          this.scorched.delete(i);
          ctx.terrain.setBurnt(i, 0);
        } else {
          this.scorched.set(i, nv);
          if (Math.floor(nv) !== Math.floor(v)) ctx.terrain.setBurnt(i, Math.min(255, Math.floor(nv)));
        }
      }
    }
    ctx.terrain.flushMask();
    this.visuals(dt);
  }

  private burnActors() {
    const p = ctx.player;
    if (p.alive && p.state !== 'swim' && this.isBurningAt(p.pos.x, p.pos.z)) {
      const g = ctx.terrain.heightAt(p.pos.x, p.pos.z);
      if (p.pos.y - g < 1.5 && p.status.wet <= 0) p.status.burning = Math.max(p.status.burning, 2.5);
    }
    ctx.enemies?.burnInFire();
    // ignite props & trees touching burning cells (sample a few per tick)
    let k = 0;
    for (const i of this.burning.keys()) {
      if (Math.random() > 0.08) continue;
      const c = ctx.terrain.cellCenter(i, this.tmp);
      ctx.veg.igniteNear(c, 1.2, 1);
      ctx.props?.igniteNear(c, 1.6);
      if (++k > 40) break;
    }
  }

  private visuals(dt: number) {
    const n = this.burning.size;
    if (n === 0) return;
    // stylised flame tongues licking up from each burning cell (Zelda-like grass fire)
    const rate = Math.min(9, 1500 / n);
    let li = 0;
    for (const [i, b] of this.burning) {
      const life = 1 - b.t / b.dur;
      const k = Math.min(1, b.t * 3) * Math.min(1, life * 2.5); // grow, then die down
      if (Math.random() < rate * dt * (0.4 + k)) {
        const c = ctx.terrain.cellCenter(i, this.tmp);
        c.x += (Math.random() - 0.5) * CELL * 1.1;
        c.z += (Math.random() - 0.5) * CELL * 1.1;
        // flames lick up from the grass tips, not hidden beneath them
        c.y = ctx.terrain.heightAt(c.x, c.z) + 0.2 + this.fuel(i) * 0.35;
        const s = 0.7 + k * 0.75 + Math.random() * 0.35;
        ctx.particles.emit({ pos: c, vel: new THREE.Vector3(ctx.wind.x * 0.5, 1.3 + k, ctx.wind.y * 0.5), spread: 0.25, life: [0.35, 0.6], size: [s, s * 0.35], alpha: [0.95, 0.1], color: '#ffb43a', color2: '#ff3c10', shape: 'flame', drag: 0.5 });
        if (Math.random() < 0.18)
          ctx.particles.emit({ pos: c.clone().setY(c.y + 0.5), vel: new THREE.Vector3(ctx.wind.x * 0.6, 3.2, ctx.wind.y * 0.6), spread: 1.4, life: [0.6, 1.3], size: [0.1, 0.03], color: '#ffd070', color2: '#ff5a10', gravity: -0.6 });
        if (Math.random() < 0.06)
          ctx.particles.emit({ pos: c.clone().setY(c.y + 1.3), vel: new THREE.Vector3(ctx.wind.x * 1.2, 1.8, ctx.wind.y * 1.2), spread: 0.4, life: [1.2, 2.2], size: [0.7, 2.2], alpha: [0.18, 0], color: '#5a504a', additive: false, drag: 0.6 });
      }
      if (li < 2 && Math.random() < dt * 1.5) {
        li++;
        ctx.lights.flash(ctx.terrain.cellCenter(i, this.tmp).add(new THREE.Vector3(0, 1.2, 0)), '#ff7a28', 18, 12, 0.5);
      }
    }
    this.soundTimer -= dt;
    if (this.soundTimer <= 0) {
      this.soundTimer = 0.6;
      // loudest near the player
      let best = Infinity;
      const pp = ctx.player.pos;
      let k = 0;
      for (const i of this.burning.keys()) {
        const c = ctx.terrain.cellCenter(i, this.tmp);
        best = Math.min(best, Math.hypot(c.x - pp.x, c.z - pp.z));
        if (++k > 200) break;
      }
      if (best < 40) events.emit('sound', { name: 'crackle', volume: Math.min(0.6, (1 - best / 40) * (0.3 + n / 400)) });
    }
  }
}
