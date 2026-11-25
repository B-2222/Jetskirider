// Day and night. A whole day takes DAY_LEN seconds of the shared world clock
// (so everyone online sees the same sky), and the night is kept short: the
// sun is up for most of it, then a quick dusk, a moonlit starry night and a
// pre-dawn glow. The light is blended smoothly between keyframes.

export const DAY_LEN = 1200; // seconds for a full day (20 minutes)

const K = [
  { p: 0.0, name: 'Sunrise', elev: 3, azim: 85, sun: [1.0, 0.56, 0.34], sunPower: 1.9, zenith: [0.08, 0.15, 0.34], horizon: [0.9, 0.55, 0.42], glow: [1.0, 0.48, 0.25], cloudLit: [1.0, 0.72, 0.6], cloudShade: [0.32, 0.27, 0.38], deep: [0.008, 0.055, 0.1], shallow: [0.04, 0.32, 0.36], ambient: 0.55, exposure: 1.02, stars: 0.1 },
  { p: 0.05, name: 'Golden morning', elev: 13, azim: 90, sun: [1.0, 0.7, 0.45], sunPower: 3.1, zenith: [0.11, 0.25, 0.55], horizon: [0.95, 0.74, 0.58], glow: [1.0, 0.62, 0.32], cloudLit: [1.0, 0.86, 0.72], cloudShade: [0.42, 0.4, 0.52], deep: [0.01, 0.08, 0.14], shallow: [0.05, 0.43, 0.45], ambient: 0.75, exposure: 0.95, stars: 0 },
  { p: 0.14, name: 'Morning', elev: 30, azim: 95, sun: [1.0, 0.86, 0.68], sunPower: 3.4, zenith: [0.1, 0.29, 0.66], horizon: [0.8, 0.82, 0.86], glow: [1.0, 0.8, 0.55], cloudLit: [1.0, 0.95, 0.88], cloudShade: [0.5, 0.54, 0.66], deep: [0.01, 0.1, 0.18], shallow: [0.05, 0.52, 0.53], ambient: 0.9, exposure: 0.92, stars: 0 },
  { p: 0.42, name: 'Midday', elev: 55, azim: 150, sun: [1.0, 0.96, 0.88], sunPower: 3.6, zenith: [0.09, 0.3, 0.74], horizon: [0.6, 0.79, 0.95], glow: [1.0, 0.92, 0.75], cloudLit: [1.0, 1.0, 1.0], cloudShade: [0.55, 0.62, 0.74], deep: [0.008, 0.11, 0.2], shallow: [0.04, 0.6, 0.6], ambient: 1.0, exposure: 0.9, stars: 0 },
  { p: 0.66, name: 'Afternoon', elev: 32, azim: 190, sun: [1.0, 0.88, 0.7], sunPower: 3.45, zenith: [0.1, 0.29, 0.66], horizon: [0.78, 0.8, 0.84], glow: [1.0, 0.82, 0.55], cloudLit: [1.0, 0.95, 0.86], cloudShade: [0.5, 0.52, 0.64], deep: [0.01, 0.1, 0.18], shallow: [0.05, 0.53, 0.54], ambient: 0.92, exposure: 0.92, stars: 0 },
  { p: 0.78, name: 'Golden hour', elev: 15, azim: 205, sun: [1.0, 0.63, 0.33], sunPower: 3.3, zenith: [0.13, 0.27, 0.56], horizon: [0.99, 0.69, 0.45], glow: [1.0, 0.52, 0.2], cloudLit: [1.0, 0.8, 0.62], cloudShade: [0.42, 0.36, 0.48], deep: [0.012, 0.085, 0.14], shallow: [0.05, 0.42, 0.44], ambient: 0.72, exposure: 0.95, stars: 0 },
  { p: 0.835, name: 'Sunset', elev: 3, azim: 215, sun: [1.0, 0.45, 0.2], sunPower: 2.0, zenith: [0.1, 0.15, 0.35], horizon: [1.0, 0.5, 0.3], glow: [1.0, 0.4, 0.15], cloudLit: [1.0, 0.6, 0.45], cloudShade: [0.35, 0.25, 0.38], deep: [0.01, 0.05, 0.09], shallow: [0.05, 0.3, 0.33], ambient: 0.55, exposure: 1.0, stars: 0 },
  { p: 0.87, name: 'Dusk', elev: 3, azim: 225, sun: [0.6, 0.45, 0.62], sunPower: 0.45, zenith: [0.04, 0.06, 0.16], horizon: [0.36, 0.26, 0.36], glow: [0.5, 0.26, 0.32], cloudLit: [0.46, 0.36, 0.46], cloudShade: [0.15, 0.14, 0.22], deep: [0.004, 0.02, 0.04], shallow: [0.02, 0.13, 0.17], ambient: 0.3, exposure: 1.25, stars: 0.5 },
  { p: 0.9, name: 'Night', elev: 38, azim: 40, sun: [0.62, 0.72, 1.0], sunPower: 0.6, zenith: [0.01, 0.02, 0.065], horizon: [0.05, 0.08, 0.15], glow: [0.25, 0.3, 0.45], cloudLit: [0.22, 0.25, 0.34], cloudShade: [0.05, 0.06, 0.1], deep: [0.003, 0.013, 0.032], shallow: [0.012, 0.065, 0.095], ambient: 0.22, exposure: 1.6, stars: 1 },
  { p: 0.965, name: 'Night', elev: 34, azim: 70, sun: [0.62, 0.72, 1.0], sunPower: 0.6, zenith: [0.01, 0.02, 0.065], horizon: [0.05, 0.08, 0.15], glow: [0.25, 0.3, 0.45], cloudLit: [0.22, 0.25, 0.34], cloudShade: [0.05, 0.06, 0.1], deep: [0.003, 0.013, 0.032], shallow: [0.012, 0.065, 0.095], ambient: 0.22, exposure: 1.6, stars: 1 },
  { p: 0.985, name: 'Before dawn', elev: 3, azim: 80, sun: [0.62, 0.5, 0.6], sunPower: 0.45, zenith: [0.04, 0.07, 0.18], horizon: [0.45, 0.33, 0.42], glow: [0.6, 0.35, 0.35], cloudLit: [0.5, 0.4, 0.5], cloudShade: [0.16, 0.15, 0.24], deep: [0.004, 0.022, 0.045], shallow: [0.02, 0.14, 0.18], ambient: 0.32, exposure: 1.22, stars: 0.45 },
];
const VEC = ['sun', 'zenith', 'horizon', 'glow', 'cloudLit', 'cloudShade', 'deep', 'shallow'];
const NUM = ['elev', 'sunPower', 'ambient', 'exposure', 'stars'];

