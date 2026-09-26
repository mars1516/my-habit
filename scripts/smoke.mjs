// Smoke test: charging, surges, glide/climb, combat, fire spread bound. Prints results + errors.
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
p.on('console', (m) => { if (['error','warning'].includes(m.type()) && !/GPU stall|toNonIndexed|Automatic fallback/.test(m.text())) logs.push(m.text()); });
p.on('pageerror', (e) => logs.push('ERR ' + e.message + '\n' + e.stack));
await p.goto(`${process.env.BASE ?? 'http://127.0.0.1:5173/'}?start=new&skipintro&quality=low`);
await p.waitForFunction(() => window.__game && window.__game.ctx.ui, null, { timeout: 180000 });
await p.waitForTimeout(2000);
const res = await p.evaluate(async () => {
  const g = window.__game, c = g.ctx, out = {};
  const I = c.input;
  g.unlockAll(); c.player.hearts = 30; c.player.hp = 120;
  // --- E charging: fire, 3 stages
  c.save.selected = 'fire';
  c.player.mana = 100;
  I.simulate('KeyE', true); g.sim(5);
  out.chargeStart = c.skills.charge?.level;
  g.sim(70); out.charge2 = c.skills.charge?.level;
  g.sim(70); out.charge3 = c.skills.charge?.level;
  I.simulate('KeyE', false); g.sim(3);
  out.afterRelease = { charge: !!c.skills.charge, mana: Math.round(c.player.mana), cd: +c.skills.cooldown('fire').skill.toFixed(1) };
  g.sim(200);
  // --- each element charged once
  for (const el of ['ice', 'wind', 'lightning', 'kinesis']) {
    c.save.selected = el; c.player.mana = 100; c.player.state === 'ground' || g.sim(200);
    I.simulate('KeyE', true); g.sim(130); const lv = c.skills.charge?.level; I.simulate('KeyE', false); g.sim(90);
    out['charge_' + el] = { lv, state: c.player.state };
    g.sim(300);
  }
  // --- sprint lock
  g.tp(40, 200); g.sim(30);
  c.save.selected = 'fire';
  I.simulate('KeyW', true); I.simulate('ShiftLeft', true); g.sim(2); I.simulate('ShiftLeft', false); g.sim(60);
  out.sprintLock = { lock: c.player.sprintLock, speed: +Math.hypot(c.player.vel.x, c.player.vel.z).toFixed(1), stamina: Math.round(c.player.stamina) };
  I.simulate('KeyW', false); g.sim(30);
  out.sprintReleased = c.player.sprintLock;
  // --- surges
  for (const el of ['fire', 'ice', 'wind', 'lightning', 'kinesis']) {
    g.tp(40 + Math.random() * 20, 200); g.sim(20);
    c.save.selected = el; c.player.stamina = c.player.maxStamina; c.player.exhausted = false;
    I.simulate('KeyW', true); I.simulate('ShiftLeft', true); g.sim(170); const s1 = c.player.surge.active; g.sim(30);
    out['surge_' + el] = { before3s: s1, active: c.player.surge.active, speed: +Math.hypot(c.player.vel.x, c.player.vel.z).toFixed(1), slowmo: +c.slowmo.toFixed(2), burning: c.player.status.burning > 0 };
    I.simulate('ShiftLeft', false); g.sim(10);
    out['surge_' + el].after = c.player.surge.active;
    I.simulate('KeyW', false); g.sim(30);
  }
  // --- fire spread bound: ignite a meadow and let it burn out
  g.tp(-120, 60); g.sim(10);
  const fp = c.player.pos.clone().add(new g.THREE.Vector3(8, 0, 0));
  c.fire.igniteCircle(fp.x, fp.z, 1.5);
  let maxBurn = 0; const cells = new Set();
  for (let i = 0; i < 60 * 40; i++) { g.sim(1); maxBurn = Math.max(maxBurn, c.fire.count); if (i % 30 === 0) for (const k of c.fire.burning.keys()) cells.add(k); }
  let maxD = 0; for (const k of cells) { const cc = c.terrain.cellCenter(k, new g.THREE.Vector3()); maxD = Math.max(maxD, Math.hypot(cc.x - fp.x, cc.z - fp.z)); }
  out.fire = { maxBurning: maxBurn, cellsTouched: cells.size, maxSpreadM: Math.round(maxD), stillBurning: c.fire.count };
  // --- glide + climb poses
  g.tp(60, 150); g.sim(10);
  out.fps = g.fps();
  return out;
});
console.log(JSON.stringify(res, null, 1));
console.log(logs.slice(0, 15).join('\n'));
await b.close();
