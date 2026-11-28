// The ocean: Gerstner-displaced radial mesh, physically motivated shading and
// a persistent foam simulation. Anything that disturbs the surface (hull,
// jet wash, spray droplets landing) stamps white water into a scrolling
// render target which then ages, spreads and dissolves into lace.

import * as THREE from 'three';
import { WAVES_GLSL } from './waves.js';
import { SURF_GLSL } from './surf.js';
import { SKY_GLSL, Sky } from './sky.js';
import { TERRAIN } from './terrain.js';

const FOAM_SIZE = 300; // metres covered by the foam map
const FOAM_RES = 1024;
const MAX_STAMPS = 6000;

export class FoamField {
  constructor(renderer) {
    this.renderer = renderer;
    this.size = FOAM_SIZE;
    this.res = FOAM_RES;
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.rtA = new THREE.WebGLRenderTarget(this.res, this.res, opts);
    this.rtB = new THREE.WebGLRenderTarget(this.res, this.res, opts);
    this.center = new THREE.Vector2(0, 0);
    this.prevCenter = new THREE.Vector2(0, 0);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.decayMat = new THREE.ShaderMaterial({
      uniforms: {
        uPrev: { value: null },
        uShift: { value: new THREE.Vector2() },
        uTexel: { value: 1 / this.res },
        uDecayR: { value: 1 },
        uDecayG: { value: 1 },
        uSub: { value: 0 },
        uBlur: { value: 0.01 },
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPrev;
        uniform vec2 uShift;
        uniform float uTexel, uDecayR, uDecayG, uSub, uBlur;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv + uShift;
          vec2 e = vec2(uTexel * 0.85, 0.0);
          vec4 c = texture2D(uPrev, uv) * (1.0 - 4.0 * uBlur)
                 + (texture2D(uPrev, uv + e.xy) + texture2D(uPrev, uv - e.xy)
                 +  texture2D(uPrev, uv + e.yx) + texture2D(uPrev, uv - e.yx)) * uBlur;
          vec2 inb = step(vec2(0.002), uv) * step(uv, vec2(0.998));
          c *= inb.x * inb.y;
          c.r = max(min(c.r, 2.2) * uDecayR - uSub, 0.0);
          c.g = max(min(c.g, 1.6) * uDecayG - uSub * 0.3, 0.0);
          gl_FragColor = c;
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.decayMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);

    // stamps
    this.stampPos = new Float32Array(MAX_STAMPS * 3); // x, z, radius
    this.stampDat = new Float32Array(MAX_STAMPS * 2); // foam, aeration
    this.stampCount = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.stampPos, 3);
    this.aDat = new THREE.BufferAttribute(this.stampDat, 2);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aDat.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aDat', this.aDat);
    this.stampGeo = g;
    this.stampMat = new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: this.center },
        uSize: { value: this.size },
        uRes: { value: this.res },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      vertexShader: /* glsl */ `
        attribute vec2 aDat;
        uniform vec2 uCenter;
        uniform float uSize, uRes;
        varying vec2 vDat;
        void main() {
          vDat = aDat;
          vec2 ndc = (position.xy - uCenter) / uSize * 2.0;
          gl_Position = vec4(ndc, 0.0, 1.0);
          gl_PointSize = max(position.z / uSize * uRes * 2.0, 1.5);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec2 uCenter;
        uniform float uSize, uRes;
        varying vec2 vDat;
        float h21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float vn(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          // foam is lace, not a disc: break every stamp up with noise fixed to
          // the water, so splashes leave ragged, holey patches
          vec2 wp = uCenter + (gl_FragCoord.xy / uRes - 0.5) * uSize;
          float n = vn(wp * 1.4) * 0.6 + vn(wp * 4.1 + 17.0) * 0.4;
          float a = smoothstep(1.0, 0.15, d) * smoothstep(0.22, 0.62, n + (1.0 - d) * 0.42) * 1.3;
          gl_FragColor = vec4(vDat.x * a, vDat.y * a, 0.0, 0.0);
        }`,
    });
    this.points = new THREE.Points(g, this.stampMat);
    this.points.frustumCulled = false;
    this.stampScene = new THREE.Scene();
    this.stampScene.add(this.points);
    this.clear();
  }

  get texture() {
    return this.rtA.texture;
  }

  clear() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const cc = new THREE.Color();
    r.getClearColor(cc);
    const ca = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rtA);
    r.clear();
    r.setRenderTarget(this.rtB);
    r.clear();
    r.setRenderTarget(prev);
    r.setClearColor(cc, ca);
    this.stampCount = 0;
  }

  // radius in metres; foam = white-water amount, aer = aerated turquoise amount
  stamp(x, z, radius, foam, aer = foam * 0.5) {
    if (this.stampCount >= MAX_STAMPS) return;
    const i = this.stampCount++;
    this.stampPos[i * 3] = x;
    this.stampPos[i * 3 + 1] = z;
    this.stampPos[i * 3 + 2] = radius;
    this.stampDat[i * 2] = foam;
    this.stampDat[i * 2 + 1] = aer;
  }

  update(focusX, focusZ, dt) {
    const r = this.renderer;
    const texel = this.size / this.res;
    this.prevCenter.copy(this.center);
    const nx = Math.round(focusX / texel) * texel;
    const nz = Math.round(focusZ / texel) * texel;
    // decay + scroll: A -> B
    const u = this.decayMat.uniforms;
    u.uPrev.value = this.rtA.texture;
    u.uShift.value.set((nx - this.prevCenter.x) / this.size, (nz - this.prevCenter.y) / this.size);
    u.uDecayR.value = Math.exp(-dt / 4.2);
    u.uDecayG.value = Math.exp(-dt / 11);
    u.uSub.value = dt * 0.02;
    u.uBlur.value = Math.min(0.08, dt * 0.9);
    this.center.set(nx, nz);
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.rtB);
    r.render(this.quadScene, this.cam);
    if (this.stampCount > 0) {
      this.stampGeo.setDrawRange(0, this.stampCount);
      this.aPos.clearUpdateRanges();
      this.aDat.clearUpdateRanges();
      this.aPos.addUpdateRange(0, this.stampCount * 3);
      this.aDat.addUpdateRange(0, this.stampCount * 2);
      this.aPos.needsUpdate = true;
      this.aDat.needsUpdate = true;
      r.render(this.stampScene, this.cam);
    }
    this.stampCount = 0;
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
    const t = this.rtA;
    this.rtA = this.rtB;
    this.rtB = t;
  }
}

