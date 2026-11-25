// Jet ski rigid-body physics. Pure JS (no three.js) so it can be tested headless.
//
// Body frame:  +X forward (bow), +Y up, +Z starboard (right).
// The origin is the centre of mass, level with the bond line, 40% of the hull
// length ahead of the transom.
//
// Model summary
//  - 6-DOF rigid body, quaternion orientation.
//  - Hull sampled at 11 points. Each wet point produces buoyancy, heave
//    damping, slam, planing lift, longitudinal drag and a tyre-like lateral
//    "grip" force that saturates and breaks loose (that is the powerslide).
//  - Because grip is produced per point, the centre of lateral resistance
//    moves with attitude: bow planted -> the stern whips round (180s);
//    bow high (trim up / wheelie) -> loose, flat slides.
//  - The jet pump thrust acts at the steering nozzle along the nozzle axis
//    (steer yaw + VTS trim pitch). No water at the intake grate = no thrust.

import { clamp, smoothstep, damp, sign } from './util.js';

const G = 9.81;
// stand-ups: how much faster than its normal rate a rider can tuck a flip or
// roll to get it round before a smaller jump comes down
const TUCK = 1.4;
// stand-ups: extra height (in hull lengths) a flip or roll needs, because the
// bow, stern, pole and rider swing down below the hull as it goes round
const ROT_ALLOW = 0.22;
const SUB_MAX = 0.45; // depth at which a hull point counts as fully submerged
const ARM_K = 0.45;

function buildPoints(spec) {
  const L = spec.L;
  const B = spec.B;
  const sb = spec.sternBias;
  const P = [];
  const add = (x, y, z, w, wl, rocker, lift) => P.push({ x: x * L, y, z: z * B, w, wl, rocker, lift, deck: false });
  for (const s of [-1, 1]) {
    add(-0.35, -0.33, 0.33 * s, 0.11, 0.1 * sb, 0.0, 0.55);
    add(-0.13, -0.35, 0.36 * s, 0.12, 0.11 * sb, 0.0, 0.9);
    add(0.11, -0.35, 0.35 * s, 0.11, 0.13, 0.012, 1.5);
    add(0.34, -0.29, 0.26 * s, 0.08, 0.09, 0.075, 1.6);
  }
  add(0.53, -0.12, 0, 0.06, 0.08, 0.2, 1.6);
  add(-0.24, -0.42, 0, 0.06, 0.08 * sb, 0.0, 0.8);
  add(0.18, -0.42, 0, 0.04, 0.16, 0.02, 1.5);
  let sw = 0;
  let swl = 0;
  for (const p of P) {
    sw += p.w;
    swl += p.wl;
  }
  for (const p of P) {
    p.w /= sw;
    p.wl /= swl;
  }
  // Deck points: only float the hull when it is upside down.
  for (const [x, z] of [
    [0.3, 0],
    [-0.2, 0.3],
    [-0.2, -0.3],
  ]) {
    P.push({ x: x * L, y: 0.42, z: z * B, w: 0.3, wl: 0, rocker: 0, lift: 0, deck: true });
  }
  return P;
}

export class SkiPhysics {
  constructor(spec, world) {
    this.world = world;
    this.setSpec(spec);
    this.px = 0;
    this.py = 0;
    this.pz = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.qx = 0;
    this.qy = 0;
    this.qz = 0;
    this.qw = 1;
    this.wx = 0;
    this.wy = 0;
    this.wz = 0;
    this.ctrl = { throttle: 0, brake: 0, steer: 0, lean: 0, trimCmd: 0, trick: 0 };
    this.subT = 0; // stand-up: how long the nose has been buried
    this.superman = 0; // sit-down: rider stretched out behind the ski in the air (0..1)
    this.airOkS = false; // stand-up: this flight is long enough to stretch out
    this.airOkF = false; // stand-up: ... and long enough to flip or roll
    this.airDriven = false; // stand-up: the rider threw a rotation this flight
    this.wobble = 1; // stand-up: which way, and how much, this flip drifts off square
    this.roll0 = 0;
    this.airLeft = 0; // predicted time to touchdown, s
    this.airLeftRot = 0; // stand-up: the same, leaving room to go round
    this.predT = 0;
    // time a flip or roll needs, fully tucked, to get round far enough to ride
    // away (~300°)
    this.trickNeed = spec.standup ? 6.0 / (spec.flipRate * TUCK) + 0.12 : 99;
    this.airEnd = 0; // predicted touchdown, in seconds of air time
    this.airPitch = 0; // pitch and roll turned this flight, rad
    this.airRoll = 0;
    this._sf = {};
    this.trim = 0; // -1 (bow down) .. +1 (bow up)
    this.steerAngle = 0;
    this.rpmN = 0.1;
    this.pumpLoad = 1;
    this.boost = 0; // turbo boost 0..1 (turbo skis only)
    this.als = false; // rolling anti-lag switched on
    this.alsT = 0;
    this.lcArmed = false; // launch control: on the line, revs held
    this.lcLaunch = 0; // seconds of managed launch left
    this.lcTrimSave = 0;
    this.leanIn = 0;
    this.powLag = 0;
    this.fhx = 1;
    this.fhz = 0;
    this.time = 0;
    this.frozen = false;
    this._s = {};
    this._n = { x: 0, y: 1, z: 0 };
    const n = this.points.length;
    this.ptPos = new Float32Array(n * 3);
    this.ptVel = new Float32Array(n * 3);
    this.ptDepth = new Float32Array(n);
    this.tele = {
      speed: 0, u: 0, v: 0, slip: 0, pitch: 0, roll: 0, yawRate: 0,
      airborne: false, airTime: 0, wet: 0, ground: 0, tuck: 0,
      pumpLoad: 1, nozzleDepth: 0.1, exposure: 0, thrustN: 0, rpmN: 0.1,
      jetSpeed: 0, trimAngle: 0, steerAngle: 0, impact: 0, reverse: 0,
      fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0, rx: 0, ry: 0, rz: 1,
      nozzle: { x: 0, y: 0, z: 0 },
      jetDir: { x: -1, y: 0, z: 0 },
      nozzleVel: { x: 0, y: 0, z: 0 },
      waterAtNozzle: 0,
      gLat: 0, gLong: 0,
    };
  }

