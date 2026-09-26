import * as THREE from 'three';
import { assets, type CharacterKey } from '../core/Assets';
import { damp } from '../core/math';

// GLTFLoader strips '.' from node names: 'hand.r' -> 'handr'.
const UPPER = new Set([
  'spine', 'chest', 'head',
  'upperarml', 'lowerarml', 'wristl', 'handl', 'handslotl', 'elbowIKl', 'handIKl',
  'upperarmr', 'lowerarmr', 'wristr', 'handr', 'handslotr', 'elbowIKr', 'handIKr',
]);

type Mask = 'full' | 'upper' | 'lower';

const clipCache = new Map<string, THREE.AnimationClip>();
function maskedClip(lib: 'adventurer' | 'skeleton', name: string, mask: Mask) {
  const key = `${lib}:${name}:${mask}`;
  let c = clipCache.get(key);
  if (c) return c;
  let src = assets.clips[lib].find((a) => a.name === name);
  if (!src) {
    console.warn(`missing clip ${name}, using Idle`);
    src = assets.clips[lib].find((a) => a.name === 'Idle')!;
  }
  if (mask === 'full') c = src;
  else {
    const tracks = src.tracks.filter((t) => {
      const bone = t.name.split('.')[0];
      const up = UPPER.has(bone);
      return mask === 'upper' ? up : !up;
    });
    c = new THREE.AnimationClip(`${name}_${mask}`, src.duration, tracks);
  }
  clipCache.set(key, c);
  return c;
}

export const CHAR_SCALE = 0.65;

/**
 * Ground speed of the locomotion clips at model scale 1 (measured from the planted foot
 * of the re-proportioned rig). Playback rate = world speed / (clip speed * scale).
 */
const CLIP_SPEED: Record<string, number> = {
  Walking_A: 2.36,
  Walking_B: 2.47,
  Walking_C: 1.35,
  Running_A: 4.33,
  Running_B: 3.54,
};

export function locoRate(clip: string, speed: number, scale: number) {
  const s = CLIP_SPEED[clip];
  return s ? speed / (s * scale) : 1;
}

interface LocoPair {
  name: string;
  full: THREE.AnimationAction;
  lower: THREE.AnimationAction;
}

export class Character {
  root = new THREE.Group();
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private loco: LocoPair | null = null;
  private fading: LocoPair[] = [];
  private upper: THREE.AnimationAction | null = null;
  private upperTarget = 0;
  private upperBlend = 0;
  private onceDone: (() => void) | null = null;
  private upperDone: (() => void) | null = null;
  materials: THREE.MeshStandardMaterial[] = [];
  bones = new Map<string, THREE.Object3D>();
  currentName = '';
  /** Procedural pose layered over the animation each frame (climbing, gliding...). */
  postPose: ((c: Character) => void) | null = null;
  /** 0..1 blend of the procedural pose. */
  postWeight = 0;
  private postTarget = 0;

