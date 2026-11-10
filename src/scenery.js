// Islands, palms, rocks, jump ramps and marker buoys.

import * as THREE from 'three';
import { makeNoise2D, makeRng, clamp, smoothstep, lerp } from './util.js';
import { WORLD_SIZE, ISLANDS } from './terrain.js';
import { canvasTexture } from './textures.js';

export function buildTerrainMesh(terrain) {
  const N = makeNoise2D(4242);
  const seg = 448;
  const g = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const wet = new THREE.Color(0.5, 0.43, 0.3);
  const sand = new THREE.Color(0.84, 0.76, 0.57);
  const g1 = new THREE.Color(0.16, 0.36, 0.11);
  const g2 = new THREE.Color(0.3, 0.47, 0.15);
  const jungle = new THREE.Color(0.07, 0.22, 0.08);
  const rock = new THREE.Color(0.4, 0.37, 0.33);
  const e = WORLD_SIZE / seg;
  const hs = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let h = terrain.heightAt(x, z);
    if (h > 1.5) h += N.fbm(x / 14, z / 14, 3) * Math.min(1.6, (h - 1.5) * 0.25);
    hs[i] = h;
    pos.setY(i, h);
    const sx = terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z);
    const sz = terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e);
    const slope = Math.hypot(sx, sz) / (2 * e);
    const n = N.fbm(x / 40, z / 40, 3) * 0.5 + 0.5;
    c.copy(wet).lerp(sand, smoothstep(0.15, 0.9, h));
    const veg = smoothstep(2.0, 4.2, h + (n - 0.5) * 2.5);
    const gc = g1.clone().lerp(g2, n).lerp(jungle, smoothstep(12, 45, h) * 0.8);
    c.lerp(gc, veg);
    c.lerp(rock, smoothstep(0.55, 0.95, slope) * smoothstep(3, 8, h));
    const shade = 0.85 + N.noise(x / 6, z / 6) * 0.15;
    col[i * 3] = c.r * shade;
    col[i * 3 + 1] = c.g * shade;
    col[i * 3 + 2] = c.b * shade;
  }
  // drop triangles that are well under water
  const src = g.index.array;
  const idx = [];
  for (let i = 0; i < src.length; i += 3) {
    if (hs[src[i]] > -2.5 || hs[src[i + 1]] > -2.5 || hs[src[i + 2]] > -2.5) idx.push(src[i], src[i + 1], src[i + 2]);
  }
  g.setIndex(idx);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.35 });
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = false;
  return m;
}

function palmFrondTexture() {
  return canvasTexture(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#6f8f2e';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    for (let i = 0; i < 42; i++) {
      const x = 6 + (i / 42) * (w - 12);
      const len = (h / 2 - 4) * Math.sin(Math.PI * Math.pow(i / 42, 0.75)) + 6;
      const gr = 90 + ((i * 37) % 60);
      g.strokeStyle = `rgb(${40 + ((i * 13) % 30)},${gr + 30},${30})`;
      g.lineWidth = 4.2;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(x, h / 2);
        g.lineTo(x + 16, h / 2 + s * len);
        g.stroke();
      }
    }
  });
}