const ease = (t) => t * t * (3 - 2 * t);

// The sky at a point in the day (phase 0..1, 0 = sunrise). `out` is reused.
export function todAt(phase, out = {}) {
  const p = ((phase % 1) + 1) % 1;
  let a = K[K.length - 1];
  let b = K[0];
  let pa = a.p - 1;
  let pb = b.p;
  for (let i = 0; i < K.length; i++) {
    const n = K[(i + 1) % K.length];
    const pn = i + 1 < K.length ? n.p : n.p + 1;
    if (p >= K[i].p && p < pn) {
      a = K[i];
      b = n;
      pa = K[i].p;
      pb = pn;
      break;
    }
  }
  const t = ease(Math.min(1, Math.max(0, (p - pa) / (pb - pa))));
  for (const k of NUM) out[k] = a[k] + (b[k] - a[k]) * t;
  for (const k of VEC) {
    const o = out[k] || (out[k] = [0, 0, 0]);
    for (let j = 0; j < 3; j++) o[j] = a[k][j] + (b[k][j] - a[k][j]) * t;
  }
  // the light swings round the short way
  let da = b.azim - a.azim;
  if (da > 180) da -= 360;
  if (da < -180) da += 360;
  out.azim = a.azim + da * t;
  out.name = t < 0.5 ? a.name : b.name;
  out.phase = p;
  return out;
}

// Clock time for the menus: sunrise is 6:00, sunset 19:00 and the short
// night squeezes 19:00 to 6:00 into the rest of the day.
const SUNSET_P = 0.835;
export function hourOf(phase) {
  const p = ((phase % 1) + 1) % 1;
  const h = p < SUNSET_P ? 6 + (p / SUNSET_P) * 13 : 19 + ((p - SUNSET_P) / (1 - SUNSET_P)) * 11;
  return h % 24;
}
export function phaseOfHour(h) {
  h = ((h % 24) + 24) % 24;
  const x = h >= 6 && h < 19 ? h - 6 : h >= 19 ? h - 19 + 13 : h + 5 + 13; // hours since sunrise, night squeezed
  return x <= 13 ? (x / 13) * SUNSET_P : SUNSET_P + ((x - 13) / 11) * (1 - SUNSET_P);
}
export function clockText(phase) {
  const h = hourOf(phase);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${hh}:${String(mm).padStart(2, '0')}`;
}

// where the old fixed presets sit in the day (?tod=0,1,2 in test links)
export const PRESET_PHASE = { golden: 0.78, day: 0.42, morning: 0.14 };
