import { SkiPhysics } from '../src/physics.js';
import { skiById } from '../src/specs.js';
const world = { sample(x, z, t, o) { o.water = 0; o.h = 0; o.vy = 0; o.nx = 0; o.nz = 0; o.ground = -30; o.mu = 0.5; return o; }, groundNormal(x, z, n) { n.x = 0; n.y = 1; n.z = 0; } };
const deg = (r) => (r * 180 / Math.PI).toFixed(0);
const spec = { ...skiById(process.argv[2] || 'trixx') };
for (const kv of process.argv.slice(3)) { const [k, v] = kv.split('='); spec[k] = parseFloat(v); }
for (const thr of [0.5, 1]) for (const steer of [0.25, 0.5, 0.75, 1]) {
  const p = new SkiPhysics(spec, world); p.reset(0, 0, 0);
  const dt = 1 / 240; let maxSlip = 0, maxYaw = 0, log = '';
  for (let t = 0; t < 10; t += dt) {
    p.ctrl.throttle = thr; p.ctrl.steer = t > 6 ? steer : 0; p.step(dt);
    if (t > 6) { maxSlip = Math.max(maxSlip, Math.abs(p.tele.slip)); maxYaw = Math.max(maxYaw, Math.abs(p.tele.yawRate)); }
    for (const tt of [6.5, 7, 8, 9.9]) if (Math.abs(t - tt) < dt / 2) log += ` [${tt}s v=${(p.tele.speed*3.6).toFixed(0)} yr=${deg(p.tele.yawRate)} slip=${deg(p.tele.slip)} roll=${deg(p.tele.roll)} g=${(p.tele.yawRate*p.tele.u/9.81).toFixed(2)}]`;
  }
  console.log(`thr=${thr} steer=${steer}${log}`);
}
