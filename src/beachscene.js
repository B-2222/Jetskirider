// What you see on BREAKER BEACH: a detailed strip of sand (wet and shiny at
// the waterline, dry and rippled up the beach, grassy dunes behind), and the
// beach itself: a lifeguard tower, the red and yellow flags, umbrellas and
// towels, surfboards stuck in the sand, a dune fence and a boardwalk, Norfolk
// pines and scrub, and boulders on the headlands.

import * as THREE from 'three';
import { makeNoise2D, makeRng, smoothstep, clamp, lerp } from './util.js';
import { HALF_BEACH } from './beach.js';

const N = makeNoise2D(4321);
const sm = smoothstep;

function grainTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 200 + Math.random() * 55;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- sand
function buildSand(B, terrain) {
  const D = [-34, -28, -22, -17, -12, -8, -5, -3, -1.5, 0, 1, 2, 3.5, 5, 7, 9.5, 12, 15, 19, 24, 30, 36, 42, 49, 57, 66, 76, 86, 94, 100, 106, 112, 118, 124, 131, 139, 148, 158, 170, 184, 200, 222, 246];
  const X0 = -HALF_BEACH - 40, X1 = HALF_BEACH + 40, DX = 2;
  const nx = Math.round((X1 - X0) / DX) + 1;
  const nd = D.length;
  const pos = new Float32Array(nx * nd * 3);
  const col = new Float32Array(nx * nd * 3);
  const wet = new Float32Array(nx * nd);
  const uv = new Float32Array(nx * nd * 2);
  const c = new THREE.Color();
  for (let j = 0; j < nd; j++) {
    for (let i = 0; i < nx; i++) {
      const x = X0 + i * DX;
      const z = B.shoreZ(x) - D[j];
      const y = B.heightAt(x, z);
      const o = j * nx + i;
      pos[o * 3] = x;
      pos[o * 3 + 1] = y;
      pos[o * 3 + 2] = z;
      uv[o * 2] = x / 3;
      uv[o * 2 + 1] = z / 3;
      const n = N.fbm(x / 30, z / 30, 3) * 0.5 + 0.5;
      const dd = D[j];
      // slope from the neighbours along d
      const ya = B.heightAt(x, B.shoreZ(x) - dd + 1), yb = B.heightAt(x, B.shoreZ(x) - dd - 1);
      B.colorAt(x, z, y, Math.abs(yb - ya) / 2, n, c);
      // the swash line: darker, glassy wet sand, with a wrack line of weed
      const w = (1 - sm(1, 9 + 3 * N.noise(x / 25, 2), dd)) * sm(-6, -0.5, dd);
      wet[o] = w;
      const wrack = (1 - sm(0, 1.2, Math.abs(dd - 10 - 2 * N.noise(x / 40, 7)))) * 0.5 * sm(0.3, 0.7, N.noise(x / 9, 1));
      c.r = Math.max(0.02, lerp(c.r, 0.13, w * 0.55) - wrack * 0.07);
      c.g = Math.max(0.02, lerp(c.g, 0.095, w * 0.55) - wrack * 0.06);
      c.b = Math.max(0.02, lerp(c.b, 0.055, w * 0.55) - wrack * 0.04);
      col[o * 3] = c.r;
      col[o * 3 + 1] = c.g;
      col[o * 3 + 2] = c.b;
    }
  }
  const idx = [];
  for (let j = 0; j < nd - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: grainTexture(), roughness: 0.95, metalness: 0, envMapIntensity: 0.6, side: THREE.DoubleSide });
  // wet sand is glassy: it reflects the sky
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aWet;\nvarying float vWet;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWet = aWet;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWet;').replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.16, vWet);');
  };
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- props
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });

function onSand(B, x, d) {
  const z = B.shoreZ(x) - d;
  return { x, z, y: B.heightAt(x, z) };
}

