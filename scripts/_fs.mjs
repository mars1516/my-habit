import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://127.0.0.1:5173/dev/charview.html?chars=mage&anims=Idle');
await p.waitForFunction(() => window.__ready, null, { timeout: 120000 });
for (const a of process.argv.slice(2)) console.log(JSON.stringify(await p.evaluate((a) => window.__footSpeed(a), a)));
await b.close();
