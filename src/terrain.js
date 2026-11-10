// Procedural archipelago. CPU heightfield (three-free so physics tests can use
// it); the renderer turns the same data into a texture + mesh.

import { makeNoise2D, smoothstep, clamp } from './util.js';

export const WORLD_SIZE = 4096; // metres, centred on the origin
export const TERRAIN_RES = 768;
const SEA_FLOOR = -26;

export const ISLANDS = [
  { x: -60, z: -700, r: 380, h: 88 },
  { x: 700, z: -220, r: 230, h: 46 },
  { x: 560, z: 560, r: 165, h: 26 },
  { x: -640, z: 280, r: 260, h: 60 },
  { x: -160, z: 860, r: 150, h: 20 },
  { x: 300, z: -330, r: 62, h: 9 },
  { x: -360, z: -150, r: 48, h: 7 },
  { x: 90, z: 470, r: 55, h: 8 },
  { x: 1150, z: 420, r: 120, h: 30 },
  { x: -1180, z: -520, r: 200, h: 52 },
  { x: 380, z: 1250, r: 180, h: 34 },
];
export const SANDBARS = [
  { x: 230, z: 170, r: 130, top: -0.9 },
  { x: -270, z: 560, r: 100, top: -0.75 },
  { x: 520, z: -620, r: 120, top: -1.1 },
];

export class Terrain {
  constructor() {
    this.size = WORLD_SIZE;
    this.res = TERRAIN_RES;
    this.data = new Float32Array(this.res * this.res);
    this.generate();
  }

  generate() {
    const N = makeNoise2D(1337);
    const res = this.res;
    const size = this.size;
    for (let j = 0; j < res; j++) {
      const z = (j / (res - 1) - 0.5) * size;
      for (let i = 0; i < res; i++) {
        const x = (i / (res - 1) - 0.5) * size;
        let h = SEA_FLOOR + N.fbm(x / 300, z / 300, 3) * 4;
        const warp = N.fbm(x / 240 + 9.1, z / 240 - 3.7, 3);
        const rough = N.fbm(x / 75 + 40, z / 75 + 11, 4);
        for (let k = 0; k < ISLANDS.length; k++) {
          const is = ISLANDS[k];
          const dx = x - is.x;
          const dz = z - is.z;
          if (Math.abs(dx) > is.r * 2.6 || Math.abs(dz) > is.r * 2.6) continue;
          const d = Math.hypot(dx, dz) / (is.r * (1 + 0.42 * warp));
          const e = 1 - d;
          let hi;
          if (e > 0) {
            const m = smoothstep(0.16, 0.9, e);
            hi = 13 * e + is.h * Math.pow(m, 1.35) * (0.72 + 0.9 * rough) + rough * 3 * smoothstep(0.1, 0.3, e);
          } else {
            hi = SEA_FLOOR * (1 - Math.exp(e * 1.55));
          }
          if (hi > h) h = hi;
        }
        for (let k = 0; k < SANDBARS.length; k++) {
          const sb = SANDBARS[k];
          const d = Math.hypot(x - sb.x, z - sb.z) / (sb.r * (1 + 0.5 * warp));
          const hi = sb.top + rough * 0.5 + SEA_FLOOR * (1 - Math.exp(-Math.max(0, d - 0.55) * 2.0));
          if (hi > h) h = hi;
        }
        this.data[j * res + i] = h;
      }
    }
    // make sure the border is deep so texture clamping reads as open ocean
    for (let i = 0; i < res; i++) {
      this.data[i] = this.data[(res - 1) * res + i] = this.data[i * res] = this.data[i * res + res - 1] = SEA_FLOOR;
    }
  }

  heightAt(x, z) {
    const res = this.res;
    const fx = clamp((x / this.size + 0.5) * (res - 1), 0, res - 1.001);
    const fz = clamp((z / this.size + 0.5) * (res - 1), 0, res - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const d = this.data;
    const o = j * res + i;
    const a = d[o] + (d[o + 1] - d[o]) * tx;
    const b = d[o + res] + (d[o + res + 1] - d[o + res]) * tx;
    return a + (b - a) * tz;
  }
}

// ---------------------------------------------------------------------------
// World = waves + terrain + solid props (ramps). This is what physics queries.
// ---------------------------------------------------------------------------
export class World {
  constructor(waves, terrain) {
    this.waves = waves;
    this.terrain = terrain;
    this.ramps = [];
    waves.depthAt = (x, z) => -terrain.heightAt(x, z);
    this._g = {};
  }

  addRamp(x, z, yaw, len = 11, width = 5.2, height = 2.3) {
    const r = { x, z, yaw, len, width, height, c: Math.cos(yaw), s: Math.sin(yaw) };
    this.ramps.push(r);
    return r;
  }

  rampHeight(r, x, z) {
    const dx = x - r.x;
    const dz = z - r.z;
    if (Math.abs(dx) > 16 || Math.abs(dz) > 16) return -99;
    // ramp local: lx along the run-up direction (yaw 0 = +X), lz across
    const lx = dx * r.c - dz * r.s;
    const lz = dx * r.s + dz * r.c;
    const base = -0.5;
    let h;
    if (lx < 0) h = base + lx * 0.6;
    else if (lx <= r.len) h = base + (r.height - base) * Math.pow(lx / r.len, 1.22);
    else h = r.height - (lx - r.len) * 5;
    const side = Math.abs(lz) - r.width / 2;
    if (side > 0) h -= side * 2.2;
    return h < -1.6 ? -99 : h;
  }

  groundAt(x, z, o) {
    let g = this.terrain.heightAt(x, z);
    let mu = 0.8;
    for (let i = 0; i < this.ramps.length; i++) {
      const rh = this.rampHeight(this.ramps[i], x, z);
      if (rh > g) {
        g = rh;
        mu = 0.04;
      }
    }
    if (o) o.mu = mu;
    return g;
  }

  sample(x, z, t, o) {
    this.waves.sample(x, z, t, o);
    o.water = o.h;
    o.ground = this.groundAt(x, z, o);
    return o;
  }

  groundNormal(x, z, n) {
    const e = 0.25;
    const hx = this.groundAt(x + e, z) - this.groundAt(x - e, z);
    const hz = this.groundAt(x, z + e) - this.groundAt(x, z - e);
    const nx = -hx / (2 * e);
    const nz = -hz / (2 * e);
    const l = 1 / Math.hypot(nx, 1, nz);
    n.x = nx * l;
    n.y = l;
    n.z = nz * l;
    return n;
  }

  waterHeight(x, z, t) {
    return this.waves.sample(x, z, t, this._g).h;
  }
}