  setSpec(spec) {
    this.spec = spec;
    this.points = buildPoints(spec);
    this.m = spec.mass;
    // Water forces scale with hull size, not with mass, so a heavy ski sits
    // deeper, reacts slower and stays planted while a light one skips around.
    this.mh = 300 * (spec.L * spec.B) / (2.79 * 1.18);
    this.Ix = spec.mass * Math.pow(spec.B * 0.34, 2); // roll
    this.Iy = spec.mass * Math.pow(spec.L * 0.27, 2); // yaw
    this.Iz = spec.mass * Math.pow(spec.L * 0.265, 2); // pitch
    const light = spec.style === 'spark';
    this.leanRate = spec.leanRate ?? (light ? 1.5 : 0.7); // how fast the rider can roll the hull onto its side
    this.unhook = spec.unhook ?? (light ? 0.28 : 0.36); // grip left once the V is out of the water
    this.carve = spec.carve ?? (light ? 1.0 : 0.95); // full-lock demand as a fraction of grip
    this.hopK = spec.hop ?? (light ? 1 : 0.5);
    // a stand-up's pump sits much closer to its (high, rider-heavy) centre of mass
    this.nozzleL = { x: -0.4 * spec.L, y: spec.standup ? -0.12 : -0.245, z: 0 };
    this.intakeL = { x: -0.17 * spec.L, y: -0.45, z: 0 };
    // Quadratic drag solved so that thrust == drag at the rated top speed.
    this.vFree = spec.top * 1.06;
    const tTop = spec.thrust * (1 - 0.78 * Math.pow(spec.top / this.vFree, 2));
    this.dragQ = (tTop - 0.45 * spec.top * spec.top) / (spec.top * spec.top) / spec.mass;
    if (this.ptPos && this.ptPos.length !== this.points.length * 3) {
      this.ptPos = new Float32Array(this.points.length * 3);
      this.ptVel = new Float32Array(this.points.length * 3);
      this.ptDepth = new Float32Array(this.points.length);
    }
  }

  reset(x, z, yaw = 0) {
    this.px = x;
    this.pz = z;
    this.world.sample(x, z, this.time, this._s);
    this.py = Math.max(this._s.water, this._s.ground) + 0.2;
    this.vx = this.vy = this.vz = 0;
    this.wx = this.wy = this.wz = 0;
    this.qx = 0;
    this.qz = 0;
    this.qy = Math.sin(yaw / 2);
    this.qw = Math.cos(yaw / 2);
    this.steerAngle = 0;
    this.rpmN = 0.1;
    this.tele.airTime = 0;
    this.airOkS = this.airOkF = this.airDriven = false;
    this.airLeft = 0;
    this.airHeld = null;
    this.frozen = false;
  }

  // Stand-ups: the rate to throw a flip at, with `togo` radians still to turn.
  // Normally the ski's own rate; on a smaller jump the rider tucks tighter
  // (up to TUCK times faster) to get round before the predicted touchdown.
  tuckRate(base, togo) {
    if (togo <= 0) return base;
    const left = this.airEnd - this.tele.airTime;
    return clamp((togo * 0.95) / Math.max(left - 0.1, 0.05), base, base * TUCK);
  }

  // Seconds until a ski flying from here (ballistic) touches water or ground.
  // lowOff = height of the centre of mass above the lowest point of the hull.
  flightLeft(t, lowOff) {
    const o = this._sf;
    for (let s = 0.05; s <= 2.4; s += 0.05) {
      const y = this.py + this.vy * s - 0.5 * G * s * s - lowOff;
      this.world.sample(this.px + this.vx * s, this.pz + this.vz * s, t + s, o);
      if (y < Math.max(o.water, o.ground)) return s;
    }
    return 2.4;
  }

  get yaw() {
    return Math.atan2(-this.fhz, this.fhx);
  }

