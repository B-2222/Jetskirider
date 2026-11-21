// Headless wave-zone run:  node tools/wave-test.mjs [skiId] [throttleSecs] [lean]
import { SkiPhysics } from '../src/physics.js';
import { skiById } from '../src/specs.js';
import { Waves, WAVE_ZONE } from '../src/waves.js';
const waves = new Waves();
waves.setSeaState(0.5, true);
const world = {
  sample(x, z, t, o) { waves.sample(x, z, t, o); o.water = o.h; o.ground = -30; o.mu = 0.5; return o; },
  groundNormal(x, z, n) { n.x = 0; n.y = 1; n.z = 0; },
};
const spec = skiById(process.argv[2] || 'trixx');
const lean = parseFloat(process.argv[4] || '0');
const p = new SkiPhysics(spec, world);
const hx = -Math.cos(WAVE_ZONE.dir), hz = -Math.sin(WAVE_ZONE.dir);
p.reset(WAVE_ZONE.x - hx * 260, WAVE_ZONE.z - hz * 260, Math.atan2(-hz, hx));
const dt = 1 / 240;
let air = 0, maxAir = 0, jumps = 0, maxH = 0, y0 = 0, landings = [];
for (let t = 0; t < 26; t += dt) {
  p.ctrl.throttle = 1;
  p.ctrl.lean = p.tele.airborne ? lean : 0;
  p.step(dt);
  const T = p.tele;
  if (T.airborne) { if (air === 0) { jumps++; y0 = p.py - waves.height(p.px, p.pz, p.time); } air += dt; maxH = Math.max(maxH, p.py - waves.height(p.px, p.pz, p.time)); }
  else if (air > 0) { if (air > 0.35) landings.push(`${air.toFixed(2)}s h=${maxH.toFixed(1)} uy=${T.uy.toFixed(2)} pitch=${(T.pitch * 57.3).toFixed(0)}`); maxAir = Math.max(maxAir, air); air = 0; maxH = 0; }
}
console.log(spec.name, 'mask at start', waves.zoneMask(p.px, p.pz).toFixed(2), 'jumps>0.35s:', landings.length, 'maxAir', maxAir.toFixed(2));
console.log(landings.slice(0, 12).join('\n'));
