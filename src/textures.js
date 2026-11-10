// Procedurally baked, seamlessly tiling textures. No image assets anywhere.

import * as THREE from 'three';
import { makeNoise2D, makeRng, clamp } from './util.js';

// RGBA noise: R,G = two cloud-like fbm fields, B = foam "lace" (cell edges
// are 0, cell centres 1), A = fine fbm.
export function makeNoiseTexture(size = 256) {
  const N1 = makeNoise2D(11);
  const N2 = makeNoise2D(29);
  const N3 = makeNoise2D(53);
  const data = new Uint8Array(size * size * 4);

  // tileable worley points
  const cells = 9;
  const rng = makeRng(77);
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    px[i] = rng();
    py[i] = rng();
  }
  const lace = (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const gx = cx + i;
        const gy = cy + j;
        const id = (((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells);
        const dx = gx + px[id] - x;
        const dy = gy + py[id] - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
    }
    return clamp((f2 - f1) * 1.6, 0, 1);
  };

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      const o = (j * size + i) * 4;
      const r = N1.fbm(u * 4, v * 4, 5, 4) * 0.5 + 0.5;
      const g = N2.fbm(u * 6, v * 6, 5, 6) * 0.5 + 0.5;
      const warp = N3.fbm(u * 8, v * 8, 2, 8) * 0.035;
      const b = lace(u + warp, v - warp) * 0.75 + lace(u * 3 + 0.37 - warp, v * 3 + 0.11 + warp) * 0.25;
      const a = N3.fbm(u * 16, v * 16, 4, 16) * 0.5 + 0.5;
      data[o] = clamp(r, 0, 1) * 255;
      data[o + 1] = clamp(g, 0, 1) * 255;
      data[o + 2] = clamp(b, 0, 1) * 255;
      data[o + 3] = clamp(a, 0, 1) * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Water ripple normal map (xy in RG, height in B).
export function makeWaterNormalTexture(size = 512) {
  const N = makeNoise2D(101);
  const h = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      // ridged + smooth mix gives wind-ripple "cat's paw" texture
      let s = 0;
      let amp = 0.5;
      let f = 6;
      for (let o = 0; o < 5; o++) {
        const n = N.noise(u * f, v * f, f);
        s += amp * (o < 2 ? n : 1 - Math.abs(n) * 2);
        amp *= 0.52;
        f *= 2;
      }
      h[j * size + i] = s;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const k = size / 64;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const l = h[j * size + ((i + size - 1) % size)];
      const r = h[j * size + ((i + 1) % size)];
      const d = h[((j + size - 1) % size) * size + i];
      const u = h[((j + 1) % size) * size + i];
      const nx = (l - r) * k;
      const ny = (d - u) * k;
      const o = (j * size + i) * 4;
      data[o] = clamp(nx * 0.5 + 0.5, 0, 1) * 255;
      data[o + 1] = clamp(ny * 0.5 + 0.5, 0, 1) * 255;
      data[o + 2] = clamp(h[j * size + i] * 0.5 + 0.5, 0, 1) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function makeHeightTexture(terrain) {
  const n = terrain.res * terrain.res;
  const data = new Uint16Array(n);
  for (let i = 0; i < n; i++) data[i] = THREE.DataUtils.toHalfFloat(terrain.data[i]);
  const tex = new THREE.DataTexture(data, terrain.res, terrain.res, THREE.RedFormat, THREE.HalfFloatType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Canvas helper
export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}