  step(dt) {
    if (this.frozen) return;
    const sp = this.spec;
    const m = this.m;
    const c = this.ctrl;
    const T = this.tele;
    this.time += dt;
    const t = this.time;

    // --- basis vectors -----------------------------------------------------
    const qx = this.qx, qy = this.qy, qz = this.qz, qw = this.qw;
    const fx = 1 - 2 * (qy * qy + qz * qz), fy = 2 * (qx * qy + qw * qz), fz = 2 * (qx * qz - qw * qy);
    const ux = 2 * (qx * qy - qw * qz), uy = 1 - 2 * (qx * qx + qz * qz), uz = 2 * (qy * qz + qw * qx);
    const rx = 2 * (qx * qz + qw * qy), ry = 2 * (qy * qz - qw * qx), rz = 1 - 2 * (qx * qx + qy * qy);
    // horizontal heading; when the hull is near vertical keep the last good one
    let fl = Math.hypot(fx, fz);
    if (fl > 0.25) {
      const s = uy >= -0.2 ? 1 : 1;
      this.fhx = (fx / fl) * s;
      this.fhz = (fz / fl) * s;
    } else {
      // derive heading from the up vector (tail-stand): heading is opposite to
      // where the deck faces horizontally.
      const ul = Math.hypot(ux, uz);
      if (ul > 0.3) {
        const sgn = fy > 0 ? -1 : 1;
        this.fhx = (ux / ul) * sgn;
        this.fhz = (uz / ul) * sgn;
      }
    }
    const fhx = this.fhx, fhz = this.fhz;
    const rhx = -fhz, rhz = fhx; // right, horizontal
    const upright = smoothstep(0.0, 0.5, uy);

    // --- launch control -----------------------------------------------------
    // Brake + gas at a standstill: the iBR gate sits in neutral and the engine
    // holds launch revs on the two-step. Let go of the brake to launch: the
    // gate lifts with the revs already up (and boost built on a turbo), and
    // the trim is held bow-down until the hull is on the plane.
    const spdNow = Math.hypot(this.vx, this.vz);
    if (sp.launchControl && c.brake > 0.5 && c.throttle > 0.5 && (spdNow < 2 || this.lcArmed)) {
      if (!this.lcArmed) this.lcTrimSave = this.trim;
      this.lcArmed = true;
      this.lcLaunch = 0;
    } else if (this.lcArmed) {
      this.lcArmed = false;
      if (c.throttle > 0.5 && c.brake <= 0.5) this.lcLaunch = 3.2;
    }
    if (this.lcLaunch > 0) {
      this.lcLaunch -= dt;
      if (c.throttle < 0.3 || spdNow > sp.top * 0.7) this.lcLaunch = 0;
    }
    // stand-ups have no reverse: the lever only cuts the throttle
    const brake = this.lcArmed || sp.standup ? 0 : c.brake;

    // --- actuators ----------------------------------------------------------
    this.steerAngle = damp(this.steerAngle, c.steer * sp.steerMax, 0.045, dt);
    this.trim = sp.standup ? 0 : clamp(this.trim + c.trimCmd * dt * 1.6, -1, 1); // stand-ups have no trim
    if (this.lcArmed || this.lcLaunch > 1.4) this.trim = damp(this.trim, -1, 0.12, dt);
    else if (this.lcLaunch > 0) this.trim = damp(this.trim, this.lcTrimSave, 0.35, dt);
    const trimAngle = this.trim > 0 ? this.trim * sp.trimUp : this.trim * sp.trimDown;
    const delta = this.steerAngle;

    const thr = brake > 0.05 || (sp.standup && c.brake > 0.05) ? 0 : c.throttle;
    const demand = Math.max(thr, brake * 0.75);
    let rpmT = 0.11 + 0.89 * demand;
    if (this.lcArmed) rpmT = sp.launchRpm ?? 0.62;
    if (this.pumpLoad < 0.45 && demand > 0.15) rpmT = Math.min(1.05, rpmT + 0.3); // pump unloads, engine flares
    this.rpmN = damp(this.rpmN, rpmT, rpmT > this.rpmN ? 0.13 : 0.28, dt);
    let power = Math.pow(clamp((this.rpmN - 0.11) / 0.89, 0, 1), 1.7);
    {
      // throttle feathering near the tail-stand balance point
      const lim = (c.lean < 0 ? sp.wheelieMax : 0.5) + 0.12;
      power *= 0.12 + 0.88 * smoothstep(lim + 0.12, lim - 0.14, Math.asin(clamp(fy, -1, 1)) + 0.12 * (this.wx * rx + this.wy * ry + this.wz * rz));
    }
    // Turbo: power builds as the turbo spools. On the line the two-step and
    // anti-lag build boost before you go; rolling anti-lag keeps it up when
    // you lift, so the next stab of throttle hits straight away.
    let alsActive = false;
    if (sp.turbo) {
      const rf = clamp((this.rpmN - 0.11) / 0.89, 0, 1);
      let want = thr * smoothstep(0.25, 0.7, rf) * (0.5 + 0.5 * this.pumpLoad);
      if (this.lcArmed) want = 0.95;
      alsActive = this.lcArmed || (this.als && spdNow > 3 && thr < 0.4);
      if (alsActive && !this.lcArmed) {
        this.alsT += dt;
        want = Math.max(want, 0.82 * (1 - smoothstep(3, 4.5, this.alsT)));
      } else if (!this.lcArmed) this.alsT = 0;
      this.boost = damp(this.boost, want, want > this.boost ? 0.75 : 0.3, dt);
      power *= 0.5 + 0.5 * this.boost;
    } else this.boost = 0;

    // Throttle hit with the trim up: the jet is aimed at the sky, the stern
    // squats, the bow snaps up and the whole ski hops off the water.
    this.powLag = damp(this.powLag, power, 0.22, dt);
    const trimFrac = clamp(this.trim, 0, 1);
    const hop = Math.max(0, power - this.powLag) * trimFrac * this.hopK * this.pumpLoad;

    // Leaning in: holding full lock on the gas, the rider rolls the hull onto
    // its side. Once the V bottom comes out of the water the hull unhooks and
    // slides. Heavy skis take longer to tip; Shift (weight forward) helps.
    const rollNow = -Math.asin(clamp(ry, -1, 1));
    {
      // c.lean > 0 is the slide button: only then does the rider throw the
      // hull over. Without it the ski stays hooked up and carves.
      const want = c.lean > 0.5 && Math.abs(c.steer) > 0.3 && Math.hypot(this.vx, this.vz) > 4;
      const rate = want ? this.leanRate * (1 + trimFrac * 0.5) : -2.5;
      this.leanIn = clamp(this.leanIn + rate * dt, 0, 1);
    }
    const unhooked = this.leanIn * smoothstep(0.3, 0.65, Math.abs(rollNow)) * upright;
    // Carving (not sliding), the banked V and chine bite harder the more the
    // hull leans into the turn. Trim down plants the bow for more bite,
    // trim up lifts it and loosens the turn.
    const carveBite = (1 - this.leanIn) * smoothstep(0.04, 0.42, Math.abs(rollNow));
    const trimBite = 1 + 0.3 * Math.max(-this.trim, 0) - 0.22 * Math.max(this.trim, 0);
    // a stand-up's narrow hull rails even harder when it is leaned over
    const gripMul = (1 - (1 - this.unhook) * unhooked) * (1 + (sp.standup ? 1.4 : 0.9) * carveBite) * trimBite;

    let Fx = 0, Fy = -m * G, Fz = 0;
    let Tx = 0, Ty = 0, Tz = 0;
    const addForce = (ax, ay, az, bx, by, bz) => {
      // force (bx,by,bz) at world offset (ax,ay,az)
      Fx += bx; Fy += by; Fz += bz;
      Tx += ay * bz - az * by;
      Ty += az * bx - ax * bz;
      Tz += ax * by - ay * bx;
    };

    const ucm = this.vx * fhx + this.vz * fhz;
    const vcm = this.vx * rhx + this.vz * rhz;

    // --- hull points --------------------------------------------------------
    const S = this._s;
    const N = this._n;
    let wet = 0, groundN = 0, impact = 0, wetStern = 0, latCap = 0, lowY = 1e9;
    const pts = this.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const ox = p.x * fx + p.y * ux + p.z * rx;
      const oy = p.x * fy + p.y * uy + p.z * ry;
      const oz = p.x * fz + p.y * uz + p.z * rz;
      const wxp = this.px + ox, wyp = this.py + oy, wzp = this.pz + oz;
      const pvx = this.vx + this.wy * oz - this.wz * oy;
      const pvy = this.vy + this.wz * ox - this.wx * oz;
      const pvz = this.vz + this.wx * oy - this.wy * ox;
      this.world.sample(wxp, wzp, t, S);
      const depth = S.water - wyp;
      this.ptPos[i * 3] = wxp; this.ptPos[i * 3 + 1] = wyp; this.ptPos[i * 3 + 2] = wzp;
      this.ptVel[i * 3] = pvx; this.ptVel[i * 3 + 1] = pvy; this.ptVel[i * 3 + 2] = pvz;
      this.ptDepth[i] = depth;
      if (!p.deck && wyp < lowY) lowY = wyp;

      // solid ground / ramps
      const pen = S.ground - wyp;
      if (pen > 0 && !p.deck) {
        this.world.groundNormal(wxp, wzp, N);
        const vn = pvx * N.x + pvy * N.y + pvz * N.z;
        let fn = m * p.w * (900 * pen * N.y - 42 * vn);
        if (fn > 0) {
          fn = Math.min(fn, m * p.w * 400);
          const tx = pvx - N.x * vn, ty = pvy - N.y * vn, tz = pvz - N.z * vn;
          const tl = Math.hypot(tx, ty, tz);
          const fr = (-S.mu * fn) / Math.max(tl, 0.6);
          addForce(ox, oy, oz, N.x * fn + tx * fr, N.y * fn + ty * fr, N.z * fn + tz * fr);
          groundN += p.w;
        }
      }

      if (depth <= 0) continue;
      const sub = Math.min(depth / SUB_MAX, 1);
      const relVy = pvy - S.vy;
      if (p.deck) {
        addForce(ox, oy, oz, 0, m * p.w * (G * 3 * sub - 5 * relVy * sub), 0);
        continue;
      }
      wet += p.w * Math.min(1, depth / 0.12);
      if (p.x < 0) wetStern += p.w * Math.min(1, depth / 0.1);

      // buoyancy + heave damping + slam
      let fyp = G * 3.0 * sub - 8.5 * relVy * (0.35 + 0.65 * sub);
      if (relVy < 0) {
        fyp += 2.6 * relVy * relVy * (0.3 + 0.7 * sub);
        if (depth < 0.25 && -relVy > impact) impact = -relVy;
      }

      // planing lift
      // speed through the water (moving water on a breaking wave carries the hull)
      const wcx = S.ux || 0, wcz = S.uz || 0;
      const up = (pvx - wcx) * fhx + (pvz - wcz) * fhz;
      if (up > 0.5 && upright > 0.1) {
        const slope = -(S.nx * fhx + S.nz * fhz);
        let aoa = fy + p.rocker + 0.035 + slope * 0.8 * Math.min(1, 24 / up) - relVy / Math.max(up, 4);
        aoa = clamp(aoa, -0.05, 0.42);
        fyp += Math.min(1.05 * p.lift * up * Math.min(up, 13) * aoa * Math.sqrt(sub), 60) * upright;
      }
      addForce(ox, oy, oz, 0, this.mh * p.w * fyp, 0);

      // horizontal hydrodynamics (applied at CoM height: yaw torque only)
      const vp = (pvx - wcx) * rhx + (pvz - wcz) * rhz;
      const wetL = 0.3 + 0.7 * Math.sqrt(sub);
      let fu = -(0.16 * up + this.dragQ * up * Math.abs(up)) * wetL * p.w * 0.82;
      if (up < 0) fu *= 1.7;
      const gripSub = Math.min(1, depth / 0.05);
      const vpk = 1.3 + 0.075 * Math.abs(ucm);
      const axs = Math.abs(vp / vpk);
      // tyre-like: builds to a peak, holds, then lets go progressively
      let g = axs < 1 ? (2 * axs) / (1 + axs * axs) : 1 - (1 - sp.slide) * smoothstep(1.2, 4.5, axs);
      const fl2 = -sign(vp) * (sp.grip * gripMul * g + 0.045 * vp * vp) * gripSub * p.wl;
      addForce(ox, 0, oz, fu * fhx * m, 0, fu * fhz * m);
      // Lateral force keeps only part of its yaw lever: enough for the centre
      // of lateral resistance to matter (planted bow = tail-happy) without
      // making the hull a weathervane.
      addForce(ox * ARM_K, 0, oz * ARM_K, fl2 * rhx * m, 0, fl2 * rhz * m);
      latCap += gripSub * p.wl;
    }
    wet = Math.min(wet * 1.15, 1);
    wetStern = Math.min(wetStern * 2.2, 1);

