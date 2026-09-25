import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { physics, RAPIER, G } from '../core/Physics';
import { assets } from '../core/Assets';
import { events } from '../core/Events';
import type { ElementHit } from '../magic/Elements';
import { ELEMENT_INFO, type Element } from '../magic/Elements';
import { Prop, DynamicProp, ICE_MAT } from './Props';
import { ITEMS } from './items';
import { culler } from '../core/Culler';

export const STONE = new THREE.MeshStandardMaterial({ color: '#b3ab9d', roughness: 0.95, flatShading: true });
export const DARK_STONE = new THREE.MeshStandardMaterial({ color: '#7a746b', roughness: 0.95, flatShading: true });
export const WOOD = new THREE.MeshStandardMaterial({ color: '#8a5a36', roughness: 0.9, flatShading: true });
const METAL = new THREE.MeshStandardMaterial({ color: '#4a4a52', roughness: 0.5, metalness: 0.6 });

function staticBox(pos: THREE.Vector3, hx: number, hy: number, hz: number, rotY = 0, owner: Record<string, unknown> = { kind: 'structure', climbable: true }) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  const c = physics.fixedCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz), pos, q, G.STATIC);
  physics.setOwner(c, owner as { kind: string });
  return c;
}

function staticCyl(pos: THREE.Vector3, hh: number, r: number, owner: Record<string, unknown> = { kind: 'structure', climbable: true }) {
  const c = physics.fixedCollider(RAPIER.ColliderDesc.cylinder(hh, r), pos, undefined, G.STATIC);
  physics.setOwner(c, owner as { kind: string });
  return c;
}

function inRange(p: Prop, hit: ElementHit, extra = 0.8) {
  return p.pos.distanceTo(hit.pos) < hit.radius + p.radius + extra;
}

function flame(pos: THREE.Vector3, scale = 1) {
  ctx.particles.emit({ pos, posSpread: 0.15 * scale, vel: new THREE.Vector3(ctx.wind.x * 0.3, 1.8 * scale, ctx.wind.y * 0.3), spread: 0.35 * scale, life: [0.3, 0.6], size: [0.8 * scale, 0.08], color: '#ffd068', color2: '#ff3a08' });
}

// ---------------------------------------------------------------------------
export class Brazier extends Prop {
  lit = false;
  locked = false;
  mesh = new THREE.Group();
  private coals: THREE.Mesh;
  private flicker = 0;
  onChange?: (lit: boolean) => void;

  constructor(pos: THREE.Vector3, lit = false) {
    super();
    this.pos.copy(pos);
    this.radius = 1;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 1.1, 8), STONE);
    base.position.y = 0.55;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.45, 0.4, 8), DARK_STONE);
    bowl.position.y = 1.3;
    this.coals = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 8), new THREE.MeshStandardMaterial({ color: '#2a2020', emissive: '#ff5010', emissiveIntensity: 0 }));
    this.coals.position.y = 1.48;
    this.mesh.add(base, bowl, this.coals);
    this.mesh.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.mesh.position.copy(pos);
    ctx.scene.add(this.mesh);
    staticCyl(pos.clone().add(new THREE.Vector3(0, 0.75, 0)), 0.75, 0.65, { kind: 'brazier', climbable: false });
    if (lit) this.setLit(true, true);
  }

  get top() {
    return this.pos.clone().add(new THREE.Vector3(0, 1.55, 0));
  }

  setLit(v: boolean, silent = false) {
    if (this.lit === v) return;
    if (!v && this.locked) return;
    this.lit = v;
    (this.coals.material as THREE.MeshStandardMaterial).emissiveIntensity = v ? 2 : 0;
    if (!silent) {
      events.emit('sound', { name: v ? 'ignite' : 'sizzle', pos: this.pos, volume: 0.6 });
      if (!v) ctx.particles.emit({ pos: this.top, count: 10, vel: new THREE.Vector3(0, 1.5, 0), spread: 0.8, life: [0.8, 1.5], size: [0.6, 1.4], alpha: [0.5, 0], color: '#d8d8d8', additive: false });
    }
    this.onChange?.(v);
  }

  override onElement(hit: ElementHit) {
    if (!inRange(this, hit)) return;
    if (hit.element === 'fire') this.setLit(true);
    else if (hit.element === 'ice' || (hit.element === 'wind' && hit.kind !== 'tick')) this.setLit(false);
  }

  override update(dt: number) {
    if (!this.lit) return;
    const d = this.pos.distanceTo(ctx.player.pos);
    if (d > 120) return;
    if (Math.random() < 0.9) flame(this.top, 1);
    if (Math.random() < 0.08) ctx.particles.emit({ pos: this.top, vel: new THREE.Vector3(0, 3, 0), spread: 1, life: [0.8, 1.4], size: [0.12, 0.04], color: '#ffb050' });
    this.flicker -= dt;
    if (d < 45 && this.flicker <= 0) {
      this.flicker = 0.35;
      ctx.lights.flash(this.top.add(new THREE.Vector3(0, 0.6, 0)), '#ff9a40', 14 + Math.random() * 6, 12, 0.42);
    }
  }
}

