import type { Element } from '../magic/Elements';
import { events } from './Events';

const KEY = 'etheria-save-v1';

export interface SaveData {
  version: 1;
  pos: [number, number, number];
  yaw: number;
  hearts: number;
  hp: number;
  maxStamina: number;
  maxMana: number;
  skills: Element[];
  selected: Element;
  inventory: Record<string, number>;
  flags: string[];
  counters: Record<string, number>;
  time: number;
  fog: string;
  quests: Record<string, number>;
  playTime: number;
  freeMode: boolean;
}

/** Runtime progression state (serialised to localStorage). */
export class SaveState {
  skills = new Set<Element>(['fire']);
  selected: Element = 'fire';
  inventory: Record<string, number> = {};
  flags = new Set<string>();
  counters: Record<string, number> = {};
  quests: Record<string, number> = {};
  playTime = 0;
  freeMode = false;

  has(flag: string) {
    return this.flags.has(flag);
  }

  set(flag: string) {
    if (this.flags.has(flag)) return false;
    this.flags.add(flag);
    events.emit('flag', { flag });
    return true;
  }

  count(item: string) {
    return this.inventory[item] ?? 0;
  }

  add(item: string, n = 1) {
    this.inventory[item] = (this.inventory[item] ?? 0) + n;
    if (this.inventory[item] <= 0) delete this.inventory[item];
  }

  take(item: string, n = 1) {
    if (this.count(item) < n) return false;
    this.add(item, -n);
    return true;
  }

  inc(counter: string, n = 1) {
    this.counters[counter] = (this.counters[counter] ?? 0) + n;
    return this.counters[counter];
  }

  static exists() {
    try {
      return !!localStorage.getItem(KEY);
    } catch {
      return false;
    }
  }

  static load(): SaveData | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw) as SaveData;
      return d.version === 1 ? d : null;
    } catch {
      return null;
    }
  }

  static write(d: SaveData) {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
      return true;
    } catch {
      return false;
    }
  }

  static clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
