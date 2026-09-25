import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { damp, rand } from '../core/math';
import { P } from './WorldGen';
import { events } from '../core/Events';

const DROPS = 2600;
const BOX = 44;

export class Weather {
  raining = false;
  intensity = 0;
  private globalRain = false;
  private timer = 200;
  private rain: THREE.LineSegments;
  private offsets: Float32Array;
  private strikeTimer = 5;
  private flash = 0;
  storm = false;
  private windAngle = 0.3;
  private windTarget = 0.3;

  constructor(scene: THREE.Scene) {
    const pos = new Float32Array(DROPS * 6);
    this.offsets = new Float32Array(DROPS * 3);
    for (let i = 0; i < DROPS; i++) {
      this.offsets[i * 3] = Math.random() * BOX;
      this.offsets[i * 3 + 1] = Math.random() * BOX;
      this.offsets[i * 3 + 2] = Math.random() * BOX;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: '#b8c8e0', transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
  }

  setGlobalRain(on: boolean, duration = 120) {
    this.globalRain = on;
    this.timer = duration;
  }

  update(dt: number) {
    const p = ctx.player.pos;
    this.storm = Math.hypot(p.x - P.peak.x, p.z - P.peak.z) < 175 && p.y > 40;
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.globalRain) {
        this.globalRain = false;
        this.timer = rand(240, 420);
      } else if (Math.random() < 0.35) {
        this.globalRain = true;
        this.timer = rand(70, 150);
      } else this.timer = rand(120, 240);
    }
    const target = this.storm || this.globalRain ? (this.storm ? 1 : 0.75) : 0;
    this.intensity += (target - this.intensity) * damp(0.5, dt);
    this.raining = this.intensity > 0.35;
    ctx.sky.overcast = Math.min(1, this.intensity * 0.95);

    // wind slowly wanders; storms blow harder
    if (Math.random() < dt * 0.02) this.windTarget = rand(0, Math.PI * 2);
    this.windAngle += (this.windTarget - this.windAngle) * damp(0.05, dt);
    const strength = 0.9 + this.intensity * 0.8;
    ctx.wind.set(Math.cos(this.windAngle) * strength, Math.sin(this.windAngle) * strength);

    this.rain.visible = this.intensity > 0.05;
    if (this.rain.visible) {
      const cam = ctx.camera.position;
      const arr = (this.rain.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      const n = Math.floor(DROPS * this.intensity);
      const fall = 26;
      for (let i = 0; i < DROPS; i++) {
        const o = i * 3;
        this.offsets[o + 1] -= fall * dt;
        this.offsets[o] += ctx.wind.x * 3 * dt;
        this.offsets[o + 2] += ctx.wind.y * 3 * dt;
        let x = (this.offsets[o] - cam.x) % BOX;
        let y = (this.offsets[o + 1] - cam.y) % BOX;
        let z = (this.offsets[o + 2] - cam.z) % BOX;
        if (x < 0) x += BOX;
        if (y < 0) y += BOX;
        if (z < 0) z += BOX;
        const wx = cam.x + x - BOX / 2, wy = cam.y + y - BOX / 2, wz = cam.z + z - BOX / 2;
        const k = i * 6;
        if (i < n) {
          arr[k] = wx; arr[k + 1] = wy; arr[k + 2] = wz;
          arr[k + 3] = wx - ctx.wind.x * 0.1; arr[k + 4] = wy + 0.7; arr[k + 5] = wz - ctx.wind.y * 0.1;
        } else {
          arr[k] = arr[k + 3] = wx; arr[k + 1] = arr[k + 4] = -1000; arr[k + 2] = arr[k + 5] = wz;
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      (this.rain.material as THREE.LineBasicMaterial).opacity = 0.35 * this.intensity + 0.1;
    }

    // lightning strikes in storms
    if (this.storm) {
      this.strikeTimer -= dt;
      if (this.strikeTimer <= 0) {
        this.strikeTimer = rand(4, 11);
        const a = Math.random() * Math.PI * 2;
        const r = rand(18, 70);
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        const y = ctx.terrain.heightAt(x, z);
        const ground = new THREE.Vector3(x, y, z);
        ctx.fx.bolt(ground.clone().add(new THREE.Vector3(rand(-10, 10), 90, rand(-10, 10))), ground, '#e8dcff', 0.35, 1.6);
        ctx.lights.flash(ground.clone().setY(y + 10), '#d8ccff', 400, 120, 0.3);
        this.flash = 1;
        events.emit('sound', { name: 'thunder', volume: Math.max(0.3, 1 - r / 90) });
        ctx.world.applyHit({ element: 'lightning', pos: ground, radius: 3, damage: 6, source: 'world', kind: 'strike' });
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 4);
      ctx.sky.hemi.intensity += this.flash * 2;
    }
  }
}
