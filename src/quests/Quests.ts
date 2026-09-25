import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { events } from '../core/Events';
import { poi, P } from '../world/WorldGen';
import type { Element } from '../magic/Elements';

export interface QuestStep {
  text: () => string;
  marker?: () => THREE.Vector3 | THREE.Vector3[] | null;
  done: () => boolean;
}

export interface QuestDef {
  id: string;
  title: string;
  main?: boolean;
  steps: QuestStep[];
  onComplete?: () => void;
}

const v = (x: number, z: number) => new THREE.Vector3(x, ctx.terrain.heightAt(x, z), z);

export const SHRINES: { id: string; element: Element }[] = [
  { id: 'shrine_wind', element: 'wind' },
  { id: 'shrine_ice', element: 'ice' },
  { id: 'shrine_kinesis', element: 'kinesis' },
  { id: 'shrine_lightning', element: 'lightning' },
];

export const beaconsLit = () => SHRINES.filter((s) => ctx.save.has('beacon:' + s.element)).length;

export const QUESTS: QuestDef[] = [
  {
    id: 'main',
    title: '잠든 원소의 봉화',
    main: true,
    steps: [
      {
        text: () => '사원 봉인문 앞의 화로 두 개에 불을 붙이자 (좌클릭: 화염탄)',
        marker: () => v(P.temple.x, P.temple.z - 12),
        done: () => ctx.save.has('sig:temple_gate'),
      },
      {
        text: () => '고원을 내려가 동쪽의 바람골 마을로 가자',
        marker: () => v(P.village.x, P.village.z),
        done: () => ctx.player.pos.distanceTo(v(P.village.x, P.village.z)) < 55 || ctx.save.has('talk:elder'),
      },
      {
        text: () => '마을 촌장 엘다와 이야기하자',
        marker: () => ctx.npcs.get('elder')?.pos.clone() ?? null,
        done: () => ctx.save.has('talk:elder'),
      },
      {
        text: () => `원소의 사당 네 곳을 찾아 봉화를 밝히자 (${beaconsLit()}/4)`,
        marker: () => SHRINES.filter((s) => !ctx.save.has('beacon:' + s.element)).map((s) => v(poi(s.id).x, poi(s.id).z)),
        done: () => beaconsLit() >= 4,
      },
      {
        text: () => '모든 봉화가 밝혀졌다. 섬 중앙의 원소의 제단으로 가자',
        marker: () => v(P.altar.x, P.altar.z),
        done: () => ctx.save.has('boss:started'),
      },
      {
        text: () => '해골 군주를 쓰러뜨리자!',
        marker: () => v(P.altar.x, P.altar.z),
        done: () => ctx.save.has('boss:defeated'),
      },
    ],
    onComplete: () => ctx.ui.showEnding(),
  },
  {
    id: 'farmer',
    title: '농부 브란의 부탁',
    steps: [
      {
        text: () => `밭 옆의 마른 덤불을 태우자 (${Math.min(9, ctx.save.counters['drybush'] ?? 0)}/9)`,
        marker: () => v(P.village.x + 58, P.village.z + 30),
        done: () => (ctx.save.counters['drybush'] ?? 0) >= 9,
      },
      {
        text: () => '농부 브란에게 알리자',
        marker: () => ctx.npcs.get('farmer')?.pos.clone() ?? null,
        done: () => ctx.save.has('done:farmer'),
      },
    ],
  },
  {
    id: 'doll',
    title: '미로의 잃어버린 인형',
    steps: [
      {
        text: () => '숲의 해골 야영지 근처에서 인형을 찾자',
        marker: () => v(poi('camp_forest').x, poi('camp_forest').z),
        done: () => ctx.save.count('doll') > 0 || ctx.save.has('done:doll'),
      },
      {
        text: () => '미로에게 인형을 돌려주자',
        marker: () => ctx.npcs.get('child')?.pos.clone() ?? null,
        done: () => ctx.save.has('done:doll'),
      },
    ],
  },
  {
    id: 'smith',
    title: '대장장이의 연구',
    steps: [
      {
        text: () => `해골 뼈를 모으자 (${Math.min(6, ctx.save.count('bone'))}/6)`,
        done: () => ctx.save.count('bone') >= 6 || ctx.save.has('done:smith'),
      },
      {
        text: () => '대장장이 고르에게 뼈를 가져가자',
        marker: () => ctx.npcs.get('smith')?.pos.clone() ?? null,
        done: () => ctx.save.has('done:smith'),
      },
    ],
  },
];

export class Quests {
  private t = 0;
  tracked = 'main';

  constructor() {
    events.on('objectBurned', (e) => {
      if (e.kind === 'drybush' && this.step('farmer') === 0) ctx.save.inc('drybush');
    });
  }

  def(id: string) {
    return QUESTS.find((q) => q.id === id)!;
  }

  /** -1 = not started, steps.length = complete. */
  step(id: string) {
    return ctx.save.quests[id] ?? -1;
  }

  active(id: string) {
    const s = this.step(id);
    return s >= 0 && s < this.def(id).steps.length;
  }

  complete(id: string) {
    return this.step(id) >= this.def(id).steps.length;
  }

  start(id: string) {
    if (this.step(id) >= 0) return;
    ctx.save.quests[id] = 0;
    const q = this.def(id);
    events.emit('banner', { title: q.title, sub: '새로운 의뢰', color: q.main ? '#ffd780' : '#9fe8c8' });
    events.emit('sound', { name: 'quest', volume: 0.7 });
    if (!q.main) this.tracked = id;
    events.emit('questUpdate', {});
    this.evaluate();
  }

  current(id: string) {
    const q = this.def(id);
    const s = this.step(id);
    return s >= 0 && s < q.steps.length ? q.steps[s] : null;
  }

  markers(): { pos: THREE.Vector3; main: boolean }[] {
    const out: { pos: THREE.Vector3; main: boolean }[] = [];
    for (const q of QUESTS) {
      const st = this.current(q.id);
      if (!st?.marker) continue;
      const m = st.marker();
      if (!m) continue;
      for (const p of Array.isArray(m) ? m : [m]) out.push({ pos: p, main: !!q.main });
    }
    return out;
  }

  evaluate() {
    for (const q of QUESTS) {
      let s = this.step(q.id);
      if (s < 0 || s >= q.steps.length) continue;
      let changed = false;
      while (s < q.steps.length && q.steps[s].done()) {
        s++;
        changed = true;
      }
      if (!changed) continue;
      ctx.save.quests[q.id] = s;
      events.emit('questUpdate', {});
      if (s >= q.steps.length) {
        events.emit('banner', { title: q.title, sub: '의뢰 완료', color: '#ffd780' });
        events.emit('sound', { name: 'fanfare', volume: 0.8 });
        if (this.tracked === q.id) this.tracked = 'main';
        q.onComplete?.();
      } else {
        events.emit('toast', { text: q.steps[s].text(), sub: q.title, kind: 'good' });
        events.emit('sound', { name: 'quest', volume: 0.5 });
      }
    }
  }

  update(dt: number) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.4;
    this.evaluate();
  }
}