/** Puzzle helper: all braziers lit → signal. */
export function brazierPuzzle(braziers: Brazier[], signal: string, timed = 0) {
  let timer = 0;
  const check = () => {
    if (ctx.save.has('sig:' + signal)) return;
    if (braziers.every((b) => b.lit)) {
      for (const b of braziers) b.locked = true;
      ctx.props.signal(signal);
      events.emit('sound', { name: 'solve', volume: 0.8 });
      events.emit('toast', { text: '고대의 장치가 반응했다!', kind: 'good' });
    } else if (timed > 0 && braziers.some((b) => b.lit)) timer = timed;
  };
  for (const b of braziers) b.onChange = check;
  if (ctx.save.has('sig:' + signal)) for (const b of braziers) {
    b.setLit(true, true);
    b.locked = true;
  }
  if (timed > 0)
    ctx.props.add(
      new (class extends Prop {
        override update(dt: number) {
          if (timer > 0 && !ctx.save.has('sig:' + signal)) {
            timer -= dt;
            if (timer <= 0) for (const b of braziers) b.setLit(false);
          }
        }
      })(),
    );
}

// ---------------------------------------------------------------------------
export class Torch extends Prop {
  lit: boolean;
  obj: THREE.Object3D;
  private flicker = Math.random();
  constructor(pos: THREE.Vector3, lit = true) {
    super();
    this.pos.copy(pos);
    this.radius = 0.6;
    this.lit = lit;
    this.obj = this.model();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.4, 5), WOOD);
    pole.position.copy(pos).add(new THREE.Vector3(0, 0.7, 0));
    ctx.scene.add(pole);
    staticCyl(pos.clone().add(new THREE.Vector3(0, 1.1, 0)), 1.1, 0.18, { kind: 'torch', climbable: false });
  }
  private model() {
    const o = assets.env(this.lit ? 'torch_lit' : 'torch');
    o.scale.setScalar(1.3);
    o.position.copy(this.pos).add(new THREE.Vector3(0, 1.4 + 0.4 * 1.3, 0));
    ctx.scene.add(o);
    if (this.obj) {
      culler.remove(this.obj);
      culler.add(o, 140);
    }
    return o;
  }
  get tip() {
    return this.pos.clone().add(new THREE.Vector3(0, 2.35, 0));
  }
  setLit(v: boolean) {
    if (v === this.lit) return;
    this.lit = v;
    this.obj.removeFromParent();
    this.obj = this.model();
    events.emit('sound', { name: v ? 'ignite' : 'sizzle', pos: this.pos, volume: 0.4 });
  }
  override onElement(hit: ElementHit) {
    if (!inRange(this, hit)) return;
    if (hit.element === 'fire') this.setLit(true);
    else if (hit.element === 'ice' || hit.element === 'wind') this.setLit(false);
  }
  override update(dt: number) {
    if (!this.lit) return;
    const d = this.pos.distanceTo(ctx.player.pos);
    if (d > 90) return;
    if (Math.random() < 0.5) flame(this.tip, 0.55);
    this.flicker -= dt;
    if (d < 35 && this.flicker <= 0) {
      this.flicker = 0.4;
      ctx.lights.flash(this.tip, '#ff9a40', 8, 9, 0.45);
    }
  }
}

// ---------------------------------------------------------------------------
export class Campfire extends Prop {
  lit = false;
  mesh = new THREE.Group();
  private flicker = 0;
  constructor(pos: THREE.Vector3, public id: string, lit = false) {
    super();
    this.pos.copy(pos);
    this.radius = 1.2;
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.3, 6), WOOD);
      log.rotation.z = Math.PI / 2 - 0.35;
      log.rotation.y = (i / 3) * Math.PI * 2;
      log.position.y = 0.25;
      this.mesh.add(log);
    }
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18, 0), DARK_STONE);
      const a = (i / 9) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.8, 0.1, Math.sin(a) * 0.8);
      this.mesh.add(s);
    }
    this.mesh.position.copy(pos);
    this.mesh.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    ctx.scene.add(this.mesh);
    if (lit) this.lit = true;
    ctx.interact.register({
      id: 'campfire:' + id,
      pos: () => this.pos,
      radius: 2.6,
      verb: () => (this.lit ? '요리하기' : '살펴보기'),
      name: () => (this.lit ? '모닥불' : '꺼진 모닥불'),
      enabled: () => true,
      action: () => {
        if (this.lit) ctx.ui.openCooking();
        else events.emit('toast', { text: '화염 마법으로 불을 붙이면 요리할 수 있다', kind: 'info' });
      },
    });
  }
  override onElement(hit: ElementHit) {
    if (!inRange(this, hit)) return;
    if (hit.element === 'fire' && !this.lit) {
      this.lit = true;
      events.emit('sound', { name: 'ignite', pos: this.pos, volume: 0.6 });
    } else if ((hit.element === 'ice' || hit.element === 'wind') && this.lit) {
      this.lit = false;
      events.emit('sound', { name: 'sizzle', pos: this.pos, volume: 0.5 });
    }
  }
  override update(dt: number) {
    if (!this.lit) return;
    const d = this.pos.distanceTo(ctx.player.pos);
    if (d > 100) return;
    const top = this.pos.clone().add(new THREE.Vector3(0, 0.4, 0));
    flame(top, 1.3);
    if (Math.random() < 0.5) flame(top, 0.9);
    if (Math.random() < 0.1) ctx.particles.emit({ pos: top.clone().setY(top.y + 1.5), vel: new THREE.Vector3(0, 1.5, 0), spread: 0.4, life: [2, 3], size: [0.8, 2.5], alpha: [0.2, 0], color: '#555', additive: false });
    this.flicker -= dt;
    if (d < 50 && this.flicker <= 0) {
      this.flicker = 0.3;
      ctx.lights.flash(top.setY(top.y + 1), '#ff9040', 22 + Math.random() * 8, 14, 0.4);
    }
  }
}

