// Holeshot test: normal launch vs launch control.  node tools/launch-test.mjs [skiId]
import { SkiPhysics } from '../src/physics.js';
import { skiById } from '../src/specs.js';
const world = { sample(x, z, t, o) { o.water = 0; o.h = 0; o.vy = 0; o.nx = 0; o.nz = 0; o.ground = -30; o.mu = 0.5; return o; }, groundNormal(x, z, n) { n.x = 0; n.y = 1; n.z = 0; } };
const spec = skiById(process.argv[2] || 'rxp');
for (const lc of [false, true]) {
  const p = new SkiPhysics(spec, world); p.reset(0, 0, 0);
  const dt = 1 / 240; let t = 0, t60 = 0, t100 = 0, maxPitch = 0;
  if (lc) for (let i = 0; i < 240 * 2; i++) { p.ctrl.brake = 1; p.ctrl.throttle = 1; p.step(dt); }
  const x0 = p.px;
  for (; t < 12; t += dt) {
    p.ctrl.brake = 0; p.ctrl.throttle = 1; p.step(dt);
    const k = p.tele.speed * 3.6; maxPitch = Math.max(maxPitch, p.tele.pitch * 57.3);
    if (!t60 && k >= 60) t60 = t; if (!t100 && k >= 100) t100 = t;
  }
  console.log(spec.name, lc ? 'LAUNCH CONTROL' : 'normal        ', '0-60', t60.toFixed(2) + 's', '0-100', t100 ? t100.toFixed(2) + 's' : '-', 'max pitch', maxPitch.toFixed(0), 'top', (p.tele.speed * 3.6).toFixed(0), 'armed moved', (x0).toFixed(2) + 'm');
}