export function buildVegetation(terrain) {
  const group = new THREE.Group();
  const rng = makeRng(99);
  const dummy = new THREE.Object3D();

  // --- palms ---------------------------------------------------------------
  const trunkG = new THREE.CylinderGeometry(0.11, 0.2, 7, 7, 8);
  trunkG.translate(0, 3.5, 0);
  {
    const p = trunkG.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 7;
      p.setX(i, p.getX(i) + y * y * 1.3);
    }
    trunkG.computeVertexNormals();
  }
  const frondParts = [];
  const nF = 11;
  for (let f = 0; f < nF; f++) {
    const fg = new THREE.PlaneGeometry(3.4, 1.1, 7, 2);
    const p = fg.attributes.position;
    const droop = 0.35 + (f % 3) * 0.22;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + 1.7; // 0..3.4
      const t = x / 3.4;
      const y = p.getY(i);
      p.setXYZ(i, x, 0.55 * t - droop * 2.4 * t * t - Math.abs(y) * 0.35, y);
    }
    fg.rotateY((f / nF) * Math.PI * 2 + (f % 2) * 0.2);
    fg.translate(1.3, 7.0, 0);
    frondParts.push(fg);
  }
  // merge fronds
  const crownG = mergeGeometries(frondParts);
  crownG.computeVertexNormals();
  const frondTex = palmFrondTexture();
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 1 });
  const crownM = new THREE.MeshStandardMaterial({ map: frondTex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.8, color: 0xd8f0b0 });
  const spots = [];
  let guard = 0;
  while (spots.length < 420 && guard++ < 60000) {
    const is = ISLANDS[(rng() * ISLANDS.length) | 0];
    const a = rng() * Math.PI * 2;
    const r = is.r * (0.55 + rng() * 0.6);
    const x = is.x + Math.cos(a) * r;
    const z = is.z + Math.sin(a) * r;
    const h = terrain.heightAt(x, z);
    if (h < 1.3 || h > 11) continue;
    spots.push([x, h, z]);
  }
  const trunks = new THREE.InstancedMesh(trunkG, trunkM, spots.length);
  const crowns = new THREE.InstancedMesh(crownG, crownM, spots.length);
  spots.forEach((s, i) => {
    dummy.position.set(s[0], s[1] - 0.3, s[2]);
    dummy.rotation.set((rng() - 0.5) * 0.25, rng() * Math.PI * 2, (rng() - 0.5) * 0.25);
    const sc = 0.8 + rng() * 0.75;
    dummy.scale.set(sc, sc * (0.85 + rng() * 0.4), sc);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    crowns.setMatrixAt(i, dummy.matrix);
  });
  group.add(trunks, crowns);

  // --- jungle canopy blobs ---------------------------------------------------
  const blobG = new THREE.IcosahedronGeometry(1, 1);
  {
    const p = blobG.attributes.position;
    const N = makeNoise2D(5);
    for (let i = 0; i < p.count; i++) {
      const k = 1 + N.noise(p.getX(i) * 2.1 + p.getY(i), p.getZ(i) * 2.1 - p.getY(i)) * 0.3;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.75, p.getZ(i) * k);
    }
    blobG.computeVertexNormals();
  }
  const blobM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: false, envMapIntensity: 0.3 });
  const blobs = [];
  guard = 0;
  while (blobs.length < 1500 && guard++ < 90000) {
    const is = ISLANDS[(rng() * ISLANDS.length) | 0];
    const a = rng() * Math.PI * 2;
    const r = is.r * Math.sqrt(rng()) * 0.95;
    const x = is.x + Math.cos(a) * r;
    const z = is.z + Math.sin(a) * r;
    const h = terrain.heightAt(x, z);
    if (h < 3.2) continue;
    blobs.push([x, h, z]);
  }
  const canopy = new THREE.InstancedMesh(blobG, blobM, blobs.length);
  const cc = new THREE.Color();
  blobs.forEach((s, i) => {
    const sc = 3.5 + rng() * 6;
    dummy.position.set(s[0], s[1] + sc * 0.3, s[2]);
    dummy.rotation.set(0, rng() * 6.28, 0);
    dummy.scale.set(sc, sc * (0.7 + rng() * 0.5), sc);
    dummy.updateMatrix();
    canopy.setMatrixAt(i, dummy.matrix);
    cc.setHSL(0.27 + rng() * 0.07, 0.5 + rng() * 0.2, 0.13 + rng() * 0.1);
    canopy.setColorAt(i, cc);
  });
  group.add(canopy);

  // --- shoreline rocks -------------------------------------------------------
  const rockG = new THREE.DodecahedronGeometry(1, 1);
  {
    const p = rockG.attributes.position;
    const N = makeNoise2D(17);
    for (let i = 0; i < p.count; i++) {
      const k = 1 + N.noise(p.getX(i) * 1.7 + 3, p.getZ(i) * 1.7 + p.getY(i) * 1.3) * 0.38;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    rockG.computeVertexNormals();
  }
  const rockM = new THREE.MeshStandardMaterial({ color: 0x6d675f, roughness: 0.95, flatShading: true });
  const rocks = [];
  guard = 0;
  while (rocks.length < 170 && guard++ < 60000) {
    const is = ISLANDS[(rng() * ISLANDS.length) | 0];
    const a = rng() * Math.PI * 2;
    const r = is.r * (0.8 + rng() * 0.4);
    const x = is.x + Math.cos(a) * r;
    const z = is.z + Math.sin(a) * r;
    const h = terrain.heightAt(x, z);
    if (h < 0.6 || h > 3.5) continue;
    rocks.push([x, h, z]);
  }
  const rockI = new THREE.InstancedMesh(rockG, rockM, rocks.length);
  rocks.forEach((s, i) => {
    const sc = 0.5 + rng() * rng() * 2.6;
    dummy.position.set(s[0], s[1] + sc * 0.2, s[2]);
    dummy.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    dummy.scale.set(sc * (0.8 + rng() * 0.6), sc * (0.6 + rng() * 0.5), sc * (0.8 + rng() * 0.6));
    dummy.updateMatrix();
    rockI.setMatrixAt(i, dummy.matrix);
  });
  group.add(rockI);
  return group;
}