// ---------------------------------------------------------------------------
export class Windmill extends Prop {
  obj: THREE.Object3D;
  fan?: THREE.Object3D;
  spin = 0;
  charge = 0;
  charged = false;
  onCharged?: () => void;
  private fanPos = new THREE.Vector3();

  constructor(pos: THREE.Vector3, rotY: number, scale = 7, red = false) {
    super();
    this.pos.copy(pos);
    this.obj = assets.env(red ? 'windmill_red' : 'windmill');
    this.obj.scale.setScalar(scale);
    this.obj.position.copy(pos);
    this.obj.rotation.y = rotY;
    ctx.scene.add(this.obj);
    this.obj.traverse((o) => {
      if (o.name.includes('fan')) this.fan = o;
    });
    this.obj.updateMatrixWorld(true);
    this.fan?.getWorldPosition(this.fanPos);
    this.radius = 4;
    this.pos.copy(this.fanPos);
    staticCyl(pos.clone().add(new THREE.Vector3(0, 0.35 * scale, 0)), 0.35 * scale, 0.42 * scale);
  }

  override onElement(hit: ElementHit) {
    if (hit.element !== 'wind') return;
    const d = this.fanPos.distanceTo(hit.pos);
    if (d > hit.radius + 7) return;
    this.spin = Math.min(14, this.spin + (hit.kind === 'tick' ? 1.5 : 6));
    events.emit('sound', { name: 'windmill', pos: this.fanPos, volume: 0.4 });
  }

  override update(dt: number) {
    const passive = 0.25 + Math.abs(ctx.wind.x + ctx.wind.y) * 0.1;
    this.spin = Math.max(passive, this.spin - dt * 1.1);
    if (this.fan) this.fan.rotateZ(this.spin * dt);
    if (!this.charged && this.onCharged) {
      if (this.spin > 3) this.charge += dt;
      else this.charge = Math.max(0, this.charge - dt * 0.5);
      if (this.spin > 3 && Math.random() < 0.5)
        ctx.particles.emit({ pos: this.fanPos, posSpread: 3, spread: 2, life: [0.3, 0.6], size: [0.3, 0.05], color: '#c8fff0' });
      if (this.charge > 2.5) {
        this.charged = true;
        this.onCharged();
      }
    }
  }
}

// ---------------------------------------------------------------------------
export class Crystal extends Prop {
  active = 0;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  onChange?: () => void;
  permanent = false;
  constructor(pos: THREE.Vector3, public duration = 9) {
    super();
    this.pos.copy(pos).add(new THREE.Vector3(0, 2.1, 0));
    this.radius = 1.1;
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 1.2, 6), STONE);
    ped.position.copy(pos).add(new THREE.Vector3(0, 0.6, 0));
    ped.castShadow = true;
    ctx.scene.add(ped);
    this.mat = new THREE.MeshStandardMaterial({ color: '#b58cff', emissive: '#5a30b0', emissiveIntensity: 0.3, roughness: 0.2, flatShading: true });
    this.mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), this.mat);
    this.mesh.scale.y = 1.5;
    this.mesh.position.copy(this.pos);
    this.mesh.castShadow = true;
    ctx.scene.add(this.mesh);
    staticCyl(pos.clone().add(new THREE.Vector3(0, 1.4, 0)), 1.4, 0.7, { kind: 'crystal', climbable: false });
  }
  override onElement(hit: ElementHit) {
    if (hit.element !== 'lightning' || !inRange(this, hit, 1.2)) return;
    const was = this.active > 0;
    this.active = this.duration;
    if (!was) {
      events.emit('sound', { name: 'crystal', pos: this.pos, volume: 0.6 });
      this.onChange?.();
    }
  }
  override update(dt: number) {
    this.mesh.rotation.y += dt * (this.active > 0 ? 3 : 0.5);
    this.mesh.position.y = this.pos.y + Math.sin(ctx.time * 2) * 0.12;
    if (this.permanent) this.active = this.duration;
    if (this.active > 0) {
      this.active -= dt;
      this.mat.emissiveIntensity = 2 + Math.sin(ctx.time * 20) * 0.4;
      if (Math.random() < 0.4) ctx.particles.emit({ pos: this.pos, posSpread: 0.6, spread: 3, life: [0.1, 0.3], size: [0.3, 0.05], color: '#e8d8ff' });
      if (Math.random() < dt * 3) ctx.fx.bolt(this.pos, this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, -1.5, (Math.random() - 0.5) * 3)), '#c8a8ff', 0.1, 0.12, false);
      if (this.active <= 0) this.onChange?.();
    } else this.mat.emissiveIntensity = 0.3;
  }
}

