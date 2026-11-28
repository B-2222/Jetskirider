// THE GORGE: a glacial river cut deep into layered grey schist, the kind of
// canyon you find in the Southern Alps. No ocean, no swell: the river steps
// down through a string of mini waterfalls and chutes from a lake at the top
// to a lake at the bottom. Between the drops there are rock gardens and
// gravel bars where the water is only ankle deep, boulders that break the
// surface, and a current that runs fastest over the lips.
//
// Everything here is plain maths (no three.js), so the physics, the race bot
// and the renderer all agree on where the water and the rock are.
//
// Along the river: s = metres from the top of the course (negative in the
// top lake), t = metres across (left of the flow is +t).

import { makeNoise2D, smoothstep, clamp, lerp } from './util.js';

const SIZE = 2048; // the world is smaller than the ocean maps, so it is finer
const RES = 1024; // 2 m cells
const FAR = 1e4; // "nowhere near the river"
const CORRIDOR = 260; // how far from the river the (s, t) lookup reaches

// the centreline, top to bottom
// (scaled to fit the world with room for the lakes)
const K = 0.9;
const CTRL = [[-820, -640], [-700, -600], [-560, -520], [-470, -390], [-400, -250], [-300, -150], [-150, -110], [-10, -60], [80, 60], [70, 210], [150, 340], [300, 410], [450, 480], [540, 610], [650, 720], [800, 790], [900, 830]];
CTRL.forEach((p) => { p[0] *= K; p[1] *= K; });
const PRE = 120; // the top lake reaches this far behind the start
const POST = 140; // and the bottom one this far past the end

// The drops, top to bottom: where the lip is (s), how far the water falls
// (m), over how long (m), and where the deeper tongue through the ledge is
// (as a fraction of the half-width, + is river left).
export const DROPS = [
  { s: 280, dh: 1.1, len: 8, tongue: 0.25, name: 'Entry Rapid' },
  { s: 470, dh: 1.6, len: 6, tongue: -0.35, name: 'The Chute' },
  { s: 690, dh: 0.9, len: 13, tongue: 0.0, name: 'The Staircase' },
  { s: 890, dh: 2.1, len: 6.5, tongue: 0.3, name: 'Big Drop' },
  { s: 1120, dh: 1.0, len: 9, tongue: -0.2, name: 'Twin Rocks' },
  { s: 1320, dh: 1.5, len: 6, tongue: 0.35, name: 'Corkscrew' },
  { s: 1530, dh: 1.2, len: 8, tongue: -0.3, name: 'Shingle Shoot' },
  { s: 1750, dh: 1.8, len: 6, tongue: 0.2, name: 'The Last Drop' },
  { s: 1950, dh: 1.0, len: 10, tongue: -0.15, name: 'Tailout' },
];
export const BRIDGE_S = 1010; // the old concrete arch over the slot
const TOP_LEVEL = 18;

// ankle-deep rock gardens: [from s, to s, centre across (fraction), half-width (fraction), depth]
const SHALLOWS = [
  [580, 630, 0.45, 0.5, 0.36],
  [790, 820, -0.5, 0.45, 0.4],
  [1220, 1275, 0.0, 0.42, 0.38],
  [1420, 1465, -0.45, 0.5, 0.34],
  [1645, 1690, 0.4, 0.5, 0.37],
  [1860, 1905, 0.3, 0.4, 0.4],
];

const sm = (a, b, x) => smoothstep(a, b, x);
const N = makeNoise2D(9177);

// ---------------------------------------------------------------------------
// the centreline, sampled every half metre
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

