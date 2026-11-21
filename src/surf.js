// Breaking surf for the wave zone. Pure JS (no three.js) so physics can use it.
//
// Waves arrive in sets with lulls between them. Each one is a finite crest
// (a peak with shoulders that fade out, so there are gaps either side) that
// travels across the zone, steepens as it shoals, then breaks: it pitches at
// the peak and peels outward in both directions (an A-frame). Right at the
// peel point the face goes near vertical and the lip throws out into a
// barrel; behind it the wave collapses into a rolling bore of whitewater
// that slowly runs out of energy.
//
// Everything is a pure function of time, so the physics, the GPU and the
// lip meshes all agree on exactly where every wave is.

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const WAVE_ZONE = { x: 900, z: -950, rIn: 190, rOut: 340, dir: 2.45 };

export const SURF = {
  c: 8.5, // wave speed, m/s
  vPeel: 7.5, // how fast the break runs along the crest, m/s
  curl: 18, // distance behind the peel point that the tube stays open, m
  A0: 2.4, // face height at the break, m
  setN: 4, // waves per set
  gap: 10.5, // seconds between waves in a set
  lull: 24, // seconds of calm between sets
  spawnS: -390, // where waves appear (along their travel axis, from the zone centre)
  endS: 380,
  sBreak: -15, // roughly where they break
  max: 8, // most waves alive at once
};
SURF.period = SURF.setN * SURF.gap + SURF.lull;
SURF.life = (SURF.endS - SURF.spawnS) / SURF.c;

