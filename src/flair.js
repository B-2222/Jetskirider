// Extra show on a ski: animated decals on the hull sides, an underglow that
// lights the water under it, and the admin's Barsa Edition (gold trim that
// pulses and a gold underglow). Works the same on your ski and on other
// riders'.
//
// The decals are a light layer drawn over the hull side panels (the same
// geometry, so they follow every curve). In the panel UVs u runs stern (0)
// to bow (1) on both sides and v runs up the panel (0 at the bottom edge).

import * as THREE from 'three';
import { itemOf } from './cosmetics.js';

const DECAL_VS = /* glsl */ `
varying vec2 vUv;
varying float vDist;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const DECAL_FS = /* glsl */ `
uniform float uTime, uRpm, uThr, uSpd, uFx, uPart;
uniform vec3 uColor, uColor2;
varying vec2 vUv;
varying float vDist;

float band(float v, float c, float w) { return smoothstep(w, 0.0, abs(v - c)); }

void main() {
  float s = vUv.x;
  float v = vUv.y;
  bool hull = uPart < 0.5, upper = uPart > 0.5 && uPart < 1.5, stand = uPart > 1.5;
  vec3 col = vec3(0.0);
  float a = 0.0;

  if (uFx < 0.5) {
    // SCANNER: a crisp line along the side with a light that sweeps from
    // the bow to the stern and leaves a short fading trail
    if (upper) discard;
    float c = stand ? 0.42 : 0.5;
    float w = stand ? 0.11 : 0.2;
    float core = band(v, c, w * 0.45);
    float halo = band(v, c, w * 1.6);
    float head = 1.15 - fract(uTime * 0.55) * 1.4;
    float d = s - head;
    float trail = d >= 0.0 ? exp(-d * 6.0) : exp(d * 70.0);
    col = mix(uColor * 1.2, uColor2 * 3.2, clamp(trail * 1.3 - 0.15, 0.0, 1.0));
    a = clamp(core * (0.7 + trail) + halo * trail * 0.6, 0.0, 1.0);
  } else if (uFx < 1.5) {
    // SHIFT LIGHTS: a row of segments that fill with the revs, green to
    // amber to red, and all flash blue on the limiter
    if (hull) discard;
    float s0 = stand ? 0.4 : 0.44, s1 = stand ? 0.82 : 0.86;
    float vc = stand ? 0.78 : 0.5, vh = stand ? 0.07 : 0.17;
    if (s < s0 || s > s1 || abs(v - vc) > vh) discard;
    float N = 12.0;
    float f = (s - s0) / (s1 - s0) * N;
    float i = floor(f);
    float gap = smoothstep(0.08, 0.2, fract(f)) * smoothstep(0.92, 0.8, fract(f));
    float edge = smoothstep(vh, vh * 0.6, abs(v - vc));
    float lit = step(i + 0.5, clamp((uRpm - 0.11) / 0.86, 0.0, 1.0) * N);
    vec3 c = i < 6.0 ? vec3(0.22, 1.0, 0.42) : i < 9.0 ? vec3(1.0, 0.69, 0.13) : vec3(1.0, 0.16, 0.16);
    // (the pump only over-revs past 1 when it sucks air: off a wave, in the air)
    float limiter = step(1.005, uRpm) * step(0.5, fract(uTime * 9.0));
    c = mix(c, uColor2, limiter);
    lit = max(lit, limiter);
    col = c * (0.18 + 2.2 * lit);
    a = gap * edge * (0.35 + 0.65 * lit);
  } else if (uFx < 2.5) {
    // LIQUID CHROME: twin pinstripes; now and then a bright glint runs
    // along them from the stern to the bow, like light catching chrome
    if (upper) discard;
    float c1 = stand ? 0.56 : 0.6, c2 = stand ? 0.64 : 0.74;
    float w = stand ? 0.04 : 0.06;
    float stripes = max(band(v, c1, w), band(v, c2, w * 0.6));
    float ph = fract(uTime / 3.2) * 2.0 - 0.4;
    float glint = exp(-pow((s - ph) * 8.0, 2.0));
    float sheen = exp(-pow((s - ph) * 3.5, 2.0)) * 0.18;
    // chrome: a cool silver that darkens and brightens along the hull
    float tone = 0.75 + 0.25 * sin(s * 22.0 + v * 6.0);
    col = mix(uColor * tone, uColor2 * 3.0, glint);
    a = clamp(stripes * (0.85 + glint) + sheen, 0.0, 1.0);
  } else if (uFx < 3.5) {
    // TIDE LINE: a glowing swell along the bottom of the hull that rolls
    // aft, faster the faster you go
    if (upper) discard;
    float sp = uTime * (1.2 + uSpd * 7.0);
    float e = (stand ? 0.24 : 0.48) + 0.09 * sin(s * 20.0 + sp) + 0.035 * sin(s * 47.0 + sp * 1.7);
    float fill = smoothstep(e + 0.02, e - 0.12, v);
    float crest = band(v, e, 0.035);
    col = mix(uColor * (0.5 + 0.5 * (1.0 - v)), uColor2 * 2.0, crest);
    a = clamp(fill * 0.55 + crest, 0.0, 1.0);
  } else {
    // AFTERBURN: heat at the stern that glows with the throttle and
    // shimmers
    float g = smoothstep(0.34, 0.0, s);
    float sh = 0.82 + 0.18 * sin(v * 28.0 + s * 40.0 - uTime * 11.0);
    float k = (0.15 + 1.6 * uThr) * sh;
    col = mix(uColor2, uColor * 1.6, g * g) * k;
    a = clamp(g * (0.25 + 0.75 * uThr) * sh, 0.0, 1.0);
  }
  // fade with distance so it never shimmers far away
  a *= 1.0 - smoothstep(140.0, 260.0, vDist);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
}
`;

const GLOW_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOW_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uI, uChase, uTime;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  // a soft neon pool: bright under the hull, falling away round it
  float pool = smoothstep(1.0, 0.0, r);
  pool = pool * pool * 0.7 + smoothstep(0.6, 0.0, r) * 0.45;
  float spot = 0.0;
  if (uChase > 0.5) {
    float ang = atan(p.y, p.x);
    float d = mod(ang - uTime * 3.4 + 3.14159, 6.28318) - 3.14159;
    spot = exp(-d * d * 6.0) * smoothstep(1.0, 0.55, r) * smoothstep(0.15, 0.5, r);
    pool *= 0.55;
  }
  float k = (pool + spot * 1.6) * uI;
  if (k < 0.004) discard;
  gl_FragColor = vec4(uColor * k, 1.0);
}
`;