export function crystalPuzzle(crystals: Crystal[], signal: string) {
  const check = () => {
    if (ctx.save.has('sig:' + signal)) return;
    if (crystals.every((c) => c.active > 0)) {
      for (const c of crystals) c.permanent = true;
      ctx.props.signal(signal);
      events.emit('sound', { name: 'solve', volume: 0.8 });
      events.emit('toast', { text: '번개 수정이 공명한다!', kind: 'good' });
    }
  };
  for (const c of crystals) c.onChange = check;
  if (ctx.save.has('sig:' + signal)) for (const c of crystals) c.permanent = true;
}

// ---------------------------------------------------------------------------
export class IceWall extends Prop {
  hp = 3;
  mesh = new THREE.Group();
  collider: RAPIER.Collider;
  private melting = -1;
  onMelt?: () => void;
  constructor(pos: THREE.Vector3, rotY: number, public w = 6, public h = 5, public d = 1.6, public flag?: string) {
    super();
    this.pos.copy(pos).add(new THREE.Vector3(0, h / 2, 0));
    this.radius = w / 2;
    for (let i = 0; i < 7; i++) {
      const g = new THREE.CylinderGeometry(0.9 + Math.random() * 0.5, 1.1, h * (0.75 + Math.random() * 0.35), 6);
      const m = new THREE.Mesh(g, ICE_MAT);
      m.position.set(-w / 2 + (i + 0.5) * (w / 7), (h * 0.5) * (0.9 + Math.random() * 0.2), (Math.random() - 0.5) * d * 0.5);
      m.rotation.y = Math.random();
      this.mesh.add(m);
    }
    this.mesh.position.copy(pos);
    this.mesh.rotation.y = rotY;
    ctx.scene.add(this.mesh);
    this.collider = staticBox(this.pos, w / 2, h / 2, d / 2 + 0.3, rotY, { kind: 'icewall', climbable: true });
    if (flag && ctx.save.has(flag)) this.finish(true);
  }
  override onElement(hit: ElementHit) {
    if (this.melting >= 0 || hit.element !== 'fire') return;
    if (this.pos.distanceTo(hit.pos) > hit.radius + this.radius + 1.5) return;
    this.hp -= hit.kind === 'blast' || hit.kind === 'burst' ? 3 : hit.kind === 'tick' ? 0.25 : 1;
    ctx.particles.emit({ pos: hit.pos, count: 12, vel: new THREE.Vector3(0, 2, 0), spread: 1.5, life: [0.8, 1.5], size: [1, 2.2], alpha: [0.5, 0], color: '#e8f4fa', additive: false });
    events.emit('sound', { name: 'sizzle', pos: hit.pos, volume: 0.5 });
    if (this.hp <= 0) {
      this.melting = 1.4;
      events.emit('toast', { text: '얼음벽이 녹아내린다', kind: 'info' });
    }
  }
  override update(dt: number) {
    if (this.melting < 0) return;
    this.melting -= dt;
    this.mesh.scale.y = Math.max(0.02, this.melting / 1.4);
    ctx.particles.emit({ pos: this.pos, count: 2, posSpread: this.radius, vel: new THREE.Vector3(0, 2, 0), spread: 1, life: [1, 2], size: [1.5, 3], alpha: [0.35, 0], color: '#eef6fa', additive: false });
    if (this.melting <= 0) this.finish(false);
  }
  private finish(silent: boolean) {
    this.melting = -2;
    this.mesh.removeFromParent();
    physics.removeCollider(this.collider);
    this.remove();
    if (this.flag) ctx.save.set(this.flag);
    if (!silent) {
      events.emit('sound', { name: 'solve', volume: 0.5 });
      this.onMelt?.();
    }
  }
}

// ---------------------------------------------------------------------------
export class Barricade extends Prop {
  mesh = new THREE.Group();
  collider: RAPIER.Collider;
  burning = -1;
  constructor(pos: THREE.Vector3, rotY: number, public w = 5, public h = 3.2, public flag?: string) {
    super();
    this.pos.copy(pos).add(new THREE.Vector3(0, h / 2, 0));
    this.radius = w / 2;
    for (let i = 0; i < 5; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, 0.15), WOOD);
      plank.position.set(0, 0.4 + i * (h / 5), 0);
      plank.rotation.z = (Math.random() - 0.5) * 0.12;
      this.mesh.add(plank);
    }
    for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, h + 0.4, 0.25), WOOD);
      post.position.set(x, (h + 0.4) / 2, 0.15);
      this.mesh.add(post);
    }
    const x1 = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, 0.25, 0.1), WOOD);
    x1.position.set(0, h / 2, -0.12);
    x1.rotation.z = 0.5;
    this.mesh.add(x1);
    this.mesh.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.mesh.position.copy(pos);
    this.mesh.rotation.y = rotY;
    ctx.scene.add(this.mesh);
    this.collider = staticBox(this.pos, w / 2, h / 2, 0.4, rotY, { kind: 'barricade', climbable: true });
    if (flag && ctx.save.has(flag)) this.finish(true);
  }
  override onElement(hit: ElementHit) {
    if (this.burning >= 0 || hit.element !== 'fire') return;
    if (this.pos.distanceTo(hit.pos) > hit.radius + this.radius + 1) return;
    this.burning = 4;
    events.emit('sound', { name: 'ignite', pos: this.pos, volume: 0.6 });
  }
  override update(dt: number) {
    if (this.burning < 0) return;
    this.burning -= dt;
    for (let i = 0; i < 3; i++) {
      const p = this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * this.w, (Math.random() - 0.5) * 2, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y));
      flame(p, 1.4);
    }
    this.mesh.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m === WOOD) {
        /* shared */
      }
    });
    if (Math.random() < dt * 3) ctx.lights.flash(this.pos, '#ff8030', 30, 14, 0.4);
    if (this.burning <= 0) this.finish(false);
  }
  private finish(silent: boolean) {
    this.burning = -2;
    this.mesh.removeFromParent();
    physics.removeCollider(this.collider);
    this.remove();
    if (this.flag) ctx.save.set(this.flag);
    if (!silent) {
      ctx.particles.emit({ pos: this.pos, count: 20, posSpread: this.w / 2, vel: new THREE.Vector3(0, 2, 0), spread: 1.5, life: [1.5, 3], size: [1.5, 3.5], alpha: [0.4, 0], color: '#2e2a28', additive: false });
      events.emit('sound', { name: 'break', pos: this.pos, volume: 0.6 });
    }
  }
}

