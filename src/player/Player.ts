import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { physics, RAPIER, G, groups } from '../core/Physics';
import { clamp, damp, angleLerp, lerp } from '../core/math';
import { Character } from './Character';
import { events } from '../core/Events';
import { newStatus, type StatusState } from '../magic/Elements';
import { waterLevelAt } from '../world/WorldGen';

export type PState = 'ground' | 'air' | 'glide' | 'climb' | 'swim' | 'dodge' | 'dead' | 'busy';

const RADIUS = 0.34;
const HALF_H = 0.46;
const CENTER_Y = HALF_H + RADIUS; // collider center above feet
const CHEST = 1.05;

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  char: Character;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = Math.PI;
  state: PState = 'ground';
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  kcc: RAPIER.KinematicCharacterController;

  // stats (hp in quarter hearts)
  hearts = 5;
  hp = 20;
  maxStamina = 100;
  stamina = 100;
  exhausted = false;
  maxMana = 100;
  mana = 100;
  manaDelay = 0;
  staminaDelay = 0;
  invuln = 0;
  status: StatusState = newStatus();

  grounded = false;
  coyote = 0;
  airTime = 0;
  fallStartY = 0;
  climbNormal = new THREE.Vector3();
  private climbPush = 0;
  dodgeTime = 0;
  dodgeDir = new THREE.Vector3();
  castSlow = 0;
  aimFacing = 0;
  facingOverride: number | null = null;
  lastSafe = new THREE.Vector3();
  private safeTimer = 0;
  private stepTimer = 0;
  private busyTimer = 0;
  private burnTick = 0;
  moveInput = new THREE.Vector2();
  wings: THREE.Group;
  private wingOpen = 0;
  speedMul = 1;
  hand = new THREE.Vector3();
  godMode = false;

  constructor(start: THREE.Vector3) {
    this.char = new Character('mage', 'adventurer');
    this.pos.copy(start);
    this.lastSafe.copy(start);
    ctx.scene.add(this.char.root);

    const bd = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y + CENTER_Y, start.z);
    this.body = physics.world.createRigidBody(bd);
    const cd = RAPIER.ColliderDesc.capsule(HALF_H, RADIUS)
      .setCollisionGroups(groups(G.PLAYER, G.TERRAIN | G.STATIC | G.DYNAMIC | G.ENEMY | G.ICE | G.NPC))
      .setFriction(0);
    this.collider = physics.world.createCollider(cd, this.body);
    physics.setOwner(this.collider, { kind: 'player' });

    this.kcc = physics.world.createCharacterController(0.03);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setSlideEnabled(true);
    this.kcc.enableAutostep(0.5, 0.25, false);
    this.kcc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((56 * Math.PI) / 180);
    this.kcc.enableSnapToGround(0.45);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(70);

    this.wings = this.buildWings();
    this.char.play('Idle');
  }

  private buildWings() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 128, 0);
    grad.addColorStop(0, 'rgba(160,255,230,0.95)');
    grad.addColorStop(1, 'rgba(120,200,255,0.0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(4, 30);
    g.bezierCurveTo(90, 0, 128, 40, 124, 120);
    g.bezierCurveTo(110, 170, 70, 230, 10, 240);
    g.bezierCurveTo(30, 180, 20, 100, 4, 30);
    g.fill();
    g.strokeStyle = 'rgba(230,255,250,0.9)';
    g.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(8, 40 + i * 40);
      g.quadraticCurveTo(60, 50 + i * 30, 110 - i * 12, 70 + i * 36);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: new THREE.Color(1.6, 1.8, 1.8),
    });
    const group = new THREE.Group();
    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(1.1, 1.6);
      geo.translate(0.55, -0.1, 0);
      const m = new THREE.Mesh(geo, mat);
      m.scale.x = side;
      m.rotation.y = side * 0.35;
      m.userData.side = side;
      group.add(m);
    }
    group.position.set(0, 1.25, -0.25);
    group.visible = false;
    this.char.root.add(group);
    return group;
  }

  get alive() {
    return this.state !== 'dead';
  }

  handWorld(out = this.hand) {
    const b = this.char.bone('handslot.r');
    if (b) b.getWorldPosition(out);
    else out.copy(this.pos).add(new THREE.Vector3(0, 1.2, 0));
    return out;
  }

  chestWorld(out = new THREE.Vector3()) {
    return out.copy(this.pos).add(new THREE.Vector3(0, CHEST, 0));
  }

  teleport(p: THREE.Vector3) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.state = 'air';
    this.airTime = 0;
    this.fallStartY = p.y;
    this.body.setTranslation({ x: p.x, y: p.y + CENTER_Y, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + CENTER_Y, z: p.z });
    this.lastSafe.copy(p);
    ctx.cam.snapTo(p);
  }

  /** Move without snapping the camera (used by ice pillars lifting the player). */
  teleportKeepCam(p: THREE.Vector3) {
    this.pos.copy(p);
    this.vel.y = 0;
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + CENTER_Y, z: p.z });
    if (this.state === 'climb' || this.state === 'swim') this.state = 'ground';
  }

  useStamina(n: number) {
    if (this.godMode) return true;
    if (this.stamina <= 0) return false;
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaDelay = 0.9;
    if (this.stamina <= 0) this.exhausted = true;
    return true;
  }

  useMana(n: number) {
    if (this.godMode) return true;
    if (this.mana < n) return false;
    this.mana -= n;
    this.manaDelay = 0.8;
    return true;
  }

  heal(quarters: number) {
    this.hp = Math.min(this.hearts * 4, this.hp + quarters);
  }

  damage(quarters: number, from?: THREE.Vector3, knock = 6) {
    if (this.invuln > 0 || this.state === 'dead' || this.godMode) return false;
    if (this.state === 'dodge') return false;
    this.hp -= quarters;
    this.invuln = 0.9;
    events.emit('playerHurt', { amount: quarters });
    ctx.cam.shake(0.5);
    this.char.setTint('#ff3030', 0.9);
    if (from) {
      const d = this.pos.clone().sub(from).setY(0).normalize();
      this.vel.x = d.x * knock;
      this.vel.z = d.z * knock;
      if (this.state === 'ground') this.vel.y = 3;
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    } else if (this.state === 'ground' || this.state === 'air') {
      this.char.playUpper('Hit_A', { speed: 1.4 });
    }
    return true;
  }

  die() {
    this.state = 'dead';
    this.char.stopUpper();
    this.char.play('Death_A', { once: true, fade: 0.15 });
    this.wings.visible = false;
    events.emit('playerDied', {});
  }

  revive(at: THREE.Vector3) {
    this.hp = this.hearts * 4;
    this.stamina = this.maxStamina;
    this.mana = this.maxMana;
    this.status = newStatus();
    this.teleport(at);
    this.char.play('Idle', { restart: true });
    this.state = 'air';
  }

  /** Locks movement for an interaction animation. */
  busy(anim: string, seconds: number, speed = 1) {
    if (this.state !== 'ground') return;
    this.state = 'busy';
    this.busyTimer = seconds;
    this.vel.set(0, 0, 0);
    this.char.play(anim, { once: true, fade: 0.12, speed });
  }

  /** Face towards a world direction for a short time (casting). */
  faceDirection(dir: THREE.Vector3, hold = 0.35) {
    this.facingOverride = Math.atan2(dir.x, dir.z);
    this.aimFacing = hold;
  }

  update(dt: number) {
    const input = ctx.input;
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.invuln > 0.6) this.char.setTint('#ff3030', (this.invuln - 0.6) * 3);
    else this.applyStatusTint();

    // --- input direction relative to camera ---
    let ix = 0, iz = 0;
    if (input.isDown('KeyW')) iz += 1;
    if (input.isDown('KeyS')) iz -= 1;
    if (input.isDown('KeyA')) ix -= 1;
    if (input.isDown('KeyD')) ix += 1;
    this.moveInput.set(ix, iz);
    if (this.moveInput.lengthSq() > 1) this.moveInput.normalize();
    const fwd = ctx.cam.forward(new THREE.Vector3());
    const right = ctx.cam.right(new THREE.Vector3());
    const wish = new THREE.Vector3().addScaledVector(fwd, this.moveInput.y).addScaledVector(right, this.moveInput.x);
    const hasInput = wish.lengthSq() > 0.01;
    if (hasInput) wish.normalize();

    const sprintHeld = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    this.castSlow = Math.max(0, this.castSlow - dt);
    this.aimFacing = Math.max(0, this.aimFacing - dt);
    if (this.aimFacing <= 0) this.facingOverride = null;

    const wl = waterLevelAt(this.pos.x, this.pos.z);
    const submerged = wl - this.pos.y;

    switch (this.state) {
      case 'ground':
        this.updateGround(dt, wish, hasInput, sprintHeld);
        break;
      case 'air':
        this.updateAir(dt, wish, hasInput);
        break;
      case 'glide':
        this.updateGlide(dt, wish, hasInput);
        break;
      case 'climb':
        this.updateClimb(dt);
        break;
      case 'swim':
        this.updateSwim(dt, wish, hasInput, sprintHeld, wl);
        break;
      case 'dodge':
        this.updateDodge(dt);
        break;
      case 'busy':
        this.busyTimer -= dt;
        this.vel.x = 0;
        this.vel.z = 0;
        this.vel.y = -2;
        this.move(dt);
        if (this.busyTimer <= 0) this.state = 'ground';
        break;
      case 'dead':
        break;
    }

    // enter swimming from any movement state
    if (['ground', 'air', 'glide', 'dodge'].includes(this.state) && submerged > 1.15) {
      this.enterSwim();
    }

    // stamina regen
    this.staminaDelay -= dt;
    const regenOK = (this.state === 'ground' || this.state === 'busy') && !(sprintHeld && hasInput && !this.exhausted);
    if (regenOK && this.staminaDelay <= 0) {
      this.stamina = Math.min(this.maxStamina, this.stamina + (this.exhausted ? 22 : 38) * dt);
      if (this.stamina >= this.maxStamina * 0.999) this.exhausted = false;
    }
    this.manaDelay -= dt;
    if (this.manaDelay <= 0) this.mana = Math.min(this.maxMana, this.mana + 14 * dt);

    this.updateStatus(dt, submerged);

    // safe position for drowning / falling out of the world
    this.safeTimer -= dt;
    if (this.state === 'ground' && this.safeTimer <= 0 && submerged < 0.3) {
      this.lastSafe.copy(this.pos);
      this.safeTimer = 1;
    }
    if (this.pos.y < -60) this.respawnSafe(4);

    // visuals
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw;
    const tilt = this.state === 'swim' ? 0.9 * Math.min(1, this.vel.length() / 3) + 0.25 : this.state === 'glide' ? 0.45 : 0;
    this.char.model.rotation.x += (tilt - this.char.model.rotation.x) * damp(8, dt);
    this.char.model.position.y = this.state === 'swim' ? 0.15 : 0;
    this.wingOpen += ((this.state === 'glide' ? 1 : 0) - this.wingOpen) * damp(10, dt);
    this.wings.visible = this.wingOpen > 0.02;
    if (this.wings.visible) {
      const flap = Math.sin(ctx.time * 5) * 0.12;
      for (const w of this.wings.children) {
        const side = w.userData.side as number;
        w.rotation.y = side * (0.35 + (1 - this.wingOpen) * 1.3 + flap);
        w.scale.y = this.wingOpen;
      }
      if (Math.random() < 0.5)
        ctx.particles.emit({
          pos: this.pos.clone().add(new THREE.Vector3(0, 1.1, 0)),
          count: 1,
          spread: 0.6,
          posSpread: 0.6,
          life: [0.4, 0.8],
          size: [0.25, 0.02],
          color: '#aaffe8',
        });
    }
    this.char.update(dt);
    this.handWorld();
  }

  private applyStatusTint() {
    const s = this.status;
    if (s.burning > 0) this.char.setTint('#ff5a10', 0.35 + Math.sin(ctx.time * 20) * 0.1);
    else if (s.frozen > 0) this.char.setTint('#80d8ff', 0.4);
    else if (s.shocked > 0) this.char.setTint('#b58cff', 0.4 * (Math.sin(ctx.time * 40) > 0 ? 1 : 0));
    else this.char.setTint('#000000', 0);
  }

  private updateStatus(dt: number, submerged: number) {
    const s = this.status;
    if (submerged > 0.3 || ctx.weather?.raining) s.wet = Math.max(s.wet, submerged > 0.3 ? 4 : 1.5);
    if (s.wet > 0 && s.burning > 0) s.burning = 0;
    s.wet = Math.max(0, s.wet - dt);
    s.frozen = Math.max(0, s.frozen - dt);
    s.shocked = Math.max(0, s.shocked - dt);
    if (s.burning > 0) {
      s.burning -= dt;
      this.burnTick -= dt;
      if (this.burnTick <= 0) {
        this.burnTick = 1;
        this.hp = Math.max(this.godMode ? this.hp : 1, this.hp - (this.godMode ? 0 : 1));
        events.emit('damageNumber', { pos: this.pos.clone().add(new THREE.Vector3(0, 2, 0)), amount: 1, color: '#ff7a2e' });
      }
      if (Math.random() < 0.6)
        ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(0, 0.9, 0)), posSpread: 0.35, vel: new THREE.Vector3(0, 2, 0), spread: 0.5, life: [0.3, 0.6], size: [0.5, 0.1], color: '#ffb040', color2: '#ff3000' });
    }
  }

  // ---- movement states -------------------------------------------------------
  private move(dt: number) {
    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    this.pos.x += m.x;
    this.pos.y += m.y;
    this.pos.z += m.z;
    // keep the player inside the island bounds
    const lim = 500;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);
    // never below terrain (safety against tunnelling)
    const th = ctx.terrain.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < th - 0.5) this.pos.y = th;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + CENTER_Y, z: this.pos.z });
    // hitting a ceiling
    if (m.y < desired.y - 0.001 && this.vel.y > 0) this.vel.y = 0;
    return m;
  }

  /** Collision normals from the last KCC move. */
  private wallContact(dir: THREE.Vector3) {
    for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
      const c = this.kcc.computedCollision(i);
      if (!c || !c.collider) continue;
      const n = c.normal1;
      if (Math.abs(n.y) < 0.6 && dir.x * n.x + dir.z * n.z < -0.4) return c;
    }
    return null;
  }

  private faceTowards(dir: THREE.Vector3, dt: number, speed = 12) {
    if (this.facingOverride !== null) {
      this.yaw = angleLerp(this.yaw, this.facingOverride, damp(20, dt));
      return;
    }
    if (dir.lengthSq() < 0.001) return;
    const target = Math.atan2(dir.x, dir.z);
    this.yaw = angleLerp(this.yaw, target, damp(speed, dt));
  }

  private updateGround(dt: number, wish: THREE.Vector3, hasInput: boolean, sprintHeld: boolean) {
    const input = ctx.input;
    const sprint = sprintHeld && hasInput && !this.exhausted && this.castSlow <= 0;
    let speed = sprint ? 8.8 : 5.4;
    if (this.exhausted) speed = 2.6;
    if (this.castSlow > 0) speed *= 0.5;
    if (this.status.frozen > 0) speed *= 0.3;
    speed *= this.speedMul;
    if (sprint) this.useStamina(20 * dt);

    const target = wish.clone().multiplyScalar(hasInput ? speed : 0);
    const k = damp(hasInput ? 12 : 16, dt);
    this.vel.x += (target.x - this.vel.x) * k;
    this.vel.z += (target.z - this.vel.z) * k;
    this.vel.y = -3;
    this.faceTowards(hasInput ? wish : new THREE.Vector3(), dt);
    ctx.cam.fovBoost += ((sprint ? 6 : 0) - ctx.cam.fovBoost) * damp(4, dt);

    const m = this.move(dt);
    // standing on something steeper than ~50 degrees means we are sliding off a cliff
    if (this.grounded) {
      const below = ctx.world.raycastStatic(this.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), new THREE.Vector3(0, -1, 0), 1.2);
      if (below && below.normal.y < 0.62) {
        this.grounded = false;
        this.coyote = Math.min(this.coyote, 0.05);
      }
    }
    if (this.grounded) this.coyote = 0.14;
    else this.coyote -= dt;

    // animation
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs < 0.4) this.char.play('Idle', { fade: 0.25 });
    else if (this.exhausted) this.char.play('Walking_A', { speed: 0.8 });
    else if (hs < 3.5) this.char.play('Walking_B', { speed: hs / 2.4 });
    else this.char.play('Running_A', { speed: sprint ? 1.25 : hs / 5.2 });

    if (hs > 1) {
      this.stepTimer -= dt * hs;
      if (this.stepTimer <= 0) {
        this.stepTimer = 2.2;
        events.emit('sound', { name: 'step', pos: this.pos, volume: 0.25 });
        if (sprint) ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), count: 2, spread: 0.7, life: [0.3, 0.6], size: [0.5, 1.2], alpha: [0.35, 0], color: '#c9b890', additive: false, drag: 3 });
      }
    }

    // climb when pushing into a steep surface
    if (hasInput && !this.exhausted && this.stamina > 4) {
      const c = this.wallContact(wish);
      if (c && this.tryStartClimb(wish)) return;
    }

    if (input.wasPressed('Space') && this.coyote > 0) {
      this.jump();
      return;
    }
    if ((input.wasPressed('KeyC') || input.wasPressed('AltLeft')) && !this.exhausted) {
      this.startDodge(hasInput ? wish : ctx.cam.forward(new THREE.Vector3()));
      return;
    }
    if (this.coyote <= 0 && !this.grounded) {
      this.state = 'air';
      this.airTime = 0;
      this.fallStartY = this.pos.y;
    }
    void m;
  }

  jump(power = 8.4) {
    this.vel.y = power;
    this.state = 'air';
    this.airTime = 0;
    this.fallStartY = this.pos.y;
    this.coyote = 0;
    this.char.play('Jump_Start', { once: true, fade: 0.08, speed: 1.4, onDone: () => this.char.play('Jump_Idle', { fade: 0.15 }) });
    events.emit('sound', { name: 'jump', pos: this.pos, volume: 0.35 });
  }

  /** External launch (wind updraft). */
  launch(vy: number) {
    this.vel.y = Math.max(this.vel.y, vy);
    if (this.state === 'ground' || this.state === 'busy' || this.state === 'glide') {
      this.state = 'air';
      this.airTime = 0.3;
    }
    this.fallStartY = this.pos.y + 100;
    this.char.play('Jump_Idle', { fade: 0.15 });
  }

  private updateAir(dt: number, wish: THREE.Vector3, hasInput: boolean) {
    const input = ctx.input;
    this.airTime += dt;
    this.vel.y -= 24 * dt;
    this.vel.y += ctx.world.updraftAt(this.pos) * dt * 0.6;
    if (this.vel.y < -40) this.vel.y = -40;
    const target = wish.clone().multiplyScalar(hasInput ? 5.4 : 0);
    const k = damp(hasInput ? 3.5 : 0.8, dt);
    this.vel.x += (target.x - this.vel.x) * k;
    this.vel.z += (target.z - this.vel.z) * k;
    this.faceTowards(hasInput ? wish : new THREE.Vector3(), dt, 6);
    if (this.vel.y > 0) this.fallStartY = Math.max(this.fallStartY, this.pos.y);
    this.move(dt);

    if (this.airTime > 0.25 && this.char.currentName !== 'Jump_Idle' && this.char.currentName !== 'Jump_Start') this.char.play('Jump_Idle', { fade: 0.2 });

    if (hasInput && this.stamina > 4 && !this.exhausted && this.airTime > 0.1) {
      const c = this.wallContact(wish);
      if (c && this.tryStartClimb(wish)) return;
    }
    if (input.wasPressed('Space') && this.airTime > 0.12 && this.stamina > 0 && !this.exhausted) {
      this.state = 'glide';
      this.vel.y = Math.max(this.vel.y, -2);
      events.emit('sound', { name: 'glide', pos: this.pos, volume: 0.4 });
      this.char.play('Jump_Idle', { fade: 0.2, speed: 0.4 });
      return;
    }
    if (this.grounded && this.vel.y <= 0) {
      const below = ctx.world.raycastStatic(this.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), new THREE.Vector3(0, -1, 0), 1.2);
      if (below && below.normal.y < 0.62) {
        // slide down steep faces instead of standing on them
        this.vel.x += below.normal.x * 30 * dt;
        this.vel.z += below.normal.z * 30 * dt;
        return;
      }
      this.land();
    }
  }

  private land() {
    const fall = this.fallStartY - this.pos.y;
    this.state = 'ground';
    this.vel.y = 0;
    if (fall > 15 && !this.godMode) {
      const dmg = Math.min(40, Math.floor((fall - 15) / 3) + 2);
      this.damage(dmg);
      events.emit('toast', { text: '높은 곳에서 떨어졌다!', kind: 'warn' });
    }
    if (this.state !== 'ground') return;
    this.char.play('Jump_Land', { once: true, fade: 0.05, speed: 1.6, onDone: () => this.char.play('Idle', { fade: 0.2 }) });
    if (fall > 3) ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), count: 8, spread: 2, life: [0.4, 0.8], size: [0.6, 1.4], alpha: [0.35, 0], color: '#cdbd98', additive: false, drag: 4 });
    events.emit('sound', { name: 'land', pos: this.pos, volume: 0.3 });
  }

  private updateGlide(dt: number, wish: THREE.Vector3, hasInput: boolean) {
    const input = ctx.input;
    const lift = ctx.world.updraftAt(this.pos);
    this.vel.y = Math.max(this.vel.y - 9 * dt, -2.3);
    if (lift > 0) this.vel.y = Math.min(this.vel.y + lift * dt, 14);
    const heading = hasInput ? wish : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const speed = hasInput ? 9.5 : 6;
    const k = damp(2.2, dt);
    this.vel.x += (heading.x * speed - this.vel.x) * k;
    this.vel.z += (heading.z * speed - this.vel.z) * k;
    this.faceTowards(heading, dt, 4);
    this.useStamina(6.5 * dt);
    this.fallStartY = this.pos.y;
    ctx.cam.fovBoost += (8 - ctx.cam.fovBoost) * damp(3, dt);
    this.move(dt);
    if (this.stamina <= 0 || input.wasPressed('Space')) {
      this.state = 'air';
      this.airTime = 0.3;
      this.char.play('Jump_Idle', { fade: 0.2 });
      return;
    }
    if (hasInput && this.stamina > 4) {
      const c = this.wallContact(wish);
      if (c && this.tryStartClimb(wish)) return;
    }
    if (this.grounded) this.land();
  }

  // ---- climbing --------------------------------------------------------------
  private tryStartClimb(dir: THREE.Vector3) {
    const origin = this.chestWorld();
    const hit = ctx.world.raycastStatic(origin, dir.clone().setY(0).normalize(), 1.2);
    if (!hit || Math.abs(hit.normal.y) > 0.62) return false;
    if (hit.owner && hit.owner.climbable === false) return false;
    this.climbPush += 1 / 60;
    if (this.climbPush < 0.08) return false;
    this.climbPush = 0;
    this.state = 'climb';
    this.climbNormal.copy(hit.normal);
    this.vel.set(0, 0, 0);
    this.char.play('Running_A', { speed: 0.001, fade: 0.2 });
    return true;
  }

  private updateClimb(dt: number) {
    const input = ctx.input;
    const n = this.climbNormal;
    const fwd = new THREE.Vector3(-n.x, 0, -n.z).normalize();
    const rightS = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const upS = new THREE.Vector3().crossVectors(n, rightS).normalize();
    const mi = this.moveInput;
    let speed = 2.3;
    if (this.status.frozen > 0) speed *= 0.3;
    const move = new THREE.Vector3().addScaledVector(upS, mi.y).addScaledVector(rightS, mi.x);
    const moving = move.lengthSq() > 0.01;
    this.yaw = angleLerp(this.yaw, Math.atan2(fwd.x, fwd.z), damp(14, dt));

    // climb jump
    if (input.wasPressed('Space')) {
      if (mi.y < -0.5) {
        this.detachClimb(true);
        return;
      }
      if (this.useStamina(18)) {
        const dir = moving ? move.clone().normalize() : upS.clone();
        this.pos.addScaledVector(dir, 1.6);
        events.emit('sound', { name: 'jump', pos: this.pos, volume: 0.3 });
      }
    }
    if (moving) {
      this.useStamina(9 * dt);
      this.pos.addScaledVector(move, speed * dt);
    }
    if (this.stamina <= 0) {
      this.detachClimb(false);
      events.emit('toast', { text: '기력이 다했다…', kind: 'warn' });
      return;
    }

    // re-attach to the surface
    const chest = this.chestWorld();
    const origin = chest.clone().addScaledVector(n, 0.6);
    const hit = ctx.world.raycastStatic(origin, n.clone().multiplyScalar(-1), 1.8);
    if (hit && Math.abs(hit.normal.y) < 0.72) {
      n.lerp(hit.normal, damp(12, dt)).normalize();
      const target = hit.point.clone().addScaledVector(hit.normal, RADIUS + 0.06);
      target.y -= CHEST;
      this.pos.lerp(target, damp(20, dt));
    } else {
      // reached a ledge: try to mantle on top
      const top = chest.clone().addScaledVector(UP, 1.2).addScaledVector(fwd, 0.7);
      const down = ctx.world.raycastStatic(top, new THREE.Vector3(0, -1, 0), 3);
      if (down && down.normal.y > 0.6) {
        this.pos.copy(down.point).addScaledVector(fwd, 0.2);
        this.state = 'ground';
        this.vel.set(0, 0, 0);
        this.char.play('Jump_Land', { once: true, fade: 0.1, speed: 1.2, onDone: () => this.char.play('Idle') });
        this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + CENTER_Y, z: this.pos.z });
        return;
      }
      if (hit && hit.normal.y >= 0.72) {
        this.pos.copy(hit.point);
        this.state = 'ground';
        return;
      }
      this.detachClimb(false);
      return;
    }
    // bottom: step off onto walkable ground
    if (mi.y < -0.3) {
      const g = ctx.world.raycastStatic(this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(0, -1, 0), 0.5);
      if (g && g.normal.y > 0.7) {
        this.state = 'ground';
        return;
      }
    }
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + CENTER_Y, z: this.pos.z });
    // animation: running cycle scaled by movement reads as hand-over-hand climbing
    this.char.play('Running_A', { speed: moving ? 0.9 : 0.0001 });
    this.grounded = false;
  }

  private detachClimb(pushOff: boolean) {
    this.state = 'air';
    this.airTime = 0.2;
    this.fallStartY = this.pos.y;
    this.vel.copy(this.climbNormal).multiplyScalar(pushOff ? 4 : 1.5).setY(pushOff ? 4 : 0);
    this.char.play('Jump_Idle', { fade: 0.2 });
  }

  // ---- swimming --------------------------------------------------------------
  private enterSwim() {
    this.state = 'swim';
    this.vel.y *= 0.2;
    events.emit('sound', { name: 'splash', pos: this.pos, volume: 0.5 });
    ctx.particles.emit({ pos: this.pos.clone().setY(waterLevelAt(this.pos.x, this.pos.z)), count: 20, vel: new THREE.Vector3(0, 3, 0), spread: 2.5, gravity: 9, life: [0.5, 0.9], size: [0.35, 0.1], color: '#e8fbff', alpha: [0.9, 0], additive: false });
  }

  private updateSwim(dt: number, wish: THREE.Vector3, hasInput: boolean, sprintHeld: boolean, wl: number) {
    const fast = sprintHeld && hasInput && !this.exhausted;
    const speed = fast ? 5.6 : 3.2;
    if (hasInput) this.useStamina((fast ? 16 : 4.5) * dt);
    const k = damp(4, dt);
    const target = wish.clone().multiplyScalar(hasInput ? speed : 0);
    this.vel.x += (target.x - this.vel.x) * k;
    this.vel.z += (target.z - this.vel.z) * k;
    const floatY = wl - 1.25 + Math.sin(ctx.time * 2) * 0.05;
    this.vel.y = (floatY - this.pos.y) * 5;
    this.faceTowards(hasInput ? wish : new THREE.Vector3(), dt, 6);
    this.move(dt);
    this.char.play(hasInput ? 'Running_B' : 'Idle', { speed: hasInput ? (fast ? 0.9 : 0.55) : 0.5 });
    if (hasInput && Math.random() < 0.3)
      ctx.particles.emit({ pos: this.pos.clone().setY(wl + 0.05), count: 1, spread: 0.6, life: [0.4, 0.8], size: [0.4, 0.9], alpha: [0.6, 0], color: '#ffffff', additive: false, drag: 2 });
    this.status.burning = 0;

    if (this.stamina <= 0) {
      events.emit('toast', { text: '물에 빠져 기력을 잃었다…', kind: 'warn' });
      this.respawnSafe(4);
      return;
    }
    const depth = wl - this.pos.y;
    if (depth < 1.0) {
      this.state = this.grounded ? 'ground' : 'air';
      this.airTime = 0;
      this.fallStartY = this.pos.y;
      if (ctx.input.isDown('Space')) this.jump(6);
    }
    if (ctx.input.wasPressed('Space') && this.useStamina(10)) {
      this.vel.y = 6;
      this.pos.y += 0.3;
      this.state = 'air';
      this.airTime = 0;
      this.fallStartY = this.pos.y;
    }
  }

  respawnSafe(dmgQuarters: number) {
    const p = this.lastSafe.clone();
    p.y = ctx.terrain.heightAt(p.x, p.z) + 0.2;
    this.teleport(p);
    this.stamina = this.maxStamina * 0.5;
    this.exhausted = false;
    if (!this.godMode) {
      this.hp -= dmgQuarters;
      if (this.hp <= 0) {
        this.hp = 0;
        this.die();
      }
    }
  }

  // ---- dodge ---------------------------------------------------------------
  private startDodge(dir: THREE.Vector3) {
    if (!this.useStamina(14)) return;
    this.state = 'dodge';
    this.dodgeTime = 0.38;
    this.dodgeDir.copy(dir).setY(0).normalize();
    this.yaw = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
    this.invuln = Math.max(this.invuln, 0.3);
    this.char.play('Dodge_Forward', { once: true, fade: 0.05, speed: 1.5 });
    events.emit('sound', { name: 'dodge', pos: this.pos, volume: 0.3 });
  }

  private updateDodge(dt: number) {
    this.dodgeTime -= dt;
    const s = lerp(5, 13, clamp(this.dodgeTime / 0.38, 0, 1));
    this.vel.x = this.dodgeDir.x * s;
    this.vel.z = this.dodgeDir.z * s;
    this.vel.y = -4;
    this.move(dt);
    if (Math.random() < 0.6) ctx.particles.emit({ pos: this.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), count: 1, spread: 0.2, life: [0.2, 0.4], size: [0.6, 0.1], color: '#c8a8ff' });
    if (this.dodgeTime <= 0) {
      this.state = this.grounded ? 'ground' : 'air';
      this.airTime = 0.2;
      this.fallStartY = this.pos.y;
    }
  }
}
