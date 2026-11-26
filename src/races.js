// Buoy races: a loop of gates (pairs of tall inflatable race pylons) on each
// map, started from a race circle: a glowing ring on the water with a beam of
// light over it. Wait inside it for ten seconds and you (and any mates who
// are in the circle with you) are put on the start grid; three, two, one,
// GO. Take every gate in order and come back through the chequered start to
// finish. A big arrow over your ski points at the next gate, which has lit-up
// pylons and a floating marker. Medals pay cash; beating mates pays more.
//
// The game (main.js) does the matchmaking through everyone's presence; this
// file is the course, the circle, the arrows and the clock.

import * as THREE from 'three';

const GATE_W = 22; // metres between the two pylons of a gate
const MAX_TIME = 360;
export const CIRCLE_R = 9; // the race circle's radius, m
export const QUEUE_S = 10; // seconds to wait in the circle

// A chunky arrow (shaft and head) lying flat, pointing along +Z.
export function arrowGeometry(len = 2.4, depth = 0.34) {
  const s = new THREE.Shape();
  const h = len / 2, w = len * 0.13, hw = len * 0.34, hb = len * 0.06;
  s.moveTo(-w, -h);
  s.lineTo(w, -h);
  s.lineTo(w, hb);
  s.lineTo(hw, hb);
  s.lineTo(0, h);
  s.lineTo(-hw, hb);
  s.lineTo(-w, hb);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 2 });
  g.translate(0, 0, -depth / 2);
  g.rotateX(Math.PI / 2); // tip to +Z, faces up
  g.computeVertexNormals();
  return g;
}

function labelTexture(lines) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(5, 20, 29, 0.78)';
  g.beginPath();
  g.roundRect(6, 6, 500, 180, 22);
  g.fill();
  g.strokeStyle = '#39ff6a';
  g.lineWidth = 5;
  g.stroke();
  g.textAlign = 'center';
  g.fillStyle = '#39ff6a';
  g.font = 'italic 900 64px "Saira Extra Condensed", Impact, sans-serif';
  g.fillText(lines[0], 256, 78);
  g.fillStyle = '#f1f7f9';
  g.font = '600 34px "Saira", sans-serif';
  g.fillText(lines[1], 256, 126);
  g.fillStyle = '#9fb6c2';
  g.font = '500 28px "Saira", sans-serif';
  g.fillText(lines[2], 256, 166);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
    g.fillRect(x * 8, y * 8, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 3);
  return t;
}