function lifeguardTower(B, x, d) {
  const g = new THREE.Group();
  const p = onSand(B, x, d);
  g.position.set(p.x, p.y, p.z);
  // face the sea (+z)
  const red = std(0xd62828), yel = std(0xffc81f), wood = std(0xb08a5a, { roughness: 0.9 }), white = std(0xf2f2ee);
  for (const sx of [-1.3, 1.3]) for (const sz of [-1.3, 1.3]) {
    const leg = new THREE.Mesh(box(0.22, 3.4, 0.22), white);
    leg.position.set(sx, 1.7, sz);
    g.add(leg);
  }
  const brace = new THREE.Mesh(box(2.8, 0.14, 0.14), white);
  brace.position.set(0, 1.2, 1.3);
  g.add(brace);
  const floor = new THREE.Mesh(box(3.4, 0.25, 3.4), wood);
  floor.position.y = 3.5;
  g.add(floor);
  const cab = new THREE.Mesh(box(3, 2.2, 3), yel);
  cab.position.y = 4.75;
  g.add(cab);
  const band = new THREE.Mesh(box(3.04, 0.6, 3.04), red);
  band.position.y = 5.3;
  g.add(band);
  const win = new THREE.Mesh(box(2.2, 0.8, 0.05), std(0x1b2a33, { roughness: 0.2, metalness: 0.4 }));
  win.position.set(0, 4.9, 1.53);
  g.add(win);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.2, 4), red);
  roof.position.y = 6.45;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  // the ramp up the front
  const ramp = new THREE.Mesh(box(1.1, 0.12, 5.2), wood);
  ramp.position.set(0, 1.75, 3.6);
  ramp.rotation.x = 0.72;
  g.add(ramp);
  // flag on top
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3, 6), white);
  pole.position.y = 8.3;
  g.add(pole);
  g.add(flag(0, 9.4, 0));
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

// red over yellow
function flag(x, y, z) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 48;
  const t = c.getContext('2d');
  t.fillStyle = '#d62828';
  t.fillRect(0, 0, 64, 24);
  t.fillStyle = '#ffc81f';
  t.fillRect(0, 24, 64, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.PlaneGeometry(1.4, 1.0, 6, 1);
  g.translate(0.7, 0, 0);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
  m.position.set(x, y, z);
  m.userData.flag = true;
  return m;
}

function beachFlag(B, x, d) {
  const g = new THREE.Group();
  const p = onSand(B, x, d);
  g.position.set(p.x, p.y, p.z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.2, 6), std(0xeeeeee));
  pole.position.y = 2.1;
  g.add(pole, flag(0, 3.7, 0));
  return g;
}

function umbrella(B, x, d, rng) {
  const g = new THREE.Group();
  const p = onSand(B, x, d);
  g.position.set(p.x, p.y, p.z);
  const cols = [0xff5a5f, 0x2bb3c0, 0xffc81f, 0x4c6ef5, 0xff8c42, 0x8ac926];
  const cA = cols[(rng() * cols.length) | 0], cB = 0xf6f6f0;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6), std(0xdddddd, { metalness: 0.5 }));
  pole.position.y = 1.15;
  pole.rotation.z = (rng() - 0.5) * 0.25;
  g.add(pole);
  // striped canopy: eight panels
  const canopy = new THREE.ConeGeometry(1.25, 0.5, 8, 1, true);
  const colors = [];
  const pa = canopy.attributes.position;
  const ca = new THREE.Color(cA), cb = new THREE.Color(cB);
  for (let i = 0; i < pa.count; i++) {
    const a = Math.atan2(pa.getZ(i), pa.getX(i));
    const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 2;
    const c = k ? ca : cb;
    colors.push(c.r, c.g, c.b);
  }
  canopy.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const cm = new THREE.Mesh(canopy, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }));
  cm.position.y = 2.25;
  cm.rotation.z = pole.rotation.z;
  g.add(cm);
  // a towel or two
  for (let k = 0; k < 1 + (rng() < 0.5); k++) {
    const tw = new THREE.Mesh(box(0.85, 0.02, 1.8), std(cols[(rng() * cols.length) | 0], { roughness: 1 }));
    tw.position.set((rng() - 0.5) * 2.4, 0.02, 0.6 + rng() * 0.8);
    tw.rotation.y = (rng() - 0.5) * 0.6;
    g.add(tw);
  }
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