function buildPath() {
  const pts = [];
  for (let i = 0; i < CTRL.length - 1; i++) {
    const p0 = CTRL[Math.max(0, i - 1)], p1 = CTRL[i], p2 = CTRL[i + 1], p3 = CTRL[Math.min(CTRL.length - 1, i + 2)];
    for (let k = 0; k < 400; k++) pts.push(catmull(p0, p1, p2, p3, k / 400));
  }
  pts.push(CTRL[CTRL.length - 1]);
  // resample by arc length
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  const STEP = 0.5;
  const n = Math.floor((L + PRE + POST) / STEP) + 1;
  const x = new Float32Array(n), z = new Float32Array(n), tx = new Float32Array(n), tz = new Float32Array(n);
  const a0 = pts[0], a1 = pts[8];
  const d0 = [a1[0] - a0[0], a1[1] - a0[1]];
  const l0 = Math.hypot(d0[0], d0[1]);
  const b0 = pts[pts.length - 9], b1 = pts[pts.length - 1];
  const d1 = [b1[0] - b0[0], b1[1] - b0[1]];
  const l1 = Math.hypot(d1[0], d1[1]);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = -PRE + i * STEP;
    if (s < 0) {
      x[i] = a0[0] + (d0[0] / l0) * s;
      z[i] = a0[1] + (d0[1] / l0) * s;
    } else if (s > L) {
      x[i] = b1[0] + (d1[0] / l1) * (s - L);
      z[i] = b1[1] + (d1[1] / l1) * (s - L);
    } else {
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const f = (s - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
      x[i] = lerp(pts[j][0], pts[j + 1][0], f);
      z[i] = lerp(pts[j][1], pts[j + 1][1], f);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 4), b = Math.min(n - 1, i + 4);
    const dx = x[b] - x[a], dz = z[b] - z[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l;
    tz[i] = dz / l;
  }
  // signed curvature (1/m), smoothed: + bends to river left
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 40), b = Math.min(n - 1, i + 40);
    const cross = tx[a] * tz[b] - tz[a] * tx[b];
    k[i] = cross / ((b - a) * STEP || 1);
  }
  return { x, z, tx, tz, k, n, STEP, L, s0: -PRE };
}

export class Gorge {
  constructor() {
    this.size = SIZE;
    this.res = RES;
    this.path = buildPath();
    this.L = this.path.L;
    this.sMin = -PRE;
    this.sMax = this.L + POST;
    this.drops = DROPS;
    this.bridgeS = BRIDGE_S;
    // the water level and its slope along s, every quarter metre
    const LS = 0.25;
    const nl = Math.ceil((this.sMax - this.sMin) / LS) + 2;
    this.lvl = new Float32Array(nl);
    this.lvlD = new Float32Array(nl);
    this.LS = LS;
    for (let i = 0; i < nl; i++) {
      const s = this.sMin + i * LS;
      let h = TOP_LEVEL;
      for (const d of DROPS) h -= d.dh * this.dropShape((s - d.s) / d.len);
      this.lvl[i] = h;
    }
    for (let i = 0; i < nl; i++) this.lvlD[i] = (this.lvl[Math.min(nl - 1, i + 1)] - this.lvl[Math.max(0, i - 1)]) / (2 * LS);
    this.bottomLevel = this.lvl[nl - 1];
    this.buildLookup();
    this.buildRocks();
  }

  // 0 above the lip, 1 at the bottom: rounds over the lip, falls steeply,
  // runs out into the pool
  dropShape(u) {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    return u * u * (3 - 2 * u);
  }

  // --- along the river ------------------------------------------------------
  idx(s) {
    const p = this.path;
    return clamp(Math.round((s - p.s0) / p.STEP), 0, p.n - 1);
  }

  level(s) {
    const f = clamp((s - this.sMin) / this.LS, 0, this.lvl.length - 1.001);
    const i = f | 0;
    return this.lvl[i] + (this.lvl[i + 1] - this.lvl[i]) * (f - i);
  }

  levelSlope(s) {
    const f = clamp((s - this.sMin) / this.LS, 0, this.lvl.length - 1.001);
    const i = f | 0;
    return this.lvlD[i] + (this.lvlD[i + 1] - this.lvlD[i]) * (f - i);
  }

  // half-width of the water
  width(s) {
    const L = this.L;
    let w = 15 + 5 * N.noise(s / 90, 3.1) + 4 * N.noise(s / 33, 8.7);
    // pools below each drop open out
    for (const d of DROPS) {
      const u = (s - d.s - d.len) / 60;
      if (u > -0.2 && u < 1.3) w += 13 * sm(-0.2, 0.15, u) * (1 - sm(0.5, 1.3, u));
    }
    // the slot under the bridge
    w = lerp(w, 10.5, 1 - sm(40, 110, Math.abs(s - BRIDGE_S)));
    // the lakes
    if (s < 210) {
      const lake = s < 0 ? 88 * Math.sqrt(Math.max(0, 1 - (s / -(PRE - 8)) ** 2)) : 88;
      w = lerp(w, lake, 1 - sm(90, 210, s));
    }
    if (s > L - 140) {
      const e = s - L;
      const lake = e > 0 ? 105 * Math.sqrt(Math.max(0, 1 - (e / (POST - 8)) ** 2)) : 105;
      w = lerp(w, lake, sm(L - 140, L - 20, s));
    }
    return Math.max(0.5, w);
  }

