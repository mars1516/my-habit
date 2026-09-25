import type * as THREE from 'three';
import type { Element } from '../magic/Elements';

export interface EventMap {
  toast: { text: string; sub?: string; kind?: 'info' | 'good' | 'warn' };
  banner: { title: string; sub?: string; color?: string };
  region: { name: string; sub?: string };
  pickup: { id: string; name: string; count: number; icon: string };
  damageNumber: { pos: THREE.Vector3; amount: number; color: string; big?: boolean };
  reaction: { pos: THREE.Vector3; name: string; color: string };
  enemyKilled: { kind: string; pos: THREE.Vector3; campId?: string };
  flag: { flag: string };
  skillUnlocked: { element: Element };
  playerHurt: { amount: number };
  playerDied: {};
  interact: { id: string };
  questUpdate: {};
  objectBurned: { kind: string; id?: string; pos: THREE.Vector3 };
  sound: { name: string; pos?: THREE.Vector3; volume?: number };
  talk: { npc: string };
  bossDefeated: {};
}

type Handler<T> = (payload: T) => void;

export class Events {
  private handlers = new Map<keyof EventMap, Set<Handler<any>>>();

  on<K extends keyof EventMap>(name: K, fn: Handler<EventMap[K]>) {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof EventMap>(name: K, payload: EventMap[K]) {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }
}

export const events = new Events();
