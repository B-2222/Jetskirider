// Wave-zone take-off test:  node tools/spin-test.mjs [skiId] [straight|airsteer|lip|carve]
// airsteer must give ~0 yaw: steering in the air does nothing.
import { SkiPhysics } from '../src/physics.js';
import { skiById } from '../src/specs.js';
import { Waves, WAVE_ZONE } from '../src/waves.js';
const waves = new Waves(); waves.setSeaState(0.5, true);
const world = { sample(x, z, t, o) { waves.sample(x, z, t, o); o.water = o.h; o.ground = -30; o.mu = 0.5; return o; }, groundNormal(x, z, n) { n.x = 0; n.y = 1; n.z = 0; } };
const id = process.argv[2] || 'trixx', mode = process.argv[3] || 'straight';
const p = new SkiPhysics(skiById(id), world);
const hx = -Math.cos(WAVE_ZONE.dir), hz = -Math.sin(WAVE_ZONE.dir);
p.reset(WAVE_ZONE.x - hx * 260, WAVE_ZONE.z - hz * 260, Math.atan2(-hz, hx));
const dt = 1 / 240; let air = 0, yaw = 0, out = [], crashes = 0;
for (let t = 0; t < 30; t += dt) {
  const T = p.tele;
  p.ctrl.throttle = 1;
  // 'lip': on the face (climbing, nose up) throw the bars and slide; otherwise straight
  const onFace = !T.airborne && T.pitch > 0.12;
  p.ctrl.steer = mode === 'lip' && onFace ? 1 : 0;
  p.ctrl.lean = mode === 'lip' && onFace && T.pitch > 0.22 ? 1 : 0;
  if (mode === 'carve') p.ctrl.steer = onFace ? 1 : 0;
  if (mode === 'airsteer' && T.airborne) p.ctrl.steer = 1; // should do nothing now
  p.step(dt);
  if (T.airborne) { air += dt; yaw += (p.wx * T.ux + p.wy * T.uy + p.wz * T.uz) * dt; }
  else if (air > 0) { if (air > 0.5) out.push(`${air.toFixed(2)}s yaw=${(Math.abs(yaw) * 57.3).toFixed(0)} land uy=${T.uy.toFixed(2)}`); if (T.uy < 0.3) crashes++; air = 0; yaw = 0; }
}
console.log(id, mode, 'jumps', out.length, 'bad landings', crashes); console.log(out.slice(0, 8).join(' | '));