  // water depth in the middle (before shallows and ledges)
  depth(s) {
    let d = 2.6;
    for (const dr of DROPS) {
      const u = s - dr.s - dr.len;
      if (u > -2 && u < 40) d = Math.max(d, 2.6 + 2.2 * sm(-2, 4, u) * (1 - sm(12, 40, u))); // plunge pool
    }
    if (s < 160) d = lerp(d, 7, 1 - sm(60, 160, s));
    if (s > this.L - 120) d = lerp(d, 8, sm(this.L - 120, this.L, s));
    return d;
  }

  // the world height of the land on either side (the top of the walls)
  plateau(x, z) {
    // 0 at the top lake, 1 at the bottom one
    const q = clamp(((x / K + 870) * 0.66 + (z / K + 700) * 0.75) / 2315, 0, 1);
    let h = lerp(27, 13, q) + 38 * sm(0.0, 0.13, q) * (1 - sm(0.84, 0.98, q));
    h += 9 * N.fbm(x / 260, z / 260, 3) + 3 * N.fbm(x / 60, z / 60, 2);
    return h;
  }

  // big ranges rising toward the edge of the world (away from the river)
  ranges(x, z) {
    const e = Math.max(Math.abs(x), Math.abs(z));
    return 150 * Math.pow(sm(620, 1010, e + 110 * N.noise(x / 300, z / 300)), 1.5) * (0.75 + 0.5 * N.fbm(x / 180, z / 180, 3));
  }

  // the ground at (s, t) (x, z: the same point in the world)
  groundST(s, t, x, z, detail = 0) {
    const W = this.width(s);
    const Lw = this.level(s);
    const at = Math.abs(t);
    const u = at / W;
    if (u <= 1) {
      let D = this.depth(s) * (1 - Math.pow(u, 2.3));
      // gravel bars on the inside of bends
      const k = this.path.k[this.idx(s)];
      const inside = k * t > 0 ? clamp(Math.abs(k) * 220, 0, 1) : 0;
      D *= 1 - 0.75 * inside * sm(0.25, 0.9, u);
      // ledges at the lips, with a deeper tongue through them
      for (const d of DROPS) {
        const v = s - d.s;
        if (v > -16 && v < d.len + 2) {
          const ledge = sm(-16, -6, v) * (1 - sm(d.len * 0.6, d.len + 2, v));
          const tongue = 1 - sm(3.5, 6.5, Math.abs(t - d.tongue * W));
          const want = lerp(0.42, 1.5, tongue);
          D = lerp(D, Math.min(D, want), ledge);
        }
      }
      // rock gardens
      for (const g of SHALLOWS) {
        if (s > g[0] - 10 && s < g[1] + 10) {
          const along = sm(g[0] - 10, g[0], s) * (1 - sm(g[1], g[1] + 10, s));
          const across = 1 - sm(g[3] * 0.7, g[3], Math.abs(t / W - g[2]));
          const k2 = along * across;
          D = lerp(D, Math.min(D, g[4] + 0.12 * N.noise(s / 4, t / 4)), k2);
        }
      }
      return Lw - Math.max(D, 0.02) + 0.18 * N.noise(s / 7, t / 7) * (1 - u);
    }
    // the banks: a low ledge, then the cliff up to the land above
    const e = at - W;
    const top = Math.max(this.plateau(x, z), Lw + 5);
    const lake = Math.max(1 - sm(120, 230, s), sm(this.L - 170, this.L - 60, s));
    const ledgeH = lerp(0.6 + 0.8 * Math.abs(N.noise(s / 25, Math.sign(t) * 5)), 1.5, lake);
    const ledgeW = lerp(1 + 4 * Math.abs(N.noise(s / 40, Math.sign(t) * 9)), 12, lake);
    const cliffW = lerp(5 + 6 * Math.abs(N.noise(s / 60, Math.sign(t) * 2)), 70, lake);
    let g = Lw + ledgeH * sm(0, 1.4, e);
    const rise = sm(ledgeW, ledgeW + cliffW, e);
    // layered schist: the wall steps up in uneven bands
    const yRel = rise * (top - Lw - ledgeH);
    const band = 2.2 * N.noise(s / 18, yRel / 3.5 + Math.sign(t) * 11) * rise * (1 - rise) * 4 * (1 - lake);
    g += yRel + band;
    if (detail) g += detail * N.fbm(x / 2.2, z / 2.2, 2) * rise * (1 - rise) * 3 * (1 - lake);
    return g;
  }

