// What you see on THE GORGE: the canyon walls (a detailed mesh that follows
// the river), the river itself (its own water shader: glacial turquoise,
// flowing ripples, whitewater over every lip and through the rock gardens),
// the boulders, the old concrete arch bridge over the slot, pines and scrub
// on the tops, the ranges all round, and mist and roar at the drops.

import * as THREE from 'three';
import { SKY_GLSL, Sky } from './sky.js';
import { makeNoise2D, makeRng, smoothstep, clamp, lerp } from './util.js';

const N = makeNoise2D(5151);
const sm = smoothstep;

// ---------------------------------------------------------------- canyon
// layered schist: thin uneven bands with lighter quartz seams and cracks,
// mapped along the river and up the walls
function schistTexture() {
  const W = 512, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(200,200,198)';
  g.fillRect(0, 0, W, H);
  const n = makeNoise2D(77);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 2) {
      const warp = n.noise(x / 110, y / 70) * 26;
      const b = Math.sin((y + warp) * 0.2 + n.noise(x / 50, y / 30) * 2.6) * (0.55 + 0.45 * n.noise(x / 70, y / 45));
      const fine = n.noise(x / 5, (y + warp) / 3) * 0.5 + n.noise(x / 17, y / 11) * 0.4;
      let v = 188 + b * 15 + fine * 20;
      // quartz seams
      if (Math.abs(Math.sin((y + warp) * 0.05 + 1.3)) > 0.992) v += 28;
      g.fillStyle = `rgb(${v | 0},${(v * 0.99) | 0},${(v * 0.96) | 0})`;
      g.fillRect(x, y, 2, 1);
    }
  }
  // cracks
  g.strokeStyle = 'rgba(40,40,40,0.45)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 70; i++) {
    let x = Math.random() * W, y = Math.random() * H;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (Math.random() - 0.5) * 18;
      y += 6 + Math.random() * 10;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildCanyon(G) {
  const ds = 1.5;
  const rows = Math.ceil((G.sMax - G.sMin) / ds) + 1;
  const U = [0, 0.18, 0.36, 0.52, 0.66, 0.78, 0.88, 0.95, 1.0];
  const E = [0.35, 0.8, 1.3, 1.9, 2.5, 3.1, 3.7, 4.3, 4.9, 5.5, 6.2, 6.9, 7.7, 8.5, 9.4, 10.4, 11.4, 12.6, 13.9, 15.4, 17, 19, 22.5, 27, 32, 38, 46, 56, 68, 84, 104, 128, 150];
  // across: right side (t < 0) far to near, the water, left side near to far
  const cols = [];
  for (let k = E.length - 1; k >= 0; k--) cols.push({ side: -1, e: E[k] });
  for (let k = U.length - 1; k >= 1; k--) cols.push({ side: -1, u: U[k] });
  cols.push({ side: 1, u: 0 });
  for (let k = 1; k < U.length; k++) cols.push({ side: 1, u: U[k] });
  for (let k = 0; k < E.length; k++) cols.push({ side: 1, e: E[k] });
  const nc = cols.length;
  const pos = new Float32Array(rows * nc * 3);
  const col = new Float32Array(rows * nc * 3);
  const sArr = new Float32Array(rows * nc);
  const uvs = new Float32Array(rows * nc * 2);
  const lvArr = new Float32Array(rows * nc);
  for (let r = 0; r < rows; r++) {
    const s = Math.min(G.sMax, G.sMin + r * ds);
    const W = G.width(s);
    const c = G.at(s);
    const lv = G.level(s);
    for (let k = 0; k < nc; k++) {
      const cc = cols[k];
      let t = cc.u !== undefined ? cc.u * W : W + cc.e;
      t = Math.min(t, G.extent(s, cc.side));
      t *= cc.side;
      const x = c.x - c.tz * t, z = c.z + c.tx * t;
      const y = G.groundST(s, t, x, z, 1);
      const o = (r * nc + k) * 3;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      sArr[r * nc + k] = s;
      lvArr[r * nc + k] = lv;
      uvs[(r * nc + k) * 2] = s / 16 + t / 40;
      uvs[(r * nc + k) * 2 + 1] = y / 9;
    }
  }
  // colours: shingle and wet rock at the water, layered grey schist on the
  // walls, tussock and scrub on the tops
  const v = (r, k) => (r * nc + k) * 3;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < nc; k++) {
      const o = v(r, k);
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const ka = Math.max(0, k - 1), kb = Math.min(nc - 1, k + 1), ra = Math.max(0, r - 1), rb = Math.min(rows - 1, r + 1);
      const dxk = Math.hypot(pos[v(r, kb)] - pos[v(r, ka)], pos[v(r, kb) + 2] - pos[v(r, ka) + 2]) || 1;
      const dyk = Math.abs(pos[v(r, kb) + 1] - pos[v(r, ka) + 1]);
      const dxr = Math.hypot(pos[v(rb, k)] - pos[v(ra, k)], pos[v(rb, k) + 2] - pos[v(ra, k) + 2]) || 1;
      const dyr = Math.abs(pos[v(rb, k) + 1] - pos[v(ra, k) + 1]);
      const slope = Math.max(dyk / dxk, dyr / dxr);
      const lv = lvArr[r * nc + k];
      const above = y - lv;
      const n = N.fbm(x / 23, z / 23, 3) * 0.5 + 0.5;
      // layered schist: bands by height, warped
      const band = Math.sin(y * 1.9 + N.noise(x / 30, z / 30) * 4 + N.noise(x / 6, z / 6) * 0.8);
      let cr, cg, cb;
      const grey = 0.25 + band * 0.07 + (n - 0.5) * 0.1 + 0.05 * N.noise(x / 3, y / 2.5 + z / 3);
      cr = grey * 1.0;
      cg = grey * 0.99;
      cb = grey * 0.96;
      // rusty iron staining in streaks
      const rust = sm(0.55, 0.85, N.noise(x / 9, y / 14 + z / 9)) * 0.5;
      cr += rust * 0.07;
      cg += rust * 0.015;
      cb -= rust * 0.03;
      // flat ground: tussock, scrub, moss
      const flat = 1 - sm(0.35, 0.8, slope);
      const tus = [0.36 + 0.05 * n, 0.3 + 0.04 * n, 0.16];
      const scrub = [0.1, 0.14, 0.06];
      const veg = sm(0.2, 0.7, N.noise(x / 40 + 3, z / 40)) * 0.75;
      const top = [lerp(tus[0], scrub[0], veg), lerp(tus[1], scrub[1], veg), lerp(tus[2], scrub[2], veg)];
      const kf = flat * sm(1.5, 4, above);
      cr = lerp(cr, top[0], kf);
      cg = lerp(cg, top[1], kf);
      cb = lerp(cb, top[2], kf);
      // shingle bars and beaches at the water
      const shingle = flat * (1 - sm(1.2, 2.5, above)) * sm(-0.6, 0.1, above);
      cr = lerp(cr, 0.36 + 0.05 * n, shingle);
      cg = lerp(cg, 0.35 + 0.05 * n, shingle);
      cb = lerp(cb, 0.32 + 0.04 * n, shingle);
      // wet and darker at the waterline, with a green slime line
      const wet = 1 - sm(0.1, 1.4, above);
      cr = lerp(cr, 0.08, wet * 0.7);
      cg = lerp(cg, 0.09, wet * 0.7);
      cb = lerp(cb, 0.08, wet * 0.7);
      const slime = (1 - sm(0, 0.5, Math.abs(above - 0.25))) * 0.5;
      cr = lerp(cr, 0.07, slime);
      cg = lerp(cg, 0.11, slime);
      cb = lerp(cb, 0.05, slime);
      // the riverbed: pale stones under the water
      const bed = 1 - sm(-0.4, 0.05, above);
      cr = lerp(cr, 0.3 + 0.08 * n, bed);
      cg = lerp(cg, 0.29 + 0.07 * n, bed);
      cb = lerp(cb, 0.25 + 0.05 * n, bed);
      col[o] = cr;
      col[o + 1] = cg;
      col[o + 2] = cb;
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let k = 0; k < nc - 1; k++) {
      const a = r * nc + k, b = a + 1, c = a + nc, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: schistTexture(), roughness: 0.93, metalness: 0, envMapIntensity: 0.4, side: THREE.DoubleSide });
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- water
function buildRiverGeometry(G) {
  // finer along the river where the surface bends over a lip
  const ss = [];
  for (let s = G.sMin; s <= G.sMax; ) {
    ss.push(s);
    let near = false;
    for (const d of G.drops) if (s > d.s - 25 && s < d.s + d.len + 25) near = true;
    s += near ? 0.6 : 2.5;
  }
  const NC = 22;
  const rows = ss.length;
  const pos = new Float32Array(rows * (NC + 1) * 3);
  const dat = new Float32Array(rows * (NC + 1) * 4); // flow x, flow z, whitewater, depth
  const st = new Float32Array(rows * (NC + 1) * 2); // s, t/W
  for (let r = 0; r < rows; r++) {
    const s = ss[r];
    const W = G.width(s);
    const c = G.at(s);
    const lv = G.level(s);
    for (let k = 0; k <= NC; k++) {
      const u = (k / NC) * 2 - 1;
      const t = u * (W + 3.5);
      const x = c.x - c.tz * t, z = c.z + c.tx * t;
      const o = r * (NC + 1) + k;
      pos[o * 3] = x;
      pos[o * 3 + 1] = lv;
      pos[o * 3 + 2] = z;
      const f = G.flow(s, t);
      dat[o * 4] = c.tx * f;
      dat[o * 4 + 1] = c.tz * f;
      dat[o * 4 + 2] = G.white(s, t);
      dat[o * 4 + 3] = lv - G.groundST(s, t, x, z);
      st[o * 2] = s;
      st[o * 2 + 1] = t / W;
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let k = 0; k < NC; k++) {
      const a = r * (NC + 1) + k, b = a + 1, c = a + NC + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aDat', new THREE.BufferAttribute(dat, 4));
  g.setAttribute('aST', new THREE.BufferAttribute(st, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function riverMaterial(sky, normalTex, foam) {
  const u = {
    uTime: { value: 0 },
    uNormalMap: { value: normalTex },
    uFoamMap: { value: null },
    uFoamCenter: { value: foam.center },
    uFoamSize: { value: foam.size },
    uAmbient: { value: 1 },
    uFogDist: { value: 2600 },
  };
  Sky.link(u, sky.uniforms);
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      attribute vec4 aDat;
      attribute vec2 aST;
      varying vec3 vWorld;
      varying vec4 vDat;
      varying vec2 vST;
      void main() {
        vWorld = position;
        vDat = aDat;
        vST = aST;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform sampler2D uNormalMap;
      uniform sampler2D uFoamMap;
      uniform vec2 uFoamCenter;
      uniform float uFoamSize;
      uniform float uTime, uAmbient, uFogDist;
      varying vec3 vWorld;
      varying vec4 vDat;
      varying vec2 vST;
      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        float t = uTime;
        vec2 flow = vDat.xy;
        float speed = length(flow);
        vec2 fd = speed > 0.01 ? flow / speed : vec2(1.0, 0.0);
        vec2 fs = vec2(-fd.y, fd.x);
        float white = vDat.z;
        float depth = max(vDat.w, 0.0);
        // ripples in river coordinates, carried downstream
        float s = vST.x;
        float across = vST.y * 14.0;
        vec2 q1 = vec2(s * 0.09 - t * speed * 0.09, across * 0.09);
        vec2 q2 = vec2(s * 0.31 - t * speed * 0.31, across * 0.27 + 0.37);
        vec2 q3 = vec2(s * 0.9 - t * speed * 0.9, across * 0.8 + 0.71);
        vec2 n1 = texture2D(uNormalMap, q1).xy * 2.0 - 1.0;
        vec2 n2 = texture2D(uNormalMap, q2).xy * 2.0 - 1.0;
        vec2 n3 = texture2D(uNormalMap, q3).xy * 2.0 - 1.0;
        float rough = 0.18 + 0.12 * min(speed, 4.0) + white * 0.7;
        vec2 dn = (n1 * 0.6 + n2 * 0.5 + n3 * 0.35 / (1.0 + dist * 0.03)) * rough;
        vec3 N = normalize(vec3(fd.x * dn.x + fs.x * dn.y, 1.0, fd.y * dn.x + fs.y * dn.y));

        // the ski's wake
        vec2 fuv = (vWorld.xz - uFoamCenter) / uFoamSize + 0.5;
        vec2 fin = step(vec2(0.0), fuv) * step(fuv, vec2(1.0));
        vec4 wake = texture2D(uFoamMap, fuv) * fin.x * fin.y;

        // reflection: sky straight up, the dark canyon walls low down
        float NdV = max(dot(N, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        vec3 R = reflect(-V, N);
        R.y = abs(R.y) + 0.01;
        R = normalize(R);
        vec3 refl = skyGradient(R);
        vec4 cl = skyClouds(R);
        refl = mix(refl, cl.rgb, cl.a * 0.9);
        vec3 wall = vec3(0.06, 0.07, 0.06) * uAmbient * (0.6 + 0.4 * uSunDir.y);
        refl = mix(wall, refl, smoothstep(0.18, 0.55, R.y));
        vec3 H = normalize(V + uSunDir);
        float NdH = max(dot(N, H), 0.0);
        refl += uSunColor * (pow(NdH, 700.0) * 18.0 + pow(NdH, 90.0) * 0.5) * smoothstep(0.3, 0.6, R.y);

        // glacial water: milky turquoise, the stones showing through the shallows
        vec3 shallow = vec3(0.06, 0.42, 0.42);
        vec3 deep = vec3(0.004, 0.08, 0.11);
        vec3 bed = vec3(0.32, 0.3, 0.25);
        float sunK = 0.4 + 0.6 * clamp(uSunDir.y * 2.0, 0.0, 1.0);
        vec3 trans = exp(-depth * vec3(0.75, 0.22, 0.2));
        vec3 body = bed * trans * sunK + mix(shallow, deep, 1.0 - exp(-depth * 0.45)) * (1.0 - exp(-depth * 1.1)) * (0.55 + 0.45 * sunK);
        body *= uAmbient;
        vec3 col = mix(body, refl, F * 0.9);

        // whitewater: over the lips, through the rock gardens, round rocks,
        // and churned up behind the ski
        float l1 = texture2D(uNoise, vec2(s * 0.11 - t * speed * 0.11, across * 0.35)).b;
        float l2 = texture2D(uNoise, vec2(s * 0.35 - t * speed * 0.35, across * 0.9 + 0.4)).b;
        float streak = l1 * 0.6 + l2 * 0.4;
        float foam = clamp((white * 1.35 - streak * 0.75) * 2.4, 0.0, 1.0);
        foam = max(foam, clamp((wake.r * 1.2 - streak * 0.9) * 2.0, 0.0, 1.0));
        // a lace of bubbles in fast water
        foam = max(foam, clamp((min(speed, 6.0) * 0.06 - streak * 0.5 + 0.02) * 3.0, 0.0, 0.35));
        vec3 foamCol = (vec3(0.86, 0.9, 0.92) * (uHorizon * 0.5 + uZenith * 0.4 + 0.3) + uSunColor * 0.18 * max(dot(N, uSunDir), 0.0)) * uAmbient;
        col = mix(col, foamCol, foam);
        // aerated water is paler
        col = mix(col, (shallow * 1.25 + 0.12) * uAmbient * sunK, clamp(white * 0.4 + wake.g * 0.4, 0.0, 0.5) * (1.0 - foam));

        float fog = 1.0 - exp(-pow(dist / uFogDist, 1.6));
        col = mix(col, skyGradient(normalize(vec3(-V.x, 0.05, -V.z))), fog);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- boulders
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  const n = makeNoise2D(seed);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // blocky schist: flattened layers, then lumps
    let k = 1 + 0.22 * n.fbm(x * 1.4 + 3, z * 1.4 + y * 0.8, 3) + 0.08 * Math.sin(y * 9 + x * 2);
    p.setXYZ(i, x * k, y * k * (y > 0 ? 0.85 : 1), z * k);
  }
  g.computeVertexNormals();
  return g;
}

function buildRocks(G) {
  const group = new THREE.Group();
  const geos = [rockGeometry(11), rockGeometry(29), rockGeometry(47)];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 });
  const per = [[], [], []];
  G.rocks.forEach((r, i) => per[i % 3].push(r));
  const d = new THREE.Object3D();
  per.forEach((list, gi) => {
    const im = new THREE.InstancedMesh(geos[gi], mat, list.length);
    const c = new THREE.Color();
    list.forEach((r, i) => {
      d.position.set(r.x, r.top - r.r * 1.1, r.z);
      d.rotation.set(0, (i * 2.399) % (Math.PI * 2), 0);
      d.scale.set(r.r * 1.02, r.r * 1.1, r.r * 0.98);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
      const k = 0.85 + ((i * 37) % 10) / 40;
      im.setColorAt(i, c.setRGB(0.16 * k, 0.16 * k, 0.15 * k));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  });
  return group;
}

// ---------------------------------------------------------------- bridge
// An old open-spandrel concrete arch over the narrowest slot.
function buildBridge(G) {
  const s = G.bridgeS;
  const c = G.at(s);
  const W = G.width(s);
  const lv = G.level(s);
  // across the river: along the normal
  const nx = -c.tz, nz = c.tx;
  // how high the tops are either side
  const rim = (side) => {
    for (let e = 4; e < 120; e += 1) {
      const t = side * (W + e);
      const x = c.x + nx * t, z = c.z + nz * t;
      const y = G.groundST(s, t, x, z);
      if (y > lv + 30 || e > 40) return { e, y };
    }
    return { e: 40, y: lv + 30 };
  };
  const a = rim(-1), b = rim(1);
  const deckY = Math.min(a.y, b.y) + 0.6;
  const half = W + Math.max(a.e, b.e) + 4; // springing points, from the centre
  const spring = lv + 12;
  const crown = deckY - 3.4;
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.92 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x6f6d68, roughness: 0.95 });
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const local = new THREE.Group();
  // local x: across the river, z: along it
  local.position.set(c.x, 0, c.z);
  local.rotation.y = Math.atan2(-nz, nx);
  group.add(local);
  const archY = (x) => spring + (crown - spring) * (1 - (x / half) ** 2);
  // two ribs
  const segs = 36;
  for (const rz of [-2.4, 2.4]) {
    for (let i = 0; i < segs; i++) {
      const x0 = -half + (i / segs) * 2 * half, x1 = -half + ((i + 1) / segs) * 2 * half;
      const y0 = archY(x0), y1 = archY(x1);
      const len = Math.hypot(x1 - x0, y1 - y0);
      const m = new THREE.Mesh(box(len + 0.15, 1.5, 1.3), concrete);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, rz);
      m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      m.castShadow = true;
      local.add(m);
    }
  }
  // spandrel columns up to the deck
  for (let x = -half + 3; x <= half - 3; x += 4.2) {
    const y0 = archY(x);
    const h = deckY - 0.5 - y0;
    if (h < 0.6) continue;
    for (const rz of [-2.4, 2.4]) {
      const m = new THREE.Mesh(box(0.7, h, 0.7), concrete);
      m.position.set(x, y0 + h / 2, rz);
      local.add(m);
    }
    const tie = new THREE.Mesh(box(0.5, 0.5, 5.2), dark);
    tie.position.set(x, deckY - 0.75, 0);
    local.add(tie);
  }
  // deck and railings, running out onto the tops
  const deckL = 2 * half + 30;
  const deck = new THREE.Mesh(box(deckL, 0.9, 7.2), concrete);
  deck.position.set(0, deckY, 0);
  deck.castShadow = true;
  deck.receiveShadow = true;
  local.add(deck);
  for (const rz of [-3.45, 3.45]) {
    const rail = new THREE.Mesh(box(deckL, 0.12, 0.12), dark);
    rail.position.set(0, deckY + 1.5, rz);
    local.add(rail);
    const rail2 = new THREE.Mesh(box(deckL, 0.08, 0.08), dark);
    rail2.position.set(0, deckY + 0.95, rz);
    local.add(rail2);
    const postG = box(0.12, 1.1, 0.12);
    const n = Math.floor(deckL / 2.2);
    const posts = new THREE.InstancedMesh(postG, dark, n);
    const d = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      d.position.set(-deckL / 2 + 1 + i * 2.2, deckY + 1.0, rz);
      d.updateMatrix();
      posts.setMatrixAt(i, d.matrix);
    }
    local.add(posts);
  }
  // footings on the rock
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(box(4, 6, 6.4), dark);
    m.position.set(sx * half, spring - 2.4, 0);
    local.add(m);
  }
  return group;
}

// ---------------------------------------------------------------- trees
function buildTrees(G, terrain) {
  const rng = makeRng(321);
  const group = new THREE.Group();
  // a mountain pine: trunk and four tiers
  const tiers = [];
  for (let i = 0; i < 4; i++) {
    const r = 2.3 - i * 0.48;
    const cg = new THREE.ConeGeometry(r, 3.6 - i * 0.35, 9, 1);
    cg.translate(0, 3.2 + i * 2.1, 0);
    tiers.push(cg);
  }
  const trunk = new THREE.CylinderGeometry(0.18, 0.3, 4.5, 6);
  trunk.translate(0, 2.2, 0);
  const crownG = mergeSimple(tiers);
  const crownM = new THREE.MeshStandardMaterial({ color: 0x1d3420, roughness: 0.95 });
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 });
  const bushG = new THREE.IcosahedronGeometry(1, 1);
  bushG.scale(1, 0.6, 1);
  const bushM = new THREE.MeshStandardMaterial({ color: 0x4f5a2e, roughness: 1 });
  const pines = [];
  const bushes = [];
  const q = {};
  const half = G.size / 2 - 20;
  let guard = 0;
  while ((pines.length < 1800 || bushes.length < 2600) && guard++ < 120000) {
    const x = (rng() * 2 - 1) * half, z = (rng() * 2 - 1) * half;
    G.st(x, z, q);
    const near = q.t < 1e3 ? Math.abs(q.t) - G.width(q.s) : 999;
    if (near < 6) continue;
    const h = terrain.heightAt(x, z);
    const e = 2;
    const sl = Math.hypot(terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z), terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
    if (sl > 0.55 || h > 105) continue;
    const forest = N.noise(x / 160, z / 160) * 0.5 + 0.5;
    if (pines.length < 1800 && rng() < forest * 1.25 - 0.2) pines.push([x, h, z, 0.8 + rng() * 0.7]);
    else if (bushes.length < 2600 && rng() < 0.7) bushes.push([x, h, z, 0.5 + rng() * 1.1]);
  }
  const d = new THREE.Object3D();
  const mk = (geo, mat, list, sy = 1) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => {
      d.position.set(p[0], p[1] - 0.2, p[2]);
      d.rotation.set(0, rng() * 6.28, 0);
      d.scale.set(p[3], p[3] * sy, p[3]);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    });
    im.castShadow = false;
    group.add(im);
  };
  mk(crownG, crownM, pines, 1.15);
  mk(trunk, trunkM, pines, 1.15);
  mk(bushG, bushM, bushes, 0.9);
  return group;
}