    // --- jet pump -----------------------------------------------------------
    const il = this.intakeL;
    const ix = il.x * fx + il.y * ux, iy = il.x * fy + il.y * uy, iz = il.x * fz + il.y * uz;
    this.world.sample(this.px + ix, this.pz + iz, t, S);
    let load = smoothstep(-0.07, 0.04, S.water - (this.py + iy));
    if (S.ground > S.water - 0.06) load = 0;
    this.pumpLoad = damp(this.pumpLoad, load, load > this.pumpLoad ? 0.03 : 0.09, dt);

    const nl = this.nozzleL;
    const nx = nl.x * fx + nl.y * ux, ny = nl.x * fy + nl.y * uy, nz = nl.x * fz + nl.y * uz;
    this.world.sample(this.px + nx, this.pz + nz, t, S);
    const nozzleDepth = S.water - (this.py + ny);
    T.waterAtNozzle = S.water;

    const ct = Math.cos(trimAngle), st = Math.sin(trimAngle);
    const cd = Math.cos(delta), sd = Math.sin(delta);
    // direction the water leaves the nozzle (body frame): aft, up with trim,
    // and to the side the bars are turned.
    const jl = { x: -ct * cd, y: st, z: ct * sd };
    const jx = jl.x * fx + jl.y * ux + jl.z * rx;
    const jy = jl.x * fy + jl.y * uy + jl.z * ry;
    const jz = jl.x * fz + jl.y * uz + jl.z * rz;

    let thrust = 0;
    let reverse = 0;
    if (this.lcArmed) {
      // launch control: gate in neutral, no net thrust
      thrust = 0;
    } else if (brake > 0.05) {
      // iBR: the reverse gate drops over the jet and throws it forward + down
      reverse = brake;
      const tr = sp.thrust * 0.62 * power * this.pumpLoad;
      const lim = ucm < -4 ? smoothstep(-7, -4, ucm) : 1;
      addForce(nx, ny, nz,
        (-fx * 0.92 + ux * 0.28 - rx * sd * 0.6) * tr * lim,
        (-fy * 0.92 + uy * 0.28 - ry * sd * 0.6) * tr * lim,
        (-fz * 0.92 + uz * 0.28 - rz * sd * 0.6) * tr * lim);
      thrust = tr;
    } else {
      const fall = clamp(1 - 0.78 * Math.pow(Math.max(ucm, 0) / this.vFree, 2), 0.1, 1) * smoothstep(sp.top * 1.07, sp.top * 0.97, ucm);
      // Net forward thrust falls away with boat speed, but the sideways and
      // vertical components come from deflecting the whole jet (gross
      // momentum flux), so steering and trim stay powerful at speed.
      const gross = sp.thrust * power * this.pumpLoad;
      thrust = gross * fall;
      const a = -jl.x * thrust, b = -jl.y * gross * 0.85, d = -jl.z * gross * 0.8;
      addForce(nx, ny, nz, fx * a + ux * b, fy * a + uy * b, fz * a + uz * b);
      Fx += rx * d; Fy += ry * d; Fz += rz * d;
    }

