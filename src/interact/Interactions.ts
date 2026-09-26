import * as THREE from 'three';
import { toon } from '../fx/Toon';
import { ctx } from '../core/ctx';
import { physics, RAPIER, G, groups } from '../core/Physics';
import { events } from '../core/Events';
import { ITEMS } from './items';
import { culler } from '../core/Culler';

export interface Interactable {
  id: string;
  pos: () => THREE.Vector3;
  radius: number;
  verb: () => string;
  name: () => string;
  enabled: () => boolean;
  action: () => void;
  priority?: number;
}

interface Pickup {
  id: number;
  item: string;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  body?: RAPIER.RigidBody;
  flag?: string;
  auto: boolean;
  age: number;
  bob: number;
}

function itemMesh(item: string): THREE.Object3D {
  const g = new THREE.Group();
  const std = (color: string, emissive = '#000000', ei = 0) => toon(new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, roughness: 0.6 }), 0.3);
  switch (item) {
    case 'apple':
    case 'roasted_apple': {
      const a = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), std(item === 'apple' ? '#e0302a' : '#8a3a18', '#300000', 0.3));
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.1), std('#5a3a1a'));
      s.position.y = 0.18;
      const l = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), std('#4caf50'));
      l.position.set(0.05, 0.2, 0);
      l.rotation.z = -1;
      g.add(a, s, l);
      break;
    }
    case 'mushroom':
    case 'glow_mushroom': {
      const glow = item === 'glow_mushroom';
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), std(glow ? '#5ff0ff' : '#d8483a', glow ? '#20c8e0' : '#000000', glow ? 1.2 : 0));
      cap.position.y = 0.2;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.22, 6), std('#f0e8d8'));
      stem.position.y = 0.11;
      g.add(cap, stem);
      break;
    }
    case 'herb': {
      for (let i = 0; i < 4; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 4), std('#5fcf6f', '#1a4a20', 0.3));
        leaf.position.y = 0.18;
        leaf.rotation.set(0.4, (i / 4) * Math.PI * 2, 0.3);
        g.add(leaf);
      }
      break;
    }
    case 'crystal': {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), std('#9fc8ff', '#6080ff', 0.8));
      c.scale.y = 1.6;
      c.position.y = 0.3;
      g.add(c);
      break;
    }
    case 'spirit_seed': {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), std('#ffd35a', '#ffb020', 1.5));
      s.position.y = 0.3;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.14, 8), std('#8a5a2a'));
      cap.position.y = 0.44;
      g.add(s, cap);
      break;
    }
    case 'bone': {
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.4, 2, 6), std('#efe8d8'));
      b.rotation.z = Math.PI / 2;
      b.position.y = 0.08;
      g.add(b);
      break;
    }
    case 'charcoal': {
      const c = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15, 0), std('#262322'));
      c.position.y = 0.12;
      g.add(c);
      break;
    }
    case 'doll': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.28, 8), std('#e87a9a'));
      body.position.y = 0.14;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), std('#f5d9b8'));
      head.position.y = 0.36;
      g.add(body, head);
      break;
    }
    default: {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), std('#ffffff')));
    }
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

export class Interactions {
  items: Interactable[] = [];
  pickups: Pickup[] = [];
  current: Interactable | null = null;
  private nextId = 1;

  register(i: Interactable) {
    this.items.push(i);
    return i;
  }

  unregister(id: string) {
    this.items = this.items.filter((i) => i.id !== id);
  }

