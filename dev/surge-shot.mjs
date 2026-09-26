// node scripts/_surge.mjs <element> out-prefix
import { chromium } from 'playwright';
const [,, el = 'fire', out = 'surge'] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
const logs = [];
p.on('console', (m) => { if (['error','warning'].includes(m.type()) && !m.text().includes('GPU stall')) logs.push(m.text()); });
p.on('pageerror', (e) => logs.push('ERR ' + e.message));
await p.goto(`http://127.0.0.1:5173/?start=free&skipintro&quality=medium&pos=40,200`);
await p.waitForFunction(() => window.__game && window.__game.ctx.ui, null, { timeout: 180000 });
await p.waitForTimeout(3000);
const r = await p.evaluate(async (el) => {
  const g = window.__game, c = g.ctx;
  g.unlockAll(); c.save.selected = el; c.player.godMode = false;
  c.player.maxStamina = 200; c.player.stamina = 200;
  g.time(10);
  g.look(0, -0.2);
  c.input.simulate('KeyW', true);
  c.input.simulate('ShiftLeft', true);
  g.sim(200);
  const st = { state: c.player.state, surge: c.player.surge.active, speed: Math.hypot(c.player.vel.x, c.player.vel.z).toFixed(1), stamina: c.player.stamina.toFixed(0) };
  g.step(8);
  // front-side view of the player
  c.cam.yaw = c.player.yaw + Math.PI * 0.75; c.cam.pitch = -0.1; c.cam.distance = 4;
  g.step(1);
  return st;
}, el);
await p.screenshot({ path: `${out}-a.png` });
const r2 = await p.evaluate(() => { const g = window.__game; g.step(10); return 1; });
await p.screenshot({ path: `${out}-b.png` });
console.log(el, JSON.stringify(r), logs.slice(0, 8).join('\n'));
await b.close();
