import * as THREE from 'three';
import { ctx } from './ctx';
import type { Game } from './Game';

/** Test/debug hooks: window.__game, plus URL parameters (?pos=x,z&time=12&yaw=0). */
export function installDebug(game: Game, params: URLSearchParams) {
  const api = {
    game,
    ctx,
    THREE,
    tp(x: number, z: number, yOffset = 0.3) {
      const y = ctx.terrain.heightAt(x, z) + yOffset;
      ctx.player.teleport(new THREE.Vector3(x, y, z));
    },
    time(h: number) {
      ctx.sky.time = h;
    },
    look(yaw: number, pitch = -0.2) {
      ctx.cam.yaw = yaw;
      ctx.cam.pitch = pitch;
    },
    /** Hold a key for ms milliseconds. */
    key(code: string, ms = 100) {
      ctx.input.simulate(code, true);
      return new Promise<void>((r) =>
        setTimeout(() => {
          ctx.input.simulate(code, false);
          r();
        }, ms),
      );
    },
    step(frames = 1, dt = 1 / 60) {
      for (let i = 0; i < frames; i++) {
        game.tick(dt);
        ctx.input.endFrame();
      }
      game.render();
    },
    /** Advance the simulation without rendering (fast logic tests). */
    sim(frames = 1, dt = 1 / 60) {
      for (let i = 0; i < frames; i++) {
        game.tick(dt);
        ctx.input.endFrame();
      }
    },
    fps: () => game.fps,
    /** Point the camera so its centre ray passes through a world point. */
    aimAt(x: number, y: number, z: number) {
      const cam = ctx.cam;
      for (let i = 0; i < 4; i++) {
        const from = ctx.camera.position;
        const d = new THREE.Vector3(x - from.x, y - from.y, z - from.z);
        cam.yaw = Math.atan2(d.x, d.z);
        cam.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        game.tick(0.0001);
      }
    },
    state() {
      const p = ctx.player;
      return {
        pos: p.pos.toArray().map((v) => +v.toFixed(2)),
        state: p.state,
        hp: p.hp,
        stamina: +p.stamina.toFixed(1),
        mana: +p.mana.toFixed(1),
        screen: ctx.ui.screen,
        mode: game.mode,
        burning: ctx.fire.count,
        enemies: ctx.enemies.list.filter((e) => e.alive && e.pos.distanceTo(p.pos) < 40).map((e) => `${e.kind}:${e.state}:${Math.round(e.hp)}`),
        flags: [...ctx.save.flags].slice(-12),
        interact: ctx.interact.current?.name(),
      };
    },
    wait: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    unlockAll() {
      for (const e of ['fire', 'ice', 'wind', 'lightning', 'kinesis'] as const) ctx.save.skills.add(e);
    },
  };
  (window as unknown as { __game: typeof api }).__game = api;

  const pos = params.get('pos');
  if (pos) {
    const [x, z] = pos.split(',').map(Number);
    api.tp(x, z);
  }
  const t = params.get('time');
  if (t) api.time(Number(t));
  const yaw = params.get('yaw');
  if (yaw) ctx.cam.yaw = Number(yaw);
  if (params.has('god')) ctx.player.godMode = true;
}
