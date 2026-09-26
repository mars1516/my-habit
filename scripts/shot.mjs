// Headless playtest helper.
// node scripts/shot.mjs "<query>" out.png [waitMs] [js] [js2 ...]  — each js step is evaluated then a shot is taken (out-N.png)
import { chromium } from 'playwright';
const [,, query = '', out = 'shot.png', waitMs = '4000', ...steps] = process.argv;
const url = `${process.env.BASE ?? 'http://localhost:5173/'}?${query}`;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForFunction(() => window.__game, null, { timeout: 180000 });
await page.waitForTimeout(Number(waitMs));
if (!steps.length) await page.screenshot({ path: out });
let i = 0;
for (const js of steps) {
  const r = await page.evaluate(`(async () => { ${js} })()`);
  if (r !== undefined) console.log(`eval[${i}]:`, JSON.stringify(r));
  await page.screenshot({ path: out.replace('.png', `-${i}.png`) });
  i++;
}
const skip = ['toNonIndexed', '[vite]', 'GPU stall', 'Automatic fallback'];
console.log(logs.filter((l) => !skip.some((s) => l.includes(s))).slice(-40).join('\n'));
console.log('fps', await page.evaluate(() => window.__game.fps()));
await browser.close();