  // --- the (s, t) lookup for any point in the world -------------------------
  buildLookup() {
    const res = RES, size = SIZE;
    const cell = size / (res - 1);
    this.sG = new Float32Array(res * res);
    this.tG = new Float32Array(res * res).fill(FAR);
    const best = new Float32Array(res * res).fill(FAR);
    const p = this.path;
    for (let i = 0; i < p.n; i += 1) {
      const s = p.s0 + i * p.STEP;
      const nx = -p.tz[i], nz = p.tx[i]; // river left
      for (let t = -CORRIDOR; t <= CORRIDOR; t += 0.7) {
        const x = p.x[i] + nx * t, z = p.z[i] + nz * t;
        const ci = Math.round((x / size + 0.5) * (res - 1));
        const cj = Math.round((z / size + 0.5) * (res - 1));
        if (ci < 0 || cj < 0 || ci >= res || cj >= res) continue;
        const o = cj * res + ci;
        // the true distance from this cell to this centreline point
        const cx = (ci / (res - 1) - 0.5) * size, cz = (cj / (res - 1) - 0.5) * size;
        const dx = cx - p.x[i], dz = cz - p.z[i];
        const d = Math.hypot(dx, dz);
        if (d < best[o]) {
          best[o] = d;
          this.sG[o] = s + (dx * p.tx[i] + dz * p.tz[i]);
          this.tG[o] = dx * nx + dz * nz;
        }
      }
    }
    this.cell = cell;
  }

  // (s, t) of a world point; t = FAR when it is nowhere near the river
  st(x, z, out) {
    const res = RES;
    const fx = clamp((x / SIZE + 0.5) * (res - 1), 0, res - 1.001);
    const fz = clamp((z / SIZE + 0.5) * (res - 1), 0, res - 1.001);
    const i = fx | 0, j = fz | 0;
    const ax = fx - i, az = fz - j;
    const o = j * res + i;
    const t00 = this.tG[o], t10 = this.tG[o + 1], t01 = this.tG[o + res], t11 = this.tG[o + res + 1];
    if (t00 >= FAR || t10 >= FAR || t01 >= FAR || t11 >= FAR) {
      const k = ax < 0.5 ? (az < 0.5 ? o : o + res) : az < 0.5 ? o + 1 : o + res + 1;
      out.s = this.sG[k];
      out.t = this.tG[k];
      return out;
    }
    const s00 = this.sG[o], s10 = this.sG[o + 1], s01 = this.sG[o + res], s11 = this.sG[o + res + 1];
    // across a fold (the medial line of a bend) do not blend two parts of the river
    if (Math.abs(s00 - s11) > 20 || Math.abs(s10 - s01) > 20) {
      const k = ax < 0.5 ? (az < 0.5 ? o : o + res) : az < 0.5 ? o + 1 : o + res + 1;
      out.s = this.sG[k];
      out.t = this.tG[k];
      return out;
    }
    out.s = (s00 * (1 - ax) + s10 * ax) * (1 - az) + (s01 * (1 - ax) + s11 * ax) * az;
    out.t = (t00 * (1 - ax) + t10 * ax) * (1 - az) + (t01 * (1 - ax) + t11 * ax) * az;
    return out;
  }