// ---------------------------------------------------------------------------
export class CrackedRock extends Prop {
  mesh: THREE.Mesh;
  collider: RAPIER.Collider;
  constructor(pos: THREE.Vector3, public size = 3.2, public flag?: string, onBreak?: () => void) {
    super();
    this.pos.copy(pos).add(new THREE.Vector3(0, size * 0.55, 0));
    this.radius = size;
    const g = new THREE.IcosahedronGeometry(size, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      v.multiplyScalar(0.85 + Math.abs(Math.sin(v.x * 3.1 + v.z * 2.3)) * 0.25);
      v.y *= 0.8;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    const ng = g.toNonIndexed();
    const np = ng.attributes.position.count;
    for (let i = 0; i < np; i += 3) {
      const crack = Math.random() < 0.18;
      const c = crack ? [0.25, 0.22, 0.2] : [0.55 + Math.random() * 0.08, 0.52, 0.48];
      for (let k = 0; k < 3; k++) colors.push(...c);
    }
    ng.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    ng.computeVertexNormals();
    this.mesh = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    this.mesh.position.copy(this.pos);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    ctx.scene.add(this.mesh);
    this.collider = physics.fixedCollider(RAPIER.ColliderDesc.ball(size * 0.85), this.pos, undefined, G.STATIC);
    physics.setOwner(this.collider, { kind: 'cracked', climbable: true });
    ctx.props.add(this);
    if (flag && ctx.save.has(flag)) {
      this.destroy(true);
      return;
    }
    ctx.props.crackable(this.pos, size, 900, () => {
      this.destroy(false);
      onBreak?.();
    });
  }
  destroy(silent: boolean) {
    if (this.removed) return;
    this.mesh.removeFromParent();
    physics.removeCollider(this.collider);
    this.remove();
    if (this.flag) ctx.save.set(this.flag);
    if (!silent) {
      ctx.particles.emit({ pos: this.pos, count: 50, posSpread: this.size * 0.6, spread: 9, gravity: 16, life: [0.6, 1.3], size: [0.7, 0.3], color: '#9a948a', additive: false });
      ctx.particles.emit({ pos: this.pos, count: 20, posSpread: this.size * 0.5, spread: 3, life: [1.5, 2.5], size: [2, 4], alpha: [0.4, 0], color: '#b8b0a4', additive: false });
      ctx.cam.shake(0.5);
      events.emit('sound', { name: 'rockbreak', pos: this.pos, volume: 0.9 });
      events.emit('toast', { text: '금이 간 바위가 부서졌다!', kind: 'good' });
    }
  }
}

// ---------------------------------------------------------------------------
export class Gate extends Prop {
  obj: THREE.Object3D;
  door?: THREE.Object3D;
  doorCollider?: RAPIER.Collider;
  open = false;
  private anim = -1;
  private doorY0 = 0;
  constructor(pos: THREE.Vector3, rotY: number, public signal: string, scale = 1.5) {
    super();
    this.pos.copy(pos);
    this.obj = assets.env('wall_doorway');
    this.obj.scale.setScalar(scale);
    this.obj.position.copy(pos);
    this.obj.rotation.y = rotY;
    ctx.scene.add(this.obj);
    this.obj.traverse((o) => {
      if (o.name.includes('door') && o !== this.obj && o.name !== 'wall_doorway') this.door = o;
    });
    this.obj.updateMatrixWorld(true);
    const all = new THREE.Box3().setFromObject(this.obj);
    const size = all.getSize(new THREE.Vector3());
    const w = 4 * scale, h = size.y, t = 1 * scale;
    // side walls
    const right = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
    const side = w * 0.26;
    for (const s of [-1, 1]) {
      staticBox(pos.clone().addScaledVector(right, s * (w / 2 - side / 2)).add(new THREE.Vector3(0, h / 2, 0)), side / 2, h / 2, t / 2, rotY);
    }
    staticBox(pos.clone().add(new THREE.Vector3(0, h * 0.86, 0)), w / 2, h * 0.14, t / 2, rotY);
    this.doorCollider = staticBox(pos.clone().add(new THREE.Vector3(0, h * 0.36, 0)), w / 2 - side, h * 0.36, t / 2, rotY, { kind: 'gate', climbable: false });
    if (this.door) this.doorY0 = this.door.position.y;
    // glowing seal on the door
    const seal = new THREE.Mesh(new THREE.PlaneGeometry(1.4 * scale, 1.4 * scale), new THREE.MeshBasicMaterial({ map: ctx.fx.runeTex, color: new THREE.Color('#9fe8ff').multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    seal.position.set(0, 1.6, 0.52);
    (this.door ?? this.obj).add(seal);
    const alreadySolved = ctx.save.has('sig:' + signal);
    ctx.props.on(signal, () => this.openGate(alreadySolved));
  }
  openGate(silent = false) {
    if (this.open) return;
    this.open = true;
    this.anim = silent ? 0 : 1.8;
    if (this.doorCollider) {
      physics.removeCollider(this.doorCollider);
      this.doorCollider = undefined;
    }
    if (!silent) {
      events.emit('sound', { name: 'door', pos: this.pos, volume: 0.9 });
      ctx.cam.shake(0.3);
    }
  }
  override update(dt: number) {
    if (this.anim < 0 || !this.door) return;
    this.anim = Math.max(0, this.anim - dt);
    const k = 1 - this.anim / 1.8;
    this.door.position.y = this.doorY0 - k * 3.2;
    if (this.anim > 0 && Math.random() < 0.5) ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), count: 1, posSpread: 2, spread: 1, life: [0.8, 1.5], size: [1, 2], alpha: [0.4, 0], color: '#c8c0b0', additive: false });
    if (this.anim <= 0) {
      this.door.visible = false;
      this.anim = -1;
    }
  }
}

// ---------------------------------------------------------------------------
export class PressurePlate extends Prop {
  pressed = false;
  mesh: THREE.Mesh;
  ring: THREE.Mesh;
  private t = 0;
  onChange?: () => void;
  constructor(pos: THREE.Vector3) {
    super();
    this.pos.copy(pos);
    this.radius = 1.4;
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 0.3, 8), STONE);
    this.mesh.position.copy(pos).add(new THREE.Vector3(0, 0.15, 0));
    this.mesh.receiveShadow = true;
    ctx.scene.add(this.mesh);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff9ae6', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.ring.position.copy(pos).add(new THREE.Vector3(0, 0.32, 0));
    ctx.scene.add(this.ring);
  }
  override update(dt: number) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.2;
    const heavy = ctx.props.dynamics.some((d) => !d.removed && d.heavy && Math.hypot(d.pos.x - this.pos.x, d.pos.z - this.pos.z) < 1.6 && Math.abs(d.pos.y - this.pos.y) < 2);
    if (heavy !== this.pressed) {
      this.pressed = heavy;
      this.mesh.position.y = this.pos.y + (heavy ? 0.03 : 0.15);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = heavy ? 1 : 0.5;
      (this.ring.material as THREE.MeshBasicMaterial).color.set(heavy ? '#fff0a0' : '#ff9ae6');
      events.emit('sound', { name: heavy ? 'click' : 'unclick', pos: this.pos, volume: 0.5 });
      this.onChange?.();
    }
  }
}

