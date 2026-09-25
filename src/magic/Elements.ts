import * as THREE from 'three';

export type Element = 'fire' | 'ice' | 'wind' | 'lightning' | 'kinesis';
export type DamageElement = Element | 'physical';

export const ELEMENTS: Element[] = ['fire', 'ice', 'wind', 'lightning', 'kinesis'];

export const ELEMENT_INFO: Record<Element, { name: string; color: string; glow: string; icon: string; key: string }> = {
  fire: { name: '화염', color: '#ff7a2e', glow: '#ffb35c', icon: '🔥', key: '1' },
  ice: { name: '빙결', color: '#7fd8ff', glow: '#d4f4ff', icon: '❄️', key: '2' },
  wind: { name: '바람', color: '#7df0c0', glow: '#d8fff0', icon: '🌪️', key: '3' },
  lightning: { name: '번개', color: '#b58cff', glow: '#e6d8ff', icon: '⚡', key: '4' },
  kinesis: { name: '염동력', color: '#ff7ad9', glow: '#ffd0f2', icon: '✋', key: '5' },
};

export const elementColor = (e: DamageElement) => (e === 'physical' ? '#ffffff' : ELEMENT_INFO[e].color);

export interface ElementHit {
  element: DamageElement;
  pos: THREE.Vector3;
  /** Area radius; ~0.6 for single bolts. */
  radius: number;
  dir?: THREE.Vector3;
  /** Base damage. */
  damage: number;
  /** Push impulse strength (m/s). */
  push?: number;
  source: 'player' | 'enemy' | 'world';
  kind: 'bolt' | 'blast' | 'strike' | 'burst' | 'gust' | 'pillar' | 'throw' | 'melee' | 'tick' | 'aura';
  /** Direct target hint (enemy id) for bolts. */
  targetId?: number;
  /** Strength of the elemental application (burn chance, freeze stacks...). */
  potency?: number;
}

/** Elemental statuses an actor can carry. */
export interface StatusState {
  burning: number; // seconds left
  wet: number;
  chill: number; // stacks 0..3
  frozen: number;
  shocked: number;
}

export const newStatus = (): StatusState => ({ burning: 0, wet: 0, chill: 0, frozen: 0, shocked: 0 });

export interface ReactionResult {
  multiplier: number;
  name?: string;
  color?: string;
  /** Extra effects for the caller to perform. */
  overload?: boolean;
  swirl?: DamageElement;
  shatter?: boolean;
  chainWet?: boolean;
}

/** Applies an element to a status and returns the reaction (Genshin-style). */
export function react(status: StatusState, hit: ElementHit): ReactionResult {
  const e = hit.element;
  const r: ReactionResult = { multiplier: 1 };
  const potency = hit.potency ?? 1;
  switch (e) {
    case 'fire':
      if (status.frozen > 0) {
        status.frozen = 0;
        status.chill = 0;
        return { multiplier: 2, name: '융해', color: '#ffb36b' };
      }
      if (status.wet > 0) {
        status.wet = 0;
        return { multiplier: 1.5, name: '증발', color: '#ffd9a0' };
      }
      if (status.shocked > 0) {
        status.shocked = 0;
        status.burning = 3;
        return { multiplier: 1.3, name: '과부하', color: '#ff6a6a', overload: true };
      }
      if (status.chill > 0) status.chill = 0;
      status.burning = Math.max(status.burning, 3.5 * potency);
      return r;
    case 'ice':
      if (status.burning > 0) {
        status.burning = 0;
        return { multiplier: 1.5, name: '융해', color: '#b8f0ff' };
      }
      if (status.wet > 0) {
        status.wet = 0;
        status.frozen = 4;
        return { multiplier: 1, name: '빙결', color: '#9fe8ff' };
      }
      status.chill += potency;
      if (status.chill >= 3) {
        status.chill = 0;
        status.frozen = 3.5;
        return { multiplier: 1, name: '빙결', color: '#9fe8ff' };
      }
      return r;
    case 'lightning':
      if (status.frozen > 0) {
        status.frozen = 0;
        return { multiplier: 2.2, name: '초전도', color: '#d0b8ff', shatter: true };
      }
      if (status.wet > 0) {
        status.shocked = 2;
        return { multiplier: 2, name: '감전', color: '#c9a2ff', chainWet: true };
      }
      if (status.burning > 0) {
        status.burning = 0;
        return { multiplier: 1.6, name: '과부하', color: '#ff6a6a', overload: true };
      }
      status.shocked = Math.max(status.shocked, 1.2 * potency);
      return r;
    case 'wind': {
      const swirl: DamageElement | undefined =
        status.burning > 0 ? 'fire' : status.frozen > 0 || status.chill > 0 ? 'ice' : status.shocked > 0 ? 'lightning' : undefined;
      if (swirl) return { multiplier: 1.4, name: '확산', color: '#8ff5d0', swirl };
      return r;
    }
    case 'kinesis':
    case 'physical':
      if (status.frozen > 0 && (hit.kind === 'throw' || hit.kind === 'strike')) {
        status.frozen = 0;
        return { multiplier: 3, name: '파쇄', color: '#e8f8ff', shatter: true };
      }
      return r;
  }
  return r;
}