function surfboards(B, x, d, rng) {
  const g = new THREE.Group();
  const cols = [0xffffff, 0x8fd3ff, 0xffd166, 0xef476f, 0x06d6a0];
  const shape = new THREE.Shape();
  shape.moveTo(0, -1.1);
  shape.quadraticCurveTo(0.3, -0.6, 0.28, 0.2);
  shape.quadraticCurveTo(0.2, 0.9, 0, 1.15);
  shape.quadraticCurveTo(-0.2, 0.9, -0.28, 0.2);
  shape.quadraticCurveTo(-0.3, -0.6, 0, -1.1);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false });
  for (let i = 0; i < 5; i++) {
    const p = onSand(B, x + i * 0.8, d + (rng() - 0.5) * 0.6);
    const m = new THREE.Mesh(geo, std(cols[i % cols.length], { roughness: 0.4 }));
    m.position.set(p.x, p.y + 0.95, p.z);
    m.rotation.set((rng() - 0.5) * 0.25, rng() * 0.6, (rng() - 0.5) * 0.2);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

function dunesAndPlants(B, terrain) {
  const group = new THREE.Group();
  const rng = makeRng(77);
  const d3 = new THREE.Object3D();
  // dune grass: crossed blades
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const t = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    t.strokeStyle = `rgba(${150 + ((i * 13) % 50)},${160 + ((i * 7) % 40)},${80 + ((i * 11) % 30)},1)`;
    t.lineWidth = 2;
    t.beginPath();
    const x0 = 8 + Math.random() * 48;
    t.moveTo(x0, 64);
    t.quadraticCurveTo(x0 + (Math.random() - 0.5) * 20, 30, x0 + (Math.random() - 0.5) * 30, 4 + Math.random() * 20);
    t.stroke();
  }
  const gt = new THREE.CanvasTexture(c);
  gt.colorSpace = THREE.SRGBColorSpace;
  const grassG = new THREE.BufferGeometry();
  {
    const a = new THREE.PlaneGeometry(1.3, 1, 1, 1);
    a.translate(0, 0.5, 0);
    const b = a.clone();
    b.rotateY(Math.PI / 2);
    const pos = [...a.toNonIndexed().attributes.position.array, ...b.toNonIndexed().attributes.position.array];
    const uv = [...a.toNonIndexed().attributes.uv.array, ...b.toNonIndexed().attributes.uv.array];
    grassG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    grassG.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    grassG.computeVertexNormals();
  }
  const grassM = new THREE.MeshStandardMaterial({ map: gt, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 });
  const grass = [];
  const bushes = [];
  const pines = [];
  let guard = 0;
  while ((grass.length < 15000 || bushes.length < 2600 || pines.length < 110) && guard++ < 200000) {
    const x = (rng() * 2 - 1) * (HALF_BEACH + 300);
    const d = 85 + rng() * 520;
    const z = B.shoreZ(x) - d;
    const h = terrain.heightAt(x, z);
    if (h < 2.4) continue;
    if (Math.abs(x - 40) < 3) continue; // the boardwalk
    if (d < 215 && grass.length < 15000 && rng() < 0.9) grass.push([x, h, z, 1.0 + rng() * 1.1]);
    else if (d > 150 && bushes.length < 2600 && rng() < 0.6) bushes.push([x, h, z, 0.6 + rng() * 1.3]);
    else if (d > 175 && d < 330 && pines.length < 110 && rng() < 0.12 && B.rocky(x) < 0.3) pines.push([x, h, z, 0.85 + rng() * 0.4]);
  }
  const place = (geo, mat, list, sy = 1, cast = false) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      d3.position.set(p[0], p[1] - 0.1, p[2]);
      d3.rotation.set(0, rng() * 6.28, 0);
      d3.scale.set(p[3], p[3] * sy, p[3]);
      d3.updateMatrix();
      im.setMatrixAt(i, d3.matrix);
    });
    im.castShadow = cast;
    group.add(im);
  };
  place(grassG, grassM, grass);
  const bushG = new THREE.IcosahedronGeometry(1, 1);
  bushG.scale(1.2, 0.65, 1.2);
  place(bushG, std(0x3f5a2a, { roughness: 1 }), bushes, 0.9);
  // Norfolk pines: tall, in flat tiers
  const tiers = [];
  for (let i = 0; i < 7; i++) {
    const r = 3.4 - i * 0.42;
    const tg = new THREE.CylinderGeometry(r * 0.15, r, 1.0, 10, 1);
    tg.translate(0, 6 + i * 2.6, 0);
    tiers.push(tg.toNonIndexed());
  }
  const trunk = new THREE.CylinderGeometry(0.2, 0.45, 26, 7);
  trunk.translate(0, 13, 0);
  const merged = new THREE.BufferGeometry();
  {
    const arrs = tiers.map((g) => g.attributes.position.array);
    const n = arrs.reduce((a, b) => a + b.length, 0);
    const pos = new Float32Array(n);
    let o = 0;
    for (const a of arrs) {
      pos.set(a, o);
      o += a.length;
    }
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.computeVertexNormals();
  }
  place(merged, std(0x24401f, { roughness: 0.95 }), pines, 1, false);
  place(trunk, std(0x5a4636, { roughness: 1 }), pines, 1, false);
  return group;
}

