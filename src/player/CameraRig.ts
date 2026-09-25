import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { clamp, damp, lerp } from '../core/math';
import { G } from '../core/Physics';
import { waterLevelAt } from '../world/WorldGen';
import type { Enemy } from '../entities/Enemy';
import { angleLerp } from '../core/math';

export class CameraRig {
  yaw = Math.PI;
  pitch = -0.22;
  distance = 6.5;
  targetDistance = 6.5;
  aimBlend = 0;
  pivot = new THREE.Vector3();
  private initialized = false;
  private shakeAmt = 0;
  fovBoost = 0;
  /** When true, wheel input is reserved by another system (kinesis distance). */
  wheelLocked = false;
  private tmpDir = new THREE.Vector3();
  /** Z-targeting: the camera keeps this enemy in view and spells aim at it. */
  lock: Enemy | null = null;

  constructor(public camera: THREE.PerspectiveCamera) {}

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  right(out = new THREE.Vector3()) {
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  /** Full 3D look direction. */
  lookDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
  }

  toggleLock() {
    if (this.lock) {
      this.lock = null;
      return;
    }
    this.lock = ctx.enemies?.findTarget(ctx.player.pos, this.forward(new THREE.Vector3()), 35, Math.cos(1.1)) ?? null;
  }

  shake(amount: number) {
    this.shakeAmt = Math.min(1.2, this.shakeAmt + amount);
  }

  snapTo(pos: THREE.Vector3, yaw?: number) {
    this.pivot.copy(pos).add(new THREE.Vector3(0, 1.55, 0));
    if (yaw !== undefined) this.yaw = yaw;
    this.initialized = true;
  }

  update(dt: number, focus: THREE.Vector3, aiming: boolean) {
    const input = ctx.input;
    const sens = 0.0022 * (ctx.settings?.sensitivity ?? 1);
    if (input.wasPressed('Mouse1') || input.wasPressed('KeyT')) this.toggleLock();
    if (this.lock && (!this.lock.alive || this.lock.pos.distanceTo(focus) > 45)) this.lock = null;
    if (this.lock) {
      const to = this.lock.chest().sub(focus);
      const yawT = Math.atan2(to.x, to.z);
      this.yaw = angleLerp(this.yaw, yawT, damp(6, dt));
      const pitchT = Math.atan2(to.y - 1.5, Math.hypot(to.x, to.z)) - 0.12;
      this.pitch += (clamp(pitchT, -0.6, 0.4) - this.pitch) * damp(4, dt);
    } else {
      this.yaw -= input.mouseDX * sens;
      this.pitch -= input.mouseDY * sens * (ctx.settings?.invertY ? -1 : 1);
    }
    this.pitch = clamp(this.pitch, -1.25, 0.9);
    if (!this.wheelLocked && input.wheel !== 0) this.targetDistance = clamp(this.targetDistance + input.wheel * 0.8, 2.8, 14);
    this.distance += (this.targetDistance - this.distance) * damp(8, dt);
    this.aimBlend += ((aiming ? 1 : 0) - this.aimBlend) * damp(12, dt);

    const target = this.tmpDir.copy(focus);
    target.y += 1.55;
    if (!this.initialized) {
      this.pivot.copy(target);
      this.initialized = true;
    }
    this.pivot.x += (target.x - this.pivot.x) * damp(16, dt);
    this.pivot.z += (target.z - this.pivot.z) * damp(16, dt);
    this.pivot.y += (target.y - this.pivot.y) * damp(9, dt);

    // looking up: pull the camera in so it doesn't sink under the character
    const up = Math.max(0, this.pitch - 0.25);
    const dist = lerp(this.distance * (1 - up * 0.55), 2.4, this.aimBlend);
    const shoulder = lerp(0.0, 0.85, this.aimBlend);
    const look = this.lookDir(new THREE.Vector3());
    const right = this.right(new THREE.Vector3());
    const pivot = this.pivot.clone().addScaledVector(right, -shoulder);
    pivot.y += this.aimBlend * 0.15 + up * 0.8;

    // collision: pull the camera in front of terrain/props
    const back = look.clone().multiplyScalar(-1);
    let d = dist;
    const hit = ctx.world ? ctx.world.raycastStatic(pivot, back, dist + 0.3) : null;
    if (hit) d = Math.max(0.6, hit.distance - 0.35);
    const pos = pivot.clone().addScaledVector(back, d);
    const ground = ctx.terrain.heightAt(pos.x, pos.z) + 0.45;
    if (pos.y < ground) pos.y = ground;
    const wl = waterLevelAt(pos.x, pos.z) + 0.35;
    if (pos.y < wl) pos.y = wl;

    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * this.shakeAmt * 0.35;
      pos.x += (Math.random() - 0.5) * s;
      pos.y += (Math.random() - 0.5) * s;
      pos.z += (Math.random() - 0.5) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(pivot.clone().addScaledVector(look, 20));
    // don't let the hat fill the screen when the camera is squeezed against a wall
    if (ctx.player) ctx.player.char.model.visible = pos.distanceTo(this.pivot) > 1.25;
    const fov = 62 + this.fovBoost - this.aimBlend * 10;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * damp(6, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  /** Ray from the camera through the screen center. */
  aimRay(maxDist = 80) {
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const hit = ctx.world.raycastAll(origin, dir, maxDist, G.TERRAIN | G.STATIC | G.DYNAMIC | G.ENEMY | G.ICE);
    const point = hit ? hit.point : origin.clone().addScaledVector(dir, maxDist);
    const waterHit = ctx.world.rayWater(origin, dir, hit ? hit.distance : maxDist);
    return { origin, dir, hit, point: waterHit ?? point, water: !!waterHit };
  }
}
