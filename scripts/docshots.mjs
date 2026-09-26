// Captures README screenshots into docs/ (run with the dev server on :5173).
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5173/?quality=medium&start=free&skipintro');
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.waitForTimeout(3000);
const shots = {
  village: `const g=__game,c=g.ctx; g.tp(270,158); g.time(9.5); g.step(10); g.aimAt(300,c.terrain.heightAt(300,122)+4,122); g.step(160);`,
  fire: `const g=__game,c=g.ctx; g.tp(90,70); g.time(16); g.look(Math.PI/4,-0.2); g.step(30); g.aimAt(108,c.terrain.heightAt(108,86),86); c.input.simulate('Digit1',true); g.step(1); c.input.simulate('Digit1',false); c.input.simulate('KeyE',true); g.step(1); c.input.simulate('KeyE',false); g.step(330); g.look(Math.PI/4+0.3,-0.3); g.step(5);`,
  frost: `const g=__game,c=g.ctx; g.tp(-250,-27); g.time(11); g.look(Math.PI,-0.18); g.step(20); const press=(k)=>{c.input.simulate(k,true); g.step(1); c.input.simulate(k,false);}; press('Digit2'); for (const dz of [10,14,18,22]) { g.aimAt(-250+(dz%8)-3, 8, -40-dz); press('Mouse0'); g.step(20); } g.aimAt(-244,8,-66); press('KeyE'); g.step(40); c.cam.pitch=-0.12; c.cam.targetDistance=7; g.step(40);`,
  glide: `const g=__game,c=g.ctx; const press=(k)=>{c.input.simulate(k,true); g.step(1); c.input.simulate(k,false);}; g.tp(20,340); g.time(17.2); g.look(0,-0.1); g.step(30); c.input.simulate('KeyW',true); g.step(40); press('Space'); g.step(20); press('Space'); g.step(60); c.input.simulate('KeyW',false); c.cam.yaw=Math.PI-0.5; c.cam.pitch=-0.15; g.step(20);`,
  surge_ice: `const g=__game,c=g.ctx; g.unlockAll(); g.tp(-120,60); g.time(10.5); c.save.selected='ice'; c.player.stamina=c.player.maxStamina; g.look(1.2,-0.15); g.step(10); c.input.simulate('KeyW',true); c.input.simulate('ShiftLeft',true); g.sim(190); g.step(25); c.cam.yaw=c.player.yaw+2.5; c.cam.pitch=-0.25; c.cam.distance=5; g.step(3); c.input.simulate('ShiftLeft',false); c.input.simulate('KeyW',false);`,
  sandevistan: `const g=__game,c=g.ctx; g.unlockAll(); g.tp(40,200); g.time(15); c.save.selected='kinesis'; c.player.stamina=c.player.maxStamina; g.look(0,-0.15); g.step(10); c.input.simulate('KeyW',true); c.input.simulate('ShiftLeft',true); g.sim(190); g.step(20); c.cam.yaw=c.player.yaw+2.2; c.cam.pitch=-0.12; c.cam.distance=5; g.step(3); c.input.simulate('ShiftLeft',false); c.input.simulate('KeyW',false);`,
  windblast: `const g=__game,c=g.ctx; g.unlockAll(); g.tp(165,-20); g.time(10); c.save.selected='wind'; g.look(Math.PI,-0.12); g.step(10); c.input.simulate('KeyE',true); g.sim(130); c.input.simulate('KeyE',false); g.sim(16); g.step(2);`,
  fireball: `const g=__game,c=g.ctx; g.unlockAll(); g.sim(300); g.tp(60,150); g.time(15.5); c.save.selected='fire'; g.look(-2.4,-0.1); g.step(10); c.input.simulate('KeyE',true); g.sim(130); c.input.simulate('KeyE',false); g.sim(52); g.step(2);`,
};
for (const [name, js] of Object.entries(shots)) {
  await page.evaluate(`(async()=>{ ${js} })()`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `docs/${name}.jpg`, type: 'jpeg', quality: 82, timeout: 120000 });
  console.log('saved', name);
}
await browser.close();
