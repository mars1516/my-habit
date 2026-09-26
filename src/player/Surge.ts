import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ctx } from '../core/ctx';
import { events } from '../core/Events';
import { ELEMENT_INFO, type Element } from '../magic/Elements';
import { waterLevelAt } from '../world/WorldGen';
import type { Player } from './Player';

/** Ground speed of each elemental surge (m/s). */
export const SURGE_SPEED: Record<Element, number> = { fire: 15, ice: 13.5, wind: 14, lightning: 18, kinesis: 16 };
/** Stamina drained per second while surging. */
export const SURGE_COST = 16;
/** Seconds Shift must be held before the surge ignites. */
export const SURGE_HOLD = 3;

// ---- fractal snowflake decal ---------------------------------------------------
function snowflakeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.translate(128, 128);
  g.strokeStyle = 'rgba(235,250,255,1)';
  g.lineCap = 'round';
  g.shadowColor = 'rgba(140,220,255,1)';
  g.shadowBlur = 8;
  const branch = (len: number, depth: number, width: number) => {
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -len);
    g.stroke();
    if (depth <= 0) return;
    for (const at of [0.38, 0.62, 0.84]) {
      g.save();
      g.translate(0, -len * at);
      for (const side of [-1, 1]) {
        g.save();
        g.rotate((side * Math.PI) / 3);
        branch(len * (0.42 - at * 0.22), depth - 1, width * 0.65);
        g.restore();
      }
      g.restore();
    }
  };
  for (let i = 0; i < 6; i++) {
    g.save();
    g.rotate((i * Math.PI) / 3);
    branch(118, 3, 5);
    g.restore();
  }
  // hexagonal core
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    const x = Math.cos(a) * 22, y = Math.sin(a) * 22;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Ghost {
  root: THREE.Object3D;
  bones: THREE.Object3D[];
  mat: THREE.MeshBasicMaterial;
  life: number;
}

export class Surge {
  active = false;
  el: Element = 'fire';
  private t = 0;
  private stepSide = 0;
  private stepTimer = 0;
  private tickTimer = 0;
  private flakeTex = snowflakeTexture();
  private flakeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private ghosts: Ghost[] = [];
  private ghostTimer = 0;
  private srcBones: THREE.Object3D[] = [];
  private tmp = new THREE.Vector3();
  private fwd = new THREE.Vector3();

  constructor(private player: Player) {}

  private bone(name: string, out: THREE.Vector3) {
    const b = this.player.char.bone(name);
    if (b) b.getWorldPosition(out);
    else out.copy(this.player.pos);
    return out;
  }

