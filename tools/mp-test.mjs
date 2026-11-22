// Two players in one browser over the local stand-in room (?mpfake=1).
//   node tools/mp-test.mjs <outDir>
import { serve } from './shot.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const out = process.argv[2] || '.';
const srv = await serve();
const url = `http://localhost:${srv.address().port}/index.html?pr=1&mpfake=1&tod=1&sea=1`;
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
  g.__now += 33; g.frame(g.__now); });
await B.screenshot({ path: out + '/mp-b-sees-a.png' });
console.log('tag', JSON.stringify(await B.evaluate(() => { const r = [...window.game.mp.remotes.values()][0]; return { hidden: r.tag.hidden, tf: r.tag.style.transform, txt: r.tag.textContent, parent: r.tag.parentElement && r.tag.parentElement.id, root: !!window.game.mp.tagRoot, rect: JSON.stringify(r.tag.getBoundingClientRect()) }; })));
// a trick from A shows in B's feed
await A.evaluate(() => window.game.tricks.award('BIG AIR', 500));
await step(0.5, ['KeyW'], ['KeyW']);
console.log('B feed', JSON.stringify(await B.evaluate(() => [...document.querySelectorAll('#mpFeed .feed-line')].map((e) => e.textContent))));
// A leaves: B's remote disappears
await A.evaluate(() => window.game.toggleLobby('lobby-1'));
await step(0.5, [], []);
console.log('after A leaves, B remotes:', await B.evaluate(() => window.game.mp.remotes.size), 'counts', JSON.stringify(await B.evaluate(() => window.game.mp.counts())));
await browser.close();
srv.close();