    // --- steering ----------------------------------------------------------
    // The deflected jet shoves the stern sideways and the hull hooks up and
    // carves. Hooked up, yaw rate follows the bars up to the grip limit; push
    // past it and the stern breaks loose and the ski rotates much faster
    // (powerslide). Off the throttle there is very little steering, exactly
    // like the real thing.
    const sN = delta / sp.steerMax;
    const yawRateR = -(this.wx * ux + this.wy * uy + this.wz * uz);
    {
      const jetFrac = Math.sqrt(power * this.pumpLoad) * (brake > 0.05 ? 0.6 : 1) * (this.lcArmed ? 0 : 1);
      const au = Math.abs(ucm);
      const spdH = Math.hypot(this.vx, this.vz);
      // trim down plants the bow and tightens the line; trim up frees it
      const trimTurn = 1 + 0.3 * Math.max(-this.trim, 0) - 0.12 * Math.max(this.trim, 0);
      const rHook = trimTurn * Math.min((au + 5 * jetFrac) / sp.turnR, (sp.grip * this.carve * trimBite * 1.35) / Math.max(au, 1), ((sp.gMax || 1.4) * G) / Math.max(au, 1));
      const slipA = spdH > 2 ? Math.abs(Math.atan2(vcm, Math.abs(ucm) + 0.5)) : 0;
      const li = this.leanIn;
      // only a committed slide lets the stern come round; otherwise the rider
      // eases the bars as soon as the hull starts to slip and it stays hooked up
      const loose = Math.max(smoothstep(0.16, 0.55, slipA), unhooked * 0.7) * smoothstep(3, 7, spdH) * smoothstep(0, 0.35, li);
      let hold = 1 - (1 - smoothstep(0, 0.35, li)) * smoothstep(0.14, 0.36, slipA) * 0.85;
      // a light stand-up would chatter on and off the limit: ease in and out smoothly
      if (sp.standup) hold = this.holdS = damp(this.holdS ?? 1, hold, hold < (this.holdS ?? 1) ? 0.06 : 0.25, dt);
      const rLoose = 0.8 + 1.7 * jetFrac;
      const rCmd = sN * (rHook + (Math.max(rLoose, rHook) - rHook) * loose) * hold;
      const auth = wetStern * upright * (0.16 * clamp(au / 6, 0, 1) + 0.84 * jetFrac);
      // grippier hulls resist rotation harder, so the jet has to push harder
      const ts = this.Iy * 7.5 * (1 + (sp.grip * gripMul) / 16) * (rCmd - yawRateR) * auth;
      // turn about the vertical: about the hull's own axis this would start
      // rolling the ski over once it is banked hard in a slide
      Ty -= ts * (sp.standup ? smoothstep(0.05, 0.45, uy) : Math.max(uy, 0));
      T.rCmd = rCmd;
    }

    // --- banking: the V hull + rider lean the ski into the turn -------------
    const aLat = yawRateR * Math.max(ucm, 0);
    // On a stand-up the rider leans the whole ski into the turn with their
    // body, so it banks much harder than a sit-down.
    const bankRaw = sp.standup
      ? clamp(Math.atan2(aLat, G) * 0.85 + sN * 0.22 * clamp(ucm / 7, 0, 1), -0.72, 0.72) + Math.sign(sN) * this.leanIn * 0.3
      : clamp(Math.atan2(aLat, G) * 0.75 + sN * 0.1 * clamp(ucm / 8, 0, 1), -0.6, 0.6) + Math.sign(sN) * this.leanIn * 0.55;
    this.bankS = damp(this.bankS || 0, clamp(bankRaw, -0.85, 0.85), 0.22, dt);
    const bankT = this.bankS;
    const roll = -Math.asin(clamp(ry, -1, 1));
    const wRoll = this.wx * fx + this.wy * fy + this.wz * fz;
    const bankK = (wet * 0.85 + 0.15 * Math.min(1, groundN * 3)) * upright;
    const li = this.leanIn;
    let tb = ((150 + 90 * li) * (bankT - roll) - (24 + 14 * li) * wRoll) * Math.max(bankK, 0.55 * li * upright * Math.min(1, wet * 4 + groundN * 4));
    // the rider can only shove so hard, and never past the point of no return
    tb = this.Ix * clamp(tb, -42, 42) * smoothstep(1.35, 1.05, Math.abs(roll));
    // Leaned past ~50 degrees the wide hull and the rider's weight want to
    // bring it back up; only a big, violent hit should put it on its side.
    tb -= Math.sign(roll) * this.Ix * 34 * smoothstep(0.85, 1.3, Math.abs(roll)) * Math.min(1, wet * 3 + groundN * 3) * smoothstep(-0.2, 0.15, uy);
    Tx += fx * tb; Ty += fy * tb; Tz += fz * tb;

    // A hard carve scrubs speed: the banked hull and the deflected jet turn
    // forward speed into turning, so a full-lock turn tightens as it slows.
    {
      const scrub = 0.2 * Math.abs(aLat) * Math.min(1, wet * 2.2) * upright * (1 - 0.6 * this.leanIn);
      const sg = Math.sign(ucm);
      Fx -= fhx * sg * scrub * m; Fz -= fhz * sg * scrub * m;
    }

