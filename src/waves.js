// Trochoidal (Gerstner) ocean. The exact same wave set drives the GPU water
// mesh and the CPU physics, so the hull really rides the waves you see.

import { smoothstep } from './util.js';
import { Surf, SURF, WAVE_ZONE } from './surf.js';

export { WAVE_ZONE };

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

// The wave zone: a patch of open water where big groundswell rolls through.
// Its waves fade in and out with distance from the centre, so they never
// show up anywhere else on the map.
// light background swell between the sets (the surf itself is in surf.js)
const ZONE = [
  { off: 0.0, len: 46, amp: 0.4 },
  { off: 0.22, len: 32, amp: 0.16 },
  { off: -0.18, len: 74, amp: 0.22 },
];
export const ZONE_COUNT = ZONE.length;

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
    // zone swell
    this.zn = ZONE.length;
    this.zdx = new Float32Array(this.zn);
    this.zdz = new Float32Array(this.zn);
    this.zk = new Float32Array(this.zn);
    this.zw = new Float32Array(this.zn);
    this.zamp = new Float32Array(this.zn);
    this.zphase = new Float32Array(this.zn);
    for (let i = 0; i < this.zn; i++) {
      const z = ZONE[i];
      const d = WAVE_ZONE.dir + z.off;
      this.zdx[i] = Math.cos(d);
      this.zdz[i] = Math.sin(d);
      this.zk[i] = (Math.PI * 2) / z.len;
      this.zw[i] = Math.sqrt(G * this.zk[i]);
      this.zamp[i] = z.amp;
      this.zphase[i] = 0.9 + i * 2.3;
    }
    this.uZA = new Float32Array(this.zn * 4);
    this.uZB = new Float32Array(this.zn * 4);
    this.uZone = new Float32Array([WAVE_ZONE.x, WAVE_ZONE.z, WAVE_ZONE.rIn, WAVE_ZONE.rOut]);
    this.surf = new Surf();
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
    if (!this.uZA) return;
    const zs = this.zoneScale();
    for (let i = 0; i < this.zn; i++) {
      this.uZA[i * 4] = this.zdx[i];
      this.uZA[i * 4 + 1] = this.zdz[i];
      this.uZA[i * 4 + 2] = this.zk[i];
      this.uZA[i * 4 + 3] = this.zamp[i] * zs;
      this.uZB[i * 4] = this.zw[i];
      this.uZB[i * 4 + 1] = this.zphase[i];
    }
  }

  // keep the swell from looping over itself when the sea state is rough too
  zoneScale() {
    return Math.min(1, Math.max(0.7, 1.3 - 0.3 * this.scale));
  }

  // 0 outside the wave zone, 1 in its heart
  zoneMask(x, z) {
    const d = Math.hypot(x - WAVE_ZONE.x, z - WAVE_ZONE.z);
    return 1 - smoothstep(WAVE_ZONE.rIn, WAVE_ZONE.rOut, d);
  }

  // highest the surface can get here (for spray collision bounds)
  maxHeight(x, z, t = this.surf._t || 0) {
    let s = this.zoneMask(x, z) > 0 ? this.surf.maxAmp(t) * 1.15 : 0;
    for (let i = 0; i < this.n; i++) s += this.amp[i];
    s *= this.scale;
    const m = this.zoneMask(x, z);
    if (m > 0) for (let i = 0; i < this.zn; i++) s += this.zamp[i] * this.zoneScale() * m;
    return s;
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
    const zm = this.zoneMask(x, z);
    if (zm > 0) {
      const za = zm * this.zoneScale() * (att / this.scale || 0);
      for (let i = 0; i < this.zn; i++) {
        const th = this.zk[i] * (this.zdx[i] * x + this.zdz[i] * z) - this.zw[i] * t + this.zphase[i];
        const a = this.zamp[i] * za;
        const s = Math.sin(th);
        ox -= this.zdx[i] * a * s;
        oz -= this.zdz[i] * a * s;
        oy += a * Math.cos(th);
      }
    }
    out.x = ox;
    out.y = oy + this.surf.height(x + ox, z + oz, t);
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
    const zm = this.zoneMask(bx, bz);
    if (zm > 0) {
      const za = zm * this.zoneScale() * (att / this.scale || 0);
      for (let i = 0; i < this.zn; i++) {
        const th = this.zk[i] * (this.zdx[i] * bx + this.zdz[i] * bz) - this.zw[i] * t + this.zphase[i];
        const a = this.zamp[i] * za;
        const s = Math.sin(th);
        h += a * Math.cos(th);
        vy += a * this.zw[i] * s;
        nx += this.zdx[i] * this.zk[i] * a * s;
        nz += this.zdz[i] * this.zk[i] * a * s;
      }
    }
    // breaking surf (height-only, evaluated at the actual point)
    const sf = this.surf.eval(x, z, t);
    if (sf.h !== 0) {
      const h0 = sf.h;
      const e = 0.3;
      h += h0;
      const gx = (this.surf.height(x + e, z, t) - h0) / e;
      const gz = (this.surf.height(x, z + e, t) - h0) / e;
      nx -= gx;
      nz -= gz;
      // a travelling wave: the surface rises as the slope in front arrives
      vy -= SURF.c * (gx * this.surf.dx + gz * this.surf.dz);
    }
    // water on a breaking wave surges forward with it: fastest at the crest,
    // a full bore in the whitewater
    const cur = sf.h > 0 ? sf.h * ((0.75 * SURF.c) / SURF.A0) : 0;
    out.ux = this.surf.dx * cur;
    out.uz = this.surf.dz * cur;
    out.foam = sf.foam;
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
#define ZONE_COUNT ${ZONE_COUNT}
uniform vec4 uWaveA[WAVE_COUNT];
uniform vec4 uWaveB[WAVE_COUNT];
uniform vec4 uZoneA[ZONE_COUNT];
uniform vec4 uZoneB[ZONE_COUNT];
uniform vec4 uZone; // centre xz, inner radius, outer radius
uniform float uTime;

float zoneMask(vec2 p) {
  return 1.0 - smoothstep(uZone.z, uZone.w, length(p - uZone.xy));
}

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
  float zm = zoneMask(p) * att;
  if (zm > 0.0) {
    for (int i = 0; i < ZONE_COUNT; i++) {
      vec4 a = uZoneA[i];
      float th = a.z * dot(a.xy, p) - uZoneB[i].x * uTime + uZoneB[i].y;
      float amp = a.w * zm;
      o.xz -= a.xy * amp * sin(th);
      o.y += amp * cos(th);
    }
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
  float zm = zoneMask(p) * att;
  if (zm > 0.0) {
    for (int i = 0; i < ZONE_COUNT; i++) {
      vec4 a = uZoneA[i];
      float th = a.z * dot(a.xy, p) - uZoneB[i].x * uTime + uZoneB[i].y;
      float ka = a.z * a.w * zm;
      n += a.xy * ka * sin(th);
      c += ka * cos(th);
    }
  }
  return vec4(n.x, 1.0 - c, n.y, c);
}
`;
