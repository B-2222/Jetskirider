// Sky dome with a sun, atmospheric gradient and drifting procedural clouds.
// The same GLSL is reused by the ocean so reflections always match the sky.

import * as THREE from 'three';
import { DEG } from './util.js';

export const TIMES = [
  {
    id: 'golden',
    name: 'Golden hour',
    elev: 15,
    azim: 205,
    sun: [1.0, 0.63, 0.33],
    sunPower: 3.3,
    zenith: [0.13, 0.27, 0.56],
    horizon: [0.99, 0.69, 0.45],
    glow: [1.0, 0.52, 0.2],
    cloudLit: [1.0, 0.8, 0.62],
    cloudShade: [0.42, 0.36, 0.48],
    deep: [0.012, 0.085, 0.14],
    shallow: [0.05, 0.42, 0.44],
    ambient: 0.72,
    exposure: 0.95,
  },
  {
    id: 'day',
    name: 'Midday',
    elev: 52,
    azim: 150,
    sun: [1.0, 0.96, 0.88],
    sunPower: 3.6,
    zenith: [0.09, 0.3, 0.74],
    horizon: [0.6, 0.79, 0.95],
    glow: [1.0, 0.92, 0.75],
    cloudLit: [1.0, 1.0, 1.0],
    cloudShade: [0.55, 0.62, 0.74],
    deep: [0.008, 0.11, 0.2],
    shallow: [0.04, 0.6, 0.6],
    ambient: 1.0,
    exposure: 0.9,
  },
  {
    id: 'morning',
    name: 'Morning',
    elev: 30,
    azim: 95,
    sun: [1.0, 0.86, 0.68],
    sunPower: 3.4,
    zenith: [0.1, 0.29, 0.66],
    horizon: [0.8, 0.82, 0.86],
    glow: [1.0, 0.8, 0.55],
    cloudLit: [1.0, 0.95, 0.88],
    cloudShade: [0.5, 0.54, 0.66],
    deep: [0.01, 0.1, 0.18],
    shallow: [0.05, 0.52, 0.53],
    ambient: 0.9,
    exposure: 0.92,
  },
];

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform sampler2D uNoise;
uniform float uCloudTime;
uniform float uCloudCover;

vec3 skyGradient(vec3 d) {
  float y = clamp(d.y, 0.0, 1.0);
  float mu = max(dot(d, uSunDir), 0.0);
  // the horizon is warm toward the sun and cooler, bluer opposite it
  float side = 0.5 + 0.5 * dot(normalize(d.xz + 1e-4), normalize(uSunDir.xz + 1e-4));
  vec3 hz = mix(mix(uHorizon, uZenith, 0.42) * 1.05, uHorizon, smoothstep(0.0, 1.0, side));
  vec3 c = mix(hz, uZenith, 1.0 - pow(1.0 - y, 5.0));
  c += uGlow * (0.16 * pow(mu, 5.0) + 0.5 * pow(mu, 40.0)) * (1.0 - 0.55 * y);
  return c;
}

float cloudNoise(vec2 uv) {
  float n = texture2D(uNoise, uv * 0.35).r * 0.56;
  n += texture2D(uNoise, uv * 0.9 + vec2(0.31, 0.17)).g * 0.29;
  n += texture2D(uNoise, uv * 2.6 + vec2(0.7, 0.4)).a * 0.15;
  return n;
}

// rgb = cloud colour, a = coverage
vec4 skyClouds(vec3 d) {
  if (d.y < 0.012) return vec4(0.0);
  vec2 uv = d.xz / (d.y + 0.11) * 0.085 + vec2(uCloudTime * 0.004, uCloudTime * 0.0017);
  float n = cloudNoise(uv);
  float cov = uCloudCover;
  float dens = smoothstep(cov, cov + 0.2, n);
  if (dens <= 0.001) return vec4(0.0);
  vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.02;
  float n2 = cloudNoise(uv + toSun);
  float lit = clamp(0.62 + (n - n2) * 5.5, 0.0, 1.0);
  float mu = max(dot(d, uSunDir), 0.0);
  vec3 col = mix(uCloudShade, uCloudLit, lit);
  col += uGlow * pow(mu, 10.0) * 0.5 * (1.0 - dens * 0.5);
  float a = dens * smoothstep(0.012, 0.16, d.y);
  // blend the base of the cloud deck into horizon haze
  col = mix(uHorizon, col, smoothstep(0.0, 0.22, d.y));
  return vec4(col, a * 0.94);
}
`;

export function makeSkyUniforms(noiseTex) {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uNoise: { value: noiseTex },
    uCloudTime: { value: 0 },
    uCloudCover: { value: 0.52 },
  };
}

export class Sky {
  constructor(noiseTex) {
    this.uniforms = makeSkyUniforms(noiseTex);
    this.uniforms.uSunDisc = { value: 1 };
    this.sunDir = this.uniforms.uSunDir.value;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = viewMatrix * vec4(position, 0.0);
          gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
          gl_Position.z = gl_Position.w;
        }`,
      fragmentShader: /* glsl */ `
        ${SKY_GLSL}
        uniform float uSunDisc;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = skyGradient(d);
          float mu = dot(d, uSunDir);
          float disc = smoothstep(0.99982, 0.99993, mu);
          vec4 cl = skyClouds(d);
          c += uSunColor * disc * 14.0 * uSunDisc * (1.0 - cl.a);
          c = mix(c, cl.rgb, cl.a);
          if (d.y < 0.0) {
            // below the horizon: sea haze colour so env maps get a sensible floor
            c = mix(uHorizon, uHorizon * vec3(0.18, 0.34, 0.42), smoothstep(0.0, -0.25, d.y));
          }
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.time = TIMES[0];
  }

  setTime(tod) {
    this.time = tod;
    const u = this.uniforms;
    const el = tod.elev * DEG;
    const az = tod.azim * DEG;
    u.uSunDir.value.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    u.uSunColor.value.setRGB(tod.sun[0] * tod.sunPower, tod.sun[1] * tod.sunPower, tod.sun[2] * tod.sunPower);
    u.uZenith.value.setRGB(...tod.zenith);
    u.uHorizon.value.setRGB(...tod.horizon);
    u.uGlow.value.setRGB(...tod.glow);
    u.uCloudLit.value.setRGB(...tod.cloudLit);
    u.uCloudShade.value.setRGB(...tod.cloudShade);
  }

  update(dt) {
    this.uniforms.uCloudTime.value += dt;
  }

  // Copy sky uniform values into another material's uniform set
  static link(target, source) {
    for (const k of Object.keys(source)) {
      if (k === 'uSunDisc') continue;
      target[k] = source[k];
    }
  }

  // Bake the sky into a prefiltered environment map for PBR reflections
  makeEnvironment(renderer) {
    const scene = new THREE.Scene();
    const m = this.mesh.clone();
    m.material = this.mesh.material.clone();
    // share live uniform values but hide the sun disc (lights add the highlight)
    for (const k of Object.keys(this.uniforms)) m.material.uniforms[k] = { value: this.uniforms[k].value };
    m.material.uniforms.uSunDisc = { value: 0.25 };
    m.material.toneMapped = false;
    m.scale.setScalar(50);
    scene.add(m);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const prevTM = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    const rt = pmrem.fromScene(scene, 0, 0.1, 100);
    renderer.toneMapping = prevTM;
    pmrem.dispose();
    m.material.dispose();
    return rt.texture;
  }
}