    // --- rider weight -------------------------------------------------------
    // lean > 0 = weight forward (nose down), lean < 0 = pull back (nose up)
    const air = wet < 0.02 && groundN < 0.02;
    // Is there time left in this flight for a trick? The sea is a known
    // function of time, so follow the ski's arc forward and find where it
    // meets the water (a wave rising to meet it, or the back of one falling
    // away). A trick can only START while there is time to finish it: a
    // Superman (sit-downs) needs a medium jump, a flip or roll (stand-ups) a
    // big one. Once allowed it stays allowed for the flight, so it never cuts
    // out mid-air. Chop and slide hops never come close.
    if (!air) {
      this.airOkS = this.airOkF = this.airDriven = false;
      this.airLeft = 0;
      this.predT = 0;
      this.airPitch = this.airRoll = 0;
    } else if (!(sp.standup ? this.airOkF : this.airOkS) && T.airTime < 0.6) {
      this.predT -= dt;
      if (!this.wasAir || (T.airTime > 0.12 && this.predT <= 0)) {
        this.predT = 0.04;
        this.airLeft = this.flightLeft(t, this.py - lowY);
        // going round, the deck, pole and rider swing down below the hull, so
        // a flip or roll has to be done with the ski that much higher up
        const leftRot = (this.airLeftRot = sp.standup ? this.flightLeft(t, this.py - lowY + ROT_ALLOW * sp.L) : this.airLeft);
        this.airEnd = T.airTime + leftRot;
        if (T.airTime > 0.12) {
          if (this.airLeft >= 0.45) this.airOkS = true;
          if (leftRot >= this.trickNeed) this.airOkF = true;
        }
      }
    }
    let tp;
    const pitchNow = Math.asin(clamp(fy, -1, 1));
    const wPitch = this.wx * rx + this.wy * ry + this.wz * rz;
    if (c.lean < 0 && !air) {
      // pulling back: the rider hunts for the balance point instead of
      // looping the ski over backwards
      const target = sp.wheelieMax * -c.lean;
      tp = clamp(this.Iz * (26 * (target - pitchNow) - 7 * wPitch), -sp.leanTorque * 1.4, sp.leanTorque);
    } else {
      tp = -c.lean * sp.leanTorque * (air ? 0.75 : 0.3);
    }
    // engine + rider sit aft of the centre of buoyancy: static bow-up trim
    tp += m * G * (sp.standup ? 0.1 : 0.17) * wet * upright;
    // sliding backwards the bow trips and digs in, the stern lifts
    if (ucm < -0.8) tp -= this.Iz * 15 * Math.min(-ucm - 0.8, 6) / 6 * wet * upright;
    // sliding hard sideways also loads the bow a little
    tp -= this.Iz * 1.4 * Math.min(Math.abs(vcm), 10) / 10 * wet * upright * clamp(1 - this.trim, 0, 1);
    tp += this.Iz * 6 * hop * (wetStern * 0.8 + 0.2);
    // not pulling back: the rider's weight keeps the bow from standing up
    {
      // a stand-up rider is right over the bars and keeps the nose down sooner
      const p0 = sp.standup ? 0.16 : 0.35;
      if (c.lean >= 0 && (!air || (sp.standup && T.airTime < 0.25)) && pitchNow > p0) tp -= Math.min(this.Iz * (24 * (pitchNow - p0) + 5 * Math.max(wPitch, 0)), sp.leanTorque * 2.2);
    }
    // At real speed the rider is braced and working the ski flat: without it
    // a 150 km/h hull would kite or stuff its nose on the first bit of chop.
    const stab = c.lean === 0 && !air ? smoothstep(17, 32, Math.abs(ucm)) * upright : 0;
    if (stab > 0) {
      tp += clamp(this.Iz * (20 * (0.05 - pitchNow) - 7 * wPitch), -sp.leanTorque * 3, sp.leanTorque * 3) * stab;
    }
    // --- stand-up: sink the nose, then pop out of the water --------------------
    // Freestyle riders bury the bow at low speed (weight forward, no steering),
    // then let it go or yank back: the buoyant nose shoots up and the ski
    // launches, which is how flat-water backflips are done.
    if (sp.standup) {
      const bowDepth = this.ptDepth[8];
      const subbing = !air && c.lean > 0.5 && Math.abs(c.steer) < 0.35 && Math.hypot(this.vx, this.vz) < (this.subT > 0 ? 13 : 9) && c.throttle > 0.2;
      if (subbing) {
        tp -= this.Iz * 9 * upright;
        Fy -= m * 3 * upright;
        // a buried nose is a big brake: the ski stops accelerating
        if (bowDepth > 0.12) {
          const u = Math.max(ucm, 0);
          Fx -= fhx * u * m * 2.4;
          Fz -= fhz * u * m * 2.4;
        }
        if (bowDepth > 0.22) this.subT = Math.min(1.4, this.subT + dt);
      } else if (this.subT > 0.3 && !air && c.lean < 0.2) {
        // let go: the buried, buoyant hull drives up out of the water for a
        // moment (a push over a quarter second, not an instant kick, so the
        // water's drag on the way up is part of it)
        this.popT = 0.26;
        this.popK = Math.min(1, this.subT);
        this.subT = 0;
        T.pop = 1;
      } else this.subT = Math.max(0, this.subT - dt * 2);
      if (this.popT > 0) {
        this.popT -= dt;
        const k = this.popK;
        // only while the hull is still in the water pushing up
        const inWater = Math.min(1, wet * 4 + 0.15);
        Fy += m * (25 + 18 * k) * (sp.popK || 1) * upright * inWater;
        tp += this.Iz * (6 + 4 * k) * inWater;
      }
    }
    // stretched out off the tray (Superman), only in the air

