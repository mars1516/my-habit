import * as THREE from 'three';
import { ctx } from './ctx';
import { SaveState, type SaveData } from './Save';
import { ELEMENTS } from '../magic/Elements';

export function gatherSave(): SaveData {
  const p = ctx.player;
  const s = ctx.save;
  const safe = p.state === 'ground' ? p.pos : p.lastSafe;
  return {
    version: 1,
    pos: [safe.x, safe.y + 0.3, safe.z],
    yaw: ctx.cam.yaw,
    hearts: p.hearts,
    hp: Math.max(4, p.hp),
    maxStamina: p.maxStamina,
    maxMana: p.maxMana,
    skills: [...s.skills],
    selected: s.selected,
    inventory: { ...s.inventory },
    flags: [...s.flags],
    counters: { ...s.counters },
    time: ctx.sky.time,
    fog: ctx.ui.map.fogToString(),
    quests: { ...s.quests },
    playTime: s.playTime,
    freeMode: s.freeMode,
    respawn: ctx.ui.respawn.toArray() as [number, number, number],
  } as SaveData & { respawn: [number, number, number] };
}

export function writeSave() {
  return SaveState.write(gatherSave());
}

/** Apply progression before the world content is built (flags decide chest/door states). */
export function applySaveEarly(d: SaveData | null, freeMode: boolean) {
  const s = ctx.save;
  if (d) {
    s.skills = new Set(d.skills);
    s.selected = d.selected;
    s.inventory = { ...d.inventory };
    s.flags = new Set(d.flags);
    s.counters = { ...d.counters };
    s.quests = { ...d.quests };
    s.playTime = d.playTime;
    s.freeMode = d.freeMode;
  } else {
    s.freeMode = freeMode;
    if (freeMode) {
      for (const e of ELEMENTS) s.skills.add(e);
    }
  }
}

/** Apply player state once the player exists. */
export function applySaveLate(d: SaveData | null) {
  if (!d) return;
  const p = ctx.player;
  p.hearts = d.hearts;
  p.hp = Math.min(d.hp, d.hearts * 4);
  p.maxStamina = d.maxStamina;
  p.stamina = d.maxStamina;
  p.maxMana = d.maxMana;
  p.mana = d.maxMana;
  ctx.sky.time = d.time;
  if (d.fog) ctx.ui.map.fogFromString(d.fog);
  const r = (d as SaveData & { respawn?: [number, number, number] }).respawn;
  if (r) ctx.ui.respawn.fromArray(r);
  const pos = new THREE.Vector3(...d.pos);
  pos.y = Math.max(pos.y, ctx.terrain.heightAt(pos.x, pos.z) + 0.2);
  p.teleport(pos);
  ctx.cam.yaw = d.yaw;
}
