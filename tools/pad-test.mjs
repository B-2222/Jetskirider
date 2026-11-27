// Drives the game with a simulated Xbox (standard-mapping) controller.
//   node tools/pad-test.mjs <outDir>
import { serve } from './shot.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const out = process.argv[2] || '.';
const srv = await serve();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(() => {
  const btn = () => Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  window.__pad = { axes: [0, 0, 0, 0], buttons: btn() };
  window.__rumble = [];
  const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    get axes() { return window.__pad.axes; }, get buttons() { return window.__pad.buttons; },
    vibrationActuator: { type: 'dual-rumble', playEffect(type, p) { window.__rumble.push({ type, ...p }); return Promise.resolve('complete'); } } };
  navigator.getGamepads = () => [pad, null, null, null];
  window.__set = (o) => { const P = window.__pad; P.buttons = btn(); if (o.axes) P.axes = o.axes.slice(); for (const [i, v] of Object.entries(o.b || {})) P.buttons[i] = { pressed: v > 0.5, touched: v > 0, value: v }; };
});
await page.goto(`http://localhost:${srv.address().port}/index.html?pr=1&tod=1&sea=1&ski=gti&nopick=1`);
await page.waitForFunction('window.game && window.game.frames > 0', null, { timeout: 120000 });
await page.evaluate(() => { const g = window.game; g.renderer.setAnimationLoop(null); g.fixedQuality = true; g.noRender = true; g.__now = performance.now();
  window.__adv = (s) => { const n = Math.round(s * 60); for (let i = 0; i < n; i++) { g.__now += 1000 / 60; g.frame(g.__now); } }; });
const tap = async (b, held = 0.08) => { await page.evaluate((b) => window.__set({ b: { [b]: 1 } }), b); await page.evaluate((s) => window.__adv(s), held); await page.evaluate(() => window.__set({})); await page.evaluate(() => window.__adv(0.1)); };
const st = () => page.evaluate(() => { const g = window.game; const T = g.phys.tele; return { state: g.state, kmh: Math.round(T.speed * 3.6), steer: +g.phys.ctrl.steer.toFixed(2), lean: g.phys.ctrl.lean, trim: +g.phys.trim.toFixed(2), cam: g.camMode, look: g.input.padLook, focus: g.padFocusEl ? (g.padFocusEl.id || g.padFocusEl.textContent.trim().slice(0, 16)) : null, pad: g.input.usingGamepad, ski: g.spec.id, help: !document.getElementById('help').hidden, leanIn: +g.phys.leanIn.toFixed(2), roll: Math.round(T.roll * 57.3) }; });
// garage: any input wakes the pad UI; D-pad moves the highlight; RB changes ski
await page.evaluate(() => window.__set({ axes: [0.2, 0, 0, 0] })); await page.evaluate(() => window.__adv(0.1)); await page.evaluate(() => window.__set({}));
console.log('garage, pad woke:', JSON.stringify(await st()));
await tap(5); console.log('RB next ski:', (await st()).ski);
await tap(4); console.log('LB prev ski:', (await st()).ski);
await tap(12); console.log('D-pad up ->', (await st()).focus);
await tap(12); console.log('D-pad up ->', (await st()).focus);
await tap(15); console.log('D-pad right ->', (await st()).focus);
await page.evaluate(() => { document.getElementById('loading').style.display = 'none'; window.game.noRender = false; window.__adv(0.02); window.game.noRender = true; });
await page.screenshot({ path: out + '/pad-garage.png' });
await tap(3); console.log('Y opens controls:', (await st()).help);
await tap(1); console.log('B closes them:', (await st()).help);
await tap(9); console.log('MENU rides:', (await st()).state);
// riding: RT gas, LS steer
await page.evaluate(() => window.__set({ b: { 7: 1 } })); await page.evaluate(() => window.__adv(4));
console.log('RT 4 s:', JSON.stringify(await st()));
await page.evaluate(() => window.__set({ b: { 7: 0.5 }, axes: [0.6, 0, 0, 0] })); await page.evaluate(() => window.__adv(1));
console.log('half RT + LS 0.6 right:', JSON.stringify(await st()));
await page.evaluate(() => window.__set({ b: { 7: 1, 0: 1 }, axes: [1, 0, 0, 0] })); await page.evaluate(() => window.__adv(1.2));
console.log('RT + A (slide) + full lock:', JSON.stringify(await st()));
await page.evaluate(() => window.__set({ b: { 7: 1 }, axes: [0, -0.9, 0, 0] })); await page.evaluate(() => window.__adv(0.3));
console.log('LS pushed up (lean nudge, must not slide):', JSON.stringify(await st()));
await page.evaluate(() => window.__set({ b: { 7: 1, 5: 1 } })); await page.evaluate(() => window.__adv(0.6));
console.log('RB trims up:', (await st()).trim);
await page.evaluate(() => window.__set({ b: { 7: 1, 2: 1 } })); await page.evaluate(() => window.__adv(0.1));
console.log('X held looks back:', (await st()).look);
await page.evaluate(() => window.__set({})); await page.evaluate(() => window.__adv(0.1));
await tap(3); console.log('Y camera:', (await st()).cam);
await tap(11); console.log('RS click first person:', (await st()).cam);
await page.evaluate(() => { window.__rumble.length = 0; window.game.effects.impactFlag = 0; });
await page.evaluate(() => window.__set({ b: { 7: 1 } })); await page.evaluate(() => window.__adv(0.5));
const r = await page.evaluate(() => window.__rumble.slice(-3));
console.log('rumble while riding:', JSON.stringify(r));
await tap(9); console.log('MENU opens garage:', (await st()).state);
await browser.close();
srv.close();