function mergeSimple(geos0) {
  const geos = geos0.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const idx = [];
  let o = 0;
  for (const g of geos) {
    g.computeVertexNormals();
    const p = g.attributes.position.array;
    pos.set(p, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let i = 0; i < p.length / 3; i++) idx.push(o + i);
    o += p.length / 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, o * 3), 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor.slice(0, o * 3), 3));
  return out;
}

// ---------------------------------------------------------------- ranges
// Snowy mountains all round, out past the edge of the world.
function buildRanges() {
  const A = 256, R = 14;
  const pos = [];
  const col = [];
  const idx = [];
  for (let j = 0; j <= R; j++) {
    const rr = 1150 + (j / R) ** 1.3 * 3600;
    for (let i = 0; i <= A; i++) {
      const a = (i / A) * Math.PI * 2;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const ridge = 1 - Math.abs(N.noise(a * 3.1, j * 0.35) * 2);
      let h = (180 + 520 * ridge * ridge + 160 * N.fbm(a * 9, j * 0.7, 3)) * sm(0, 0.25, j / R) + 140;
      h *= 1 - sm(0.8, 1, j / R) * 0.7;
      pos.push(x, h, z);
      const snow = sm(380, 520, h + 70 * N.noise(a * 20, j));
      const rock = 0.2 + 0.06 * N.noise(a * 30, j * 2);
      col.push(lerp(rock, 0.93, snow), lerp(rock * 0.98, 0.95, snow), lerp(rock * 0.95, 0.98, snow));
    }
  }
  for (let j = 0; j < R; j++) {
    for (let i = 0; i < A; i++) {
      const a = j * (A + 1) + i, b = a + 1, c = a + A + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
  m.frustumCulled = false;
  return m;
}

// ---------------------------------------------------------------- side falls
// Thin streams pouring off the tops and down the walls into the river.
export const SIDE_FALLS = [
  { s: 420, side: 1, w: 2.6 },
  { s: 760, side: -1, w: 1.8 },
  { s: 1185, side: 1, w: 3.2 },
  { s: 1610, side: -1, w: 2.2 },
];

function buildSideFalls(G, noiseTex) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uNoise: { value: noiseTex } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uNoise;
      varying vec2 vUv;
      void main() {
        // water falling: streaks racing down, thin at the edges, mist at the foot
        float a = texture2D(uNoise, vec2(vUv.x * 0.9, vUv.y * 0.35 + uTime * 0.9)).b;
        float b = texture2D(uNoise, vec2(vUv.x * 2.3 + 0.3, vUv.y * 0.8 + uTime * 1.6)).b;
        float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
        float k = clamp((a * 0.6 + b * 0.55) * 1.4 - 0.35, 0.0, 1.0) * edge;
        k = max(k, smoothstep(0.85, 1.0, vUv.y) * 0.8 * edge);
        gl_FragColor = vec4(vec3(0.9, 0.95, 0.97), k * 0.85);
      }`,
  });
  for (const f of SIDE_FALLS) {
    const W = G.width(f.s);
    // down the wall from the top to the water
    const steps = 40;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= steps; i++) {
      const e = 26 * (1 - i / steps) + 0.2;
      for (let j = 0; j <= 1; j++) {
        const s = f.s + (j - 0.5) * f.w;
        const t = f.side * (W + e);
        const c = G.at(s);
        const x = c.x - c.tz * t, z = c.z + c.tx * t;
        // a little proud of the rock face, leaning out
        const y = G.groundST(s, t, x, z) + 0.35;
        const o = -f.side * 0.6;
        pos.push(x - c.tz * o, y, z + c.tx * o);
        uv.push(j, i / steps);
      }
    }
    for (let i = 0; i < steps; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 4;
    group.add(m);
  }
  group.userData.mat = mat;
  return group;
}

// ---------------------------------------------------------------- scene
export class GorgeScene {
  constructor({ gorge, terrain, scene, sky, normalTex, noiseTex, foam, spray }) {
    this.G = gorge;
    this.spray = spray;
    this.foam = foam;
    this.group = new THREE.Group();
    this.canyon = buildCanyon(gorge);
    this.water = new THREE.Mesh(buildRiverGeometry(gorge), riverMaterial(sky, normalTex, foam));
    this.water.renderOrder = -5;
    this.falls = buildSideFalls(gorge, noiseTex);
    this.group.add(this.canyon, this.water, buildRocks(gorge), buildBridge(gorge), buildTrees(gorge, terrain), buildRanges(), this.falls);
    scene.add(this.group);
    this.roar = 0;
    this.acc = 0;
    this.stampT = 0;
  }

  setAmbient(a) {
    this.water.material.uniforms.uAmbient.value = a;
  }

  // mist off the drops, foam round the rocks, and how loud the river is here
  update(dt, time, camPos, skiPos, density = 1) {
    const u = this.water.material.uniforms;
    u.uTime.value = time;
    this.falls.userData.mat.uniforms.uTime.value = time;
    u.uFoamMap.value = this.foam.texture;
    const G = this.G;
    let roar = 0;
    for (const d of G.drops) {
      const s = d.s + d.len * 0.8;
      const c = G.at(s);
      const dist = Math.hypot(c.x - camPos.x, c.z - camPos.z);
      roar = Math.max(roar, clamp(0.35 + d.dh * 0.32, 0, 1) * (1 - sm(25, 260, dist)));
      if (dist > 240) continue;
      const W = G.width(s);
      const lv = G.level(s);
      this.acc += dt * (40 + 30 * d.dh) * density * (1 - sm(80, 240, dist));
      while (this.acc >= 1) {
        this.acc -= 1;
        const t = (Math.random() * 2 - 1) * W * 0.85;
        const x = c.x - c.tz * t, z = c.z + c.tx * t;
        const up = 1.5 + Math.random() * (2.5 + d.dh * 2);
        const fw = 2 + Math.random() * 3;
        const big = Math.random() < 0.25;
        this.spray.emit(x, lv + 0.15, z, c.tx * fw + (Math.random() - 0.5) * 1.5, up, c.tz * fw + (Math.random() - 0.5) * 1.5,
          1.0 + Math.random() * 1.4, big ? 0.3 : 0.1 + Math.random() * 0.08, big ? 1.8 + Math.random() : 0.5 + Math.random() * 0.6, 1, big ? 1.0 : 0.5, big ? 0.3 : 0.75, 0.4);
      }
    }
    for (const f of SIDE_FALLS) {
      const c = G.at(f.s);
      const t = f.side * (G.width(f.s) + 0.5);
      const x = c.x - c.tz * t, z = c.z + c.tx * t;
      if (Math.abs(x - camPos.x) > 200 || Math.abs(z - camPos.z) > 200) continue;
      if (Math.random() < dt * 14 * density) {
        this.spray.emit(x + (Math.random() - 0.5) * f.w, G.level(f.s) + 0.3, z + (Math.random() - 0.5) * f.w, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5, 1.2 + Math.random(), 0.25, 1.4 + Math.random(), 1, 1.0, 0.3, 0.3);
      }
      this.foam.stamp(x, z, f.w * 1.2, 0.3 * dt * 10, 0.3 * dt * 10);
    }
    // white water piling up round the boulders near the ski (in the wake field)
    this.stampT -= dt;
    if (this.stampT <= 0) {
      this.stampT = 0.12;
      for (const r of G.rocks) {
        if (Math.abs(r.x - skiPos.x) > 110 || Math.abs(r.z - skiPos.z) > 110) continue;
        if (r.top - G.level(r.s) > 2.5) continue;
        const a = G.at(r.s);
        this.foam.stamp(r.x + a.tx * r.r * 0.9, r.z + a.tz * r.r * 0.9, r.r * 1.3, 0.35, 0.3);
        this.foam.stamp(r.x + a.tx * r.r * 2.2, r.z + a.tz * r.r * 2.2, r.r * 1.1, 0.22, 0.2);
      }
    }
    this.roar = roar;
  }
}
