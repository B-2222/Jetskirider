// A real jet of water, not a cloud of dots. The pump's output is followed as
// a connected line of water parcels: each leaves the nozzle at jet speed,
// flies under gravity and air drag, spreads as it goes and finally rains back
// onto the water, leaving foam where it lands. The line is drawn as a ribbon
// facing the camera: a tight glassy-white rope at the nozzle that swells and
// breaks up into lacy spray and mist the further it travels.
//
// Parcels leave in whatever direction the nozzle points at that moment, so
// swinging the bars sweeps the stream side to side like a hose, and a jet
// that comes out underwater simply is not there (the pump wash shows instead).
//
// A flat ribbon has no area when you look straight along it (from the seat
// looking back at speed, the whole stream runs away from you), so the parcels
// are also drawn as soft round puffs that take over as the view lines up with
// the stream: from any angle it reads as a thick body of water.
//
// The same class draws everyone's stream (remote riders too), and hits()
// says how much water a stream is putting on a given spot (getting sprayed).

import * as THREE from 'three';

const MAX = 320; // parcels per stream (about 3 s at the emission rate)
const VERTS = MAX * 6 + MAX * 4; // three ribbon layers, then a puff per parcel
const RATE = 100; // parcels per second along the stream

// Spray close to the lens: a wide sheet right by the camera would cover the
// screen (and its far edges would not be close enough to fade per pixel), so
// whole pieces fade by how near they are for their size.
function nearFade(dist, w) {
  const a = 1.0 + 0.5 * w, b = 2.5 + 1.1 * w;
  const t = Math.min(1, Math.max(0, (dist - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// One material per stream: the lighting uniforms are shared, the colour
// (a rider's jet colour from the style shop) is the stream's own.
function material(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uTint: { value: new THREE.Color(1, 1, 1) }, uTintK: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec2 aUv;   // across (0..1), along the water (when it left the nozzle, s)
      attribute vec4 aDat;  // age 0..1, density, width (m), seed
      attribute vec3 aSide; // unit vector across the ribbon
      attribute vec2 aQ;    // puffs: 1, and the up-down coordinate (-1..1)
      varying vec2 vUv;
      varying vec4 vDat;
      varying vec3 vWorld;
      varying vec3 vSide;
      varying vec2 vQ;
      void main() {
        vUv = aUv;
        vQ = aQ;
        vDat = aDat;
        vSide = aSide;
        vWorld = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise;
      uniform vec3 uLit;
      uniform vec3 uShade;
      uniform vec3 uWater;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uRainbow;
      uniform vec3 uTint;
      uniform float uTintK; // 0 white water, > 0 tinted, < 0 rainbow
      varying vec2 vUv;
      varying vec4 vDat;
      varying vec3 vWorld;
      varying vec3 vSide;
      varying vec2 vQ;
      vec3 hue(float h) {
        return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      }
      void main() {
        float x = vUv.x * 2.0 - 1.0;
        float age = vDat.x;
        float w = vDat.z;
        // breaking up: a solid rope at the nozzle, broken lace and mist later
        float brk = smoothstep(0.02, 0.55, age);
        // noise fixed to the moving water (it streams along with the jet)
        // (along the stream it breaks up as finely as across it, so seen end-on
        // it is lace, not long streaks)
        // (a puff's up-down runs through the along-stream noise, scaled up to
        // match the across scale so the lace is even, not streaky)
        vec2 nc = vec2(x * (0.35 + w * 0.6) + vDat.w * 7.0, vUv.y * 42.0 + vQ.y * (0.35 + w * 0.6) * 4.3);
        float n1 = texture2D(uNoise, nc * vec2(0.5, 0.11)).r;
        float n2 = texture2D(uNoise, nc * vec2(1.3, 0.3) + 0.37).g;
        float n3 = texture2D(uNoise, nc * vec2(3.1, 0.75) + 0.71).a;
        float n = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
        // ragged edges: the outline wanders with the noise
        float xr = (vQ.x > 0.5 ? length(vec2(x, vQ.y)) : abs(x)) * (1.0 + (n1 - 0.5) * 0.9 * brk);
        float prof = 1.0 - smoothstep(mix(0.55, 0.15, brk), 1.0, xr);
        float lace = smoothstep(0.28 + brk * 0.12, 0.7, n + (1.0 - xr) * 0.35);
        float a = prof * mix(1.0, lace, brk) * vDat.y;
        a *= mix(1.0, 0.55 + 0.45 * n3, brk); // thinning to mist
        // water right by the lens is a blur you never see as a sheet
        a *= smoothstep(1.0, 4.0, length(cameraPosition - vWorld));
        if (a < 0.01) discard;
        // lighting: treat the ribbon as a round column of water
        vec3 toCam = normalize(cameraPosition - vWorld);
        float xx = min(1.0, x * x + vQ.y * vQ.y);
        vec3 nrm = normalize(vSide + vec3(0.0, vQ.y, 0.0) + toCam * sqrt(max(0.0, 1.0 - xx)));
        float lit = clamp(0.55 + 0.45 * dot(nrm, uSunDir), 0.0, 1.0);
        vec3 col = mix(uShade, uLit, lit);
        // the young rope is glassy and catches the water's colour in its middle
        col = mix(col, uWater * (0.8 + 0.5 * lit), (1.0 - brk) * 0.35 * (1.0 - abs(x)));
        // sparkle where it catches the sun
        col += uSunColor * smoothstep(0.82, 0.97, n3) * lit * 0.6;
        // backlit by the sun it glows
        float glow = pow(max(dot(-toCam, uSunDir), 0.0), 6.0) * smoothstep(-0.05, 0.15, uSunDir.y);
        col += uSunColor * glow * (0.7 + 0.8 * brk);
        // admin extra: rainbow spray, the colours running along the stream
        col = mix(col, hue(fract(vUv.y * 0.9 + x * 0.08)) * (0.55 + 0.6 * lit), uRainbow * 0.7);
        if (uTintK > 0.0) col = mix(col, uTint * (0.5 + 0.7 * lit) + uSunColor * glow * 0.3, uTintK);
        else if (uTintK < 0.0) col = mix(col, hue(fract(vUv.y * 0.9 + x * 0.08)) * (0.6 + 0.6 * lit), 0.72);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class JetStream {
  // uniforms: shared lighting uniforms (from the spray system)
  constructor(uniforms, opts = {}) {
    this.wide = opts.wide || 1; // how fast it spreads (the pump wash is wider)
    this.sheath = opts.sheath || 2.1; // how much wider the outer spray is than the core
    // slowly wandering variation along the stream (per-parcel randomness
    // would make the edges zigzag into spikes)
    this.vary = 0.5;
    this.px = new Float32Array(MAX);
    this.py = new Float32Array(MAX);
    this.pz = new Float32Array(MAX);
    this.vx = new Float32Array(MAX);
    this.vy = new Float32Array(MAX);
    this.vz = new Float32Array(MAX);
    this.age = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.dens = new Float32Array(MAX);
    this.w0 = new Float32Array(MAX);
    this.grow = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.born = new Float32Array(MAX);
    this.seed = new Float32Array(MAX);
    this.alive = new Uint8Array(MAX);
    this.head = 0; // next slot (parcels are kept in emission order)
    this.acc = 0;
    this.clock = 0;
    this.last = null; // previous feed, for smooth sub-frame emission
    this.seedV = Math.random();

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aUv = new THREE.BufferAttribute(new Float32Array(VERTS * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aDat = new THREE.BufferAttribute(new Float32Array(VERTS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSide = new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aUv', this.aUv);
    g.setAttribute('aDat', this.aDat);
    g.setAttribute('aSide', this.aSide);
    this.aQ = new THREE.BufferAttribute(new Float32Array(VERTS * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aQ', this.aQ);
    this.index = new THREE.BufferAttribute(new Uint16Array((MAX - 1) * 18 + MAX * 6), 1).setUsage(THREE.DynamicDrawUsage);
    g.setIndex(this.index);
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material(uniforms));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 19;
  }

  dispose() {
    this.geo.dispose();
    this.mesh.material.dispose();
  }

  // a jet colour: a hex number, 'rainbow', or null for white water
  setTint(c) {
    const u = this.mesh.material.uniforms;
    if (c === 'rainbow') u.uTintK.value = -1;
    else if (c === null || c === undefined) u.uTintK.value = 0;
    else {
      u.uTint.value.setHex(c);
      u.uTintK.value = 0.62;
    }
  }

  clear() {
    this.alive.fill(0);
    this.last = null;
    this.geo.setDrawRange(0, 0);
  }

  // Feed this frame's jet: nozzle position and velocity, jet direction (unit)
  // and speed, and how much of it is out in the air (0..1: flow x exposure).
  // spread: how quickly it fans out (1 normal; trimmed up and clear of the
  // water it holds together longer).
  feed(dt, nx, ny, nz, nvx, nvy, nvz, dx, dy, dz, speed, amount, spread = 1) {
    const cur = { nx, ny, nz, vx: nvx + dx * speed, vy: nvy + dy * speed, vz: nvz + dz * speed, amount };
    const prev = this.last || cur;
    this.last = cur;
    if (amount < 0.02 && prev.amount < 0.02) {
      this.acc = 0;
      return;
    }
    this.acc += RATE * dt;
    let n = this.acc | 0;
    this.acc -= n;
    if (n > 12) n = 12;
    for (let k = 1; k <= n; k++) {
      const f = k / n; // along the frame, oldest first
      const lag = (1 - f) * dt; // how long it has already flown this frame
      const vx = prev.vx + (cur.vx - prev.vx) * f;
      const vy = prev.vy + (cur.vy - prev.vy) * f;
      const vz = prev.vz + (cur.vz - prev.vz) * f;
      const am = prev.amount + (cur.amount - prev.amount) * f;
      const i = this.head;
      this.head = (this.head + 1) % MAX;
      this.px[i] = prev.nx + (cur.nx - prev.nx) * f + vx * lag;
      this.py[i] = prev.ny + (cur.ny - prev.ny) * f + vy * lag;
      this.pz[i] = prev.nz + (cur.nz - prev.nz) * f + vz * lag;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;
      this.vary = Math.min(1, Math.max(0, this.vary + (Math.random() - 0.5) * 0.08));
      const vr = this.vary;
      this.age[i] = lag;
      this.life[i] = 2.6 + vr * 0.6;
      this.dens[i] = am;
      // a fat column of water out of the nozzle that billows as it goes
      this.w0[i] = 0.3 + 0.12 * this.wide;
      this.grow[i] = (3.0 + 1.4 * vr) * spread * this.wide;
      // a jet holds together, then breaks into drops that air slows hard
      this.drag[i] = 0.28 + 0.2 * (1 - vr);
      this.born[i] = this.clock - lag;
      this.seed[i] = Math.random();
      this.alive[i] = am >= 0.02 ? 1 : 0;
    }
  }

  // Move the water on; parcels that reach the surface splash and leave foam.
  // surfaceAt(x, z) -> water height. foam: the foam field (or null).
  // spray: the particle system, for the odd droplet thrown off the edges.
  update(dt, surfaceAt, foam, spray, density = 1) {
    this.clock += dt;
    const { px, py, pz, vx, vy, vz, age, life, alive, drag, dens } = this;
    this.landed = 0;
    for (let i = 0; i < MAX; i++) {
      if (!alive[i]) continue;
      const a = (age[i] += dt);
      if (a > life[i]) {
        alive[i] = 0;
        continue;
      }
      // air drag rises as the jet breaks into drops
      const c = drag[i] * (1 + 3.5 * Math.min(a, 1.2));
      const dk = Math.exp(-c * dt);
      vx[i] *= dk;
      vz[i] *= dk;
      vy[i] = vy[i] * dk - 9.81 * dt;
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      pz[i] += vz[i] * dt;
      if (vy[i] < 0 && a > 0.08) {
        const h = surfaceAt(px[i], pz[i]);
        if (py[i] < h) {
          alive[i] = 0;
          this.landed += dens[i];
          const w = this.w0[i] + this.grow[i] * Math.pow(a, 0.8);
          if (foam) foam.stamp(px[i], pz[i], 0.35 + w * 0.45, dens[i] * 0.5, dens[i] * 0.35);
          if (spray && Math.random() < 0.7 * density * dens[i]) {
            const r = () => Math.random() * 2 - 1;
            spray.emit(px[i] + r() * w * 0.3, h + 0.05, pz[i] + r() * w * 0.3, vx[i] * 0.3 + r() * 1.2, 1 + Math.random() * 2.5, vz[i] * 0.3 + r() * 1.2,
              0.6 + Math.random() * 0.7, 0.08 + Math.random() * 0.06, 0.4 + Math.random() * 0.5, 1, 0.5, 0.75, 0.12);
          }
        }
      }
    }
  }

  // How much of this stream is passing within r of (x, y, z): 0 = dry.
  hits(x, y, z, r) {
    const { px, py, pz, alive, dens, age } = this;
    let k = 0;
    for (let i = 0; i < MAX; i++) {
      if (!alive[i] || age[i] < 0.12) continue;
      const w = this.w0[i] + this.grow[i] * Math.pow(age[i], 0.8);
      const rr = r + w * 0.5;
      const dx = px[i] - x, dy = py[i] - y, dz = pz[i] - z;
      if (dx * dx + dy * dy + dz * dz < rr * rr) k += dens[i];
    }
    return k;
  }

  // Rebuild the ribbon to face the camera: a wide faint sheath of spray and
  // mist round the outside, then the denser core over it.
  build(camPos, camDir) {
    const P = this.aPos.array;
    const U = this.aUv.array;
    const D = this.aDat.array;
    const Sd = this.aSide.array;
    const I = this.index.array;
    const { px, py, pz, alive, age, life, dens } = this;
    const order = this._order || (this._order = new Int32Array(MAX));
    const SX = this._sx || (this._sx = new Float32Array(MAX * 3));
    const WD = this._wd || (this._wd = new Float32Array(MAX * 2));
    const EO = this._eo || (this._eo = new Float32Array(MAX)); // how end-on we see it
    const DI = this._di || (this._di = new Float32Array(MAX)); // distance from the camera
    // the young jet is a rope (ribbon); once it has broken up into spray it
    // is drawn as round puffs only (a ribbon of loose spray twists into slivers)
    const RB = this._rb || (this._rb = new Float32Array(MAX));
    const EG = this._eg || (this._eg = new Float32Array(MAX)); // ribbon kept (not edge-on)
    // oldest -> newest, with per-parcel side vector, width and density
    let m = 0;
    for (let k = 0; k < MAX; k++) {
      const i = (this.head + k) % MAX;
      let ok = alive[i];
      // water behind (or right at) the camera is not drawn: a ribbon crossing
      // the lens would smear across the whole screen
      if (ok && camDir) ok = (px[i] - camPos.x) * camDir.x + (py[i] - camPos.y) * camDir.y + (pz[i] - camPos.z) * camDir.z > 1.0;
      order[m++] = ok ? i : -1;
    }
    let psx = 0, psy = 0, psz = 0, havePrev = false;
    // a swept stream pulls apart: where neighbours have flown far apart the
    // ribbon breaks rather than stretching into long slivers
    const JN = this._join || (this._join = new Uint8Array(MAX));
    for (let k = 0; k < m; k++) {
      const i = order[k];
      const j = k > 0 ? order[k - 1] : -1;
      if (i < 0 || j < 0) {
        JN[k] = 0;
        continue;
      }
      const gap = Math.hypot(px[i] - px[j], py[i] - py[j], pz[i] - pz[j]);
      JN[k] = gap < 0.9 + 0.35 * Math.min(age[i], 2) * this.wide ? 1 : 0;
    }
    for (let k = 0; k < m; k++) {
      const i = order[k];
      if (i < 0) {
        havePrev = false;
        continue;
      }
      const a = k > 0 && order[k - 1] >= 0 ? order[k - 1] : i;
      const b = k < m - 1 && order[k + 1] >= 0 ? order[k + 1] : i;
      let tx = px[b] - px[a], ty = py[b] - py[a], tz = pz[b] - pz[a];
      if (a === b) {
        tx = this.vx[i];
        ty = this.vy[i];
        tz = this.vz[i];
      }
      const vdx = px[i] - camPos.x, vdy = py[i] - camPos.y, vdz = pz[i] - camPos.z;
      // side = tangent x view, falling back to level-sideways when the
      // stream points straight at the camera
      let sx = ty * vdz - tz * vdy;
      let sy = tz * vdx - tx * vdz;
      let sz = tx * vdy - ty * vdx;
      let sl = Math.hypot(sx, sy, sz);
      const tl = Math.hypot(tx, ty, tz), vl = Math.hypot(vdx, vdy, vdz);
      DI[k] = vl;
      // 0 side-on, 1 looking straight along the stream
      EO[k] = tl > 1e-6 && vl > 1e-6 ? 1 - Math.min(1, sl / (tl * vl)) : 1;
      // a ribbon piece seen edge-on is a hard bright line: it fades out
      // there (the puffs carry it), judged on the pieces either side too
      let eg = EO[k];
      for (const o of [a, b]) {
        if (o === i) continue;
        const ex = px[o] - px[i], ey = py[o] - py[i], ez = pz[o] - pz[i];
        const el = Math.hypot(ex, ey, ez) * vl;
        if (el > 1e-6) eg = Math.max(eg, Math.abs(ex * vdx + ey * vdy + ez * vdz) / el);
      }
      const et = Math.min(1, Math.max(0, (eg - 0.6) / 0.33));
      EG[k] = 1 - et * et * (3 - 2 * et);
      if (sl < 1e-5) {
        sx = -vdz;
        sy = 0;
        sz = vdx;
        sl = Math.hypot(sx, sz) || 1;
      }
      sx /= sl;
      sy /= sl;
      sz /= sl;
      // keep the ribbon from twisting where the stream turns toward the camera
      if (havePrev && sx * psx + sy * psy + sz * psz < 0) {
        sx = -sx;
        sy = -sy;
        sz = -sz;
      }
      psx = sx;
      psy = sy;
      psz = sz;
      havePrev = true;
      SX[k * 3] = sx;
      SX[k * 3 + 1] = sy;
      SX[k * 3 + 2] = sz;
      const ag = age[i];
      const w = this.w0[i] + this.grow[i] * Math.pow(ag, 0.8);
      const rt = Math.min(1, Math.max(0, (ag - 0.3) / 0.6));
      RB[k] = 1 - rt * rt * (3 - 2 * rt);
      const t01 = ag / life[i];
      // thins out as it spreads and as it nears the end of its flight
      WD[k * 2] = w;
      WD[k * 2 + 1] = dens[i] * Math.min(1, 0.6 / Math.max(w, 0.6) + 0.5) * (1 - t01 * t01) * Math.min(1, ag * 25);
    }
    const Q = this.aQ.array;
    Q.fill(0, 0, MAX * 6 * 2);
    let vtx = 0;
    let idx = 0;
    // outer mist halo, the spray sheath, then the dense core over them
    for (let layer = 0; layer < 3; layer++) {
      const wk = layer === 0 ? this.sheath * 1.35 : layer === 1 ? this.sheath : 1;
      const dk = layer === 0 ? 0.07 : layer === 1 ? 0.42 : 1;
      let prevV = -1;
      for (let k = 0; k < m; k++) {
        const i = order[k];
        if (i < 0) {
          prevV = -1;
          continue;
        }
        const sx = SX[k * 3], sy = SX[k * 3 + 1], sz = SX[k * 3 + 2];
        const w = WD[k * 2] * wk;
        const h = w * 0.5;
        const dd = WD[k * 2 + 1] * dk * nearFade(DI[k], w) * RB[k] * EG[k];
        for (let sd = 0; sd < 2; sd++) {
          const sg = sd ? 1 : -1;
          const v3 = vtx * 3;
          P[v3] = px[i] + sx * h * sg;
          P[v3 + 1] = py[i] + sy * h * sg;
          P[v3 + 2] = pz[i] + sz * h * sg;
          Sd[v3] = sx * sg;
          Sd[v3 + 1] = sy * sg;
          Sd[v3 + 2] = sz * sg;
          U[vtx * 2] = sd;
          U[vtx * 2 + 1] = this.born[i] % 512; // fixed to this bit of water
          const v4 = vtx * 4;
          D[v4] = Math.min(1, age[i] / 1.6);
          D[v4 + 1] = dd;
          D[v4 + 2] = w;
          D[v4 + 3] = this.seedV + layer * 0.37;
          vtx++;
        }
        if (prevV >= 0 && JN[k]) {
          I[idx++] = prevV;
          I[idx++] = prevV + 1;
          I[idx++] = vtx - 2;
          I[idx++] = prevV + 1;
          I[idx++] = vtx - 1;
          I[idx++] = vtx - 2;
        }
        prevV = vtx - 2;
      }
    }
    // the puffs: round, facing the camera, strongest where the stream runs
    // along the line of sight (every other parcel is plenty, they overlap)
    for (let k = 0; k < m; k++) {
      const i = order[k];
      if (i < 0 || i & 1) continue;
      const eo = EO[k];
      const pk = Math.max(0.04 + 0.26 * eo * eo * (3 - 2 * eo), 0.3 * (1 - RB[k] * EG[k]));
      const w = WD[k * 2] * (1.5 + 0.4 * (1 - RB[k]));
      const dd = WD[k * 2 + 1] * pk * nearFade(DI[k], w);
      if (dd < 0.01) continue;
      const h = w * 0.5;
      // right and up across the view
      const vdx = px[i] - camPos.x, vdy = py[i] - camPos.y, vdz = pz[i] - camPos.z;
      let rx = -vdz, rz = vdx;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl;
      rz /= rl;
      const vl = Math.hypot(vdx, vdy, vdz) || 1;
      // up = right x view
      const ux = (-rz * vdy) / vl, uy = (rz * vdx - rx * vdz) / vl, uz = (rx * vdy) / vl;
      for (let c = 0; c < 4; c++) {
        const sx = c & 1 ? 1 : -1;
        const sy = c & 2 ? 1 : -1;
        const v3 = vtx * 3;
        P[v3] = px[i] + (rx * sx + ux * sy) * h;
        P[v3 + 1] = py[i] + uy * sy * h;
        P[v3 + 2] = pz[i] + (rz * sx + uz * sy) * h;
        Sd[v3] = rx * sx;
        Sd[v3 + 1] = 0;
        Sd[v3 + 2] = rz * sx;
        U[vtx * 2] = c & 1;
        U[vtx * 2 + 1] = this.born[i] % 512;
        Q[vtx * 2] = 1;
        Q[vtx * 2 + 1] = sy;
        const v4 = vtx * 4;
        D[v4] = Math.min(1, age[i] / 1.6);
        D[v4 + 1] = dd;
        D[v4 + 2] = w;
        D[v4 + 3] = this.seedV + 0.83;
        vtx++;
      }
      I[idx++] = vtx - 4;
      I[idx++] = vtx - 3;
      I[idx++] = vtx - 2;
      I[idx++] = vtx - 3;
      I[idx++] = vtx - 1;
      I[idx++] = vtx - 2;
    }
    this.geo.setDrawRange(0, idx);
    if (vtx > 0) {
      for (const at of [this.aPos, this.aUv, this.aDat, this.aSide, this.aQ]) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, vtx * at.itemSize);
        at.needsUpdate = true;
      }
      this.index.clearUpdateRanges();
      this.index.addUpdateRange(0, idx);
      this.index.needsUpdate = true;
    }
    this.mesh.visible = idx > 0;
  }
}
