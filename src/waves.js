// Trochoidal (Gerstner) ocean. The exact same wave set drives the GPU water
// mesh and the CPU physics, so the hull really rides the waves you see.

import { smoothstep } from './util.js';

const G = 9.81;

// dir (radians), wavelength (m), amplitude (m) at sea state 1.0
const BASE = [
  { dir: 0.35, len: 71, amp: 0.5 },
  { dir: 0.95, len: 43, amp: 0.3 },
  { dir: -0.3, len: 27, amp: 0.2 },
  { dir: 1.65, len: 16.5, amp: 0.115 },
  { dir: -0.95, len: 10.3, amp: 0.07 },
  { dir: 2.45, len: 6.4, amp: 0.042 },
  { dir: 0.12, len: 4.1, amp: 0.026 },
  { dir: -1.9, len: 2.7, amp: 0.016 },
];

export const WAVE_COUNT = BASE.length;

export const SEA_STATES = [
  { id: 'glass', name: 'Glass', scale: 0.12, wind: 0.25 },
  { id: 'chop', name: 'Light chop', scale: 0.5, wind: 0.6 },
  { id: 'swell', name: 'Rolling swell', scale: 1.0, wind: 0.85 },
  { id: 'rough', name: 'Rough', scale: 1.7, wind: 1.0 },
];

export class Waves {
  constructor() {
    this.n = WAVE_COUNT;
    this.dx = new Float32Array(this.n);
    this.dz = new Float32Array(this.n);
    this.k = new Float32Array(this.n);
    this.w = new Float32Array(this.n);
    this.amp = new Float32Array(this.n);
    this.phase = new Float32Array(this.n);
    this.scale = 1;
    this.targetScale = 1;
    // depthAt(x, z) -> water depth in metres (positive). Lets waves die on beaches.
    this.depthAt = null;
    for (let i = 0; i < this.n; i++) {
      const b = BASE[i];
      this.dx[i] = Math.cos(b.dir);
      this.dz[i] = Math.sin(b.dir);
      this.k[i] = (Math.PI * 2) / b.len;
      this.w[i] = Math.sqrt(G * this.k[i]);
      this.amp[i] = b.amp;
      this.phase[i] = i * 1.7;
    }
    // GLSL uniform payloads
    this.uA = new Float32Array(this.n * 4); // dx, dz, k, amp
    this.uB = new Float32Array(this.n * 4); // omega, phase, 0, 0
    this._tmp = { x: 0, y: 0, z: 0 };
    this.updateUniforms();
  }

  setSeaState(scale, immediate = false) {
    this.targetScale = scale;
    if (immediate) this.scale = scale;
    this.updateUniforms();
  }

  update(dt) {
    if (Math.abs(this.scale - this.targetScale) > 1e-4) {
      this.scale += (this.targetScale - this.scale) * Math.min(1, dt * 0.8);
      this.updateUniforms();
    }
  }

  updateUniforms() {
    for (let i = 0; i < this.n; i++) {
      this.uA[i * 4] = this.dx[i];
      this.uA[i * 4 + 1] = this.dz[i];
      this.uA[i * 4 + 2] = this.k[i];
      this.uA[i * 4 + 3] = this.amp[i] * this.scale;
      this.uB[i * 4] = this.w[i];
      this.uB[i * 4 + 1] = this.phase[i];
    }
  }

  attenuation(x, z) {
    if (!this.depthAt) return 1;
    return 0.06 + 0.94 * smoothstep(0.2, 7.0, this.depthAt(x, z));
  }

  // Displacement of the surface particle whose rest position is (x, z).
  displace(x, z, t, out) {
    let ox = 0;
    let oy = 0;
    let oz = 0;
    const att = this.attenuation(x, z) * this.scale;
    for (let i = 0; i < this.n; i++) {
      const th = this.k[i] * (this.dx[i] * x + this.dz[i] * z) - this.w[i] * t + this.phase[i];
      const a = this.amp[i] * att;
      const s = Math.sin(th);
      const c = Math.cos(th);
      ox -= this.dx[i] * a * s;
      oz -= this.dz[i] * a * s;
      oy += a * c;
    }
    out.x = ox;
    out.y = oy;
    out.z = oz;
    return out;
  }

  // Surface height at a fixed world position (inverts the horizontal
  // displacement with a few fixed-point iterations). Also returns the
  // vertical water velocity in out.vy.
  sample(x, z, t, out) {
    const d = this._tmp;
    let bx = x;
    let bz = z;
    for (let it = 0; it < 3; it++) {
      this.displace(bx, bz, t, d);
      bx = x - d.x;
      bz = z - d.z;
    }
    const att = this.attenuation(bx, bz) * this.scale;
    let h = 0;
    let vy = 0;
    let nx = 0;
    let nz = 0;
    for (let i = 0; i < this.n; i++) {
      const th = this.k[i] * (this.dx[i] * bx + this.dz[i] * bz) - this.w[i] * t + this.phase[i];
      const a = this.amp[i] * att;
      const s = Math.sin(th);
      h += a * Math.cos(th);
      vy += a * this.w[i] * s;
      nx += this.dx[i] * this.k[i] * a * s;
      nz += this.dz[i] * this.k[i] * a * s;
    }
    out.h = h;
    out.vy = vy;
    out.nx = nx; // un-normalised surface normal = (nx, 1, nz)
    out.nz = nz;
    return out;
  }

  height(x, z, t) {
    return this.sample(x, z, t, (this._s ||= {})).h;
  }
}

// GLSL shared by the water vertex + fragment shaders.
export const WAVES_GLSL = /* glsl */ `
#define WAVE_COUNT ${WAVE_COUNT}
uniform vec4 uWaveA[WAVE_COUNT];
uniform vec4 uWaveB[WAVE_COUNT];
uniform float uTime;

vec3 gerstner(vec2 p, float att) {
  vec3 o = vec3(0.0);
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 a = uWaveA[i];
    float th = a.z * dot(a.xy, p) - uWaveB[i].x * uTime + uWaveB[i].y;
    float amp = a.w * att;
    float s = sin(th);
    o.xz -= a.xy * amp * s;
    o.y += amp * cos(th);
  }
  return o;
}

// returns un-normalised normal in xyz and crest steepness in w
vec4 gerstnerNormal(vec2 p, float att) {
  vec2 n = vec2(0.0);
  float c = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 a = uWaveA[i];
    float th = a.z * dot(a.xy, p) - uWaveB[i].x * uTime + uWaveB[i].y;
    float ka = a.z * a.w * att;
    n += a.xy * ka * sin(th);
    c += ka * cos(th);
  }
  return vec4(n.x, 1.0 - c, n.y, c);
}
`;
