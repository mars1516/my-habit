import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

/** Collision membership bits. */
export const G = {
  TERRAIN: 1 << 0,
  STATIC: 1 << 1,
  DYNAMIC: 1 << 2,
  PLAYER: 1 << 3,
  ENEMY: 1 << 4,
  ICE: 1 << 5,
  NPC: 1 << 6,
} as const;
export const ALL = 0xffff;

export function groups(member: number, filter: number) {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

export interface PhysicsOwner {
  kind: string;
  /** Surfaces that the player may climb. */
  climbable?: boolean;
  [k: string]: unknown;
}

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  collider: RAPIER.Collider;
  owner?: PhysicsOwner;
}

export class Physics {
  world!: RAPIER.World;
  owners = new Map<number, PhysicsOwner>();

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -24, z: 0 });
  }

  step(dt: number) {
    this.world.timestep = Math.min(Math.max(dt, 1 / 240), 1 / 30);
    this.world.step();
  }

  setOwner(c: RAPIER.Collider, owner: PhysicsOwner) {
    this.owners.set(c.handle, owner);
  }

  ownerOf(c: RAPIER.Collider) {
    return this.owners.get(c.handle);
  }

  removeCollider(c: RAPIER.Collider) {
    this.owners.delete(c.handle);
    this.world.removeCollider(c, true);
  }

  removeBody(b: RAPIER.RigidBody) {
    for (let i = 0; i < b.numColliders(); i++) this.owners.delete(b.collider(i).handle);
    this.world.removeRigidBody(b);
  }

  fixedCollider(desc: RAPIER.ColliderDesc, pos: THREE.Vector3, rot?: THREE.Quaternion, member: number = G.STATIC) {
    desc.setTranslation(pos.x, pos.y, pos.z);
    if (rot) desc.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    desc.setCollisionGroups(groups(member, ALL));
    return this.world.createCollider(desc);
  }

  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    filterMask = ALL,
    excludeBody?: RAPIER.RigidBody,
    solid = true,
  ): RayHit | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDist,
      solid,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(ALL, filterMask),
      undefined,
      excludeBody,
    );
    if (!hit) return null;
    const p = ray.pointAt(hit.timeOfImpact);
    return {
      point: new THREE.Vector3(p.x, p.y, p.z),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance: hit.timeOfImpact,
      collider: hit.collider,
      owner: this.owners.get(hit.collider.handle),
    };
  }

  /** Colliders whose shapes overlap a sphere. */
  overlapSphere(center: THREE.Vector3, radius: number, filterMask = ALL) {
    const out: RAPIER.Collider[] = [];
    const shape = new RAPIER.Ball(radius);
    this.world.intersectionsWithShape(
      center,
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      (c) => {
        out.push(c);
        return true;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(ALL, filterMask),
    );
    return out;
  }
}

export const physics = new Physics();