  // the land height anywhere (fills the terrain grid)
  heightAt(x, z) {
    const o = this._h || (this._h = {});
    this.st(x, z, o);
    const far = o.t >= FAR ? 1 : sm(150, 250, Math.abs(o.t));
    const rg = this.ranges(x, z) * far;
    if (o.t >= FAR || Math.abs(o.t) > CORRIDOR - 4) return this.plateau(x, z) + rg;
    return this.groundST(o.s, o.t, x, z) + rg;
  }

  // --- the water ------------------------------------------------------------
  // flow speed (m/s) down the river at (s, t)
  flow(s, t) {
    const W = this.width(s);
    let v = 1.5;
    if (s < 180) v = lerp(v, 0.25, 1 - sm(80, 180, s));
    if (s > this.L - 140) v = lerp(v, 0.3, sm(this.L - 140, this.L - 40, s));
    for (const d of DROPS) {
      const u = (s - d.s) / d.len;
      if (u > -3 && u < 5) v += (1.6 + 2.0 * d.dh) * sm(-3, 0, u) * (1 - sm(1.2, 5, u));
    }
    for (const g of SHALLOWS) if (s > g[0] - 5 && s < g[1] + 5) v += 0.8;
    return v * (1 - Math.pow(clamp(Math.abs(t) / W, 0, 1), 4));
  }

  // whitewater amount (0..1) at (s, t)
  white(s, t) {
    const W = this.width(s);
    let w = 0;
    for (const d of DROPS) {
      const u = (s - d.s) / d.len;
      if (u > -0.4 && u < 6) w = Math.max(w, sm(-0.4, 0.5, u) * (1 - sm(1.4, 6, u)) * clamp(0.5 + d.dh * 0.4, 0, 1));
    }
    for (const g of SHALLOWS) {
      if (s > g[0] - 8 && s < g[1] + 12) {
        const across = 1 - sm(g[3] * 0.6, g[3] * 1.2, Math.abs(t / W - g[2]));
        w = Math.max(w, 0.55 * across * sm(g[0] - 8, g[0], s) * (1 - sm(g[1], g[1] + 12, s)));
      }
    }
    return w;
  }

  // what physics needs: the surface, its slope, its velocity
  water(x, z, o) {
    const q = this._w || (this._w = {});
    this.st(x, z, q);
    const s = clamp(q.s, this.sMin, this.sMax);
    const lv = this.level(s);
    o.h = o.water = lv;
    o.vy = 0;
    const i = this.idx(s);
    const tx = this.path.tx[i], tz = this.path.tz[i];
    const sl = this.levelSlope(s);
    o.nx = -sl * tx;
    o.nz = -sl * tz;
    const v = q.t >= FAR ? 0 : this.flow(s, q.t);
    o.ux = tx * v;
    o.uz = tz * v;
    o.foam = 0;
    return o;
  }

  waterLevel(x, z) {
    const q = this._w2 || (this._w2 = {});
    this.st(x, z, q);
    return this.level(clamp(q.s, this.sMin, this.sMax));
  }

  // --- boulders ---------------------------------------------------------------
  buildRocks() {
    const R = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const at = (s, tf, r, above) => {
      const i = this.idx(s);
      const W = this.width(s);
      const t = tf * W;
      const p = this.path;
      R.push({ x: p.x[i] - p.tz[i] * t, z: p.z[i] + p.tx[i] * t, r, top: this.level(s) + above, s, t });
    };
    // in the rock gardens
    for (const g of SHALLOWS) {
      for (let k = 0; k < 5; k++) at(g[0] + rnd() * (g[1] - g[0]), g[2] + (rnd() * 2 - 1) * g[3] * 0.8, 1.1 + rnd() * 1.4, 0.25 + rnd() * 0.9);
    }
    // guarding the lips, either side of the tongue
    for (const d of DROPS) {
      for (const sd of [-1, 1]) at(d.s - 2 - rnd() * 6, clamp(d.tongue + sd * (0.45 + rnd() * 0.3), -0.92, 0.92), 1.3 + rnd() * 1.2, 0.4 + rnd() * 1.1);
    }
    // a few big ones mid-river
    for (const s of [380, 930, 1190, 1400, 1810]) at(s, rnd() * 0.8 - 0.4, 2.2 + rnd() * 1.3, 1.0 + rnd() * 1.4);
    // and along the banks
    for (let s = 220; s < this.L - 150; s += 23 + rnd() * 30) at(s, (rnd() < 0.5 ? -1 : 1) * (0.82 + rnd() * 0.16), 1.0 + rnd() * 2.2, 0.2 + rnd() * 1.6);
    this.rocks = R;
    // a coarse bucket grid so a lookup only checks rocks nearby
    this.rockCell = 16;
    this.rockMap = new Map();
    for (const r of R) {
      const ci = Math.floor(r.x / this.rockCell), cj = Math.floor(r.z / this.rockCell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const k = (ci + a) * 4096 + (cj + b);
        if (!this.rockMap.has(k)) this.rockMap.set(k, []);
        this.rockMap.get(k).push(r);
      }
    }
  }