export function platePuzzle(plates: PressurePlate[], signal: string) {
  const check = () => {
    if (ctx.save.has('sig:' + signal)) return;
    if (plates.every((p) => p.pressed)) {
      ctx.props.signal(signal);
      events.emit('sound', { name: 'solve', volume: 0.8 });
      events.emit('toast', { text: '발판이 모두 눌렸다!', kind: 'good' });
    }
  };
  for (const p of plates) p.onChange = check;
}

// ---------------------------------------------------------------------------
const beamMat = (color: string) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.5) }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main(){ float a = (1.0 - vUv.y) * (0.55 + 0.45*sin(vUv.y*40.0 - uTime*3.0)) ;
        float edge = 1.0 - abs(vUv.x - 0.5)*2.0; a *= smoothstep(0.0, 0.6, edge);
        gl_FragColor = vec4(uColor, a*0.8); }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

export class Beacon extends Prop {
  lit = false;
  mesh = new THREE.Group();
  gem: THREE.Mesh;
  beam?: THREE.Mesh;
  constructor(pos: THREE.Vector3, public element: Element) {
    super();
    this.pos.copy(pos);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.8, 8), STONE);
    base.position.y = 0.4;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.0, 7, 4), STONE);
    pillar.position.y = 4.3;
    pillar.rotation.y = Math.PI / 4;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.8, 0.6, 8), DARK_STONE);
    cap.position.y = 8;
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), new THREE.MeshStandardMaterial({ color: ELEMENT_INFO[element].color, emissive: ELEMENT_INFO[element].color, emissiveIntensity: 0.15, flatShading: true }));
    this.gem.position.y = 9.4;
    this.mesh.add(base, pillar, cap, this.gem);
    this.mesh.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.mesh.position.copy(pos);
    ctx.scene.add(this.mesh);
    staticCyl(pos.clone().add(new THREE.Vector3(0, 4, 0)), 4, 1.0);
    staticCyl(pos.clone().add(new THREE.Vector3(0, 0.4, 0)), 0.4, 2.5);
  }
  light(silent = false) {
    if (this.lit) return;
    this.lit = true;
    (this.gem.material as THREE.MeshStandardMaterial).emissiveIntensity = 3;
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 700, 16, 1, true).translate(0, 350, 0), beamMat(ELEMENT_INFO[this.element].color));
    this.beam.position.copy(this.pos).add(new THREE.Vector3(0, 9.4, 0));
    this.beam.frustumCulled = false;
    ctx.scene.add(this.beam);
    if (!silent) {
      ctx.fx.sphere(this.gem.getWorldPosition(new THREE.Vector3()), ELEMENT_INFO[this.element].color, 8, 0.8);
      ctx.cam.shake(0.4);
      events.emit('sound', { name: 'beacon', volume: 1 });
    }
  }
  override update(dt: number) {
    this.gem.rotation.y += dt * (this.lit ? 2 : 0.3);
    if (this.beam) (this.beam.material as THREE.ShaderMaterial).uniforms.uTime.value += dt;
    if (this.lit && Math.random() < 0.3 && this.pos.distanceTo(ctx.player.pos) < 150)
      ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(0, 9.4, 0)), posSpread: 1, vel: new THREE.Vector3(0, 4, 0), spread: 1, life: [1, 2], size: [0.4, 0.05], color: ELEMENT_INFO[this.element].glow });
  }
}

