// Fires one air trick per jump and reports rotation + landing attitude.
//   node tools/trick-test.mjs [skiId] [trick: back|front|spin|roll]
import { SkiPhysics } from '../src/physics.js';
import { skiById } from '../src/specs.js';
import { Waves, WAVE_ZONE } from '../src/waves.js';
const waves = new Waves();
waves.setSeaState(0.5, true);
const world = { sample(x, z, t, o) { waves.sample(x, z, t, o); o.water = o.h; o.ground = -30; o.mu = 0.5; return o; }, groundNormal(x, z, n) { n.x = 0; n.y = 1; n.z = 0; } };
const spec = skiById(process.argv[2] || 'trixx');
const trick = process.argv[3] || 'back';
const p = new SkiPhysics(spec, world);
const hx = -Math.cos(WAVE_ZONE.dir), hz = -Math.sin(WAVE_ZONE.dir);
p.reset(WAVE_ZONE.x - hx * 260, WAVE_ZONE.z - hz * 260, Math.atan2(-hz, hx));
const dt = 1 / 240;
let air = 0, rot = { p: 0, y: 0, r: 0 }, out = [];
for (let t = 0; t < 26; t += dt) {
  const T = p.tele;
  p.ctrl.throttle = 1; p.ctrl.lean = 0; p.ctrl.steer = 0;
  if (T.airborne && air > 0.08) {
    // hold the trick until ~85% of the needed rotation, then let go to land
    const done = trick === 'back' || trick === 'front' ? Math.abs(rot.p) > 5.3 : trick === 'spin' ? Math.abs(rot.y) > 5.5 : Math.abs(rot.r) > 5.4;
    if (!done) {
      if (trick === 'back') p.ctrl.lean = -1;
      if (trick === 'front') p.ctrl.lean = 1;
      if (trick === 'spin') p.ctrl.steer = 1;
      if (trick === 'roll') { p.ctrl.lean = 1; p.ctrl.steer = 1; }
    }
  }
  p.step(dt);
  if (T.airborne) {
    air += dt;
    rot.p += (p.wx * T.rx + p.wy * T.ry + p.wz * T.rz) * dt;
    rot.y += (p.wx * T.ux + p.wy * T.uy + p.wz * T.uz) * dt;
    rot.r += (p.wx * T.fx + p.wy * T.fy + p.wz * T.fz) * dt;
  } else if (air > 0) {
    if (air > 0.5) out.push(`air ${air.toFixed(2)}s rot p=${(rot.p * 57.3).toFixed(0)} y=${(rot.y * 57.3).toFixed(0)} r=${(rot.r * 57.3).toFixed(0)} | land uy=${T.uy.toFixed(2)} pitch=${(T.pitch * 57.3).toFixed(0)} roll=${(T.roll * 57.3).toFixed(0)} impact=${T.impact.toFixed(1)}`);
    air = 0; rot = { p: 0, y: 0, r: 0 };
  }
}
console.log(spec.name, trick); console.log(out.slice(0, 8).join('\n'));