    // Air tricks only count when pressed after leaving the water, and only off
    // a real launch (a wave, ramp or nose-sink pop with ~0.6 s of air, never a
    // skip off the chop). The slide button is never a trick button, so
    // starting a powerslide over chop can never roll the ski. (Pulling back
    // at the lip of a real launch is how a backflip is thrown, so that one
    // may be held through take-off.)
    if (air && !this.wasAir) this.airHeld = { lean: c.lean, steer: sN, trick: c.trick, vy: this.vy };
    if (!air) this.airHeld = null;
    let aLean = c.lean;
    let aSteer = sN;
    let aTrick = c.trick > 0.5;
    if (this.airHeld) {
      const h = this.airHeld;
      if (h.lean < -0.3 && c.lean >= -0.3) h.lean = 0;
      if (Math.abs(h.steer) > 0.3 && Math.abs(sN) <= 0.3) h.steer = 0;
      if (h.trick > 0.5 && c.trick <= 0.5) h.trick = 0;
      if (!sp.standup && h.lean < -0.3 && c.lean < -0.3 && h.vy < 3.8) aLean = 0;
      if (Math.abs(h.steer) > 0.3 && Math.abs(sN) > 0.3) aSteer = 0;
      if (h.trick > 0.5) aTrick = false;
      // a strong launch, or a medium one that has already been airborne for
      // half a second (skips off the chop are over long before that).
      // Stand-ups go by the predicted flight instead: a Superman needs a
      // medium jump, a flip or roll a big one.
      const real = T.airTime > 0.12 && (h.vy >= 3.8 || (T.airTime > 0.45 && h.vy >= 2.5));
      const okS = this.airOkS;
      // stand-ups: pull back in the air and the flip starts, however much air
      // is left (too little and you under-rotate: that is on you)
      const okF = sp.standup ? T.airTime > 0.06 : real;
      if (!okF) {
        aLean = Math.max(aLean, 0);
        aSteer = 0;
      }
      if (!okS) aTrick = false;
      // and only START while there is still time to finish it: a press late in
      // the flight does nothing (a trick already under way carries on)
      const leftNow = this.airEnd - T.airTime;
      if (!sp.standup && this.superman < 0.1 && leftNow < 0.35) {
        aLean = Math.max(aLean, 0);
        aSteer = sp.standup ? 0 : aSteer;
        aTrick = false;
      }
    } else aTrick = false;
    // asked for a trick this jump cannot fit (too small, or too late): the
    // game says so
    // (only for a fresh press in the air: holding pull-back off the water
    // through a hop is a wheelie, not a flip attempt)
    const held = this.airHeld && (sp.standup ? this.airHeld.lean < -0.3 : this.airHeld.trick > 0.5);
    const asked = !held && (sp.standup ? c.lean < -0.5 : c.trick > 0.5);
    const got = sp.standup ? aLean < -0.3 : aTrick;
    T.trickTry = !sp.standup && air && T.airTime > 0.3 && asked && !got && !this.airDriven && this.superman < 0.1 ? 1 : 0;
    // sit-downs: trick button in the air = Superman (hands on the bars, legs
    // kicked out behind the ski); get back on the seat before you land
    this.superman = damp(this.superman, !sp.standup && air && aTrick ? 1 : 0, aTrick ? 0.09 : 0.07, dt);
    if (air && sp.standup) {
      // Stand-ups flip: pull back and the rider throws the ski round with the
      // pole; steer to spin. Let go and a rotation that is under way carries
      // on (you cannot stop a flip in mid-air); once upright the rider
      // settles it to land.
      const K = 8;
      const settle = smoothstep(0.2, 0.45, T.airTime) * smoothstep(0.15, 0.5, uy);
      // a ski that left the face rotating on its own (looping out) the rider fights
      const fight = this.airDriven ? 0 : 1 - smoothstep(0.3, 0.7, uy);
      // The flip aims to come round to slightly nose-up for the landing
      // (the ski left the lip already pitched up, so that is a little under a
      // full turn from take-off). Holding on with air to spare commits to a
      // double.
      const TWO_PI = Math.PI * 2;
      if (aLean < -0.3 && !this.airDriven) {
        // every flip drifts a little off square one way or the other
        const h = Math.sin(this.time * 12.9898 + this.px * 0.0781) * 43758.5453;
        const r = h - Math.floor(h);
        this.wobble = (r < 0.5 ? -1 : 1) * (0.45 + r * 0.9);
        this.pitch0 = pitchNow - this.airPitch;
        this.roll0 = this.airRoll;
        this.flipN = 1;
      }
      const goal = TWO_PI * (this.flipN || 1) + (0.12 - (this.pitch0 || 0));
      const done0 = TWO_PI * ((this.flipN || 1) - 1);
      const prog = this.airDriven ? clamp((this.airPitch - done0) / (goal - done0), 0, 1) : 0; // how far round this flip is
      const left = goal - this.airPitch;
      if (this.airDriven && aLean < -0.3 && prog > 0.8 && this.airEnd - T.airTime - left / (sp.flipRate * TUCK) > TWO_PI / (sp.flipRate * TUCK) + 0.25) {
        this.flipN++; // plenty of air left and still pulling: go round again
      }
      if (aLean < -0.3 && left > 0.05) {
        // thrown hard, fastest upside down, easing off as the rider untucks
        // and spots the landing
        const shape = 0.78 + 0.44 * Math.sin(Math.PI * prog);
        const want = -aLean * Math.min(this.tuckRate(sp.flipRate, left) * shape, 0.6 + 4.5 * left);
        // spinning up the rider throws it; slowing down they untuck, quicker
        tp = this.Iz * (want < wPitch ? 10 : 5.5) * (want - wPitch);
        this.airDriven = true;
      } else if (this.airDriven && left < 0.15) {
        // round: the rider stops it at the landing attitude
        tp = this.Iz * (10 * (0.12 - pitchNow) - 9 * wPitch);
      } else if (this.airDriven && Math.abs(wPitch) > 2.2 && uy < 0.6) {
        // let go: the rider untucks, so a tucked-up fast flip slows to the
        // ski's normal rate and carries on round
        tp = -this.Iz * (0.6 * wPitch + 4 * (wPitch - clamp(wPitch, -sp.flipRate, sp.flipRate)));
      } else tp = this.Iz * ((6 * (0.04 - clamp(aLean, -1, 1) * 0.25 - pitchNow) - 3.5 * wPitch) * settle + (5 * (0.04 - pitchNow) - 4 * wPitch) * fight);
      // roll: the rider soaks it up. Mid-flip the ski leans a little off
      // axis and comes back square by the end (no flip is perfectly square).
      // (an off-square lean that peaks upside down and is gone by the end)
      const low = 1 - smoothstep(0.3, 0.7, uy);
      const lean = this.airDriven && prog < 1 ? this.wobble * 0.2 * Math.sin(Math.PI * prog) : 0;
      const tr = this.Ix * ((9 * -roll - 4.5 * wRoll) * settle - 6 * wRoll * smoothstep(0.2, 0.5, uy) + (this.airDriven ? (7 * (lean - (this.airRoll - (this.roll0 || 0))) - 5 * wRoll) * low : (5 * -roll - 4 * wRoll) * fight));
      if (Math.abs(aSteer) > 0.15) {
        const ts = this.Iy * K * (aSteer * sp.spinRate - yawRateR);
        Tx -= ux * ts; Ty -= uy * ts; Tz -= uz * ts;
      }
      Tx += fx * tr; Ty += fy * tr; Tz += fz * tr;
      // how tucked up the rider is: in as the flip starts, out to land
      T.tuck = this.airDriven ? smoothstep(0, 0.12, prog) * (1 - smoothstep(0.6, 0.9, prog)) : 0;
    } else if (air) {
      // Out of the water there is nothing to push against, so no flips, rolls
      // or spins can be started up here. Whatever rotation the ski had when it
      // left the water carries on: a flat 360 is thrown by turning hard into
      // the lip. The rider can only shift weight to nudge the nose up or down
      // (pull back / lean forward) and settle the ski for the landing, and
      // much less of that while stretched out in a Superman.
      const settle = smoothstep(0.2, 0.45, T.airTime) * smoothstep(0.12, 0.5, uy) * (1 - 0.6 * this.superman);
      const pitchT = 0.06 - clamp(c.lean, -1, 1) * 0.28;
      tp = this.Iz * (4 * (pitchT - pitchNow) - 2.5 * wPitch) * settle;
      // the rider's weight soaks up any roll the ski took off with straight
      // away, so a slide that gets a bit of air does not keep rolling over
      const tr = this.Ix * ((4.5 * -roll - 2.5 * wRoll) * settle - 7 * wRoll * smoothstep(-0.1, 0.3, uy));
      Tx += fx * tr; Ty += fy * tr; Tz += fz * tr;
    }
    Tx += rx * tp; Ty += ry * tp; Tz += rz * tp;

