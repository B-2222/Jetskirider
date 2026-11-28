// BREAKER BEACH: a long white-sand surf beach in a shallow crescent bay,
// with a sandbar that makes the waves stand up and break, a gutter inside
// it, then the shore break. Behind the sand: the berm, grassy dunes, coastal
// scrub and pines, rocky headlands at both ends. Built for wave jumping.
//
// Plain maths (no three.js): the terrain grid, the physics and the renderer
// all use it. Across the beach: d = metres inland from the waterline
// (negative out to sea).

import { makeNoise2D, smoothstep, clamp, lerp } from './util.js';

const N = makeNoise2D(2718);
const sm = smoothstep;

export const SHORE_Z = 250; // the waterline at the middle of the bay
export const HALF_BEACH = 860; // the sand runs this far either way

export class Beach {
  constructor() {
    this.size = 4096;
    this.res = 768;
  }

  // where the waterline is for this x (a gentle crescent, headlands at the ends)
  shoreZ(x) {
    const ax = Math.abs(x);
    let z = SHORE_Z + 0.00011 * x * x + 6 * N.noise(x / 140, 1.7);
    // the headlands push out to sea
    z += 340 * Math.pow(sm(HALF_BEACH - 120, HALF_BEACH + 260, ax), 1.4);
    return z;
  }

  // across-beach distance (inland is positive)
  dOf(x, z) {
    return this.shoreZ(x) - z;
  }

  // how rocky it is here (the headlands)
  rocky(x) {
    return sm(HALF_BEACH - 140, HALF_BEACH + 40, Math.abs(x));
  }

  profile(d, x) {
    const n = N.noise(x / 60, d / 60);
    if (d < 0) {
      // offshore: deep water, the outer sandbar (where the waves stand up),
      // the gutter, a little inner bar, then the shore break
      let h = lerp(-3.2 + 0.4 * n, -26, sm(-110, -760, d));
      h += 1.5 * Math.exp(-(((d + 150) / 26) ** 2)); // the outer bar, where they stand up
      h += 2.0 * Math.exp(-(((d + 48) / 13) ** 2)); // the inner bar
      if (d > -30) h = lerp(h, 0, sm(-30, 0, d));
      return h;
    }
    // the beach face up to the berm, the dry sand, the dunes, the land behind
    let h = 2.1 * sm(0, 38, d) + 0.02 * d * (1 - sm(0, 38, d));
    h += 0.5 * sm(40, 95, d);
    const dune = sm(92, 128, d) * (5.5 + 3 * N.fbm(x / 70, 3.3, 3));
    const back = sm(140, 230, d) * (1.5 + 2.5 * N.fbm(x / 45, d / 45, 3));
    h += dune - sm(150, 200, d) * 2.5 + back;
    h += sm(220, 700, d) * (8 + 22 * (N.fbm(x / 300, d / 300, 3) * 0.5 + 0.5));
    // wind ripples and hummocks on the dry sand
    h += 0.12 * N.noise(x / 7, d / 7) * sm(40, 60, d) + 0.6 * N.noise(x / 18, d / 18) * sm(100, 160, d);
    return h;
  }

  heightAt(x, z) {
    const d = this.dOf(x, z);
    let h = this.profile(d, x);
    // rocky headlands: cliffs and reef at the ends of the bay
    const rk = this.rocky(x);
    if (rk > 0) {
      const cliff = (d > 0 ? 14 + 16 * sm(0, 60, d) : 14 * (1 - sm(0, 18, -d)) - 10 * sm(10, 60, -d)) + 5 * N.fbm(x / 25, z / 25, 3);
      const reef = d < 0 ? -1.2 - 4 * sm(20, 120, -d) + 1.5 * N.fbm(x / 14, z / 14, 2) : cliff;
      h = lerp(h, Math.max(cliff, reef), rk);
    }
    // the far hills round the bay
    const e = Math.max(Math.abs(x), z < 0 ? -z : 0);
    if (z < SHORE_Z - 300) h += 70 * Math.pow(sm(600, 1700, e + (SHORE_Z - 300 - z) * 0.5), 1.3) * (0.6 + 0.6 * N.fbm(x / 400, z / 400, 3));
    return h;
  }

  // land colours: wet and dry sand, dune grass, scrub, rock
  colorAt(x, z, h, slope, n, c) {
    const d = this.dOf(x, z);
    const wet = [0.17, 0.12, 0.07], dry = [0.47, 0.35, 0.18], grass = [0.2, 0.22, 0.07], scrub = [0.06, 0.09, 0.035], rock = [0.12, 0.1, 0.09], dark = [0.04, 0.07, 0.03];
    const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    let col = mix(wet, dry, sm(2, 14, d));
    col = mix(col, grass, sm(100, 125, d + 12 * N.noise(x / 30, z / 30)) * 0.85);
    col = mix(col, scrub, sm(150, 260, d + 30 * N.noise(x / 50, z / 50)));
    col = mix(col, dark, sm(400, 900, d) * 0.6 * n);
    col = mix(col, rock, Math.max(this.rocky(x) * sm(-5, 4, h), sm(0.5, 0.9, slope) * sm(3, 8, h)));
    if (h < -0.2) col = mix(col, [0.45, 0.37, 0.24], 0.8); // sand under the water
    c.setRGB(col[0], col[1], col[2]);
  }

  // the detailed beach mesh covers the sand strip
  covered(x, z) {
    if (Math.abs(x) > HALF_BEACH + 40) return false;
    const d = this.dOf(x, z);
    return d > -34 && d < 246;
  }
}