  constructor(public key: CharacterKey, public lib: 'adventurer' | 'skeleton', scale = CHAR_SCALE) {
    this.root.userData.isCharacter = true;
    this.model = assets.character(key);
    this.model.scale.setScalar(scale);
    this.root.add(this.model);
    this.model.traverse((o) => {
      if (o.name) this.bones.set(o.name, o);
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.castShadow = true;
        this.materials.push(m.material as THREE.MeshStandardMaterial);
      }
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.mixer.addEventListener('finished', (e) => {
      const action = (e as unknown as { action: THREE.AnimationAction }).action;
      if (this.upper && action === this.upper) {
        this.upperTarget = 0;
        const cb = this.upperDone;
        this.upperDone = null;
        cb?.();
      } else if (this.loco && action === this.loco.full) {
        const cb = this.onceDone;
        this.onceDone = null;
        cb?.();
      }
    });
  }

  bone(name: string) {
    return this.bones.get(name.replace(/\./g, ''));
  }

  hide(names: string[]) {
    for (const n of names) {
      const o = this.bones.get(n);
      if (o) o.visible = false;
    }
  }

  private action(name: string, mask: Mask) {
    const key = `${name}:${mask}`;
    let a = this.actions.get(key);
    if (!a) {
      a = this.mixer.clipAction(maskedClip(this.lib, name, mask));
      this.actions.set(key, a);
    }
    return a;
  }

  hasClip(name: string) {
    return !!assets.clips[this.lib].find((a) => a.name === name);
  }

  /** Base (locomotion or full-body) animation. */
  play(name: string, opts: { fade?: number; speed?: number; once?: boolean; onDone?: () => void; restart?: boolean } = {}) {
    const fade = opts.fade ?? 0.2;
    const speed = opts.speed ?? 1;
    if (this.loco && this.loco.name === name && !opts.restart) {
      this.loco.full.timeScale = speed;
      this.loco.lower.timeScale = speed;
      return;
    }
    const full = this.action(name, 'full');
    const lower = this.action(name, 'lower');
    for (const a of [full, lower]) {
      a.reset();
      a.enabled = true;
      a.timeScale = speed;
      a.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = !!opts.once;
      a.fadeIn(fade).play();
    }
    if (this.loco) {
      this.loco.full.fadeOut(fade);
      this.loco.lower.fadeOut(fade);
      this.fading.push(this.loco);
    }
    this.loco = { name, full, lower };
    this.fading = this.fading.filter((p) => p.name !== name);
    this.currentName = name;
    this.onceDone = opts.once ? opts.onDone ?? null : null;
  }

  /** Upper-body overlay (casting while moving). */
  playUpper(name: string, opts: { fade?: number; speed?: number; onDone?: () => void; hold?: boolean } = {}) {
    const a = this.action(name, 'upper');
    if (this.upper && this.upper !== a) this.upper.fadeOut(opts.fade ?? 0.1);
    a.reset();
    a.enabled = true;
    a.timeScale = opts.speed ?? 1;
    a.setLoop(opts.hold ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.fadeIn(opts.fade ?? 0.08).play();
    this.upper = a;
    this.upperTarget = 1;
    this.upperDone = opts.onDone ?? null;
  }

  stopUpper(fade = 0.2) {
    if (this.upper) this.upper.fadeOut(fade);
    this.upperTarget = 0;
  }

  get upperActive() {
    return this.upperTarget > 0;
  }

  update(dt: number) {
    this.upperBlend += (this.upperTarget - this.upperBlend) * damp(18, dt);
    const u = this.upperBlend;
    const apply = (p: LocoPair) => {
      p.full.weight = 1 - u;
      p.lower.weight = u;
    };
    if (this.loco) apply(this.loco);
    for (const p of this.fading) apply(p);
    this.fading = this.fading.filter((p) => p.full.isRunning() && p.full.getEffectiveWeight() > 0.001);
    if (this.upper) {
      this.upper.weight = u;
      if (u < 0.01 && this.upperTarget === 0) {
        this.upper.stop();
        this.upper = null;
      }
    }
    this.mixer.update(dt);
    this.postWeight += (this.postTarget - this.postWeight) * damp(10, dt);
    if (this.postPose && this.postWeight > 0.01) {
      this.root.updateMatrixWorld(true);
      this.postPose(this);
    }
  }

  setPostPose(fn: ((c: Character) => void) | null) {
    if (fn) this.postPose = fn;
    this.postTarget = fn ? 1 : 0;
  }

  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private qc = new THREE.Quaternion();
  private va = new THREE.Vector3();
  private vb = new THREE.Vector3();
  /**
   * Rotate a bone so that it points along `dir` (model space: +X left, +Y up, +Z forward),
   * blended with the animated pose by `w` * postWeight.
   */
  aim(name: string, dir: THREE.Vector3, w = 1) {
    const b = this.bone(name);
    if (!b || !b.parent) return;
    const k = w * this.postWeight;
    b.parent.getWorldQuaternion(this.qa);
    this.qb.copy(this.qa).multiply(b.quaternion); // current world rotation
    const cur = this.va.set(0, 1, 0).applyQuaternion(this.qb);
    this.model.getWorldQuaternion(this.qc);
    const want = this.vb.copy(dir).normalize().applyQuaternion(this.qc);
    const delta = new THREE.Quaternion().setFromUnitVectors(cur, want);
    const target = delta.multiply(this.qb);
    this.qb.slerp(target, k);
    b.quaternion.copy(this.qa.invert().multiply(this.qb));
    b.updateMatrixWorld(true);
  }

  private tintColor = new THREE.Color();
  /** Emissive tint for hit flashes and elemental statuses. */
  setTint(color: THREE.ColorRepresentation, amount: number) {
    this.tintColor.set(color).multiplyScalar(amount);
    for (const m of this.materials) m.emissive.copy(this.tintColor);
  }

  setOpacity(a: number) {
    for (const m of this.materials) {
      m.transparent = a < 1;
      m.opacity = a;
    }
  }

  attach(boneName: string, obj: THREE.Object3D) {
    const b = this.bone(boneName);
    if (b) b.add(obj);
    return obj;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
