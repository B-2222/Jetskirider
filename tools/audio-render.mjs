// node tools/audio-render.mjs <outDir> [skiId...]  -> WAV files of a scripted ride
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './shot.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const [outDir, ...ids] = process.argv.slice(2);
const srv = await serve();
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${srv.address().port}/tools/audio-render.html`);
await page.waitForFunction('window.ready');
for (const id of ids.length ? ids : ['trixx']) {
  const r = await page.evaluate((id) => window.render(id), id);
  const pcm = Buffer.from(r.b64, 'base64');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(r.sr, 24);
  h.writeUInt32LE(r.sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  const f = path.join(outDir, `engine-${id}.wav`);
  fs.writeFileSync(f, Buffer.concat([h, pcm]));
  console.log(id, 'peak', r.peak.toFixed(3), 'nan', r.nan, '->', f);
}
await browser.close();
srv.close();