function mergeGeometries(list) {
  let nv = 0;
  let ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index.count;
  }
  const pos = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
    vo += g.attributes.position.count;
    io += ia.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// --- jump ramps ---------------------------------------------------------------
export function buildRampMesh(world, ramp) {
  const nx = 40;
  const nz = 20;
  const x0 = -1.4;
  const x1 = ramp.len + 0.45;
  const z0 = -ramp.width / 2 - 0.9;
  const z1 = ramp.width / 2 + 0.9;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const lx = lerp(x0, x1, i / nx);
      const lz = lerp(z0, z1, j / nz);
      // local -> world (inverse of World.rampHeight transform)
      const wx = ramp.x + lx * ramp.c + lz * ramp.s;
      const wz = ramp.z - lx * ramp.s + lz * ramp.c;
      let h = world.rampHeight(ramp, wx, wz);
      if (h < -1.6) h = -1.6;
      pos.push(wx, h, wz);
      uv.push(lx / ramp.len, (lz - z0) / (z1 - z0));
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tex = canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = '#1565c0';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#f3f6f8';
    c.fillRect(0, 0, w, h * 0.16);
    c.fillRect(0, h * 0.84, w, h * 0.16);
    c.fillStyle = '#ffd21f';
    for (let i = 0; i < 6; i++) {
      const x = w * (0.12 + i * 0.15);
      c.beginPath();
      c.moveTo(x, h * 0.3);
      c.lineTo(x + w * 0.06, h * 0.5);
      c.lineTo(x, h * 0.7);
      c.lineTo(x + w * 0.035, h * 0.7);
      c.lineTo(x + w * 0.095, h * 0.5);
      c.lineTo(x + w * 0.035, h * 0.3);
      c.fill();
    }
    c.fillStyle = '#e53935';
    c.fillRect(w * 0.955, 0, w * 0.045, h);
  });
  const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.35, clearcoat: 0.6, side: THREE.DoubleSide }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// --- buoys ----------------------------------------------------------------------
export class Buoys {
  constructor(world, list) {
    this.world = world;
    this.items = [];
    this.group = new THREE.Group();
    const bodyG = new THREE.CylinderGeometry(0.34, 0.42, 0.9, 16);
    bodyG.translate(0, 0.3, 0);
    const topG = new THREE.ConeGeometry(0.34, 0.6, 16);
    topG.translate(0, 1.05, 0);
    const bandG = new THREE.CylinderGeometry(0.35, 0.36, 0.14, 16);
    bandG.translate(0, 0.55, 0);
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, roughness: 0.4 });
    const mats = {};
    for (const b of list) {
      const key = b.color;
      if (!mats[key]) mats[key] = new THREE.MeshPhysicalMaterial({ color: key, roughness: 0.35, clearcoat: 0.5 });
      const g = new THREE.Group();
      for (const [geo, mat] of [[bodyG, mats[key]], [topG, mats[key]], [bandG, white]]) {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        g.add(m);
      }
      g.position.set(b.x, 0, b.z);
      const s = b.scale || 1;
      g.scale.setScalar(s);
      this.group.add(g);
      this.items.push({ x: b.x, z: b.z, g, r: 0.42 * s, tiltX: 0, tiltZ: 0, hit: 0, ph: Math.random() * 6 });
    }
    this._s = {};
  }

  update(dt, t, phys) {
    for (const b of this.items) {
      const dx = b.x - phys.px;
      const dz = b.z - phys.pz;
      if (Math.abs(dx) > 400 || Math.abs(dz) > 400) continue;
      const s = this.world.waves.sample(b.x, b.z, t, this._s);
      b.g.position.y = s.h - 0.05;
      b.tiltX += (-s.nz * 1.2 - b.tiltX) * Math.min(1, dt * 4);
      b.tiltZ += (s.nx * 1.2 - b.tiltZ) * Math.min(1, dt * 4);
      b.hit *= Math.exp(-dt * 2.5);
      b.g.rotation.set(b.tiltX + Math.sin(t * 5 + b.ph) * b.hit, 0, b.tiltZ + Math.cos(t * 5 + b.ph) * b.hit);
      // soft collision with the ski
      const d = Math.hypot(dx, dz);
      const minD = b.r + 0.75;
      if (d < minD && d > 1e-3 && Math.abs(phys.py - s.h) < 1.2) {
        const nx = -dx / d;
        const nz = -dz / d;
        const push = minD - d;
        phys.px += nx * push;
        phys.pz += nz * push;
        const vn = phys.vx * nx + phys.vz * nz;
        if (vn < 0) {
          phys.vx -= nx * vn * 1.25;
          phys.vz -= nz * vn * 1.25;
        }
        b.hit = Math.min(0.7, b.hit + 0.4);
      }
    }
  }
}