function hash(k, s) {
  const x = Math.sin(k * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class Surf {
  constructor() {
    const d = WAVE_ZONE.dir;
    this.dx = Math.cos(d);
    this.dz = Math.sin(d);
    // crest axis (left/right along the wave)
    this.nx = -this.dz;
    this.nz = this.dx;
    this.cx = WAVE_ZONE.x;
    this.cz = WAVE_ZONE.z;
    this.waves = [];
    for (let i = 0; i < SURF.max; i++) this.waves.push({ k: 0, sc: 0, amp: 0, faceW: 9, backW: 16, lp: 0, pd: -1, half: 90, lc: 0, sb: 0 });
    this.count = 0;
    this._t = NaN;
    // GPU payload
    this.uA = new Float32Array(SURF.max * 4); // sc, amp, faceW, backW
    this.uB = new Float32Array(SURF.max * 4); // lp, pd, half, lc
    this.uC = new Float32Array([this.dx, this.dz, this.cx, this.cz]);
    this._o = { h: 0, foam: 0, q: -1, sl: 0, reach: 0 };
  }

  spawnTime(k) {
    const set = Math.floor(k / SURF.setN);
    const i = k - set * SURF.setN;
    return set * SURF.period + i * SURF.gap + (hash(k, 1) - 0.5) * 2.4;
  }

  // work out which waves are alive at time t and where they are
  update(t) {
    if (t === this._t) return;
    this._t = t;
    const kLo = Math.floor((t - SURF.life) / SURF.period) * SURF.setN - SURF.setN;
    const kHi = Math.floor(t / SURF.period) * SURF.setN + SURF.setN * 2;
    let n = 0;
    for (let k = kLo; k <= kHi && n < SURF.max; k++) {
      const age = t - this.spawnTime(k);
      if (age < 0 || age > SURF.life) continue;
      const w = this.waves[n++];
      const sc = SURF.spawnS + SURF.c * age;
      const sb = SURF.sBreak + (hash(k, 2) - 0.5) * 40;
      const sh = smooth(SURF.spawnS, sb, sc);
      const fade = smooth(0, 9, age) * (1 - smooth(SURF.endS - 90, SURF.endS, sc));
      w.k = k;
      w.sc = sc;
      w.sb = sb;
      w.amp = SURF.A0 * (0.85 + hash(k, 3) * 0.3) * (0.45 + 0.55 * sh) * fade;
      w.faceW = 9.5 - 5.6 * sh * sh;
      w.backW = 17;
      w.lp = (hash(k, 4) - 0.5) * 100; // where it peaks
      w.lc = w.lp * 0.4 + (hash(k, 5) - 0.5) * 30; // middle of the crest
      w.half = 65 + hash(k, 6) * 55; // half the crest length before it fades
      w.pd = sc > sb ? ((sc - sb) / SURF.c) * SURF.vPeel : -1;
    }
    this.count = n;
  }

  pack(t) {
    this.update(t);
    for (let i = 0; i < SURF.max; i++) {
      const w = this.waves[i];
      const on = i < this.count;
      this.uA[i * 4] = w.sc;
      this.uA[i * 4 + 1] = on ? w.amp : 0;
      this.uA[i * 4 + 2] = w.faceW;
      this.uA[i * 4 + 3] = w.backW;
      this.uB[i * 4] = w.lp;
      this.uB[i * 4 + 1] = w.pd;
      this.uB[i * 4 + 2] = w.half;
      this.uB[i * 4 + 3] = w.lc;
    }
  }

  // Height of the surf at (x, z). out.foam = whitewater, out.q = how far into
  // the breaking section (0..1 tube, >1 collapsing), out.reach = how far the
  // lip throws out in front of the crest there.
  eval(x, z, t, out = this._o) {
    out.h = 0;
    out.foam = 0;
    out.q = -1;
    out.reach = 0;
    const rx = x - this.cx;
    const rz = z - this.cz;
    if (rx * rx + rz * rz > 480 * 480) return out;
    this.update(t);
    const s = rx * this.dx + rz * this.dz;
    const l = rx * this.nx + rz * this.nz;
    for (let i = 0; i < this.count; i++) {
      const w = this.waves[i];
      const sl = s - w.sc;
      if (sl < -60 || sl > 40) continue;
      const env = 1 - smooth(w.half, w.half + 50, Math.abs(l - w.lc));
      if (env <= 0) continue;
      const al = Math.abs(l - w.lp);
      let fw = w.faceW;
      // the section about to break stands up near vertical
      // the section about to break stands up near vertical, and stays that way
      // under the open tube until it collapses
      if (w.pd >= 0) fw += (2.9 - fw) * (al > w.pd ? 1 - smooth(0, 40, al - w.pd) : 1);
      const prof = sl > 0 ? Math.exp(-(sl * sl) / (fw * fw)) : Math.exp(-(sl * sl) / (w.backW * w.backW));
      const tr = (sl - 2.2 * fw) / (1.4 * fw);
      let h = w.amp * (prof - 0.1 * Math.exp(-tr * tr));
      let foam = 0;
      if (w.pd >= 0 && al < w.pd) {
        const q = (w.pd - al) / SURF.curl;
        const tl = (w.pd - al) / SURF.vPeel;
        const soupA = w.amp * 0.48 * Math.exp(-tl / 18);
        const sp = sl > 0 ? Math.exp(-(sl * sl) / 25) : Math.exp(-(sl * sl) / 121);
        const k = smooth(1.4, 2.0, q);
        h += (soupA * sp - h) * k;
        const fs = (sl + 3) / 9;
        foam = k * Math.exp(-tl / 26) * Math.exp(-fs * fs);
        if (q < 2.0 && env * w.amp > out.reach * 0.8) {
          out.q = q;
          out.sl = sl;
          out.reach = w.amp * env * (0.2 + 1.6 * smooth(0, 0.45, q));
        }
      }
      out.h += h * env;
      out.foam = Math.max(out.foam, foam * env);
    }
    return out;
  }

  height(x, z, t) {
    return this.eval(x, z, t).h;
  }

  // Highest the surf can be anywhere right now (for spray collision bounds)
  maxAmp(t) {
    this.update(t);
    let m = 0;
    for (let i = 0; i < this.count; i++) m = Math.max(m, this.waves[i].amp);
    return m;
  }

  // 0..1 when (x, z) is inside an open barrel: under the lip, on the face
  barrelAt(x, z, t) {
    const o = this.eval(x, z, t, {});
    if (o.q < 0.2 || o.q > 1.6 || o.reach < 1.2) return 0;
    if (o.sl < 0.3 || o.sl > o.reach * 1.02) return 0;
    return smooth(0.2, 0.45, o.q) * (1 - smooth(1.4, 1.6, o.q));
  }
}

// GLSL twin of Surf.eval (height + whitewater). Needs uniforms uSurfA/B/C.
export const SURF_GLSL = /* glsl */ `
#define SURF_MAX ${SURF.max}
uniform vec4 uSurfA[SURF_MAX];
uniform vec4 uSurfB[SURF_MAX];
uniform vec4 uSurfC;
float surfField(vec2 p, out float foam) {
  foam = 0.0;
  vec2 r = p - uSurfC.zw;
  if (dot(r, r) > 480.0 * 480.0) return 0.0;
  float s = dot(r, uSurfC.xy);
  float l = dot(r, vec2(-uSurfC.y, uSurfC.x));
  float hsum = 0.0;
  for (int i = 0; i < SURF_MAX; i++) {
    vec4 A = uSurfA[i];
    vec4 B = uSurfB[i];
    if (A.y <= 0.0) continue;
    float sl = s - A.x;
    if (sl < -60.0 || sl > 40.0) continue;
    float env = 1.0 - smoothstep(B.z, B.z + 50.0, abs(l - B.w));
    if (env <= 0.0) continue;
    float al = abs(l - B.x);
    float fw = A.z;
    if (B.y >= 0.0) fw += (2.9 - fw) * (al > B.y ? 1.0 - smoothstep(0.0, 40.0, al - B.y) : 1.0);
    float prof = sl > 0.0 ? exp(-(sl * sl) / (fw * fw)) : exp(-(sl * sl) / (A.w * A.w));
    float tr = (sl - 2.2 * fw) / (1.4 * fw);
    float h = A.y * (prof - 0.1 * exp(-tr * tr));
    if (B.y >= 0.0 && al < B.y) {
      float q = (B.y - al) / ${SURF.curl.toFixed(1)};
      float tl = (B.y - al) / ${SURF.vPeel.toFixed(2)};
      float soupA = A.y * 0.48 * exp(-tl / 18.0);
      float sp = sl > 0.0 ? exp(-(sl * sl) / 25.0) : exp(-(sl * sl) / 121.0);
      float k = smoothstep(1.4, 2.0, q);
      h += (soupA * sp - h) * k;
      float fs = (sl + 3.0) / 9.0;
      foam = max(foam, k * exp(-tl / 26.0) * exp(-fs * fs) * env);
    }
    hsum += h * env;
  }
  return hsum;
}
`;
