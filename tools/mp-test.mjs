// Two players in one browser, over the local stand-in room (?mpfake=1) or the
// Firebase emulator (?fbemu=9000: start it first with
// `firebase emulators:start --only database --project demo-jetski`).
//   node tools/mp-test.mjs <outDir> [fake|fbemu]
import { serve } from './shot.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const out = process.argv[2] || '.';
const srv = await serve();
const mode = process.argv[3] || 'fake';
const url = `http://localhost:${srv.address().port}/index.html?pr=1&${mode === 'fbemu' ? 'fbemu=9000' : 'mpfake=1'}&tod=1&sea=1`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const open = async (name, ski) => {
  const pg = await ctx.newPage();
  pg.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
  pg.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}]`, m.text().slice(0, 300)); });
  await pg.goto(url + '&ski=' + ski);
  await pg.waitForFunction('window.game && window.game.frames > 0 && window.game.mp.status === "ready"', null, { timeout: 120000 });
  await pg.evaluate((n) => { const g = window.game; g.renderer.setAnimationLoop(null); g.fixedQuality = true; g.noRender = true; g.__now = performance.now();
    window.__adv = (secs) => { const k = Math.round(secs * 30); for (let i = 0; i < k; i++) { g.__now += 1000 / 30; g.frame(g.__now); } };
    window.__keys = (l) => { g.input.keys.clear(); for (const c of l) { g.input.keys.add(c); g.input.pressed.add(c); } };
    g.mp.setNick(n); }, name);
  return pg;
};
const A = await open('Alex', 'rxp');
const B = await open('Bo', 'trixx');
await A.evaluate(() => window.game.toggleLobby('lobby-1'));
await B.evaluate(() => window.game.toggleLobby('lobby-1'));
for (const pg of [A, B]) await pg.evaluate(() => { document.getElementById('btnRide').click(); });
// run both "in parallel": alternate small chunks so presence flows both ways
const step = async (secs, keysA, keysB) => {
  await A.evaluate((k) => window.__keys(k), keysA);
  await B.evaluate((k) => window.__keys(k), keysB);
  for (let i = 0; i < secs * 10; i++) { await A.evaluate(() => window.__adv(0.1)); await B.evaluate(() => window.__adv(0.1)); }
};
// wait (real time) until B can see A, however long the connection takes
for (let i = 0; i < 40; i++) {
  await step(0.3, [], []);
  if (await B.evaluate(() => window.game.mp.remotes.size > 0)) break;
}
await step(2, [], []);
await step(4, ['KeyW'], ['KeyW', 'KeyD']);
const info = async (pg) => pg.evaluate(() => { const g = window.game; const r = [...g.mp.remotes.values()][0];
  return { me: [g.phys.px | 0, g.phys.pz | 0], remotes: g.mp.remotes.size, remote: r ? { name: r.name, pos: [r.pos.x | 0, r.pos.z | 0], ski: r.skiId, visible: r.group.visible } : null,
    board: [...document.querySelectorAll('#mpBoard li')].map((l) => l.textContent), title: document.getElementById('mpTitle').textContent,
    counts: g.mp.counts(), clock: { host: g.mp.isHost, offset: Math.round(g.mp.clockOffset) }, lobbyBtn: document.getElementById('mpL1').textContent }; });
console.log('A', JSON.stringify(await info(A)));
console.log('B', JSON.stringify(await info(B)));
// B sees A: put B's camera behind A and screenshot
await B.evaluate(() => { const g = window.game; const r = [...g.mp.remotes.values()][0]; g.noRender = false;
  const V = g._v.constructor; g.updateCamera = function () { const c = this.camera; c.position.set(r.pos.x - 9, r.pos.y + 3.2, r.pos.z + 6); c.up.set(0, 1, 0); c.lookAt(new V(r.pos.x, r.pos.y + 0.8, r.pos.z)); c.fov = 55; c.updateProjectionMatrix(); };
  g.__now += 33; g.frame(g.__now);
  window.__tag = { hidden: r.tag.hidden, tf: r.tag.style.transform, txt: r.tag.textContent, parent: r.tag.parentElement && r.tag.parentElement.id, root: !!g.mp.tagRoot, rect: JSON.stringify(r.tag.getBoundingClientRect()) }; });
await B.screenshot({ path: out + '/mp-b-sees-a.png' });
console.log('tag', JSON.stringify(await B.evaluate(() => window.__tag)));
// the screenshot is slow here; let A be heard again before going on
for (let i = 0; i < 40; i++) { await step(0.3, ['KeyW'], ['KeyW']); if (await B.evaluate(() => window.game.mp.remotes.size > 0)) break; }
// a trick from A shows in B's feed
await A.evaluate(() => window.game.tricks.award('BIG AIR', 500));
await step(0.5, ['KeyW'], ['KeyW']);
console.log('B feed', JSON.stringify(await B.evaluate(() => [...document.querySelectorAll('#mpFeed .feed-line')].map((e) => e.textContent))));
// Smoothness: feed B's remote for A a scripted stream (12 updates a second,
// 40-100 ms of network delay so some arrive bunched) and sample it at an exact
// 60 fps. Smooth motion moves the same small step every frame; a broken
// timeline shows frozen frames and jumps.
console.log('smoothness', JSON.stringify(await B.evaluate(() => {
  const r = [...window.game.mp.remotes.values()][0];
  const real = performance.now; let now = 100000; performance.now = () => now;
  try {
    r.samples.length = 0; r.off = undefined;
    const base = r.state; const v = 20; const pk = []; let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 40; k++) { const ts = 5e6 + k * 83.3; pk.push({ at: now + k * 83.3 + 40 + rnd() * 60, s: { ...base, p: [v * k * 0.0833, base.p[1], base.p[2]], u: [v, 0, 0], t: ts } }); }
    pk.sort((a, b) => a.at - b.at);
    const xs = [];
    for (let f = 0; f < 150; f++) {
      now += 1000 / 60;
      while (pk.length && pk[0].at <= now) r.push({ presence: pk.shift().s, updatedAt: Date.now() });
      if (f > 30) { r.sample(now / 1000); xs.push(r.pos.x); }
    }
    const d = xs.slice(1).map((x, i) => x - xs[i]);
    return { frames: d.length, frozen: d.filter((x) => Math.abs(x) < 1e-4).length, idealStep: +(v / 60).toFixed(3), minStep: +Math.min(...d).toFixed(3), maxStep: +Math.max(...d).toFixed(3) };
  } finally { performance.now = real; }
})));
// A leaves: B's remote disappears
await A.evaluate(() => window.game.toggleLobby('lobby-1'));
await step(0.5, [], []);
console.log('after A leaves, B remotes:', await B.evaluate(() => window.game.mp.remotes.size), 'counts', JSON.stringify(await B.evaluate(() => window.game.mp.counts())));
// A comes back, then closes the tab outright: B must lose them
await A.evaluate(() => window.game.toggleLobby('lobby-1'));
for (let i = 0; i < 40 && !(await B.evaluate(() => window.game.mp.remotes.size > 0)); i++) await step(0.3, [], []);
console.log('A back, B remotes:', await B.evaluate(() => window.game.mp.remotes.size));
await A.close();
for (let i = 0; i < 40 && (await B.evaluate(() => window.game.mp.remotes.size > 0)); i++) await step(0.3, [], []);
console.log('after A closes the tab, B remotes:', await B.evaluate(() => window.game.mp.remotes.size), 'counts', JSON.stringify(await B.evaluate(() => window.game.mp.counts())));
await browser.close();
srv.close();