// eq: the style worn ({ dec, glow }), already checked
export function addFlair(model, look, spec, scene, eq = {}) {
  const barsa = !!look && look.flair === 'barsa';
  const dec = eq.dec ? itemOf('dec', eq.dec) : null;
  const ug = eq.glow ? itemOf('glow', eq.glow) : null;
  if (!barsa && !dec && !ug) return null;
  const parts = [];

  // --- Barsa Edition: the gold trim breathes
  const glowMats = [];
  if (barsa) {
    const trim = look.cw.trim;
    model.group.traverse((o) => {
      const m = o.material;
      if (m && m.emissive && m.color && m.color.getHex() === trim && !glowMats.includes(m)) glowMats.push(m);
    });
  }

  // --- decals: a light layer over each hull side panel
  const U = {
    uTime: { value: 0 },
    uRpm: { value: 0 },
    uThr: { value: 0 },
    uSpd: { value: 0 },
    uFx: { value: dec ? dec.fx : 0 },
    uColor: { value: new THREE.Color(dec ? dec.color : 0xffffff) },
    uColor2: { value: new THREE.Color(dec ? dec.c2 : 0xffffff) },
  };
  const decMats = [];
  if (dec) {
    const panels = [];
    model.group.traverse((o) => {
      if (o.isMesh && o.userData.part !== undefined) panels.push(o);
    });
    for (const pm of panels) {
      const part = pm.userData.part;
      let mat = decMats[part];
      if (!mat) {
        mat = decMats[part] = new THREE.ShaderMaterial({
          uniforms: { ...U, uPart: { value: part } },
          vertexShader: DECAL_VS,
          fragmentShader: DECAL_FS,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -4,
          toneMapped: false,
          fog: false,
        });
      }
      const m = new THREE.Mesh(pm.geometry, mat);
      m.renderOrder = 3;
      m.userData.decal = true;
      pm.add(m);
      parts.push(m);
    }
  }

  // --- underglow: a neon pool on the water under the ski
  let glow = null;
  let gU = null;
  const mode = ug ? ug.mode : barsa ? 'barsa' : null;
  // (a small grid that is laid on the waves every frame, so the chop never
  // cuts hard edges through it)
  const NX = 10, NZ = 7;
  const hl = spec.L * 1.2, hw = spec.B * 2.1;
  if (mode) {
    gU = { uColor: { value: new THREE.Color(ug ? ug.color : 0xff8a00) }, uI: { value: 0 }, uChase: { value: mode === 'chase' ? 1 : 0 }, uTime: { value: 0 } };
    const mat = new THREE.ShaderMaterial({ uniforms: gU, vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    const geo = new THREE.BufferGeometry();
    const uv = [];
    const idx = [];
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) uv.push(i / NX, j / NZ);
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const a = j * (NX + 1) + i;
        idx.push(a, a + NX + 1, a + 1, a + 1, a + NX + 1, a + NX + 2);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(uv.length * 1.5), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    glow = new THREE.Mesh(geo, mat);
    glow.frustumCulled = false;
    glow.renderOrder = 2;
    scene.add(glow);
  }
  let thrS = 0;

  return {
    // t: seconds; x, z: the ski; waterAt(x, z): the water height; y: the
    // ski's height; yaw: its heading (radians, about +Y); drive: the engine
    // { rpm: 0..1, thr: 0..1, spd: 0..1 of top speed } and the daylight
    // (day: 0 night .. 1 midday)
    update(t, x, waterAt, z, y, yaw, drive) {
      const k = 0.5 + 0.5 * Math.sin(t * 3.2);
      for (const m of glowMats) m.emissiveIntensity = 0.6 + 1.1 * k;
      const d = drive || {};
      thrS += ((d.thr || 0) - thrS) * 0.15;
      if (dec) {
        U.uTime.value = t;
        U.uRpm.value = d.rpm || 0;
        U.uThr.value = thrS;
        U.uSpd.value = Math.min(1, d.spd || 0);
      }
      if (glow) {
        const water = waterAt(x, z);
        const lift = Math.max(0, y - water - 0.3);
        glow.position.set(x, 0, z);
        const fx = Math.cos(yaw), fz = -Math.sin(yaw);
        const pa = glow.geometry.attributes.position;
        const P = pa.array;
        let n = 0;
        for (let j = 0; j <= NZ; j++) {
          const b = (j / NZ) * 2 - 1;
          for (let i = 0; i <= NX; i++) {
            const a = (i / NX) * 2 - 1;
            const dx = a * hl * fx - b * hw * fz;
            const dz = a * hl * fz + b * hw * fx;
            P[n] = dx;
            P[n + 1] = waterAt(x + dx, z + dz) + 0.07;
            P[n + 2] = dz;
            n += 3;
          }
        }
        pa.needsUpdate = true;
        let i;
        if (mode === 'barsa') i = 0.7 + 0.3 * k;
        else if (mode === 'breathe') i = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2.1));
        else if (mode === 'throttle') i = 0.3 + 1.15 * thrS;
        else i = 0.85 + 0.05 * Math.sin(t * 7.3);
        // neon is subtle in the sun and pops at dusk and night
        const day = Math.min(1, Math.max(0, ((d.day ?? 0.6) - 0.3) / 0.6));
        gU.uI.value = i * Math.max(0, 1 - lift / 6) * (1 - 0.45 * day);
        gU.uTime.value = t;
        glow.visible = gU.uI.value > 0.02;
      }
    },
    hide() {
      if (glow) glow.visible = false;
    },
    dispose() {
      for (const m of parts) m.removeFromParent();
      for (const m of decMats) if (m) m.dispose();
      if (glow) {
        glow.removeFromParent();
        glow.geometry.dispose();
        glow.material.dispose();
      }
    },
  };
}
