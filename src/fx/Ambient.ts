import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { waterLevelAt } from '../world/WorldGen';

/**
 * Ambient life in the Zelda / Genshin manner: curling wind trails that drift with the
 * breeze, butterflies fluttering over meadows by day and bird flocks crossing the sky.
 */

const TRAIL_POINTS = 28;

interface Trail {
  mesh: THREE.Mesh;
  pts: THREE.Vector3[];
  head: THREE.Vector3;
  vel: THREE.Vector3;
  t: number;
  life: number;
  curl: number;
}

interface Butterfly {
  obj: THREE.Group;
  wings: THREE.Mesh[];
  home: THREE.Vector3;
  pos: THREE.Vector3;
  phase: number;
  speed: number;
}

interface Bird {
  obj: THREE.Group;
  wings: THREE.Mesh[];
  phase: number;
}

export class Ambient {
  private trails: Trail[] = [];
  // additive: vertex brightness doubles as opacity
  private trailMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, vertexColors: true });
  private butterflies: Butterfly[] = [];
  private flocks: { group: THREE.Group; birds: Bird[]; vel: THREE.Vector3 }[] = [];
  private spawnT = 0;

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < 6; i++) this.trails.push(this.makeTrail());
    const wingTex = this.wingTexture();
    const colors = ['#fff3a0', '#ffffff', '#ffb0d8', '#a8d8ff', '#ffc070'];
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshLambertMaterial({ map: wingTex, color: colors[i % colors.length], side: THREE.DoubleSide, alphaTest: 0.4, emissive: '#303030' });
      const obj = new THREE.Group();
      const wings: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const g = new THREE.PlaneGeometry(0.16, 0.14).rotateX(-Math.PI / 2).translate(0.08, 0, 0);
        const w = new THREE.Mesh(g, mat);
        w.scale.x = side;
        obj.add(w);
        wings.push(w);
      }
      obj.visible = false;
      obj.userData.noCull = true;
      scene.add(obj);
      this.butterflies.push({ obj, wings, home: new THREE.Vector3(), pos: new THREE.Vector3(), phase: Math.random() * 10, speed: 0.8 + Math.random() * 0.6 });
    }
    const birdMat = new THREE.MeshBasicMaterial({ color: '#2a2a33', side: THREE.DoubleSide, fog: true });
    for (let f = 0; f < 3; f++) {
      const group = new THREE.Group();
      const birds: Bird[] = [];
      const n = 5 + f * 2;
      for (let i = 0; i < n; i++) {
        const obj = new THREE.Group();
        const wings: THREE.Mesh[] = [];
        for (const side of [-1, 1]) {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, 0, 0, -0.2, 1.1 * side, 0, -0.1], 3));
          const w = new THREE.Mesh(g, birdMat);
          obj.add(w);
          wings.push(w);
        }
        // V formation
        const row = Math.ceil(i / 2), sgn = i % 2 ? 1 : -1;
        obj.position.set(sgn * row * 2.4, (Math.random() - 0.5) * 0.8, -row * 2.2);
        group.add(obj);
        birds.push({ obj, wings, phase: Math.random() * 6 });
      }
      group.userData.noCull = true;
      scene.add(group);
      this.flocks.push({ group, birds, vel: new THREE.Vector3() });
      this.resetFlock(this.flocks[f], true);
    }
  }

  private wingTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(26, 22, 26, 18, -0.3, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(22, 46, 18, 14, 0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(40,30,20,0.6)';
    g.beginPath();
    g.arc(32, 22, 5, 0, Math.PI * 2);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private makeTrail(): Trail {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(TRAIL_POINTS * 2 * 3);
    const col = new Float32Array(TRAIL_POINTS * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_POINTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, this.trailMat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.userData.noCull = true;
    this.scene.add(mesh);
    return { mesh, pts: [], head: new THREE.Vector3(), vel: new THREE.Vector3(), t: 0, life: 0, curl: 0 };
  }

  private spawnTrail(tr: Trail, focus: THREE.Vector3) {
    const w = ctx.wind;
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 22;
    tr.head.set(focus.x + Math.cos(a) * r - w.x * 10, 0, focus.z + Math.sin(a) * r - w.y * 10);
    tr.head.y = Math.max(ctx.terrain.heightAt(tr.head.x, tr.head.z), waterLevelAt(tr.head.x, tr.head.z)) + 1.5 + Math.random() * 4;
    tr.vel.set(w.x, 0, w.y).normalize().multiplyScalar(5 + Math.random() * 3);
    tr.pts = [];
    tr.t = 0;
    tr.life = 3 + Math.random() * 2;
    tr.curl = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 2);
    tr.mesh.visible = true;
  }

  private updateTrail(tr: Trail, dt: number) {
    tr.t += dt;
    // gentle sway, and occasionally a loop-the-loop curl
    const side = new THREE.Vector3(-tr.vel.z, 0, tr.vel.x).normalize();
    const loop = tr.curl !== 0 && tr.t > 1 && tr.t < 1 + (Math.PI * 2) / Math.abs(tr.curl);
    if (loop) {
      const q = new THREE.Quaternion().setFromAxisAngle(side, tr.curl * dt);
      tr.vel.applyQuaternion(q);
    } else {
      tr.vel.y += (0 - tr.vel.y) * Math.min(1, dt * 2);
      tr.vel.addScaledVector(side, Math.sin(tr.t * 2.2) * dt * 2);
    }
    tr.head.addScaledVector(tr.vel, dt);
    if (tr.t < tr.life - 0.9) {
      tr.pts.unshift(tr.head.clone());
      if (tr.pts.length > TRAIL_POINTS) tr.pts.pop();
    } else tr.pts.pop();
    const pos = tr.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const col = tr.mesh.geometry.attributes.color as THREE.BufferAttribute;
    const cam = ctx.camera.position;
    const fadeIn = Math.min(1, tr.t * 2);
    const night = 1 - ctx.sky.night * 0.75;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const p = tr.pts[Math.min(i, tr.pts.length - 1)] ?? tr.head;
      const next = tr.pts[Math.min(i + 1, tr.pts.length - 1)] ?? p;
      const dir = next.clone().sub(p);
      const toCam = cam.clone().sub(p);
      const n = new THREE.Vector3().crossVectors(dir, toCam).normalize();
      const k = i / (TRAIL_POINTS - 1);
      const width = 0.085 * Math.sin(Math.min(1, k * 1.2) * Math.PI) + 0.006;
      pos.setXYZ(i * 2, p.x + n.x * width, p.y + n.y * width, p.z + n.z * width);
      pos.setXYZ(i * 2 + 1, p.x - n.x * width, p.y - n.y * width, p.z - n.z * width);
      // brightness stands in for opacity (additive-looking white on the sky)
      const a = (1 - k) * fadeIn * 0.85 * night * (i < tr.pts.length ? 1 : 0);
      col.setXYZ(i * 2, a, a, a);
      col.setXYZ(i * 2 + 1, a, a, a);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (tr.t >= tr.life || tr.pts.length === 0) tr.mesh.visible = false;
  }

  private resetFlock(f: { group: THREE.Group; vel: THREE.Vector3 }, initial = false) {
    const focus = ctx.player?.pos ?? new THREE.Vector3();
    const a = Math.random() * Math.PI * 2;
    const start = new THREE.Vector3(focus.x + Math.cos(a) * 260, 0, focus.z + Math.sin(a) * 260);
    const target = new THREE.Vector3(focus.x + (Math.random() - 0.5) * 120, 0, focus.z + (Math.random() - 0.5) * 120);
    f.vel.copy(target.sub(start).setY(0).normalize().multiplyScalar(9 + Math.random() * 4));
    if (initial) start.addScaledVector(f.vel, Math.random() * 20);
    start.y = 60 + Math.random() * 50;
    f.group.position.copy(start);
    f.group.lookAt(start.clone().add(f.vel));
  }

  update(dt: number, focus: THREE.Vector3) {
    const day = 1 - ctx.sky.night;
    // --- wind trails
    this.spawnT -= dt;
    if (this.spawnT <= 0 && !ctx.weather?.raining) {
      this.spawnT = 0.7 + Math.random() * 1.2;
      const free = this.trails.find((t) => !t.mesh.visible);
      if (free) this.spawnTrail(free, focus);
    }
    for (const tr of this.trails) if (tr.mesh.visible) this.updateTrail(tr, dt);

    // --- butterflies hover around flowers near the player during the day
    for (const b of this.butterflies) {
      const far = b.home.distanceToSquared(focus) > 45 * 45;
      if (!b.obj.visible || far) {
        if (day < 0.5 || ctx.weather?.raining) {
          b.obj.visible = false;
          continue;
        }
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 30;
        const x = focus.x + Math.cos(a) * r, z = focus.z + Math.sin(a) * r;
        if (ctx.terrain.grassAt(x, z) < 0.4) {
          b.obj.visible = false;
          continue;
        }
        b.home.set(x, ctx.terrain.heightAt(x, z), z);
        b.pos.copy(b.home).setY(b.home.y + 0.8);
        b.obj.visible = true;
      }
      b.phase += dt * b.speed;
      const p = b.phase;
      const tx = b.home.x + Math.sin(p * 0.7) * 2.5 + Math.sin(p * 1.9) * 0.6;
      const tz = b.home.z + Math.cos(p * 0.55) * 2.5 + Math.cos(p * 2.3) * 0.6;
      const ty = b.home.y + 0.6 + Math.abs(Math.sin(p * 1.3)) * 0.8;
      const prev = b.pos.clone();
      b.pos.set(tx, ty, tz);
      b.obj.position.copy(b.pos);
      const d = b.pos.clone().sub(prev);
      if (d.lengthSq() > 1e-6) b.obj.rotation.y = Math.atan2(d.x, d.z);
      const flap = Math.sin(ctx.time * 22 + b.phase * 3) * 1.1;
      b.wings[0].rotation.z = flap;
      b.wings[1].rotation.z = -flap;
    }

    // --- bird flocks glide across the sky
    for (const f of this.flocks) {
      f.group.position.addScaledVector(f.vel, dt);
      f.group.visible = day > 0.3;
      for (const b of f.birds) {
        b.phase += dt;
        const glide = Math.sin(b.phase * 0.5) > 0.3;
        const flap = glide ? 0.08 : Math.sin(b.phase * 9) * 0.55;
        b.wings[0].rotation.z = flap;
        b.wings[1].rotation.z = -flap;
      }
      const dx = f.group.position.x - focus.x, dz = f.group.position.z - focus.z;
      if (dx * dx + dz * dz > 320 * 320) this.resetFlock(f);
    }
  }
}
