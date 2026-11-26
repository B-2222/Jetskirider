// Buoy races: a loop of gates (pairs of tall inflatable race pylons) on each
// map. Ride through the chequered start gate and the clock starts; take every
// gate in order and come back through the start to finish. The next gate has
// a floating marker over it and lit-up pylons. Medals pay cash.

import * as THREE from 'three';

const GATE_W = 22; // metres between the two pylons of a gate
const MAX_TIME = 360;

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
    this.state = 'idle';
    this.next = 0;
    this.t = 0;
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
    this.colour();
    this._s = {};
  }

  // the starting grid: just back from the start gate, lined up through it
  startSpot() {
    const g = this.gates[0];
    return { x: g.x - g.dx * 70, z: g.z - g.dz * 70, yaw: Math.atan2(-g.dz, g.dx) };
  }

  colour() {
    const n = this.gates.length;
    const target = this.state === 'run' ? this.next % n : 0;
    for (const p of this.pylons) {
      let m;
      if (p.gate === 0 && !(this.state === 'run' && target === 0)) m = this.mats.start;
      else if (p.gate === target) m = this.mats.next;
      else if (this.state === 'run' && p.gate < this.next && p.gate !== 0) m = this.mats.done;
      else m = this.mats.idle;
      p.body.material = p.cap.material = m;
    }
  }

  cancel(quiet) {
    if (this.state !== 'run') return;
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
    return this.gates[this.state === 'run' ? this.next % n : 0];
  }

  update(dt, time, phys, riding) {
    const n = this.gates.length;
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
    this.marker.visible = riding;

    const x1 = phys.px, z1 = phys.pz;
    const x0 = this.lx ?? x1, z0 = this.lz ?? z1;
    this.lx = x1;
    this.lz = z1;
    if (!riding) return;
    if (this.state === 'idle') {
      if (this.crossed(this.gates[0], x0, z0, x1, z1)) {
        this.state = 'run';
        this.next = 1;
        this.t = 0;
        this.colour();
        if (this.onEvent) this.onEvent('start', {});
      }
      return;
    }
    this.t += dt;
    const gi = this.next % n;
    if (this.crossed(this.gates[gi], x0, z0, x1, z1)) {
      if (gi === 0) {
        this.state = 'idle';
        this.next = 0;
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