function makeOceanGeometry() {
  // Radial grid: dense under the ski, stretching out to the horizon.
  const SEG = 192;
  const radii = [0];
  let r = 0;
  let step = 0.3;
  while (r < 9500) {
    r += step;
    radii.push(r);
    step *= 1.042;
  }
  const rings = radii.length;
  const pos = new Float32Array(((rings - 1) * SEG + 1) * 3);
  let p = 3; // first vertex is the centre
  for (let i = 1; i < rings; i++) {
    const off = (i % 2) * 0.5;
    for (let s = 0; s < SEG; s++) {
      const a = ((s + off) / SEG) * Math.PI * 2;
      pos[p++] = Math.cos(a) * radii[i];
      pos[p++] = 0;
      pos[p++] = Math.sin(a) * radii[i];
    }
  }
  const idx = [];
  for (let s = 0; s < SEG; s++) idx.push(0, 1 + ((s + 1) % SEG), 1 + s);
  for (let i = 1; i < rings - 1; i++) {
    const a0 = 1 + (i - 1) * SEG;
    const b0 = 1 + i * SEG;
    const odd = i % 2 === 1; // inner ring i is offset by half a step when odd
    for (let s = 0; s < SEG; s++) {
      const s1 = (s + 1) % SEG;
      if (odd) {
        idx.push(a0 + s, b0 + s1, b0 + s);
        idx.push(a0 + s, a0 + s1, b0 + s1);
      } else {
        idx.push(a0 + s, a0 + s1, b0 + s);
        idx.push(a0 + s1, b0 + s1, b0 + s);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Ocean {
  constructor({ waves, sky, noiseTex, normalTex, heightTex, foam }) {
    this.waves = waves;
    this.foam = foam;
    const u = {
      uWaveA: { value: waves.uA },
      uWaveB: { value: waves.uB },
      uZoneA: { value: waves.uZA },
      uZoneB: { value: waves.uZB },
      uZone: { value: waves.uZone },
      uSurfA: { value: waves.surf.uA },
      uSurfB: { value: waves.surf.uB },
      uSurfC: { value: waves.surf.uC },
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2() },
      uHeightMap: { value: heightTex },
      uWorldSize: { value: TERRAIN.size },
      uNormalMap: { value: normalTex },
      uFoamMap: { value: null },
      uFoamCenter: { value: foam.center },
      uFoamSize: { value: foam.size },
      uDeep: { value: new THREE.Color() },
      uShallow: { value: new THREE.Color() },
      uSand: { value: new THREE.Color(0.8, 0.72, 0.54) },
      uAmbient: { value: 1 },
      uRipple: { value: 0.3 },
      uCaps: { value: 0 },
      uSkiPos: { value: new THREE.Vector3() },
      uSkiFwd: { value: new THREE.Vector2(1, 0) },
      uSkiDim: { value: new THREE.Vector2(1.7, 0.75) },
      uFogDist: { value: 6500 },
      uShoreW: { value: 1.4 }, // how far out the shore wash reaches (in depth)
    };
    Sky.link(u, sky.uniforms);
    this.uniforms = u;
    this.material = new THREE.ShaderMaterial({
      uniforms: u,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        ${WAVES_GLSL}
        ${SURF_GLSL}
        uniform vec2 uCenter;
        uniform sampler2D uHeightMap;
        uniform float uWorldSize;
        varying vec3 vWorld;
        varying vec2 vBase;
        varying float vAtt;
        void main() {
          vec2 base = position.xz + uCenter;
          float depth = -texture2D(uHeightMap, base / uWorldSize + 0.5).r;
          float att = 0.06 + 0.94 * smoothstep(0.2, 7.0, depth);
          vec3 d = gerstner(base, att);
          vec3 wp = vec3(base.x, 0.0, base.y) + d;
          float sfoam;
          wp.y += surfField(wp.xz, sfoam);
          vWorld = wp;
          vBase = base;
          vAtt = att;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${WAVES_GLSL}
        ${SKY_GLSL}
        ${SURF_GLSL}
        uniform sampler2D uHeightMap;
        uniform sampler2D uNormalMap;
        uniform sampler2D uFoamMap;
        uniform float uWorldSize;
        uniform vec2 uFoamCenter;
        uniform float uFoamSize;
        uniform vec3 uDeep, uShallow, uSand;
        uniform float uAmbient, uRipple, uCaps, uFogDist, uShoreW;
        uniform vec3 uSkiPos;
        uniform vec2 uSkiFwd, uSkiDim;
        varying vec3 vWorld;
        varying vec2 vBase;
        varying float vAtt;

        void main() {
          vec3 toCam = cameraPosition - vWorld;
          float dist = length(toCam);
          vec3 V = toCam / dist;

          // --- normal: analytic swell + scrolling ripple detail ---------------
          vec4 gn = gerstnerNormal(vBase, vAtt);
          // breaking surf: slope by finite differences, plus its whitewater
          float sFoam = 0.0, sTmp;
          float sH = surfField(vWorld.xz, sFoam);
          // slope only where a wave actually is (the field's far tails are ~0)
          if (abs(sH) > 0.004 || sFoam > 0.01) {
            float se = 0.25;
            float sx = surfField(vWorld.xz + vec2(se, 0.0), sTmp);
            float sz = surfField(vWorld.xz + vec2(0.0, se), sTmp);
            gn.xz -= vec2(sx - sH, sz - sH) / se;
          }
          float sSteep = clamp(length(gn.xz) * 1.4, 0.0, 1.0);
          vec3 N = normalize(gn.xyz);
          vec2 xz = vWorld.xz;
          float t = uTime;
          vec2 d1 = texture2D(uNormalMap, xz * 0.021 + t * vec2(0.006, 0.009)).xy * 2.0 - 1.0;
          vec2 d2 = texture2D(uNormalMap, xz * 0.083 + t * vec2(-0.021, 0.014)).xy * 2.0 - 1.0;
          vec2 d3 = texture2D(uNormalMap, xz * 0.31 + t * vec2(0.035, -0.05)).xy * 2.0 - 1.0;
          vec2 d4 = texture2D(uNormalMap, xz * 1.13 + t * vec2(-0.08, -0.06)).xy * 2.0 - 1.0;
          float nearK = 1.0 / (1.0 + dist * 0.02);
          vec2 dn = d1 * 0.5 + d2 * 0.55 + d3 * 0.42 + d4 * 0.3 * nearK;
          float rip = uRipple * (0.35 + 0.65 * vAtt);

          // --- foam / wake field ----------------------------------------------
          vec2 fuv = (xz - uFoamCenter) / uFoamSize + 0.5;
          vec2 fin = step(vec2(0.0), fuv) * step(fuv, vec2(1.0));
          vec4 wake = texture2D(uFoamMap, fuv) * fin.x * fin.y;
          // churned water is rougher
          N = normalize(N + vec3(dn.x, 0.0, dn.y) * (rip + min(wake.g, 1.0) * 0.35));

          // --- sea floor & depth ----------------------------------------------
          float floorH = texture2D(uHeightMap, xz / uWorldSize + 0.5).r;
          float depth = max(vWorld.y - floorH, 0.0);

          // --- shadow of the ski on the water ---------------------------------
          vec2 sc = uSkiPos.xz - uSunDir.xz / max(uSunDir.y, 0.12) * max(uSkiPos.y + 0.25 - vWorld.y, 0.0);
          vec2 q = xz - sc;
          vec2 ql = vec2(dot(q, uSkiFwd), dot(q, vec2(-uSkiFwd.y, uSkiFwd.x)));
          // stretch the blob along the sun direction for low sun
          float sh = 1.0 - smoothstep(0.55, 1.15, length(ql / uSkiDim));
          sh *= 0.62 * (1.0 - smoothstep(0.5, 6.0, uSkiPos.y - vWorld.y));

          // --- reflection -------------------------------------------------------
          float NdV = max(dot(N, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
          F *= mix(1.0, 0.62, smoothstep(60.0, 1800.0, dist));
          vec3 R = reflect(-V, N);
          R.y = abs(R.y) + 0.015;
          R = normalize(R);
          vec3 refl = skyGradient(R);
          vec4 cl = skyClouds(R);
          refl = mix(refl, cl.rgb, cl.a * 0.9);
          vec3 H = normalize(V + uSunDir);
          float NdH = max(dot(N, H), 0.0);
          float spec = pow(NdH, 900.0) * 34.0 + pow(NdH, 120.0) * 1.1 + pow(NdH, 18.0) * 0.05;
          refl += uSunColor * spec * (1.0 - sh) * (1.0 - cl.a * 0.0);

          // --- water body -------------------------------------------------------
          vec2 cuv = xz * 0.11;
          float caust = texture2D(uNormalMap, cuv + t * 0.02).b * texture2D(uNormalMap, cuv * 1.7 - t * 0.027).b;
          vec3 sand = uSand * (0.62 + caust * 1.5 * smoothstep(8.0, 0.5, depth));
          vec3 trans = exp(-depth * vec3(0.55, 0.14, 0.1));
          vec3 scat = mix(uShallow, uDeep, 1.0 - exp(-depth * 0.16));
          float sunK = 0.35 + 0.65 * clamp(uSunDir.y * 2.2, 0.0, 1.0);
          vec3 body = sand * trans * (0.5 + 0.5 * sunK) * uAmbient + scat * (1.0 - exp(-depth * 0.5)) * uAmbient;
          // light scattering through wave crests when looking toward the sun
          float crest = clamp(gn.w * 2.2 + 0.25, 0.0, 1.0);
          float toSun = pow(max(dot(normalize(V.xz + 1e-4), -normalize(uSunDir.xz + 1e-4)), 0.0), 2.0);
          body += uShallow * uSunColor * 0.085 * crest * (0.35 + toSun) * smoothstep(1.5, 8.0, depth);
          // light glowing through the thin top of a standing wave face
          float glow = clamp(sH / 2.4, 0.0, 1.0) * sSteep;
          body += (uShallow * 1.2 + vec3(0.05, 0.12, 0.1)) * glow * (0.35 + 0.65 * toSun) * uAmbient;
          // aerated water left behind by the jet wash: milky turquoise
          float aer = clamp(wake.g + sFoam * 0.8, 0.0, 1.0);
          body = mix(body, (uShallow * 1.5 + vec3(0.2, 0.3, 0.3)) * uAmbient * sunK, aer * 0.55);
          body *= 1.0 - sh * 0.55;

          vec3 col = mix(body, refl, F * (1.0 - aer * 0.35));

          // --- foam -------------------------------------------------------------
          float lace = texture2D(uNoise, xz * 0.11 + t * vec2(0.004, -0.003)).b * 0.65
                     + texture2D(uNoise, xz * 0.37 - t * vec2(0.006, 0.002)).b * 0.35;
          float fine = texture2D(uNoise, xz * 1.9).a;
          float f = wake.r;
          float foam = clamp((f * 1.3 - lace * 1.0) * 2.0, 0.0, 1.0);
          foam = max(foam, clamp((f - 1.0) * 1.4, 0.0, 1.0));
          // whitewater rolling behind the break
          foam = max(foam, clamp((sFoam * 1.6 - lace * 0.85) * 2.4, 0.0, 1.0));
          // shoreline wash
          float shore = 1.0 - smoothstep(0.0, uShoreW, depth);
          float lap = 0.5 + 0.5 * sin(depth * 5.0 - t * 1.3 + lace * 5.0);
          foam = max(foam, clamp((shore * (1.1 + lap * 0.7) - lace * 0.95) * 2.4, 0.0, 1.0) * step(0.001, depth));
          // whitecaps on steep crests
          float zc = zoneMask(vBase);
          float cap = smoothstep(0.2 - zc * 0.04, 0.42 - zc * 0.08, gn.w + (lace - 0.5) * 0.14) * max(uCaps, zc * 0.85);
          foam = max(foam, clamp((cap * 1.6 - lace) * 2.0, 0.0, 1.0));
          foam *= 0.74 + 0.26 * fine;
          float foamTex = 0.8 + 0.2 * lace + 0.12 * (fine - 0.5);
          vec3 foamCol = (vec3(0.82, 0.88, 0.92) * (uHorizon * 0.55 + uZenith * 0.45 + 0.25)
                       + uSunColor * 0.2 * max(dot(N, uSunDir), 0.0) + uSunColor * 0.06) * (1.0 - sh * 0.5) * foamTex;
          col = mix(col, foamCol, foam);

          // --- aerial perspective -----------------------------------------------
          float fog = 1.0 - exp(-pow(dist / uFogDist, 1.6));
          vec3 fogCol = skyGradient(normalize(vec3(-V.x, 0.035, -V.z)));
          col = mix(col, fogCol, fog);

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(makeOceanGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  setTime(tod) {
    const u = this.uniforms;
    u.uDeep.value.setRGB(...tod.deep);
    u.uShallow.value.setRGB(...tod.shallow);
    u.uAmbient.value = tod.ambient;
  }

  setSea(state) {
    this.uniforms.uRipple.value = 0.1 + 0.34 * state.wind;
    this.uniforms.uCaps.value = state.scale > 1.2 ? 1 : state.scale > 0.8 ? 0.45 : 0;
  }

  update(time, cx, cz) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCenter.value.set(cx, cz);
    u.uFoamMap.value = this.foam.texture;
    this.waves.surf.pack(time);
  }
}