  start(el: Element) {
    this.active = true;
    this.el = el;
    this.t = 0;
    const p = this.player;
    const col = ELEMENT_INFO[el].color;
    ctx.fx.ring(p.pos, col, 4, 0.5);
    ctx.fx.sphere(p.pos.clone().setY(p.pos.y + 1), col, 1.6, 0.25);
    ctx.cam.shake(0.25);
    events.emit('sound', { name: 'surge', pos: p.pos, volume: 0.6 });
    events.emit('toast', { text: `${ELEMENT_INFO[el].name} 질주!`, kind: 'info' });
    if (el === 'kinesis') {
      events.emit('sound', { name: 'sandevistan', volume: 0.6 });
      ctx.ui.setScreenFx('sandevistan', true);
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    ctx.slowmo = 1;
    ctx.ui.setScreenFx('sandevistan', false);
  }

  /** Build-up while Shift is held (0..1). */
  charging(k: number, el: Element) {
    const p = this.player;
    if (k <= 0.15 || Math.random() > 0.2 + k * 0.8) return;
    const a = Math.random() * Math.PI * 2;
    const r = 0.9 - k * 0.4;
    const from = p.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r));
    ctx.particles.emit({ pos: from, vel: new THREE.Vector3(-Math.cos(a) * 1.2, 1.5 + k * 2, -Math.sin(a) * 1.2), spread: 0.2, life: [0.25, 0.5], size: [0.1 + k * 0.25, 0.02], color: ELEMENT_INFO[el].glow, color2: ELEMENT_INFO[el].color });
  }

  update(dt: number, speed: number) {
    const p = this.player;
    this.t += dt;
    this.fwd.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const fwd = this.fwd;
    const moving = speed > 2;
    this.tickTimer -= dt;
    const tick = this.tickTimer <= 0;
    if (tick) this.tickTimer = 0.2;
    // light that travels with the player
    if (Math.random() < dt * 8) ctx.lights.flash(p.pos.clone().setY(p.pos.y + 1), ELEMENT_INFO[this.el].color, 18, 9, 0.2);
    // speed streaks
    if (moving && Math.random() < 0.7) {
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar((Math.random() - 0.5) * 2.4);
      ctx.particles.emit({ pos: p.pos.clone().add(side).setY(p.pos.y + 0.3 + Math.random() * 1.6), vel: fwd.clone().multiplyScalar(-speed * 0.6), spread: 0.1, life: [0.12, 0.22], size: [0.16, 0.02], color: ELEMENT_INFO[this.el].glow });
    }
    switch (this.el) {
      case 'fire':
        this.fire(dt, fwd, tick, moving);
        break;
      case 'ice':
        this.ice(dt, fwd, moving, tick);
        break;
      case 'wind':
        this.wind(dt, fwd, tick);
        break;
      case 'lightning':
        this.lightning(dt, fwd, tick);
        break;
      case 'kinesis':
        this.kinesis(dt);
        break;
    }
    this.updateGhosts(dt);
  }

  /** Jets of flame from both feet; scorches a short trail of grass. */
  private fire(dt: number, fwd: THREE.Vector3, tick: boolean, moving: boolean) {
    const p = this.player;
    for (const f of ['foot.l', 'foot.r']) {
      const fp = this.bone(f, this.tmp).clone();
      for (let i = 0; i < 2; i++)
        ctx.particles.emit({ pos: fp, vel: fwd.clone().multiplyScalar(-7).add(new THREE.Vector3(0, -1.2, 0)), spread: 1.2, life: [0.15, 0.35], size: [0.75, 0.1], color: '#ffe080', color2: '#ff3000' });
    }
    if (moving && Math.random() < dt * 30) {
      const g = p.pos.clone();
      g.y = ctx.terrain.heightAt(g.x, g.z) + 0.15;
      ctx.particles.emit({ pos: g, posSpread: 0.35, vel: new THREE.Vector3(0, 1.6, 0), spread: 0.4, life: [0.5, 1.0], size: [0.9, 0.1], color: '#ffb040', color2: '#ff2000' });
    }
    if (Math.random() < dt * 4) events.emit('sound', { name: 'surgeFire', pos: p.pos, volume: 0.35 });
    if (tick) {
      // barely-spreading trail: the flames die out a few cells behind
      if (moving && !ctx.weather?.raining) ctx.fire.igniteCircle(p.pos.x, p.pos.z, 0.9, 0.4);
      ctx.world.applyHit({ element: 'fire', pos: p.pos.clone().setY(p.pos.y + 0.8), radius: 1.8, damage: 6, source: 'player', kind: 'aura' });
    }
  }

  /** Every stride leaves a fractal snowflake on the ground; water freezes underfoot. */
  private ice(dt: number, fwd: THREE.Vector3, moving: boolean, tick: boolean) {
    const p = this.player;
    this.stepTimer -= dt;
    if (moving && this.stepTimer <= 0) {
      this.stepTimer = 0.2;
      this.stepSide ^= 1;
      const fp = this.bone(this.stepSide ? 'foot.l' : 'foot.r', this.tmp).clone();
      const wl = waterLevelAt(fp.x, fp.z);
      const ground = Math.max(ctx.terrain.heightAt(fp.x, fp.z), wl > -50 ? wl : -Infinity);
      // float just above the grass tips so the flake reads in meadows too
      const grassy = ctx.terrain.grassAt(fp.x, fp.z);
      fp.y = Math.max(p.pos.y, ground) + 0.06 + grassy * 0.35;
      this.snowflake(fp);
      events.emit('sound', { name: 'surgeIce', pos: fp, volume: 0.3 });
    }
    if (Math.random() < 0.6)
      ctx.particles.emit({ pos: p.pos.clone().setY(p.pos.y + 0.2), posSpread: 0.4, vel: fwd.clone().multiplyScalar(-2).setY(1.2), spread: 0.8, life: [0.4, 0.9], size: [0.18, 0.02], color: '#f0fbff', color2: '#8fdcff' });
    // freeze the water ahead so the surge can cross lakes
    const ahead = p.pos.clone().addScaledVector(fwd, 2.5);
    if (ctx.terrain.waterDepth(ahead.x, ahead.z) > 0.3 && Math.random() < dt * 12) ctx.props.freezeWater(ahead, 2.6);
    if (tick) ctx.world.applyHit({ element: 'ice', pos: p.pos.clone().setY(p.pos.y + 0.8), radius: 1.6, damage: 4, source: 'player', kind: 'aura', potency: 0.5 });
  }

  private snowflake(pos: THREE.Vector3) {
    const mat = new THREE.MeshBasicMaterial({ map: this.flakeTex, color: new THREE.Color('#bfeeff').multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const m = new THREE.Mesh(this.flakeGeo, mat);
    m.position.copy(pos);
    m.rotation.y = Math.random() * Math.PI;
    const size = 2 + Math.random() * 0.9;
    ctx.fx.add(m, 1.6, (k, dt) => {
      const grow = k < 0.15 ? k / 0.15 : 1;
      m.scale.setScalar(size * (0.3 + 0.7 * (1 - Math.pow(1 - grow, 3))) * (1 + k * 0.15));
      m.rotation.y += dt * 0.4;
      mat.opacity = k < 0.5 ? 1 : 1 - (k - 0.5) / 0.5;
    }, () => mat.dispose());
    ctx.particles.emit({ pos: pos.clone().setY(pos.y + 0.1), count: 6, spread: 1.4, life: [0.3, 0.7], size: [0.25, 0.02], color: '#ffffff', color2: '#8fdcff' });
  }

  /** Spiralling gusts; brushes props and enemies aside, skims across water. */
  private wind(dt: number, fwd: THREE.Vector3, tick: boolean) {
    const p = this.player;
    const n = 3;
    for (let i = 0; i < n; i++) {
      const a = this.t * 14 + (i / n) * Math.PI * 2;
      const r = 0.7;
      const pos = p.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3 + ((this.t * 3 + i * 0.33) % 1) * 1.6, Math.sin(a) * r));
      ctx.particles.emit({ pos, vel: fwd.clone().multiplyScalar(-4), spread: 0.2, life: [0.25, 0.45], size: [0.35, 0.05], alpha: [0.8, 0], color: '#e8fff6', color2: '#7df0c0' });
    }
    if (Math.random() < 0.5) {
      const g = p.pos.clone();
      const wl = waterLevelAt(g.x, g.z);
      g.y = Math.max(ctx.terrain.heightAt(g.x, g.z), wl) + 0.1;
      const onWater = wl > ctx.terrain.heightAt(g.x, g.z);
      ctx.particles.emit({ pos: g, posSpread: 0.4, vel: fwd.clone().multiplyScalar(-3).setY(onWater ? 2.5 : 0.8), spread: 1.2, gravity: onWater ? 6 : 0, life: [0.4, 0.8], size: [0.5, 1.2], alpha: [0.45, 0], color: onWater ? '#f4fdff' : '#d9d2b8', additive: false, drag: 2 });
    }
    if (tick) {
      ctx.props.push(p.pos, fwd, 3.5, Math.cos(1.2), 9);
      ctx.enemies?.push(p.pos, fwd, 3, Math.cos(1.2), 8);
      ctx.fire.blow(p.pos, fwd, 5);
    }
    void dt;
  }

  /** Arcs of lightning crawl over the body; enemies brushed are shocked. */
  private lightning(dt: number, fwd: THREE.Vector3, tick: boolean) {
    const p = this.player;
    const pts = ['head', 'chest', 'hips', 'hand.l', 'hand.r', 'foot.l', 'foot.r', 'lowerleg.l', 'lowerleg.r', 'lowerarm.l', 'lowerarm.r'];
    const arcs = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < arcs; i++) {
      const a = this.bone(pts[(Math.random() * pts.length) | 0], new THREE.Vector3());
      const b = this.bone(pts[(Math.random() * pts.length) | 0], new THREE.Vector3());
      a.add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5));
      b.add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.9));
      if (a.distanceTo(b) < 0.3) b.addScaledVector(fwd, -0.8);
      ctx.fx.bolt(a, b, '#e0d0ff', 0.07, 0.07, false);
    }
    // trail sparks on the ground behind
    if (Math.random() < dt * 14) {
      const g = p.pos.clone().addScaledVector(fwd, -1.5);
      g.y = ctx.terrain.heightAt(g.x, g.z) + 0.1;
      ctx.fx.bolt(g, g.clone().addScaledVector(fwd, -2.5).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.3, (Math.random() - 0.5) * 1.5)), '#c9a8ff', 0.12, 0.12, false);
    }
    ctx.particles.emit({ pos: p.pos.clone().setY(p.pos.y + 1), posSpread: 0.5, count: 1, spread: 2, life: [0.1, 0.25], size: [0.2, 0.02], color: '#f4ecff' });
    if (Math.random() < dt * 10) events.emit('sound', { name: 'surgeZap', pos: p.pos, volume: 0.35 });
    if (tick) ctx.world.applyHit({ element: 'lightning', pos: p.pos.clone().setY(p.pos.y + 0.9), radius: 2, damage: 8, source: 'player', kind: 'aura', potency: 0.6 });
  }

  /** Sandevistan: the world slows down and neon afterimages trail behind. */
  private kinesis(dt: number) {
    ctx.slowmo += (0.3 - ctx.slowmo) * Math.min(1, dt * 6);
    this.ghostTimer -= dt;
    if (this.ghostTimer <= 0) {
      this.ghostTimer = 0.05;
      this.spawnGhost();
    }
  }

  private ghostPool() {
    if (this.ghosts.length) return;
    const src = this.player.char.model;
    src.traverse((o) => this.srcBones.push(o));
    for (let i = 0; i < 12; i++) {
      const root = SkeletonUtils.clone(src);
      const mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const bones: THREE.Object3D[] = [];
      root.traverse((o) => {
        bones.push(o);
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = mat;
          m.castShadow = false;
          m.receiveShadow = false;
          m.frustumCulled = false;
        }
      });
      root.visible = false;
      root.userData.noCull = true;
      ctx.scene.add(root);
      this.ghosts.push({ root, bones, mat, life: 0 });
    }
  }

  private spawnGhost() {
    this.ghostPool();
    const g = this.ghosts.reduce((a, b) => (a.life < b.life ? a : b));
    const src = this.player.char.model;
    src.updateMatrixWorld(true);
    for (let i = 0; i < this.srcBones.length && i < g.bones.length; i++) {
      const s = this.srcBones[i], d = g.bones[i];
      d.position.copy(s.position);
      d.quaternion.copy(s.quaternion);
      d.scale.copy(s.scale);
      d.visible = s.visible;
    }
    // place in world space where the model currently is
    src.matrixWorld.decompose(g.root.position, g.root.quaternion, g.root.scale);
    g.root.visible = true;
    g.life = 0.55;
    // Sandevistan palette: green -> cyan -> magenta
    const h = (this.t * 0.9) % 1;
    g.mat.color.setHSL(0.33 + h * 0.55, 1, 0.5).multiplyScalar(1.6);
  }

  private updateGhosts(dt: number) {
    for (const g of this.ghosts) {
      if (g.life <= 0) continue;
      g.life -= dt;
      g.mat.opacity = Math.max(0, g.life / 0.55) * 0.55;
      if (g.life <= 0) g.root.visible = false;
    }
  }
}
