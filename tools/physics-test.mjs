// Headless physics sanity run:  node tools/physics-test.mjs [skiId]
import { SkiPhysics } from '../src/physics.js';
import { SKIS, skiById } from '../src/specs.js';
import { Waves } from '../src/waves.js';

const waves = new Waves();
const waveScale = parseFloat(process.env.WAVES || '0');
waves.setSeaState(waveScale, true);
const world = {
  sample(x, z, t, o) { waves.sample(x, z, t, o); o.water = o.h; o.ground = -30; o.mu = 0.5; return o; },
  groundNormal(x, z, n) { n.x = 0; n.y = 1; n.z = 0; },
};
const deg = (r) => (r * 180 / Math.PI).toFixed(1);
function run(spec, name, script, dur, every = 0.5) {
  const p = new SkiPhysics(spec, world);
  p.reset(0, 0, 0);
  const dt = 1 / 240;
  console.log(`\n== ${spec.name}: ${name}`);
  let next = 0;
  for (let t = 0; t < dur; t += dt) {
    script(p, t);
    p.step(dt);
    if (t >= next) {
      next += every;
      const T = p.tele;
      console.log(`t=${t.toFixed(1)} v=${(T.speed * 3.6).toFixed(0)}km/h u=${T.u.toFixed(1)} vlat=${T.v.toFixed(1)} pitch=${deg(T.pitch)} roll=${deg(T.roll)} y=${p.py.toFixed(2)} yawR=${deg(T.yawRate)} wet=${T.wet.toFixed(2)} noz=${T.nozzleDepth.toFixed(2)} load=${T.pumpLoad.toFixed(2)} hdg=${deg(p.yaw)} slip=${deg(T.slip)}`);
    }
  }
  return p;
}
const ids = process.argv[2] ? [process.argv[2]] : ['trixx', 'rxp'];
const tests = (process.argv[3] || 'rest,accel,turn,wheelie,spin').split(',');
for (const id of ids) {
  const spec = skiById(id);
  if (tests.includes('rest')) run(spec, 'rest', () => {}, 4, 1);
  if (tests.includes('accel')) run(spec, 'full throttle', (p) => { p.ctrl.throttle = 1; }, 14, 1);
  if (tests.includes('turn')) run(spec, 'accel 6s then full right', (p, t) => { p.ctrl.throttle = 1; p.ctrl.steer = t > 6 ? 1 : 0; }, 11, 0.5);
  if (tests.includes('half')) run(spec, 'accel 6s then half right', (p, t) => { p.ctrl.throttle = 1; p.ctrl.steer = t > 6 ? 0.45 : 0; }, 11, 0.5);
  if (tests.includes('wheelie')) run(spec, 'trim up + lean back + throttle', (p, t) => { p.ctrl.trimCmd = 1; p.ctrl.lean = t > 1 ? -1 : 0; p.ctrl.throttle = t > 1 ? 1 : 0; }, 8, 0.5);
  if (tests.includes('trim')) run(spec, 'trim up at speed', (p, t) => { p.ctrl.trimCmd = t > 6 ? 1 : 0; p.ctrl.throttle = 1; }, 12, 1);
  if (tests.includes('spin')) run(spec, 'accel 5s, lean fwd + full left + throttle, then off', (p, t) => {
    p.ctrl.throttle = t < 6.2 ? 1 : (t > 8 ? 1 : 0); p.ctrl.steer = t > 5 && t < 6.6 ? -1 : 0; p.ctrl.lean = t > 5 && t < 7.5 ? 1 : 0;
  }, 10, 0.25);
}