    // --- aero + angular damping --------------------------------------------
    const spd = Math.hypot(this.vx, this.vy, this.vz);
    Fx -= 0.45 * spd * this.vx; Fy -= 0.45 * spd * this.vy; Fz -= 0.45 * spd * this.vz;
    {
      const wr = wRoll, wyaw = this.wx * ux + this.wy * uy + this.wz * uz, wp = this.wx * rx + this.wy * ry + this.wz * rz;
      const kR = 0.2 + 1.6 * wet, kY = 0.12 + 0.75 * wet, kP = 0.2 + 2.6 * wet;
      const dr = -this.Ix * kR * wr, dy = -this.Iy * (kY * wyaw + 0.5 * wet * wyaw * Math.abs(wyaw)), dp = -this.Iz * kP * wp;
      Tx += fx * dr + ux * dy + rx * dp;
      Ty += fy * dr + uy * dy + ry * dp;
      Tz += fz * dr + uz * dy + rz * dp;
    }

    // Leaving the water mid-turn on a real launch, the rider throws the ski
    // round at the lip. Only a turn that is already happening gets carried
    // into the air: no turn at take-off, no spin.
    // A stand-up rider who is already pulling back at the lip pops the flip.
    if (sp.standup && air && !this.wasAir && c.lean < -0.4 && this.vy > 3.8) {
      this.wx += rx * 2.0; this.wy += ry * 2.0; this.wz += rz * 2.0;
    }
    if (air && !this.wasAir && this.vy > 2.5 && Math.abs(sN) > 0.5 && Math.abs(yawRateR) > 0.6 && Math.sign(sN) === Math.sign(yawRateR)) {
      const cap = sp.style === 'spark' || sp.standup ? 4.6 : 3.6;
      const want = Math.sign(yawRateR) * Math.min(Math.abs(yawRateR) * 1.7, cap);
      const dY = want - yawRateR;
      if (Math.sign(dY) === Math.sign(yawRateR)) {
        this.wx -= ux * dY; this.wy -= uy * dY; this.wz -= uz * dY;
      }
    }
    this.wasAir = air;

    // --- integrate ----------------------------------------------------------
    const ax = Fx / m, ay = Fy / m, az = Fz / m;
    this.vx += ax * dt; this.vy += ay * dt; this.vz += az * dt;
    this.px += this.vx * dt; this.py += this.vy * dt; this.pz += this.vz * dt;

    const tbx = (Tx * fx + Ty * fy + Tz * fz) / this.Ix;
    const tby = (Tx * ux + Ty * uy + Tz * uz) / this.Iy;
    const tbz = (Tx * rx + Ty * ry + Tz * rz) / this.Iz;
    this.wx += (fx * tbx + ux * tby + rx * tbz) * dt;
    this.wy += (fy * tbx + uy * tby + ry * tbz) * dt;
    this.wz += (fz * tbx + uz * tby + rz * tbz) * dt;
    const wl = Math.hypot(this.wx, this.wy, this.wz);
    if (wl > 14) {
      const k = 14 / wl;
      this.wx *= k; this.wy *= k; this.wz *= k;
    }
    const hx = 0.5 * dt;
    const dqx = (this.wx * qw + this.wy * qz - this.wz * qy) * hx;
    const dqy = (this.wy * qw + this.wz * qx - this.wx * qz) * hx;
    const dqz = (this.wz * qw + this.wx * qy - this.wy * qx) * hx;
    const dqw = -(this.wx * qx + this.wy * qy + this.wz * qz) * hx;
    let nqx = qx + dqx, nqy = qy + dqy, nqz = qz + dqz, nqw = qw + dqw;
    const ql = 1 / Math.hypot(nqx, nqy, nqz, nqw);
    this.qx = nqx * ql; this.qy = nqy * ql; this.qz = nqz * ql; this.qw = nqw * ql;

    // --- telemetry ----------------------------------------------------------
    T.speed = Math.hypot(this.vx, this.vz);
    T.u = ucm; T.v = vcm;
    T.slip = T.speed > 1.5 ? Math.atan2(vcm, Math.abs(ucm)) : 0;
    T.pitch = Math.asin(clamp(fy, -1, 1));
    T.roll = roll;
    T.yawRate = yawRateR;
    T.wet = wet;
    T.ground = groundN;
    T.airborne = air;
    T.airTime = air ? T.airTime + dt : 0;
    T.pumpLoad = this.pumpLoad;
    T.nozzleDepth = nozzleDepth;
    T.exposure = smoothstep(0.07, -0.05, nozzleDepth);
    T.thrustN = thrust / sp.thrust;
    T.power = power;
    T.rpmN = this.rpmN;
    T.jetSpeed = (9 + (sp.jet - 9) * power) * (0.25 + 0.75 * this.pumpLoad);
    T.trimAngle = trimAngle;
    T.steerAngle = delta;
    T.reverse = reverse;
    T.boost = this.boost;
    T.als = alsActive;
    T.lcArmed = this.lcArmed;
    T.lcLaunch = this.lcLaunch;
    T.superman = this.superman;
    if (!air || !sp.standup) T.tuck = 0;
    if (air) {
      this.airPitch += wPitch * dt;
      this.airRoll += wRoll * dt;
    }
    T.subT = this.subT;
    T.leanIn = this.leanIn;
    T.unhooked = unhooked;
    if (impact > T.impact) T.impact = impact;
    T.fx = fx; T.fy = fy; T.fz = fz; T.ux = ux; T.uy = uy; T.uz = uz; T.rx = rx; T.ry = ry; T.rz = rz;
    T.nozzle.x = this.px + nx; T.nozzle.y = this.py + ny; T.nozzle.z = this.pz + nz;
    T.jetDir.x = jx; T.jetDir.y = jy; T.jetDir.z = jz;
    T.nozzleVel.x = this.vx + this.wy * nz - this.wz * ny;
    T.nozzleVel.y = this.vy + this.wz * nx - this.wx * nz;
    T.nozzleVel.z = this.vz + this.wx * ny - this.wy * nx;
    T.gLong = (ax * fhx + az * fhz) / G;
    T.gLat = (ax * rhx + az * rhz) / G;
  }
}