export class Race {
  // course: { name, gates: [[x, z]...], medals: [bronze, silver, gold] seconds }
  constructor(world, course) {
    this.world = world;
    this.course = course;
    this.group = new THREE.Group();
    // idle, grid (on the start line, waiting for GO), run, done
    this.state = 'idle';
    this.next = 0;
    this.t = 0;
    this.goAt = 0;
    this.onEvent = null; // (kind, data)
    const G = course.gates;
    const n = G.length;
    this.gates = G.map((g, i) => {
      // face along the line through the gate (from the gate before to the one after)
      const a = G[(i - 1 + n) % n];
      const b = G[(i + 1) % n];
      let dx = b[0] - a[0];
      let dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const sx = -dz, sz = dx;
      return { x: g[0], z: g[1], dx, dz, lx: g[0] - sx * GATE_W * 0.5, lz: g[1] - sz * GATE_W * 0.5, rx: g[0] + sx * GATE_W * 0.5, rz: g[1] + sz * GATE_W * 0.5 };
    });

    // pylons
    const bodyG = new THREE.CylinderGeometry(0.62, 0.95, 3.4, 20, 1);
    bodyG.translate(0, 1.5, 0);
    const capG = new THREE.SphereGeometry(0.62, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    capG.translate(0, 3.2, 0);
    const bandG = new THREE.CylinderGeometry(0.75, 0.8, 0.4, 20, 1, true);
    bandG.translate(0, 2.2, 0);
    const mk = (color, emissive = 0) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, clearcoat: 0.45, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive });
    this.mats = {
      idle: mk(0xff6a13),
      next: mk(0x39ff6a, 0.55),
      done: mk(0x6d7780),
      start: new THREE.MeshPhysicalMaterial({ map: checkerTexture(), roughness: 0.5, clearcoat: 0.3 }),
      band: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.4 }),
    };
    this.pylons = [];
    for (let i = 0; i < n; i++) {
      const gt = this.gates[i];
      for (const side of [0, 1]) {
        const grp = new THREE.Group();
        const body = new THREE.Mesh(bodyG, this.mats.idle);
        const cap = new THREE.Mesh(capG, this.mats.idle);
        const band = new THREE.Mesh(bandG, this.mats.band);
        body.castShadow = cap.castShadow = true;
        grp.add(body, cap, band);
        const x = side ? gt.rx : gt.lx;
        const z = side ? gt.rz : gt.lz;
        grp.position.set(x, 0, z);
        if (i === 0) grp.scale.set(1.15, 1.35, 1.15);
        this.group.add(grp);
        this.pylons.push({ g: grp, body, cap, gate: i, x, z, tiltX: 0, tiltZ: 0, hit: 0, ph: Math.random() * 6 });
      }
    }
    // a banner between the start pylons
    {
      const g0 = this.gates[0];
      const w = GATE_W;
      const bannerG = new THREE.PlaneGeometry(w, 1.6);
      const tex = checkerTexture();
      tex.repeat.set(w / 1.6, 1);
      const banner = new THREE.Mesh(bannerG, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.7 }));
      banner.position.set(g0.x, 5.6, g0.z);
      banner.rotation.y = Math.atan2(g0.dx, g0.dz);
      this.banner = banner;
      this.group.add(banner);
      const poleG = new THREE.CylinderGeometry(0.09, 0.09, 6.4, 8);
      poleG.translate(0, 3.2, 0);
      const poleM = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.3 });
      for (const s of [-1, 1]) {
        const pole = new THREE.Mesh(poleG, poleM);
        pole.position.set(g0.x - g0.dz * s * w * 0.5, 0, g0.z + g0.dx * s * w * 0.5);
        this.group.add(pole);
      }
    }
    // the floating marker over the next gate
    const mG = new THREE.ConeGeometry(1.4, 2.6, 4);
    mG.rotateX(Math.PI);
    this.marker = new THREE.Mesh(mG, new THREE.MeshBasicMaterial({ color: 0x39ff6a, transparent: true, opacity: 0.9, fog: false }));
    this.marker.renderOrder = 5;
    this.group.add(this.marker);
    {
      // the floating marker is a big arrow pointing down at the gate
      this.marker.geometry.dispose();
      const ag = arrowGeometry(3.2, 0.5);
      ag.rotateX(Math.PI / 2); // tip down
      this.marker.geometry = ag;
    }

    // the race circle
    const c = course.circle;
    this.circle = { x: c[0], z: c[1] };
    const cg = new THREE.Group();
    cg.position.set(c[0], 0, c[1]);
    this.ringU = { uProg: { value: 0 }, uTime: { value: 0 }, uOn: { value: 0 } };
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(CIRCLE_R - 1.1, CIRCLE_R + 0.15, 96, 1),
      new THREE.ShaderMaterial({
        uniforms: this.ringU,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vP;
          void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uProg, uTime, uOn;
          varying vec2 vP;
          void main() {
            float a = fract(atan(vP.x, vP.y) / 6.2831853 + 1.0);
            float r = length(vP);
            float edge = smoothstep(${(CIRCLE_R - 1.1).toFixed(2)}, ${(CIRCLE_R - 0.8).toFixed(2)}, r) * (1.0 - smoothstep(${(CIRCLE_R - 0.15).toFixed(2)}, ${(CIRCLE_R + 0.15).toFixed(2)}, r));
            float dash = step(0.5, fract(a * 24.0 - uTime * 0.6));
            float filled = step(a, uProg);
            vec3 base = vec3(0.22, 1.0, 0.42);
            vec3 col = mix(base * (0.55 + 0.25 * dash), vec3(1.0, 0.92, 0.3), filled);
            float al = edge * mix(0.55 + 0.35 * dash, 1.0, filled) * (0.75 + 0.25 * sin(uTime * 4.0) * (1.0 - uOn));
            gl_FragColor = vec4(col * (1.2 + filled), al);
          }`,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    ring.renderOrder = 4;
    const fill = new THREE.Mesh(new THREE.CircleGeometry(CIRCLE_R - 1.1, 64), new THREE.MeshBasicMaterial({ color: 0x39ff6a, transparent: true, opacity: 0.12, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.1;
    // a beam of light so you can find it from far away
    const beamG = new THREE.CylinderGeometry(CIRCLE_R, CIRCLE_R, 26, 48, 1, true);
    beamG.translate(0, 13, 0);
    const beam = new THREE.Mesh(
      beamG,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: this.ringU,
        vertexShader: /* glsl */ `
          varying float vY;
          void main() { vY = position.y / 26.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uOn;
          varying float vY;
          void main() {
            float a = (1.0 - vY) * (1.0 - vY) * (0.22 + 0.12 * uOn) * (0.85 + 0.15 * sin(uTime * 2.0 - vY * 9.0));
            gl_FragColor = vec4(vec3(0.25, 1.0, 0.45) * a, 1.0);
          }`,
      })
    );
    beam.renderOrder = 3;
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(['BUOY RACE', course.name, 'Wait in the circle for 10 s']), depthWrite: false }));
    sign.scale.set(13, 4.9, 1);
    sign.position.y = 10.5;
    cg.add(ring, fill, beam, sign);
    this.circleGroup = cg;
    this.group.add(cg);

    // the guide arrow over your ski (during a race)
    const am = new THREE.MeshStandardMaterial({ color: 0x39ff6a, emissive: 0x1fbf4a, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.1 });
    const guide = new THREE.Group();
    const aG = arrowGeometry(1.6, 0.26);
    const arrow = new THREE.Mesh(aG, am);
    const outline = new THREE.Mesh(aG, new THREE.MeshBasicMaterial({ color: 0x06130b, side: THREE.BackSide }));
    outline.scale.setScalar(1.12);
    guide.add(outline, arrow);
    guide.visible = false;
    guide.renderOrder = 6;
    this.guide = guide;
    this.guideYaw = null;
    this.group.add(guide);

    this.colour();
    this._s = {};
  }

  // inside the race circle?
  inCircle(x, z) {
    return Math.hypot(x - this.circle.x, z - this.circle.z) < CIRCLE_R - 0.5;
  }

  // the circle fills as the wait counts down (0..1); on = someone is in it
  setQueue(prog, on) {
    this.ringU.uProg.value = prog;
    this.ringU.uOn.value = on ? 1 : 0;
  }

  // start line slot `slot` of `n`: side by side behind the start gate
  gridSpot(slot, n) {
    const g = this.gates[0];
    const off = (slot - (n - 1) / 2) * 6;
    return { x: g.x - g.dx * 45 - g.dz * off, z: g.z - g.dz * 45 + g.dx * off, yaw: Math.atan2(-g.dz, g.dx) };
  }

  // on the grid: the clock starts at goAt (shared world clock, seconds).
  // `next` counts the lines crossed: the start line (gate 0), every gate,
  // then gate 0 again to finish.
  begin(goAt) {
    this.state = 'grid';
    this.goAt = goAt;
    this.next = 0;
    this.t = 0;
    this.colour();
  }

  // for the HUD: what the next line is
  stage() {
    const n = this.gates.length;
    return this.next === 0 ? 'START LINE' : this.next >= n ? 'FINISH' : 'GATE ' + this.next + ' / ' + (n - 1);
  }

  // point the guide arrow (from `at`, a position over the ski) at the next gate
  steer(at, dt, show) {
    const g = this.guide;
    g.visible = show;
    if (!show) {
      this.guideYaw = null;
      return;
    }
    const tg = this.target();
    const want = Math.atan2(tg.x - at.x, tg.z - at.z);
    if (this.guideYaw === null) this.guideYaw = want;
    let d = want - this.guideYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.guideYaw += d * Math.min(1, dt * 8);
    g.position.copy(at);
    g.rotation.set(0, this.guideYaw, 0);
    // tipped up toward you a little so it reads from behind
    g.children[0].rotation.x = g.children[1].rotation.x = -0.2;
  }

  // next to the race circle, facing into it
  startSpot() {
    const c = this.circle;
    return { x: c.x, z: c.z, yaw: Math.atan2(-(this.gates[0].z - c.z), this.gates[0].x - c.x) };
  }

  colour() {
    const n = this.gates.length;
    const racing = this.state === 'run' || this.state === 'grid';
    const target = racing ? this.next % n : -1;
    for (const p of this.pylons) {
      let m;
      if (p.gate === 0 && target !== 0) m = this.mats.start;
      else if (p.gate === target) m = this.mats.next;
      else if (racing && p.gate < this.next && p.gate !== 0) m = this.mats.done;
      else m = this.mats.idle;
      p.body.material = p.cap.material = m;
    }
  }

  // back to free riding after a race
  reset() {
    this.state = 'idle';
    this.next = 0;
    this.colour();
  }

  cancel(quiet) {
    if (this.state !== 'run' && this.state !== 'grid') return;
    this.state = 'idle';
    this.next = 0;
    this.colour();
    if (!quiet && this.onEvent) this.onEvent('cancel', {});
  }

  // did the ski cross this gate's line (forwards) between two positions?
  crossed(gt, x0, z0, x1, z1) {
    const mx = x1 - x0, mz = z1 - z0;
    if (mx * gt.dx + mz * gt.dz <= 0) return false;
    const ex = gt.rx - gt.lx, ez = gt.rz - gt.lz;
    const den = mx * ez - mz * ex;
    if (Math.abs(den) < 1e-9) return false;
    const ax = gt.lx - x0, az = gt.lz - z0;
    const t = (ax * ez - az * ex) / den; // along the ski's move
    const u = (ax * mz - az * mx) / den; // along the gate
    return t >= 0 && t <= 1 && u >= -0.05 && u <= 1.05;
  }

  // where the rider should head next (for the HUD arrow)
  target() {
    const n = this.gates.length;
    return this.gates[this.state === 'run' || this.state === 'grid' ? this.next % n : 0];
  }

  // now: the shared world clock (seconds), for the start
  update(dt, time, phys, riding, now) {
    const n = this.gates.length;
    // the circle floats on the water and glows
    {
      const c = this.circle;
      const sc = this.world.waves.sample(c.x, c.z, time, this._s);
      this.circleGroup.position.y = sc.h;
      this.ringU.uTime.value += dt;
    }
    // pylons ride the waves and bump the ski
    for (const p of this.pylons) {
      const dx = p.x - phys.px;
      const dz = p.z - phys.pz;
      if (Math.abs(dx) > 500 || Math.abs(dz) > 500) continue;
      const s = this.world.waves.sample(p.x, p.z, time, this._s);
      p.g.position.y = s.h - 0.25;
      p.tiltX += (-s.nz * 1.1 - p.tiltX) * Math.min(1, dt * 4);
      p.tiltZ += (s.nx * 1.1 - p.tiltZ) * Math.min(1, dt * 4);
      p.hit *= Math.exp(-dt * 2.5);
      p.g.rotation.set(p.tiltX + Math.sin(time * 5 + p.ph) * p.hit, 0, p.tiltZ + Math.cos(time * 5 + p.ph) * p.hit);
      const d = Math.hypot(dx, dz);
      const minD = 1.7;
      if (d < minD && d > 1e-3 && Math.abs(phys.py - s.h) < 1.5) {
        const nx = -dx / d, nz = -dz / d;
        phys.px += nx * (minD - d);
        phys.pz += nz * (minD - d);
        const vn = phys.vx * nx + phys.vz * nz;
        if (vn < 0) {
          phys.vx -= nx * vn * 1.3;
          phys.vz -= nz * vn * 1.3;
        }
        p.hit = Math.min(0.6, p.hit + 0.4);
      }
    }
    // the marker bobs over the next gate
    const tg = this.target();
    const sm = this.world.waves.sample(tg.x, tg.z, time, this._s);
    this.marker.position.set(tg.x, sm.h + 8 + Math.sin(time * 2.4) * 0.6, tg.z);
    this.marker.rotation.y += dt * 1.6;
    const racing = this.state === 'run' || this.state === 'grid';
    this.marker.visible = riding && racing;

    const x1 = phys.px, z1 = phys.pz;
    const x0 = this.lx ?? x1, z0 = this.lz ?? z1;
    this.lx = x1;
    this.lz = z1;
    if (!riding || !racing) return;
    if (this.state === 'grid') {
      if (now < this.goAt) return;
      this.state = 'run';
      this.t = now - this.goAt;
      if (this.onEvent) this.onEvent('go', {});
    }
    this.t += dt;
    const gi = this.next % n;
    if (this.crossed(this.gates[gi], x0, z0, x1, z1)) {
      if (this.next >= n) {
        this.state = 'done';
        this.colour();
        const m = this.course.medals; // bronze, silver, gold times
        const medal = this.t <= m[2] ? 2 : this.t <= m[1] ? 1 : this.t <= m[0] ? 0 : -1;
        if (this.onEvent) this.onEvent('finish', { time: this.t, medal });
        return;
      }
      this.next++;
      this.colour();
      if (this.onEvent) this.onEvent('gate', { gate: gi, of: n });
    }
    const d = Math.hypot(tg.x - x1, tg.z - z1);
    if (this.t > MAX_TIME || d > 900) this.cancel();
  }

  // forget where the ski was (after a teleport, so no false crossing)
  jumped() {
    this.lx = this.lz = undefined;
  }
}

export const clock = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
};