// ---------------------------------------------------------------------------
/** A shy light that runs from the player. Hit it with any spell to reveal a spirit seed. */
export class Wisp extends Prop {
  sprite: THREE.Sprite;
  home: THREE.Vector3;
  private vel = new THREE.Vector3();
  constructor(pos: THREE.Vector3, public flag: string) {
    super();
    this.home = pos.clone();
    this.pos.copy(pos);
    this.radius = 0.8;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,230,1)');
    gr.addColorStop(0.25, 'rgba(255,230,140,0.9)');
    gr.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2, 2, 1.6) }));
    this.sprite.scale.setScalar(0.9);
    ctx.scene.add(this.sprite);
    if (ctx.save.has(flag)) this.pop(true);
  }
  override onElement(hit: ElementHit) {
    if (hit.source !== 'player') return;
    if (this.pos.distanceTo(hit.pos) < hit.radius + 1.3) this.pop(false);
  }
  pop(silent: boolean) {
    if (this.removed) return;
    this.remove();
    this.sprite.removeFromParent();
    if (silent) return;
    ctx.particles.emit({ pos: this.pos, count: 30, spread: 4, life: [0.4, 0.9], size: [0.4, 0.05], color: '#fff0a0' });
    ctx.interact.spawnPickup('spirit_seed', this.pos.clone(), true, this.flag, true);
    events.emit('toast', { text: '정령: 헤헤, 잡혔다! 씨앗을 줄게!', kind: 'good' });
    events.emit('sound', { name: 'wisp', pos: this.pos, volume: 0.7 });
  }
  override update(dt: number) {
    const pp = ctx.player.pos;
    const d = this.pos.distanceTo(pp);
    const desired = new THREE.Vector3();
    if (d < 9) desired.copy(this.pos).sub(pp).setY(0).normalize().multiplyScalar(7);
    else desired.copy(this.home).sub(this.pos).multiplyScalar(0.4);
    if (this.pos.distanceTo(this.home) > 22) desired.add(this.home.clone().sub(this.pos).normalize().multiplyScalar(8));
    this.vel.lerp(desired, Math.min(1, dt * 3));
    this.pos.addScaledVector(this.vel, dt);
    const g = ctx.terrain.heightAt(this.pos.x, this.pos.z);
    this.pos.y = Math.max(this.pos.y, g + 1.2);
    this.pos.y += (g + 1.6 + Math.sin(ctx.time * 3) * 0.4 - this.pos.y) * Math.min(1, dt * 2);
    this.sprite.position.copy(this.pos);
    this.sprite.scale.setScalar(0.8 + Math.sin(ctx.time * 8) * 0.1);
    if (d < 60 && Math.random() < dt * 20) ctx.particles.emit({ pos: this.pos, spread: 0.3, life: [0.4, 0.8], size: [0.18, 0.02], color: '#ffe8a0' });
  }
}

/** A mossy rock hiding a spirit seed underneath. */
export class SpiritRockWatcher extends Prop {
  rock: DynamicProp;
  private settle = 2;
  constructor(pos: THREE.Vector3, public flag: string) {
    super();
    this.pos.copy(pos);
    this.rock = ctx.props.dyn('spiritrock', pos.clone().add(new THREE.Vector3(0, 0.55, 0)));
    if (ctx.save.has(flag)) this.remove();
  }
  override update(dt: number) {
    if (this.removed) return;
    if (this.settle > 0) {
      // wait for the rock to come to rest before remembering where the seed hides
      this.settle -= dt;
      if (!this.rock.held && this.rock.thrown <= 0) this.pos.set(this.rock.pos.x, this.rock.pos.y - 0.55, this.rock.pos.z);
      return;
    }
    const moved = this.rock.removed || Math.hypot(this.rock.pos.x - this.pos.x, this.rock.pos.z - this.pos.z) > 1.3;
    if (moved) {
      this.remove();
      ctx.interact.spawnPickup('spirit_seed', this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), true, this.flag, true);
      ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), count: 24, spread: 3, life: [0.4, 0.9], size: [0.35, 0.05], color: '#fff0a0' });
      events.emit('toast', { text: '정령: 야호! 찾았다!', kind: 'good' });
      events.emit('sound', { name: 'wisp', pos: this.pos, volume: 0.7 });
    }
  }
}