function fenceAndBoardwalk(B, rng) {
  const group = new THREE.Group();
  const d3 = new THREE.Object3D();
  // a sand fence along the foot of the dunes (posts with gaps)
  const posts = [];
  for (let x = -HALF_BEACH + 60; x < HALF_BEACH - 60; x += 2.6) {
    if (N.noise(x / 40, 9) > 0.45 || Math.abs(x - 40) < 4) continue;
    const p = onSand(B, x, 92 + 2 * N.noise(x / 60, 3));
    posts.push([p.x, p.y, p.z, (rng() - 0.5) * 0.25]);
  }
  const postG = box(0.12, 1.2, 0.12);
  postG.translate(0, 0.45, 0);
  const pm = new THREE.InstancedMesh(postG, std(0x8a6f4e, { roughness: 1 }), posts.length);
  posts.forEach((p, i) => {
    d3.position.set(p[0], p[1], p[2]);
    d3.rotation.set(p[3], 0, p[3] * 0.5);
    d3.scale.set(1, 1, 1);
    d3.updateMatrix();
    pm.setMatrixAt(i, d3.matrix);
  });
  group.add(pm);
  // a boardwalk over the dunes
  const planks = [];
  for (let d = 60; d < 230; d += 0.5) {
    const p = onSand(B, 40, d);
    planks.push([p.x, Math.max(p.y, B.heightAt(40, B.shoreZ(40) - d + 1)) + 0.35, p.z]);
  }
  const plankG = box(2.2, 0.08, 0.42);
  const wm = new THREE.InstancedMesh(plankG, std(0xa98257, { roughness: 0.9 }), planks.length);
  planks.forEach((p, i) => {
    d3.position.set(p[0], p[1], p[2]);
    d3.rotation.set(0, 0, 0);
    d3.updateMatrix();
    wm.setMatrixAt(i, d3.matrix);
  });
  wm.receiveShadow = true;
  group.add(wm);
  return group;
}

function headlandRocks(B, rng) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + 0.25 * N.fbm(p.getX(i) * 1.7 + 2, p.getZ(i) * 1.7 + p.getY(i), 3);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.75, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const list = [];
  for (let i = 0; i < 260; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = side * (HALF_BEACH - 120 + rng() * 380);
    const d = -70 + rng() * 110;
    const z = B.shoreZ(x) - d;
    const y = B.heightAt(x, z);
    if (y > 12) continue;
    list.push([x, y, z, 0.8 + rng() * 3.2]);
  }
  const im = new THREE.InstancedMesh(geo, std(0x5b554e, { roughness: 0.85 }), list.length);
  const d3 = new THREE.Object3D();
  list.forEach((q, i) => {
    d3.position.set(q[0], q[1] - q[3] * 0.3, q[2]);
    d3.rotation.set(rng(), rng() * 6, rng());
    d3.scale.setScalar(q[3]);
    d3.updateMatrix();
    im.setMatrixAt(i, d3.matrix);
  });
  im.castShadow = true;
  return im;
}

export class BeachScene {
  constructor({ beach, terrain, scene }) {
    const B = beach;
    const rng = makeRng(2024);
    this.group = new THREE.Group();
    this.group.add(buildSand(B, terrain));
    this.group.add(lifeguardTower(B, 60, 32));
    for (const [x, d] of [[-150, 14], [250, 14], [-150, 60], [250, 60]]) this.group.add(beachFlag(B, x, d));
    for (let i = 0; i < 14; i++) {
      const x = (rng() * 2 - 1) * 520;
      if (Math.abs(x - 60) < 20) continue;
      this.group.add(umbrella(B, x, 44 + rng() * 38, rng));
    }
    this.group.add(surfboards(B, 72, 36, rng));
    this.group.add(surfboards(B, -320, 50, rng));
    this.group.add(dunesAndPlants(B, terrain));
    this.group.add(fenceAndBoardwalk(B, rng));
    this.group.add(headlandRocks(B, rng));
    this.flags = [];
    this.group.traverse((o) => o.userData.flag && this.flags.push(o));
    scene.add(this.group);
  }

  // the flags flap in the sea breeze
  update(dt, time) {
    for (let i = 0; i < this.flags.length; i++) {
      const f = this.flags[i];
      f.rotation.y = -0.4 + Math.sin(time * 2.2 + i) * 0.25;
      f.scale.y = 1 + Math.sin(time * 7 + i * 2) * 0.05;
    }
  }
}
