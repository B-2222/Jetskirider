// Dev helper: drive the game deterministically in headless Chromium.
//   node tools/play.mjs '<json script>'
// script: { url, size:[w,h], steps:[ {keys:["KeyW"], secs:2}, {shot:"out.png"}, {eval:"..."} ] }
import { serve } from './shot.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const script = JSON.parse(process.argv[2]);
const srv = await serve();
const port = srv.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const [w, h] = script.size || [960, 540];
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text().slice(0, 1200)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${port}${script.url || '/index.html?pr=1'}`);
await page.waitForFunction('window.game && window.game.frames > 0', null, { timeout: 120000 });
await page.evaluate(() => { const g = window.game; g.renderer.setAnimationLoop(null); g.fixedQuality = true; g.__now = performance.now(); g.noRender = true;
  window.__adv = (secs, fps = 60) => { const n = Math.round(secs * fps); for (let i = 0; i < n; i++) { g.__now += 1000 / fps; g.frame(g.__now); } };
  window.__keys = (list) => { g.input.keys.clear(); for (const k of list) { g.input.keys.add(k); g.input.pressed.add(k); } };
  window.__tele = () => { const p = g.phys, T = p.tele; const d = (r) => +(r * 57.3).toFixed(1); return { t: +p.time.toFixed(2), kmh: +(T.speed * 3.6).toFixed(0), u: +T.u.toFixed(1), v: +T.v.toFixed(1), pitch: d(T.pitch), roll: d(T.roll), slip: d(T.slip), yaw: d(p.yaw), y: +p.py.toFixed(2), wet: +T.wet.toFixed(2), noz: +T.nozzleDepth.toFixed(2), exp: +T.exposure.toFixed(2), load: +T.pumpLoad.toFixed(2), trim: +p.trim.toFixed(2), parts: g.spray.count, score: g.tricks.score, live: g.tricks.live, state: g.state, x: +p.px.toFixed(0), z: +p.pz.toFixed(0) }; };
});
for (const st of script.steps) {
  if (st.click) await page.click(st.click);
  if (st.eval) { const r = await page.evaluate(st.eval); if (r !== undefined) console.log('eval:', JSON.stringify(r)); }
  if (st.keys) await page.evaluate((k) => window.__keys(k), st.keys);
  if (st.secs) {
    const chunks = Math.max(1, Math.round(st.secs / (st.every || st.secs)));
    for (let i = 0; i < chunks; i++) {
      await page.evaluate((s) => window.__adv(s), st.secs / chunks);
      if (st.log || st.every) console.log(JSON.stringify(await page.evaluate(() => window.__tele())));
    }
  }
  if (st.shot) {
    await page.evaluate(() => { const g = window.game; g.noRender = false; g.__now += 1000 / 60; g.frame(g.__now); g.noRender = true; });
    await page.screenshot({ path: st.shot });
    console.log('shot', st.shot);
  }
}
await browser.close();
srv.close();