// ---------------------------------------------------------------------------
export interface Loot {
  item: string;
  n: number;
}

export class Chest extends Prop {
  obj: THREE.Object3D;
  lid?: THREE.Object3D;
  opened = false;
  hidden: boolean;
  private anim = -1;
  collider?: RAPIER.Collider;
  constructor(pos: THREE.Vector3, rotY: number, public id: string, public loot: Loot[], opts: { gold?: boolean; hiddenUntil?: string; lockedWhile?: () => string | null } = {}) {
    super();
    this.pos.copy(pos);
    this.obj = assets.env(opts.gold ? 'chest_gold' : 'chest');
    this.obj.scale.setScalar(0.72);
    this.obj.position.copy(pos);
    this.obj.rotation.y = rotY;
    this.obj.traverse((o) => {
      if (o.name.includes('lid')) this.lid = o;
    });
    this.opened = ctx.save.has('chest:' + id);
    this.hidden = !!opts.hiddenUntil && !ctx.save.has('sig:' + opts.hiddenUntil);
    if (!this.hidden) this.place(true);
    if (opts.hiddenUntil) ctx.props.on(opts.hiddenUntil, () => this.hidden && this.appear());
    if (this.opened && this.lid) this.lid.rotation.x = -1.9;
    ctx.props.add(this);
    ctx.interact.register({
      id: 'chest:' + id,
      pos: () => this.pos,
      radius: 2.4,
      verb: () => '열기',
      name: () => (opts.gold ? '황금 보물상자' : '보물상자'),
      enabled: () => !this.hidden && !this.opened,
      action: () => {
        const lock = opts.lockedWhile?.();
        if (lock) {
          events.emit('toast', { text: lock, kind: 'warn' });
          return;
        }
        this.open();
      },
    });
  }
  private place(silent: boolean) {
    ctx.scene.add(this.obj);
    const q = new THREE.Quaternion().setFromEuler(this.obj.rotation);
    this.collider = physics.fixedCollider(RAPIER.ColliderDesc.cuboid(0.62, 0.45, 0.52), this.pos.clone().add(new THREE.Vector3(0, 0.45, 0)), q, G.STATIC);
    physics.setOwner(this.collider, { kind: 'chest', climbable: false });
    if (!silent) {
      ctx.fx.sphere(this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), '#ffe8a0', 2.5, 0.6);
      ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), count: 40, spread: 4, life: [0.5, 1.2], size: [0.4, 0.05], color: '#fff0b0' });
      events.emit('sound', { name: 'appear', pos: this.pos, volume: 0.7 });
      events.emit('toast', { text: '보물상자가 나타났다!', kind: 'good' });
    }
  }
  appear() {
    this.hidden = false;
    this.place(false);
  }
  open() {
    if (this.opened) return;
    this.opened = true;
    ctx.save.set('chest:' + this.id);
    this.anim = 0;
    ctx.player.busy('Interact', 0.7, 1.4);
    events.emit('sound', { name: 'chest', pos: this.pos, volume: 0.8 });
    ctx.world.after(0.45, () => {
      for (const l of this.loot) {
        ctx.save.add(l.item, l.n);
        const def = ITEMS[l.item];
        events.emit('pickup', { id: l.item, name: def?.name ?? l.item, count: l.n, icon: def?.icon ?? '❔' });
      }
      ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(0, 1, 0)), count: 30, vel: new THREE.Vector3(0, 3, 0), spread: 2.5, life: [0.6, 1.2], size: [0.35, 0.05], color: '#ffe8a0' });
    });
  }
  override update(dt: number) {
    if (this.anim < 0 || !this.lid) return;
    this.anim = Math.min(1, this.anim + dt * 2);
    this.lid.rotation.x = -1.9 * (1 - Math.pow(1 - this.anim, 3));
    if (this.anim >= 1) this.anim = -1;
  }
}

// ---------------------------------------------------------------------------
export function sign(pos: THREE.Vector3, rotY: number, id: string, title: string, text: string) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4, 0.15), WOOD);
  post.position.y = 0.7;
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.08), WOOD);
  board.position.y = 1.35;
  g.add(post, board);
  g.position.copy(pos);
  g.rotation.y = rotY;
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  ctx.scene.add(g);
  ctx.interact.register({
    id: 'sign:' + id,
    pos: () => pos,
    radius: 2.4,
    verb: () => '읽기',
    name: () => '표지판',
    enabled: () => true,
    action: () => ctx.ui.showDialog([{ who: title, text }]),
  });
}

export { staticBox, staticCyl, METAL };