  /** Place an item in the world. `physical` makes it fall and roll. */
  spawnPickup(item: string, pos: THREE.Vector3, physical = false, flag?: string, auto = false) {
    if (flag && ctx.save.has(flag)) return;
    const mesh = itemMesh(item);
    mesh.position.copy(pos);
    ctx.scene.add(mesh);
    mesh.userData.noCull = true;
    const p: Pickup = { id: this.nextId++, item, mesh, pos: pos.clone(), flag, auto, age: 0, bob: Math.random() * 6 };
    if (physical) {
      const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(0.8).setAngularDamping(2);
      p.body = physics.world.createRigidBody(bd);
      const cd = RAPIER.ColliderDesc.ball(0.16).setDensity(3).setRestitution(0.3).setCollisionGroups(groups(G.DYNAMIC, G.TERRAIN | G.STATIC | G.ICE));
      physics.world.createCollider(cd, p.body);
      p.body.applyImpulse({ x: (Math.random() - 0.5) * 0.15, y: 0.1, z: (Math.random() - 0.5) * 0.15 }, true);
    }
    this.pickups.push(p);
    culler.add(mesh, 75, p.pos);
    const id = `pickup:${p.id}`;
    this.register({
      id,
      pos: () => p.pos,
      radius: 1.8,
      verb: () => '줍기',
      name: () => ITEMS[item]?.name ?? item,
      enabled: () => true,
      action: () => this.collect(p),
      priority: 1,
    });
    return p;
  }

  collect(p: Pickup) {
    const def = ITEMS[p.item];
    ctx.save.add(p.item, 1);
    if (p.flag) ctx.save.set(p.flag);
    events.emit('pickup', { id: p.item, name: def?.name ?? p.item, count: 1, icon: def?.icon ?? '❔' });
    events.emit('sound', { name: p.item === 'spirit_seed' ? 'seed' : 'pickup', volume: 0.5 });
    ctx.particles.emit({ pos: p.pos.clone().setY(p.pos.y + 0.3), count: 10, spread: 1.5, life: [0.3, 0.6], size: [0.25, 0.02], color: '#fff2b0' });
    this.removePickup(p);
    if (ctx.player.state === 'ground') ctx.player.char.playUpper('PickUp', { speed: 2.2 });
  }

  private removePickup(p: Pickup) {
    culler.remove(p.mesh);
    p.mesh.removeFromParent();
    if (p.body) physics.removeBody(p.body);
    this.pickups = this.pickups.filter((x) => x !== p);
    this.unregister(`pickup:${p.id}`);
  }

  update(dt: number) {
    const pp = ctx.player.pos;
    for (const p of this.pickups) {
      p.age += dt;
      if (p.body) {
        const t = p.body.translation();
        p.pos.set(t.x, t.y - 0.14, t.z);
        if (t.y < -30) {
          this.removePickup(p);
          continue;
        }
      }
      p.mesh.position.set(p.pos.x, p.pos.y + (p.body ? 0 : Math.sin(ctx.time * 2 + p.bob) * 0.05), p.pos.z);
      p.mesh.rotation.y += dt * (p.item === 'spirit_seed' || p.item === 'crystal' ? 2 : 0.4);
      if ((p.item === 'spirit_seed' || p.item === 'crystal') && Math.random() < dt * 6)
        ctx.particles.emit({ pos: p.pos.clone().setY(p.pos.y + 0.35), count: 1, spread: 0.4, vel: new THREE.Vector3(0, 0.6, 0), life: [0.5, 1], size: [0.14, 0.02], color: p.item === 'crystal' ? '#a0c8ff' : '#ffe080' });
      if (p.auto && p.age > 0.6 && p.pos.distanceTo(pp) < 1.6) this.collect(p);
    }

    // choose the best interactable
    const p = ctx.player;
    let best: Interactable | null = null;
    let bestScore = Infinity;
    if (p.alive && (p.state === 'ground' || p.state === 'swim' || p.state === 'climb')) {
      const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      for (const it of this.items) {
        const ip = it.pos();
        const d = ip.distanceTo(pp);
        if (d > it.radius || Math.abs(ip.y - pp.y) > 3.5) continue;
        if (!it.enabled()) continue;
        const to = ip.clone().sub(pp).setY(0).normalize();
        const facing = to.dot(fwd);
        const score = d - facing * 0.6 - (it.priority ?? 0) * 0.3;
        if (score < bestScore) {
          bestScore = score;
          best = it;
        }
      }
    }
    this.current = best;
    if (best && ctx.input.wasPressed('KeyF')) {
      best.action();
      events.emit('interact', { id: best.id });
    }
  }
}
