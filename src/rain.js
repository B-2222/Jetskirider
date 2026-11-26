// Rain for the storm map: streaks falling round the camera, slanted by the
// wind. The drops live in a box that follows the camera, so it is cheap.

import * as THREE from 'three';

const N = 1800;
const BOX = 46; // metres across
const TALL = 30;

export class Rain {
  constructor() {
    this.pos = new Float32Array(N * 6);
    this.drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * BOX;
      this.drops[i * 3 + 1] = Math.random() * TALL;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * BOX;
    }
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    this.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc9d4dc, transparent: true, opacity: 0.32, depthWrite: false }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.wind = { x: 3.2, z: 1.4 };
    this.fall = 17;
  }

  update(dt, cam) {
    const d = this.drops;
    const p = this.pos;
    const wx = this.wind.x, wz = this.wind.z, f = this.fall;
    const len = 0.05; // streak length in seconds of fall
    const cx = cam.x, cz = cam.z;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      d[o] += wx * dt;
      d[o + 1] -= f * dt;
      d[o + 2] += wz * dt;
      // keep each drop in the box round the camera (below the water the
      // surface hides it)
      let x = d[o], y = d[o + 1], z = d[o + 2];
      if (y < 0) y = d[o + 1] = TALL - Math.random() * 3;
      if (x > BOX / 2) x = d[o] -= BOX;
      else if (x < -BOX / 2) x = d[o] += BOX;
      if (z > BOX / 2) z = d[o + 2] -= BOX;
      else if (z < -BOX / 2) z = d[o + 2] += BOX;
      const ax = cx + x, ay = cam.y + y - TALL * 0.4, az = cz + z;
      const q = i * 6;
      p[q] = ax;
      p[q + 1] = ay;
      p[q + 2] = az;
      p[q + 3] = ax - wx * len;
      p[q + 4] = ay + f * len;
      p[q + 5] = az - wz * len;
    }
    this.attr.needsUpdate = true;
  }
}
