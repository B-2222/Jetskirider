// What you see and hear of the surf beyond the heightfield: the throwing lip
// and barrel of every breaking section, the spray where the lip lands, and
// the foam the whitewater leaves behind.

import * as THREE from 'three';
import { SKY_GLSL, Sky } from './sky.js';
import { SURF } from './surf.js';

const NS = 24; // sections along the curl
const NP = 16; // points across the lip profile
const STRIPS = SURF.max * 2;
const VPS = (NS + 1) * (NP + 1);

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Breakers {
  constructor({ waves, ocean, sky, spray, foam }) {
    this.waves = waves;
    this.surf = waves.surf;
    this.spray = spray;
    this.foam = foam;
    this.pos = new Float32Array(STRIPS * VPS * 3);
    this.aux = new Float32Array(STRIPS * VPS * 2); // foam, alpha
    const idx = [];
    for (let s = 0; s < STRIPS; s++) {
      const b = s * VPS;
      for (let j = 0; j < NS; j++) {
        for (let i = 0; i < NP; i++) {
          const a = b + j * (NP + 1) + i;
          idx.push(a, a + 1, a + NP + 1, a + 1, a + NP + 2, a + NP + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAux = new THREE.BufferAttribute(this.aux, 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aAux', this.aAux);
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.geo = g;

    const u = { uTime: { value: 0 } };
    Sky.link(u, sky.uniforms);
    u.uShallow = ocean.uniforms.uShallow;
    u.uDeep = ocean.uniforms.uDeep;
    u.uAmbient = ocean.uniforms.uAmbient;
    this.material = new THREE.ShaderMaterial({
      uniforms: u,
      transparent: true,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec2 aAux;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec2 vAux;
        void main() {
          vWorld = position;
          vNormal = normal;
          vAux = aAux;
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${SKY_GLSL}
        uniform vec3 uShallow, uDeep;
        uniform float uAmbient, uTime;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec2 vAux;
        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
          float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N);
          R.y = abs(R.y) + 0.02;
          vec3 refl = skyGradient(normalize(R));
          vec4 cl = skyClouds(normalize(R));
          refl = mix(refl, cl.rgb, cl.a * 0.8);
          float spec = pow(max(dot(N, normalize(V + uSunDir)), 0.0), 220.0);
          // a thin sheet of water: light comes straight through it, glowing
          // turquoise, brightest when you look toward the sun
          float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
          vec3 body = (uShallow * 1.55 + vec3(0.04, 0.1, 0.09)) * uAmbient * (0.75 + 0.6 * back);
          vec3 col = mix(body, refl, F * 0.75) + uSunColor * spec * 2.0;
          // lace of foam on the lip, filling in as it collapses
          float lace = texture2D(uNoise, vWorld.xz * 0.21 + vWorld.y * 0.13 + uTime * vec2(0.03, -0.02)).b;
          float fine = texture2D(uNoise, vWorld.xz * 0.9 - vWorld.y * 0.4).a;
          float foam = clamp((vAux.x * 1.5 - lace * 0.7) * 2.2, 0.0, 1.0) * (0.8 + 0.2 * fine);
          vec3 foamCol = (vec3(0.85, 0.9, 0.93) * (uHorizon * 0.5 + uZenith * 0.4 + 0.3) + uSunColor * 0.12) * uAmbient;
          col = mix(col, foamCol, foam);
          float a = vAux.y * mix(0.86, 1.0, foam);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.roar = 0;
    this.sprayAcc = 0;
    this._s = {};
  }

  surfaceY(x, z, t) {
    return this.waves.sample(x, z, t, this._s).h;
  }

  update(dt, t, ski, density = 1) {
    const S = this.surf;
    S.update(t);
    this.material.uniforms.uTime.value = t;
    const P = this.pos;
    const X = this.aux;
    let strip = 0;
    let roar = 0;
    const near = (x, z) => Math.hypot(x - ski.px, z - ski.pz);
    const waves = [];
    for (let i = 0; i < S.count; i++) waves.push({ ...S.waves[i] });
    for (const w of waves) {
      if (w.pd < 0 || w.amp < 0.4) continue;
      for (const side of [1, -1]) {
        if (strip >= STRIPS) break;
        const lf = w.lp + side * w.pd;
        const ddMax = Math.min(SURF.curl * 2.1, w.pd);
        if (ddMax < 0.5) continue;
        // is any of this curl still on the crest?
        const envAt = (l) => 1 - smooth(w.half, w.half + 50, Math.abs(l - w.lc));
        if (envAt(lf) < 0.02 && envAt(lf - side * ddMax) < 0.02) continue;
        const base = strip * VPS;
        for (let j = 0; j <= NS; j++) {
          const dd = (j / NS) * ddMax;
          const l = lf - side * dd;
          const q = dd / SURF.curl;
          const env = envAt(l);
          const H = w.amp * env;
          // the lip throws out fast at the peel point, holds an open tube,
          // then the tube collapses into whitewater
          const r = smooth(0, 0.45, q);
          const collapse = smooth(1.45, 2.05, q);
          const Hs = H * (1 - 0.55 * collapse);
          const cx = S.cx + S.dx * w.sc + S.nx * l;
          const cz = S.cz + S.dz * w.sc + S.nz * l;
          const y0 = this.surfaceY(cx, cz, t);
          const reach = Hs * (0.2 + 1.6 * r);
          const yEnd = this.surfaceY(cx + S.dx * reach, cz + S.dz * reach, t) - 0.12 * H;
          // lip profile: buried behind the crest, up over it, out and down
          const p0s = -0.18 * Hs;
          const p0y = y0 - 0.14 * Hs;
          const p1s = 0.08 * Hs + 0.75 * Hs * r;
          const p1y = y0 + 0.45 * Hs * r + 0.03;
          const p2s = reach + 0.16 * Hs * r;
          const p2y = y0 + 0.14 * Hs * r;
          const p3s = reach;
          const p3y = y0 - 0.05 * Hs + (yEnd - (y0 - 0.05 * Hs)) * r;
          const alpha = Math.min(1, H / 0.5) * (1 - smooth(1.85, 2.1, q));
          for (let i = 0; i <= NP; i++) {
            const u = i / NP;
            const a = (1 - u) * (1 - u) * (1 - u);
            const b = 3 * u * (1 - u) * (1 - u);
            const c = 3 * u * u * (1 - u);
            const d = u * u * u;
            const s = a * p0s + b * p1s + c * p2s + d * p3s;
            const y = a * p0y + b * p1y + c * p2y + d * p3y;
            const v = base + j * (NP + 1) + i;
            P[v * 3] = cx + S.dx * s;
            P[v * 3 + 1] = y;
            P[v * 3 + 2] = cz + S.dz * s;
            X[v * 2] = Math.max(collapse, smooth(0.6, 1, u) * (0.3 + 0.4 * r));
            X[v * 2 + 1] = alpha;
          }
          // the lip lands: explode into spray (only near the rider)
          if (q > 1.35 && q < 1.9 && H > 0.6) {
            const ex = cx + S.dx * reach;
            const ez = cz + S.dz * reach;
            const dist = near(ex, ez);
            roar = Math.max(roar, (H / SURF.A0) * (1 - smooth(25, 170, dist)));
            if (dist < 170) {
              this.sprayAcc += 26 * H * dt * density * (1 - smooth(60, 170, dist));
              while (this.sprayAcc >= 1) {
                this.sprayAcc -= 1;
                const rs = () => Math.random() * 2 - 1;
                const up = 2.5 + Math.random() * 5.5 * (H / SURF.A0);
                const fw = SURF.c * (0.6 + Math.random() * 0.6);
                const big = Math.random() < 0.18;
                this.spray.emit(ex + rs() * 0.8 * S.nx, yEnd + 0.2, ez + rs() * 0.8 * S.nz,
                  S.dx * fw + rs() * 2, up, S.dz * fw + rs() * 2,
                  0.9 + Math.random() * 1.2, big ? 0.22 : 0.08 + Math.random() * 0.07, big ? 1.4 + Math.random() : 0.4 + Math.random() * 0.6,
                  1, big ? 1.1 : 0.45, big ? 0.35 : 0.85, 0.35);
              }
            }
          }
        }
        strip++;
      }
      // whitewater leaves foam trails behind the bore
      const soupHalf = Math.min(w.pd, w.half + 50);
      for (let l = w.lp - soupHalf; l <= w.lp + soupHalf; l += 4) {
        const al = Math.abs(l - w.lp);
        const q = (w.pd - al) / SURF.curl;
        if (q < 1.5) continue;
        const env = 1 - smooth(w.half, w.half + 50, Math.abs(l - w.lc));
        const tl = (w.pd - al) / SURF.vPeel;
        const k = env * Math.exp(-tl / 22) * (w.amp / SURF.A0);
        if (k < 0.05) continue;
        const x = S.cx + S.dx * (w.sc + 2) + S.nx * l;
        const z = S.cz + S.dz * (w.sc + 2) + S.nz * l;
        const dist = near(x, z);
        roar = Math.max(roar, k * 0.6 * (1 - smooth(20, 140, dist)));
        if (dist < 140) this.foam.stamp(x + (Math.random() - 0.5) * 3, z + (Math.random() - 0.5) * 3, 1.5 + k, k * dt * 3.5, k * dt * 4);
      }
    }
    this.roar = roar;
    // tidy up the strips we did not use this frame
    const used = strip * NS * NP * 6;
    this.geo.setDrawRange(0, used);
    if (strip > 0) {
      this.aPos.clearUpdateRanges();
      this.aAux.clearUpdateRanges();
      this.aPos.addUpdateRange(0, strip * VPS * 3);
      this.aAux.addUpdateRange(0, strip * VPS * 2);
      this.aPos.needsUpdate = true;
      this.aAux.needsUpdate = true;
      this.geo.computeVertexNormals();
    }
    this.mesh.visible = strip > 0;
  }
}