  // the top of a boulder here, or -99
  rockAt(x, z) {
    const list = this.rockMap.get(Math.floor(x / this.rockCell) * 4096 + Math.floor(z / this.rockCell));
    if (!list) return -99;
    let h = -99;
    for (const r of list) {
      const d2 = ((x - r.x) ** 2 + (z - r.z) ** 2) / (r.r * r.r);
      if (d2 >= 1) continue;
      // a rounded dome sitting well into the riverbed
      const y = r.top - r.r * 1.1 * (1 - Math.sqrt(1 - d2));
      if (y > h) h = y;
    }
    return h;
  }

  // colours for the land mesh away from the canyon: tussock and scrub on the
  // tops, grey rock where it is steep, snow on the high ranges
  colorAt(x, z, h, slope, n, c) {
    const tus = [0.36, 0.3, 0.16], grass = [0.16, 0.2, 0.08], rock = [0.2, 0.2, 0.19], snow = [0.85, 0.88, 0.92], scrub = [0.09, 0.13, 0.06];
    const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    let col = mix(grass, tus, sm(0.3, 0.75, n + 0.15 * N.noise(x / 13, z / 13)));
    col = mix(col, scrub, sm(0.55, 0.8, N.noise(x / 70 + 4, z / 70)) * 0.7);
    col = mix(col, rock, sm(0.45, 0.85, slope) + sm(80, 120, h) * 0.6);
    col = mix(col, snow, sm(118, 150, h + 12 * N.noise(x / 40, z / 40)) * (1 - sm(0.9, 1.4, slope) * 0.6));
    c.setRGB(col[0], col[1], col[2]);
  }

  // the coarse land mesh leaves out what the detailed canyon mesh covers
  covered(x, z) {
    const o = this._c || (this._c = {});
    this.st(x, z, o);
    return o.t < FAR && Math.abs(o.t) < this.extent(o.s, o.t) - 6;
  }

  // how far across (each side) the detailed canyon mesh goes at s: less on
  // the inside of a tight bend, where it would fold over itself
  extent(s, side) {
    const k = this.path.k[this.idx(s)];
    const r = Math.abs(k) > 1e-5 ? 1 / Math.abs(k) : 1e5;
    const inner = k * side > 0;
    return inner ? Math.min(150, r * 0.8) : 150;
  }

  // somewhere calm to put a rider back on the water near s: on the
  // centreline, a little upstream, never on a lip or in a rock garden
  safeSpot(s) {
    let q = clamp(s - 10, 0, this.L - 10);
    for (let k = 0; k < 6; k++) {
      let moved = false;
      for (const d of DROPS) if (q > d.s - 22 && q < d.s + d.len + 4) { q = d.s - 24; moved = true; }
      for (const g of SHALLOWS) if (q > g[0] - 12 && q < g[1] + 12) { q = g[0] - 14; moved = true; }
      if (!moved) break;
    }
    const w = this.toWorld(q, 0);
    return { x: w.x, z: w.z, yaw: this.at(q).yaw };
  }

  // a point on the centreline and the way the river runs there
  at(s) {
    const i = this.idx(s);
    const p = this.path;
    return { x: p.x[i], z: p.z[i], tx: p.tx[i], tz: p.tz[i], yaw: Math.atan2(-p.tz[i], p.tx[i]) };
  }

  // (s, t) to world
  toWorld(s, t) {
    const i = this.idx(s);
    const p = this.path;
    return { x: p.x[i] - p.tz[i] * t, z: p.z[i] + p.tx[i] * t };
  }
}
