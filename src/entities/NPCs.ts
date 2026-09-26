import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { physics, RAPIER, G, groups } from '../core/Physics';
import { Character, CHAR_SCALE } from '../player/Character';
import type { CharacterKey } from '../core/Assets';
import { angleLerp, damp } from '../core/math';
import { assets } from '../core/Assets';

export interface DialogLine {
  who: string;
  text: string;
  choices?: { text: string; action?: () => void; next?: DialogLine[] }[];
}

export interface NPCDef {
  id: string;
  name: string;
  title: string;
  model: CharacterKey;
  pos: THREE.Vector3;
  yaw: number;
  idle?: string;
  route?: THREE.Vector3[];
  prop?: string;
  hide?: string[];
  scale?: number;
  talk: () => DialogLine[];
}

export const NPC_GEAR = [
  '1H_Sword', '1H_Sword_Offhand', '2H_Sword', 'Round_Shield', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield',
  '1H_Axe', '1H_Axe_Offhand', '2H_Axe', 'Mug', '1H_Crossbow', '2H_Crossbow', 'Throwable', 'Knife', 'Knife_Offhand',
  'Barbarian_Round_Shield',
];

export class NPC {
  char: Character;
  pos = new THREE.Vector3();
  yaw: number;
  body: RAPIER.RigidBody;
  private routeIdx = 0;
  private wait = 0;
  talking = false;

  constructor(public def: NPCDef) {
    this.char = new Character(def.model, 'adventurer', CHAR_SCALE * (def.scale ?? 1));
    this.pos.copy(def.pos);
    this.yaw = def.yaw;
    this.char.hide(def.hide ?? NPC_GEAR);
    if (def.prop) this.char.attach('handslot.r', assets.env(def.prop));
    ctx.scene.add(this.char.root);
    this.char.play(def.idle ?? 'Idle', { fade: 0 });
    if (!def.idle || def.idle === 'Idle' || def.idle.startsWith('Walking')) this.char.setPostPose(Character.relaxArms);
    const bd = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y + 0.9, this.pos.z);
    this.body = physics.world.createRigidBody(bd);
    const c = physics.world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.4).setCollisionGroups(groups(G.NPC, G.PLAYER | G.DYNAMIC)), this.body);
    physics.setOwner(c, { kind: 'npc' });
    ctx.interact.register({
      id: 'npc:' + def.id,
      pos: () => this.pos,
      radius: 3,
      verb: () => '대화',
      name: () => def.name,
      enabled: () => true,
      action: () => this.talk(),
      priority: 2,
    });
  }

  talk() {
    this.talking = true;
    ctx.save.set('met:' + this.def.id);
    ctx.ui.showDialog(this.def.talk(), () => (this.talking = false));
  }

  update(dt: number) {
    const pp = ctx.player.pos;
    const d = this.pos.distanceTo(pp);
    this.char.root.visible = d < 150;
    if (d > 150) return;
    let moving = false;
    if (this.talking || d < 4.5) {
      this.yaw = angleLerp(this.yaw, Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z), damp(6, dt));
    } else if (this.def.route && this.def.route.length > 1) {
      if (this.wait > 0) this.wait -= dt;
      else {
        const target = this.def.route[this.routeIdx];
        const to = target.clone().sub(this.pos).setY(0);
        if (to.length() < 0.5) {
          this.routeIdx = (this.routeIdx + 1) % this.def.route.length;
          this.wait = 2 + Math.random() * 4;
        } else {
          moving = true;
          const step = to.normalize().multiplyScalar(1.3 * dt);
          this.pos.add(step);
          this.pos.y = ctx.terrain.heightAt(this.pos.x, this.pos.z);
          this.yaw = angleLerp(this.yaw, Math.atan2(step.x, step.z), damp(6, dt));
        }
      }
    } else this.yaw = angleLerp(this.yaw, this.def.yaw, damp(2, dt));
    this.char.play(moving ? 'Walking_A' : this.def.idle ?? 'Idle', { speed: moving ? 0.9 : 1, fade: 0.3 });
    this.char.root.position.copy(this.pos);
    this.char.root.rotation.y = this.yaw;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + 0.9, z: this.pos.z });
    this.char.update(dt);
  }
}

export class NPCs {
  list: NPC[] = [];
  add(def: NPCDef) {
    const n = new NPC(def);
    this.list.push(n);
    return n;
  }
  get(id: string) {
    return this.list.find((n) => n.def.id === id);
  }
  update(dt: number) {
    for (const n of this.list) n.update(dt);
  }
}
