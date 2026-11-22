// Sit-down Superman: tap X after take-off on wave jumps, hold it into the
// landing (must bail), and mash it on small chop (must never fire).
//   node tools/superman-test.mjs [skiId]
import { SkiPhysics } from '../src/physics.js';
import { skiById } from '../src/specs.js';
import { Waves, WAVE_ZONE } from '../src/waves.js';
const id = process.argv[2] || 'trixx';
const dt = 1 / 240;
for (const [mode, sea, where] of [['super', 0.5, 'zone'], ['hold', 0.5, 'zone'], ['mash', 0.5, 'chop'], ['mash', 1.0, 'chop']]) {
  const waves = new Waves(); waves.setSeaState(sea, true);
  const world = { sample(x, z, t, o) { waves.sample(x, z, t, o); o.water = o.h; o.ground = -30; o.mu = 0.5; return o; }, groundNormal(x, z, n) { n.x = 0; n.y = 1; n.z = 0; } };
  const p = new SkiPhysics(skiById(id), world);
  const hx = -Math.cos(WAVE_ZONE.dir), hz = -Math.sin(WAVE_ZONE.dir);
  if (where === 'zone') { p.time = 30; p.reset(WAVE_ZONE.x - hx * 300, WAVE_ZONE.z - hz * 300, Math.atan2(-hz, hx)); } else p.reset(0, 0, 0);
  let air = 0, smT = 0, jumps = 0, supers = 0, bails = 0, worst = 1;
  const out = [];
  for (let t = 0; t < 70; t += dt) {
    const T = p.tele;
    p.ctrl.throttle = 1; p.ctrl.steer = 0; p.ctrl.lean = 0; p.ctrl.trick = 0;
    if (mode === 'mash') p.ctrl.trick = Math.floor(t / 0.3) % 2; // tap tap tap
    else if (T.airborne && air > 0.12 && (mode === 'hold' || T.airTime < p.airEnd - 0.28)) p.ctrl.trick = 1;
    p.step(dt);
    if (T.airborne) { air += dt; if (T.superman > 0.7) smT += dt; }
    else if (air > 0) {
      if (air > 0.5) jumps++;
      if (smT > 0.25) supers++;
      if (T.superman > 0.45) bails++;
      worst = Math.min(worst, T.uy);
      if (air > 0.5) out.push(`${air.toFixed(2)}s${smT > 0.25 ? ' SUPERMAN' : ''}${T.superman > 0.45 ? ' BAIL' : ''}`);
      air = 0; smT = 0;
    }
  }
  console.log(`${id} ${mode.padEnd(5)} sea ${sea} ${where}: jumps ${jumps} supermans ${supers} bails ${bails} min uy at landing ${worst.toFixed(2)} | ${out.slice(0, 8).join(', ')}`);
}
