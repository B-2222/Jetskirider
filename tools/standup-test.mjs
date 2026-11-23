// Stand-up tricks: flat-water pop + backflip, and wave tricks (X alone does nothing, X + steer is just a spin).
//   node tools/standup-test.mjs [skiId] [key=value ...]   (spec overrides, e.g. flipRate=6.2)
import { SkiPhysics } from '../src/physics.js';
import { skiById } from '../src/specs.js';
import { Waves, WAVE_ZONE } from '../src/waves.js';
const id = process.argv[2] || 'sfree';
const spec = { ...skiById(id) };
for (const kv of process.argv.slice(3)) { const [k, v] = kv.split('='); spec[k] = parseFloat(v); }
const flat = { sample(x, z, t, o) { o.water = 0; o.h = 0; o.vy = 0; o.nx = 0; o.nz = 0; o.ground = -30; o.mu = 0.5; return o; }, groundNormal(x, z, n) { n.x = 0; n.y = 1; n.z = 0; } };
const dt = 1 / 240;
const d = (r) => (r * 57.3).toFixed(0);
function track(p, rot) { const T = p.tele; rot.p += (p.wx * T.rx + p.wy * T.ry + p.wz * T.rz) * dt; rot.y += (p.wx * T.ux + p.wy * T.uy + p.wz * T.uz) * dt; rot.r += (p.wx * T.fx + p.wy * T.fy + p.wz * T.fz) * dt; }
// 1. flat water: sink the nose, then pull back to pop, hold for a backflip
{
  const p = new SkiPhysics(spec, flat); p.reset(0, 0, 0);
  let t = 0, popped = false, air = 0, rot = { p: 0, y: 0, r: 0 }, maxSub = 0, landed = null;
  for (; t < 8; t += dt) {
    const T = p.tele;
    p.ctrl.throttle = t < 1 ? 0.6 : 0.5;
    p.ctrl.lean = t < 1 ? 0 : t < 2.4 ? 1 : (T.airborne && Math.abs(rot.p) < 5.0) || t < 2.6 ? -1 : 0;
    p.step(dt);
    maxSub = Math.max(maxSub, p.subT);
    if (T.pop) popped = true;
    if (T.airborne) { air += dt; track(p, rot); }
    else if (air > 0.3 && !landed) landed = { air: air.toFixed(2), flip: d(rot.p), uy: T.uy.toFixed(2), pitch: d(T.pitch) };
  }
  console.log(id, 'FLAT-WATER POP: nose buried', maxSub.toFixed(2) + 's, popped', popped, 'landing', JSON.stringify(landed));
}
// 2. wave tricks
const waves = new Waves(); waves.setSeaState(0.5, true);
const world = { sample(x, z, t, o) { waves.sample(x, z, t, o); o.water = o.h; o.ground = -30; o.mu = 0.5; return o; }, groundNormal(x, z, n) { n.x = 0; n.y = 1; n.z = 0; } };
for (const trick of ['back', 'lipback', 'spin', 'xonly', 'xsteer']) {
  const p = new SkiPhysics(spec, world);
  const hx = -Math.cos(WAVE_ZONE.dir), hz = -Math.sin(WAVE_ZONE.dir);
  p.time = 30; p.reset(WAVE_ZONE.x - hx * 300, WAVE_ZONE.z - hz * 300, Math.atan2(-hz, hx));
  let air = 0, rot = { p: 0, y: 0, r: 0 }, out = [], sm = 0, smAtLand = 0;
  for (let t = 0; t < 90 && out.length < 4; t += dt) {
    const T = p.tele;
    p.ctrl.throttle = 1; p.ctrl.lean = 0; p.ctrl.steer = 0; p.ctrl.trick = 0;
    // lipback: pull back while climbing the face, as a rider times it for the lip
    if (trick === 'lipback' && !T.airborne && p.vy > 2.5) p.ctrl.lean = -1;
    if (trick === 'lipback' && T.airborne && Math.abs(rot.p) < 5.0 && (air < 0.02 || p.ctrl.lean < 0 || p.airHeld?.lean < 0)) p.ctrl.lean = -1;
    if (T.airborne && air > 0.13) {
      const need = trick === 'back' || trick === 'lipback' ? Math.abs(rot.p) < 5.0 : trick === 'xsteer' ? true : trick === 'spin' ? Math.abs(rot.y) < 5.4 : true;
      if (need) {
        if (trick === 'back' || trick === 'lipback') p.ctrl.lean = -1;
        if (trick === 'xonly') p.ctrl.trick = 1;
        if (trick === 'xsteer') { p.ctrl.trick = 1; p.ctrl.steer = 1; } // was the barrel roll: now just a spin
        if (trick === 'spin') p.ctrl.steer = 1;
      }
    }
    p.step(dt);
    if (T.airborne) { air += dt; track(p, rot); sm = Math.max(sm, T.superman); smAtLand = T.superman; }
    else if (air > 0) {
      if (air > 1.0) out.push(`air ${air.toFixed(2)}s flip ${d(rot.p)} spin ${d(rot.y)} roll ${d(rot.r)} superman ${sm.toFixed(2)} (at landing ${smAtLand.toFixed(2)}) land uy ${T.uy.toFixed(2)}`);
      air = 0; rot = { p: 0, y: 0, r: 0 }; sm = 0;
    }
  }
  console.log(id, trick.toUpperCase().padEnd(9), out.join(' | ') || 'no big jumps');
}
