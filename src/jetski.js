// Procedural Sea-Doo models. Every surface is lofted from hand-tuned section
// curves: deep-V hull with chines and strakes, bond-line bumper, footwells,
// seat, hood, handlebars, pump, steering nozzle, VTS trim and iBR gate.
//
// Model frame matches physics: +X bow, +Y up, +Z starboard, origin at the
// centre of mass on the bond line. Transom is at x = -0.385 L.

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';
import { canvasTexture } from './textures.js';

const STERN = 0.385;

// monotone cubic through [x, y] keys
function curve(keys) {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// Sample a strip of ring control points [a..b] into a smooth polyline.
function sampleStrip(ring, a, b, sub, tension) {
  const out = [];
  for (let i = a; i < b; i++) {
    const p0 = ring[Math.max(i - 1, a)];
    const p1 = ring[i];
    const p2 = ring[i + 1];
    const p3 = ring[Math.min(i + 2, b)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      if (tension) out.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t), i - a + t]);
      else out.push([lerp(p1[0], p2[0], t), lerp(p1[1], p2[1], t), i - a + t]);
    }
  }
  out.push([ring[b][0], ring[b][1], b - a]);
  return out;
}

// Build lofted geometry. xOf(s) maps station to model X.
// mode: 'start' = strip begins on the centreline (weld there), 'end' = ends on
// the centreline, 'side' = one side only (sideSign +1/-1).
function loftStrip({ ringFn, xOf, s0 = 0, s1 = 1, nS, a, b, sub = 5, smooth = true, mode, sideSign = 1, colorFn, sPow = 1 }) {
  const rows = [];
  for (let i = 0; i <= nS; i++) {
    const tt = i / nS;
    const s = s0 + (s1 - s0) * (sPow === 1 ? tt : 1 - Math.pow(1 - tt, sPow));
    const pts = sampleStrip(ringFn(s), a, b, sub, smooth);
    let row;
    if (mode === 'start') {
      row = [];
      for (let k = pts.length - 1; k >= 1; k--) row.push([-pts[k][0], pts[k][1], pts[k][2], -1]);
      for (let k = 0; k < pts.length; k++) row.push([pts[k][0], pts[k][1], pts[k][2], 1]);
    } else if (mode === 'end') {
      row = [];
      for (let k = 0; k < pts.length; k++) row.push([pts[k][0], pts[k][1], pts[k][2], 1]);
      for (let k = pts.length - 2; k >= 0; k--) row.push([-pts[k][0], pts[k][1], pts[k][2], -1]);
    } else {
      row = pts.map((p) => [p[0] * sideSign, p[1], p[2], sideSign]);
    }
    rows.push({ s, row });
  }
  const M = rows[0].row.length;
  const pos = new Float32Array((nS + 1) * M * 3);
  const uv = new Float32Array((nS + 1) * M * 2);
  const col = colorFn ? new Float32Array((nS + 1) * M * 3) : null;
  const c = new THREE.Color();
  let p = 0;
  let q = 0;
  for (let i = 0; i <= nS; i++) {
    const { s, row } = rows[i];
    const x = xOf(s);
    for (let k = 0; k < M; k++) {
      pos[p] = x;
      pos[p + 1] = row[k][1];
      pos[p + 2] = row[k][0];
      if (col) {
        colorFn(s, row[k][2], c, row[k][3]);
        col[p] = c.r;
        col[p + 1] = c.g;
        col[p + 2] = c.b;
      }
      p += 3;
      uv[q++] = (s - s0) / (s1 - s0);
      uv[q++] = row[k][2] / (b - a);
    }
  }
  const idx = [];
  const flip = mode === 'side' && sideSign < 0;
  for (let i = 0; i < nS; i++) {
    for (let k = 0; k < M - 1; k++) {
      const v0 = i * M + k;
      const v1 = v0 + 1;
      const v2 = v0 + M;
      const v3 = v2 + 1;
      if (flip) idx.push(v0, v2, v1, v1, v2, v3);
      else idx.push(v0, v1, v2, v1, v3, v2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tube(points, radius, radial = 8, closed = false) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(c, Math.max(points.length * 6, 16), radius, radial, closed);
}

// ---------------------------------------------------------------------------
// Style definitions
// ---------------------------------------------------------------------------
function styleParams(spec) {
  const st = spec.style;
  const P = { L: spec.L, hb: spec.B / 2 };
  P.bw = curve([[0, 0.88], [0.12, 0.95], [0.3, 1.0], [0.5, 1.0], [0.62, 0.95], [0.74, 0.82], [0.84, 0.64], [0.92, 0.42], [0.97, 0.23], [1.0, 0.05]]);
  P.yb = curve([[0, 0.0], [0.5, 0.01], [0.75, 0.06], [0.9, 0.12], [1, 0.17]]);
  P.yk = curve([[0, -0.4], [0.5, -0.42], [0.65, -0.4], [0.8, -0.3], [0.9, -0.16], [0.96, -0.02], [1, 0.14]]);
  P.ck = curve([[0, 0.86], [0.6, 0.86], [0.85, 0.8], [1, 0.6]]);
  P.ch = curve([[0, 0.36], [0.6, 0.38], [0.85, 0.5], [1, 0.62]]);
  P.rk = curve([[0, 0.9], [0.6, 0.9], [1, 0.8]]);
  P.rh = curve([[0, 0.11], [0.14, 0.13], [0.55, 0.14], [0.7, 0.16], [0.9, 0.1], [1, 0.03]]);
  P.pw = curve([[0.1, 0.24], [0.2, 0.19], [0.4, 0.17], [0.5, 0.19], [0.6, 0.3]]);
  if (st === 'spark') {
    P.ct = curve([[0, 0.06], [0.09, 0.07], [0.14, 0.14], [0.2, 0.26], [0.5, 0.29], [0.58, 0.35], [0.65, 0.46], [0.69, 0.47], [0.78, 0.37], [0.9, 0.25], [0.97, 0.2], [1, 0.18]]);
    P.seatTop = curve([[0.15, 0.22], [0.19, 0.38], [0.3, 0.42], [0.36, 0.415], [0.5, 0.4], [0.58, 0.42], [0.63, 0.45]]);
    P.seatW = curve([[0.15, 0.13], [0.24, 0.165], [0.4, 0.15], [0.52, 0.125], [0.63, 0.13]]);
    P.seat0 = 0.15;
    P.seat1 = 0.63;
    P.pw = curve([[0.1, 0.22], [0.2, 0.17], [0.4, 0.15], [0.5, 0.17], [0.6, 0.27]]);
    P.pivotS = 0.665;
    P.column = spec.trixx ? 0.4 : 0.33;
    P.barW = 0.72;
    P.floorDrop = 0.05;
  } else if (st === 'race') {
    P.ct = curve([[0, 0.07], [0.09, 0.08], [0.13, 0.16], [0.19, 0.31], [0.5, 0.34], [0.57, 0.42], [0.64, 0.57], [0.68, 0.58], [0.78, 0.43], [0.9, 0.27], [0.97, 0.2], [1, 0.18]]);
    P.seatTop = curve([[0.15, 0.3], [0.19, 0.47], [0.28, 0.5], [0.335, 0.52], [0.37, 0.465], [0.47, 0.45], [0.55, 0.5], [0.6, 0.53]]);
    P.seatW = curve([[0.15, 0.15], [0.25, 0.19], [0.35, 0.2], [0.42, 0.14], [0.52, 0.12], [0.6, 0.14]]);
    P.seat0 = 0.15;
    P.seat1 = 0.6;
    P.pivotS = 0.655;
    P.column = 0.27;
    P.barW = 0.76;
    P.floorDrop = 0.05;
  } else {
    P.ct = curve([[0, 0.07], [0.09, 0.08], [0.13, 0.16], [0.19, 0.3], [0.5, 0.33], [0.57, 0.4], [0.64, 0.58], [0.68, 0.6], [0.76, 0.5], [0.88, 0.34], [0.96, 0.22], [1, 0.19]]);
    P.seatTop = curve([[0.15, 0.3], [0.19, 0.46], [0.3, 0.5], [0.345, 0.5], [0.375, 0.455], [0.47, 0.445], [0.55, 0.49], [0.6, 0.52]]);
    P.seatW = curve([[0.15, 0.15], [0.25, 0.2], [0.35, 0.19], [0.45, 0.155], [0.55, 0.135], [0.6, 0.14]]);
    P.seat0 = 0.15;
    P.seat1 = 0.6;
    P.pivotS = 0.655;
    P.column = 0.26;
    P.barW = 0.76;
    P.floorDrop = 0.045;
  }
  P.xOf = (s) => (s - STERN) * P.L;
  P.well = (s) => smoothstep(0.11, 0.17, s) * (1 - smoothstep(0.5, 0.6, s));
  return P;
}

// One full section of the hull + deck at station s. Points are [z, y].
function hullRing(P, s) {
  const hb = P.hb;
  const bw = P.bw(s) * hb;
  const yb = P.yb(s);
  const yk = P.yk(s);
  const cw = bw * P.ck(s);
  const yc = yk + (yb - yk) * P.ch(s);
  const pad = Math.min(0.075, cw * 0.3) * (1 - smoothstep(0.55, 0.8, s));
  const zr = bw * P.rk(s);
  const yr = yb + P.rh(s);
  const ct = Math.max(P.ct(s), yb + 0.012);
  const w = P.well(s);
  const pw = Math.min(P.pw(s), zr * 0.7);
  const floorY = yb - P.floorDrop;
  const dome = (f, i) => {
    const a = (f * Math.PI) / 2;
    return [zr * Math.pow(Math.cos(a), 0.92), yr + (ct - yr) * Math.pow(Math.sin(a), 1.05)];
  };
  const d1 = dome(0.3);
  const d2 = dome(0.58);
  const d3 = dome(0.82);
  const w1 = [zr - 0.04, floorY];
  const w2 = [pw + 0.055, floorY];
  const w3 = [pw, ct - 0.06];
  const mix = (a, b) => [lerp(a[0], b[0], w), lerp(a[1], b[1], w)];
  return [
    [0, yk], // 0 keel
    [pad, yk + 0.004], // 1 keel pad
    [cw * 0.56, lerp(yk, yc, 0.5) - 0.014 * (1 - smoothstep(0.7, 0.95, s))], // 2 strake
    [cw, yc], // 3 chine
    [bw, yb], // 4 bond line
    [bw * 0.992 + 0.003, yb + Math.min(0.05, P.rh(s) * 0.45)], // 5 upper side
    [zr, yr], // 6 gunwale rim
    mix(d1, w1), // 7
    mix(d2, w2), // 8
    mix(d3, w3), // 9
    [0, ct], // 10 centreline
  ];
}

function seatRing(P, s) {
  const sw = P.seatW(s);
  const top = P.seatTop(s);
  const base = P.ct(s) - 0.05;
  const h = Math.max(top - base, 0.02);
  return [
    [sw * 0.96, base],
    [sw * 1.04, base + h * 0.55],
    [sw * 0.8, top - h * 0.1],
    [sw * 0.4, top],
    [0, top + 0.004],
  ];
}

// ---------------------------------------------------------------------------
// Graphics (decal) textures
// ---------------------------------------------------------------------------
const hex = (c) => '#' + new THREE.Color(c).getHexString();

function hullSideTexture(spec, cw, mirror) {
  return canvasTexture(2048, 256, (g, w, h) => {
    const dark = new THREE.Color(cw.hull).getHSL({}).l < 0.4;
    g.fillStyle = hex(cw.hull);
    g.fillRect(0, 0, w, h);
    // speed slashes
    g.save();
    g.transform(1, 0, -0.55, 1, 0, 0);
    g.fillStyle = hex(cw.accent);
    g.globalAlpha = 0.95;
    g.fillRect(w * 0.6, 0, w * 0.035, h);
    g.fillRect(w * 0.645, 0, w * 0.012, h);
    g.globalAlpha = 1;
    g.restore();
    // wordmark
    g.save();
    if (mirror) {
      g.translate(w, 0);
      g.scale(-1, 1);
    }
    const tx = mirror ? w * (1 - 0.52) : w * 0.2;
    g.font = 'italic 900 150px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = dark ? '#f4f6f8' : '#14161a';
    g.transform(1, 0, -0.18, 1, 0, 0);
    g.fillText('SEA-DOO', tx + 30, h * 0.5);
    g.restore();
  });
}

function upperSideTexture(spec, cw, mirror) {
  return canvasTexture(2048, 128, (g, w, h) => {
    g.fillStyle = hex(cw.deck);
    g.fillRect(0, 0, w, h);
    g.fillStyle = hex(cw.accent);
    g.fillRect(0, h * 0.0, w * 0.5, h * 0.2);
    g.save();
    g.transform(1, 0, -0.8, 1, 0, 0);
    g.fillRect(w * 0.5, 0, w * 0.05, h);
    g.fillStyle = hex(cw.hull);
    g.fillRect(w * 0.57, 0, w * 0.02, h);
    g.restore();
    g.save();
    if (mirror) {
      g.translate(w, 0);
      g.scale(-1, 1);
    }
    const lum = new THREE.Color(cw.deck).getHSL({}).l;
    g.fillStyle = lum > 0.55 ? '#111317' : '#ffffff';
    g.font = 'italic 800 78px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    g.textBaseline = 'middle';
    const label = spec.name;
    const tw = g.measureText(label).width;
    const tx = mirror ? w * (1 - 0.33) - tw : w * 0.2;
    g.fillText(label, tx, h * 0.6);
    g.restore();
  });
}

function matTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#b8b8b8';
    g.lineWidth = 3;
    for (let i = -w; i < w * 2; i += 16) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + h, h);
      g.stroke();
      g.beginPath();
      g.moveTo(i + h, 0);
      g.lineTo(i, h);
      g.stroke();
    }
  }, { data: true, repeat: true });
}

// ---------------------------------------------------------------------------
// Stand-up: narrow hull, open tray to stand in, raised hood and a hinged
// handle pole running back to the bars.
// ---------------------------------------------------------------------------
function standupParams(spec) {
  const P = { L: spec.L, hb: spec.B / 2 };
  P.bw = curve([[0, 0.86], [0.1, 0.94], [0.3, 0.99], [0.5, 1.0], [0.62, 0.96], [0.74, 0.85], [0.85, 0.64], [0.93, 0.4], [0.98, 0.18], [1.0, 0.05]]);
  P.yb = curve([[0, 0.0], [0.5, 0.01], [0.78, 0.05], [0.92, 0.1], [1, 0.15]]);
  P.yk = curve([[0, -0.27], [0.5, -0.29], [0.68, -0.27], [0.84, -0.18], [0.95, -0.05], [1, 0.1]]);
  P.ck = curve([[0, 0.86], [0.6, 0.86], [0.85, 0.8], [1, 0.6]]);
  P.ch = curve([[0, 0.36], [0.6, 0.38], [0.85, 0.5], [1, 0.62]]);
  P.rk = curve([[0, 0.92], [0.6, 0.92], [1, 0.82]]);
  P.rh = curve([[0, 0.07], [0.06, 0.1], [0.55, 0.11], [0.66, 0.14], [0.86, 0.08], [1, 0.03]]);
  P.ct = curve([[0, 0.12], [0.55, 0.13], [0.64, 0.29], [0.72, 0.34], [0.82, 0.31], [0.92, 0.22], [1, 0.16]]);
  P.floor = (s) => P.yb(s) + 0.035;
  P.tray = (s) => smoothstep(0.035, 0.075, s) * (1 - smoothstep(0.55, 0.63, s));
  P.xOf = (s) => (s - STERN) * P.L;
  P.pivotS = 0.9;
  return P;
}

function standupRing(P, s) {
  const hb = P.hb;
  const bw = P.bw(s) * hb;
  const yb = P.yb(s);
  const yk = P.yk(s);
  const cw = bw * P.ck(s);
  const yc = yk + (yb - yk) * P.ch(s);
  const pad = Math.min(0.06, cw * 0.3) * (1 - smoothstep(0.55, 0.8, s));
  const zr = bw * P.rk(s);
  const yr = yb + P.rh(s);
  const ct = Math.max(P.ct(s), yr + 0.012);
  const tr = P.tray(s);
  const fl = P.floor(s);
  const dome = (f) => {
    const a = (f * Math.PI) / 2;
    return [zr * Math.pow(Math.cos(a), 0.92), yr + (ct - yr) * Math.pow(Math.sin(a), 1.05)];
  };
  const mix = (a, b) => [lerp(a[0], b[0], tr), lerp(a[1], b[1], tr)];
  return [
    [0, yk],
    [pad, yk + 0.004],
    [cw * 0.56, lerp(yk, yc, 0.5) - 0.012 * (1 - smoothstep(0.7, 0.95, s))],
    [cw, yc],
    [bw, yb],
    [bw * 0.992 + 0.003, yb + Math.min(0.04, P.rh(s) * 0.45)],
    [zr, yr],
    mix(dome(0.3), [zr - 0.03, yr + 0.004]), // inner lip of the tray
    mix(dome(0.58), [zr - 0.05, fl + 0.02]), // tray wall
    mix(dome(0.82), [zr * 0.5, fl]), // tray floor
    [0, lerp(ct, fl - 0.003, tr)],
  ];
}

function standupSideTexture(spec, cw, mirror) {
  return canvasTexture(2048, 256, (g, w, h) => {
    const dark = new THREE.Color(cw.hull).getHSL({}).l < 0.4;
    g.fillStyle = hex(cw.hull);
    g.fillRect(0, 0, w, h);
    g.save();
    g.transform(1, 0, -0.6, 1, 0, 0);
    g.fillStyle = hex(cw.deck);
    g.fillRect(w * 0.52, 0, w * 0.05, h);
    g.fillStyle = hex(cw.accent);
    g.fillRect(w * 0.58, 0, w * 0.015, h);
    g.restore();
    g.save();
    if (mirror) {
      g.translate(w, 0);
      g.scale(-1, 1);
    }
    const label = spec.name.split(' ')[0];
    g.font = 'italic 900 140px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = dark ? '#f4f6f8' : '#14161a';
    g.transform(1, 0, -0.18, 1, 0, 0);
    const tw = g.measureText(label).width;
    g.fillText(label, mirror ? w * 0.5 - tw + 40 : w * 0.16, h * 0.52);
    g.restore();
  });
}

let _matTex = null;

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------
// how much further the nozzle and its jet are drawn swinging than the
// steering angle the physics uses
export const NOZZLE_SWING = 1.8;

export class JetskiModel {
  constructor(spec, colorway) {
    this.spec = spec;
    this.cw = colorway;
    this.group = new THREE.Group();
    this.P = styleParams(spec);
    this.disposables = [];
    this.build();
  }

  track(o) {
    this.disposables.push(o);
    return o;
  }

  dispose() {
    for (const d of this.disposables) d.dispose && d.dispose();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }

  build() {
    if (this.spec.standup) return this.buildStandup();
    const { spec, cw, P } = this;
    const L = P.L;
    const hb = P.hb;
    const spark = spec.style === 'spark';
    const ringFn = (s) => hullRing(P, s);
    const group = this.group;
    if (!_matTex) _matTex = matTexture();

    // --- materials ----------------------------------------------------------
    const gloss = spark ? { roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.3 } : { roughness: 0.3, clearcoat: 1.0, clearcoatRoughness: 0.07 };
    const M = (o) => this.track(new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, envMapIntensity: 1.0, ...o }));
    const mHull = M({ color: cw.hull, ...gloss });
    const mHullSideR = M({ map: this.track(hullSideTexture(spec, cw, false)), ...gloss });
    const mHullSideL = M({ map: this.track(hullSideTexture(spec, cw, true)), ...gloss });
    const mUpperR = M({ map: this.track(upperSideTexture(spec, cw, false)), ...gloss });
    const mUpperL = M({ map: this.track(upperSideTexture(spec, cw, true)), ...gloss });
    const mDeck = M({ color: 0xffffff, vertexColors: true, ...gloss });
    const mBlack = M({ color: 0x0c0d0f, roughness: 0.55, clearcoat: 0.2 });
    const mRubber = M({ color: 0x08090a, roughness: 0.92 });
    const mSeat = M({ color: 0xffffff, vertexColors: true, roughness: 0.78, bumpMap: _matTex, bumpScale: 0.6 });
    const mMetal = M({ color: 0xb9c0c7, metalness: 1, roughness: 0.28 });
    const mDarkMetal = M({ color: 0x33373c, metalness: 0.9, roughness: 0.42 });
    const mAccent = M({ color: cw.trim, ...gloss });
    const mGlass = M({ color: 0x050607, roughness: 0.08, metalness: 0.0, clearcoat: 1 });
    this.mScreen = this.track(new THREE.MeshBasicMaterial({ color: 0x9fe8ff }));
    const mRed = M({ color: 0xc81e1e, roughness: 0.3, emissive: 0x300000 });

    const add = (geo, mat, parent = group) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // --- hull + deck loft -----------------------------------------------------
    const nS = 84;
    const common = { ringFn, xOf: P.xOf, nS, sPow: 1.35 };
    add(loftStrip({ ...common, a: 0, b: 3, sub: 4, mode: 'start' }), mHull);
    for (const side of [1, -1]) {
      add(loftStrip({ ...common, a: 3, b: 4, sub: 3, smooth: false, mode: 'side', sideSign: side }), side > 0 ? mHullSideR : mHullSideL);
      add(loftStrip({ ...common, a: 4, b: 6, sub: 4, mode: 'side', sideSign: side }), side > 0 ? mUpperR : mUpperL);
    }
    const cDeck = new THREE.Color(cw.deck);
    const cAccent = new THREE.Color(cw.accent);
    const cMat = new THREE.Color(0x1d2023);
    const cBlack = new THREE.Color(0x0e0f11);
    const cHullC = new THREE.Color(cw.hull);
    const deckColor = (s, t, c) => {
      const w = P.well(s);
      if (w > 0.5) {
        // footwell: traction mat on the floor, dark pedestal
        if (t > 0.72 && t < 2.3) c.copy(cMat);
        else if (t >= 2.3) c.copy(spark ? cDeck : cBlack);
        else c.copy(cDeck);
      } else if (s < 0.15) {
        // boarding platform
        if (t > 0.75) c.copy(cMat);
        else c.copy(cDeck);
      } else {
        // hood: colour with a centre spine and accent blades
        c.copy(cDeck);
        const spine = spark ? 3.25 : 3.45;
        if (t > spine && s < 0.93) c.copy(spark ? cHullC : cBlack);
        else if (t > spine - 0.3 && s > 0.62 && s < 0.9) c.copy(cAccent);
        // intake vents
        if (!spark && t > 1.2 && t < 2.2 && s > 0.705 && s < 0.78) c.copy(cBlack);
        if (spark && t > 0.9 && t < 2.4 && s > 0.7 && s < 0.86) c.copy(cHullC);
      }
    };
    add(loftStrip({ ...common, nS: 140, a: 6, b: 10, sub: 7, mode: 'end', colorFn: deckColor }), mDeck);

    // transom
    {
      const r = ringFn(0);
      const pts = sampleStrip(r, 0, 10, 4, true);
      const outline = [];
      for (const p of pts) outline.push([p[0], p[1]]);
      for (let k = pts.length - 2; k >= 1; k--) outline.push([-pts[k][0], pts[k][1]]);
      const pos = [0, -0.12, 0];
      for (const o of outline) pos.push(0, o[1], o[0]);
      const idx = [];
      for (let i = 0; i < outline.length; i++) idx.push(0, 1 + i, 1 + ((i + 1) % outline.length));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.translate(P.xOf(0), 0, 0);
      add(g, mHull);
    }

    // --- bond line bumper -----------------------------------------------------
    {
      const pts = [];
      const N = 40;
      for (let i = 0; i <= N; i++) {
        const s = 1 - Math.pow(1 - i / N, 1.5);
        pts.push([P.xOf(s), P.yb(s) + 0.004, P.bw(s) * hb + 0.004]);
      }
      const full = [...pts];
      for (let i = N - 1; i >= 0; i--) full.push([pts[i][0], pts[i][1], -pts[i][2]]);
      add(tube(full, 0.021, 8), mRubber);
    }

    // --- sponsons ---------------------------------------------------------------
    for (const side of [1, -1]) {
      const g = new THREE.BoxGeometry(0.2 * L, 0.05, 0.035);
      const pa = g.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i);
        if (x > 0) pa.setY(i, pa.getY(i) * 0.25);
      }
      g.computeVertexNormals();
      const m = add(g, spark ? mBlack : mAccent);
      const s = 0.13;
      const r = ringFn(s);
      m.position.set(P.xOf(s), r[3][1] + 0.05, side * (r[3][0] + 0.03));
    }

    // --- seat -----------------------------------------------------------------
    {
      const cSeat = new THREE.Color(cw.seat);
      const cSeatAcc = new THREE.Color(cw.trim);
      const cGrip = new THREE.Color(0x24272b);
      const seatColor = (s, t, c) => {
        const rel = (s - P.seat0) / (P.seat1 - P.seat0);
        c.copy(cSeat);
        if (t > 2.4) c.copy(cGrip);
        if (t > 0.85 && t < 1.25 && rel > 0.12 && rel < 0.9) c.copy(cSeatAcc);
      };
      add(loftStrip({ ringFn: (s) => seatRing(P, s), xOf: P.xOf, s0: P.seat0, s1: P.seat1, nS: 44, a: 0, b: 4, sub: 5, mode: 'end', colorFn: seatColor }), mSeat);
      // rear cap of the seat
      const r = seatRing(P, P.seat0);
      const pts = sampleStrip(r, 0, 4, 4, true);
      const pos = [0, r[0][1], 0];
      const outline = [];
      for (const p of pts) outline.push([p[0], p[1]]);
      for (let k = pts.length - 2; k >= 0; k--) outline.push([-pts[k][0], pts[k][1]]);
      for (const o of outline) pos.push(0, o[1], o[0]);
      const idx = [];
      for (let i = 0; i < outline.length - 1; i++) idx.push(0, 1 + i, 2 + i);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const cols = [];
      for (let i = 0; i < pos.length / 3; i++) cols.push(cSeat.r, cSeat.g, cSeat.b);
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.translate(P.xOf(P.seat0), 0, 0);
      add(g, mSeat);
      // grab handle behind the seat
      const x0 = P.xOf(P.seat0) - 0.02;
      const y0 = P.ct(P.seat0) + 0.02;
      add(tube([[x0 + 0.06, y0, 0.14], [x0 - 0.05, y0 + 0.05, 0.13], [x0 - 0.08, y0 + 0.07, 0], [x0 - 0.05, y0 + 0.05, -0.13], [x0 + 0.06, y0, -0.14]], 0.017, 8), mBlack);
    }

    // --- Trixx step wedges ------------------------------------------------------
    if (spec.trixx) {
      for (const side of [1, -1]) {
        const g = new THREE.BoxGeometry(0.2, 0.09, 0.2);
        const pa = g.attributes.position;
        for (let i = 0; i < pa.count; i++) if (pa.getX(i) > 0 && pa.getY(i) > 0) pa.setY(i, -0.04);
        g.computeVertexNormals();
        const m = add(g, mAccent);
        m.position.set(P.xOf(0.17), P.yb(0.17) + 0.0, side * (P.pw(0.17) + 0.16));
      }
    }

    // --- cowl, gauge and steering ------------------------------------------------
    const pivotX = P.xOf(P.pivotS);
    const pivotY = P.ct(P.pivotS);
    {
      // gauge pod
      const pod = new THREE.Group();
      pod.position.set(pivotX + 0.13, pivotY - 0.005, 0);
      group.add(pod);
      const body = new THREE.BoxGeometry(0.2, 0.07, spark ? 0.16 : 0.26);
      body.translate(0, 0.025, 0);
      const mb = add(body, mBlack, pod);
      mb.rotation.z = -0.5;
      const scr = new THREE.PlaneGeometry(spark ? 0.1 : 0.2, 0.085);
      const ms = new THREE.Mesh(scr, this.mScreen);
      ms.rotation.set(0, -Math.PI / 2, 0);
      ms.rotation.order = 'YXZ';
      ms.rotation.x = -0.0;
      const holder = new THREE.Group();
      holder.rotation.z = -0.5 + Math.PI / 2 - 0.25;
      holder.position.set(-0.03, 0.055, 0);
      ms.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
      holder.add(ms);
      pod.add(holder);
      this.screen = ms;

      if (!spark) {
        // mirrors
        for (const side of [1, -1]) {
          const stalk = add(tube([[pivotX + 0.16, pivotY - 0.08, side * 0.2], [pivotX + 0.13, pivotY + 0.0, side * 0.3], [pivotX + 0.1, pivotY + 0.04, side * 0.36]], 0.016, 6), mBlack);
          const house = add(new THREE.SphereGeometry(0.06, 14, 10), mBlack);
          house.scale.set(0.55, 0.7, 1.15);
          house.position.set(pivotX + 0.1, pivotY + 0.055, side * 0.39);
          const glass = add(new THREE.CircleGeometry(0.045, 16), mMetal);
          glass.scale.set(1.25, 0.75, 1);
          glass.rotation.y = -Math.PI / 2;
          glass.position.set(pivotX + 0.066, pivotY + 0.055, side * 0.39);
          void stalk;
        }
      }
    }

    // steering assembly (rotates about the raked column axis)
    const rake = spark ? 0.62 : 0.72; // radians back from vertical
    const steerRoot = new THREE.Group();
    steerRoot.position.set(pivotX - 0.02, pivotY - 0.02, 0);
    steerRoot.rotation.z = rake; // tilt column back (+Z rotation moves +Y toward -X)
    group.add(steerRoot);
    const steer = new THREE.Group();
    steerRoot.add(steer);
    this.steer = steer;
    {
      const colLen = P.column;
      const colG = new THREE.CylinderGeometry(spark ? 0.03 : 0.045, spark ? 0.04 : 0.06, colLen, 12);
      colG.translate(0, colLen / 2, 0);
      add(colG, spec.trixx ? mAccent : mBlack, steer);
      if (!spark) {
        const shroud = new THREE.BoxGeometry(0.16, colLen * 0.9, 0.2);
        shroud.translate(-0.01, colLen * 0.5, 0);
        add(shroud, mBlack, steer);
      }
      // bar clamp + bar
      const top = new THREE.Group();
      top.position.y = colLen;
      top.rotation.z = -rake; // bars level again
      steer.add(top);
      const half = P.barW / 2;
      const rise = spark ? 0.06 : 0.04;
      const sweep = 0.07;
      const barPts = [[-sweep, rise, -half], [-sweep * 0.7, rise, -half + 0.14], [0, 0, -0.1], [0, 0, 0.1], [-sweep * 0.7, rise, half - 0.14], [-sweep, rise, half]];
      add(tube(barPts, 0.0125, 8), mMetal, top);
      for (const side of [1, -1]) {
        const gg = new THREE.CylinderGeometry(0.019, 0.019, 0.13, 10);
        gg.rotateX(Math.PI / 2);
        const grip = add(gg, mRubber, top);
        grip.position.set(-sweep, rise, side * (half - 0.065));
        // levers: throttle (right), iBR (left)
        const lv = add(tube([[-sweep + 0.03, rise - 0.005, side * (half - 0.16)], [-sweep + 0.06, rise - 0.01, side * (half - 0.1)], [-sweep + 0.055, rise - 0.012, side * (half - 0.02)]], 0.006, 5), mDarkMetal, top);
        void lv;
        const anchor = new THREE.Object3D();
        anchor.position.set(-sweep, rise + 0.012, side * (half - 0.065));
        top.add(anchor);
        if (side > 0) this.gripR = anchor;
        else this.gripL = anchor;
      }
      const padG = new THREE.CapsuleGeometry(0.04, 0.14, 4, 10);
      padG.rotateX(Math.PI / 2);
      const pad = add(padG, spec.trixx ? mAccent : mBlack, top);
      pad.position.set(0, 0.012, 0);
      // lanyard / start cluster
      const btn = add(new THREE.BoxGeometry(0.03, 0.03, 0.05), mRed, top);
      btn.position.set(-0.035, rise * 0.6, -half + 0.2);
    }

    // --- jet pump, steering nozzle, VTS, iBR gate --------------------------------
    const tx = P.xOf(0);
    this.addPump(add, { mDarkMetal, mBlack, mMetal }, tx, -0.245, P.yk(0), true);

    // --- intake grate + keel details ---------------------------------------------
    {
      const gx = -0.17 * L;
      const gy = P.yk(STERN - 0.17) - 0.004;
      for (let i = -2; i <= 2; i++) {
        const bar = add(new THREE.BoxGeometry(0.3, 0.012, 0.012), mMetal);
        bar.position.set(gx, gy, i * 0.03);
      }
      const frame = add(new THREE.BoxGeometry(0.34, 0.006, 0.18), mBlack);
      frame.position.set(gx, gy + 0.008, 0);
    }

    // --- bow eye, tow hook, drain plugs, fuel cap ----------------------------------
    {
      const eye = add(new THREE.TorusGeometry(0.03, 0.008, 6, 14), mMetal);
      eye.position.set(P.xOf(0.975), P.yb(0.975) - 0.06, 0);
      eye.rotation.y = Math.PI / 2;
      const hook = add(new THREE.TorusGeometry(0.035, 0.009, 6, 14), mMetal);
      hook.position.set(tx - 0.012, 0.03, 0);
      hook.rotation.y = Math.PI / 2;
      for (const side of [1, -1]) {
        const plug = add(new THREE.CylinderGeometry(0.018, 0.018, 0.01, 10), mBlack);
        plug.rotation.z = Math.PI / 2;
        plug.position.set(tx - 0.004, -0.2, side * 0.25);
        const refl = add(new THREE.BoxGeometry(0.008, 0.035, 0.09), mRed);
        refl.position.set(tx - 0.004, -0.03, side * (hb * 0.6));
      }
      const cap = add(new THREE.CylinderGeometry(0.035, 0.035, 0.015, 14), mBlack);
      const sc = 0.73;
      const rr = ringFn(sc);
      cap.position.set(P.xOf(sc), rr[8][1] + 0.012, rr[8][0] * 0.9);
      cap.rotation.x = 0.45;
    }

    // rider reference points (model frame)
    this.anchors = {
      seat: new THREE.Vector3(P.xOf(spark ? 0.44 : 0.42), P.seatTop(spark ? 0.44 : 0.42), 0),
      footL: new THREE.Vector3(P.xOf(0.5), P.yb(0.5) - P.floorDrop + 0.02, -(P.pw(0.5) + 0.19)),
      footR: new THREE.Vector3(P.xOf(0.5), P.yb(0.5) - P.floorDrop + 0.02, P.pw(0.5) + 0.19),
      footBackL: new THREE.Vector3(P.xOf(0.19), P.yb(0.19) - P.floorDrop + (spec.trixx ? 0.09 : 0.02), -(P.pw(0.19) + 0.17)),
      footBackR: new THREE.Vector3(P.xOf(0.19), P.yb(0.19) - P.floorDrop + (spec.trixx ? 0.09 : 0.02), P.pw(0.19) + 0.17),
    };
    this._v = new THREE.Vector3();
  }

  buildStandup() {
    const { spec, cw } = this;
    const P = (this.P = standupParams(spec));
    const L = P.L;
    const hb = P.hb;
    const ringFn = (s) => standupRing(P, s);
    const group = this.group;
    if (!_matTex) _matTex = matTexture();
    const gloss = { roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.1 };
    const M = (o) => this.track(new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, envMapIntensity: 1.0, ...o }));
    const mHull = M({ color: cw.hull, ...gloss });
    const mSideR = M({ map: this.track(standupSideTexture(spec, cw, false)), ...gloss });
    const mSideL = M({ map: this.track(standupSideTexture(spec, cw, true)), ...gloss });
    const mDeck = M({ color: 0xffffff, vertexColors: true, ...gloss });
    const mBlack = M({ color: 0x0c0d0f, roughness: 0.55, clearcoat: 0.2 });
    const mRubber = M({ color: 0x08090a, roughness: 0.92 });
    const mMetal = M({ color: 0xb9c0c7, metalness: 1, roughness: 0.28 });
    const mDarkMetal = M({ color: 0x33373c, metalness: 0.9, roughness: 0.42 });
    const mAccent = M({ color: cw.trim, ...gloss });
    const mPad = M({ color: 0x16181b, roughness: 0.85, bumpMap: _matTex, bumpScale: 0.4 });
    this.mScreen = null;
    const add = (geo, mat, parent = group) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // --- hull, sides, tray and hood ------------------------------------------
    const common = { ringFn, xOf: P.xOf, nS: 80, sPow: 1.3 };
    add(loftStrip({ ...common, a: 0, b: 3, sub: 4, mode: 'start' }), mHull);
    for (const side of [1, -1]) add(loftStrip({ ...common, a: 3, b: 6, sub: 4, mode: 'side', sideSign: side }), side > 0 ? mSideR : mSideL);
    const cDeck = new THREE.Color(cw.deck);
    const cAccent = new THREE.Color(cw.accent);
    const cMat = new THREE.Color(0x1b1e21);
    const cHull = new THREE.Color(cw.hull);
    const deckColor = (s, t, c) => {
      const tr = P.tray(s);
      if (tr > 0.5) {
        if (t > 1.6) c.copy(cMat); // traction mat on the tray floor
        else c.copy(cDeck);
      } else if (s < 0.1) c.copy(cHull);
      else {
        c.copy(cDeck);
        if (t > 3.3 && s > 0.66 && s < 0.95) c.copy(cAccent);
        if (t > 1.0 && t < 1.8 && s > 0.67 && s < 0.8) c.copy(cHull); // hood vents
      }
    };
    add(loftStrip({ ...common, nS: 130, a: 6, b: 10, sub: 7, mode: 'end', colorFn: deckColor }), mDeck);
    // transom
    {
      const r = ringFn(0);
      const pts = sampleStrip(r, 0, 10, 4, true);
      const outline = [];
      for (const p of pts) outline.push([p[0], p[1]]);
      for (let k = pts.length - 2; k >= 1; k--) outline.push([-pts[k][0], pts[k][1]]);
      const pos = [0, -0.1, 0];
      for (const o of outline) pos.push(0, o[1], o[0]);
      const idx = [];
      for (let i = 0; i < outline.length; i++) idx.push(0, 1 + i, 1 + ((i + 1) % outline.length));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.translate(P.xOf(0), 0, 0);
      add(g, mHull);
    }
    // bond-line bumper
    {
      const pts = [];
      for (let i = 0; i <= 36; i++) {
        const s = 1 - Math.pow(1 - i / 36, 1.5);
        pts.push([P.xOf(s), P.yb(s) + 0.004, P.bw(s) * hb + 0.004]);
      }
      const full = [...pts];
      for (let i = 35; i >= 0; i--) full.push([pts[i][0], pts[i][1], -pts[i][2]]);
      add(tube(full, 0.018, 8), mRubber);
    }
    // tray mat ribs and a kick-pad at the front of the tray
    for (let i = 0; i < 7; i++) {
      const s = 0.12 + i * 0.06;
      const rib = add(new THREE.BoxGeometry(0.02, 0.008, P.bw(s) * hb * 0.95), mPad);
      rib.position.set(P.xOf(s), P.floor(s) + 0.006, 0);
    }
    {
      const kp = add(new THREE.BoxGeometry(0.06, 0.07, P.bw(0.56) * hb * 1.2), mPad);
      kp.position.set(P.xOf(0.565), P.floor(0.56) + 0.05, 0);
      kp.rotation.z = 0.5;
    }
    // two-stroke water-box exhaust out of the side
    {
      const ex = add(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 12, 1, true), mDarkMetal);
      ex.rotation.x = Math.PI / 2;
      ex.position.set(P.xOf(0.1), P.yb(0.1) - 0.06, -(P.bw(0.1) * hb));
    }

    // --- handle pole, hinged at the nose, bars at the end ---------------------
    const pivotX = P.xOf(P.pivotS);
    const pivotY = P.ct(P.pivotS) + 0.02;
    const poleLen = spec.L * 0.5;
    const pole = new THREE.Group();
    pole.position.set(pivotX, pivotY, 0);
    pole.rotation.z = -0.5; // raised: the end of the pole swings up toward the rider
    group.add(pole);
    this.pole = pole;
    {
      const hinge = add(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 14), mDarkMetal, pole);
      hinge.rotation.x = Math.PI / 2;
      const pg = new THREE.BoxGeometry(poleLen, 0.07, 0.11);
      pg.translate(-poleLen / 2, 0.02, 0);
      // taper the pole toward the bars
      const pa = pg.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const k = 1 - (-pa.getX(i) / poleLen) * 0.35;
        pa.setZ(i, pa.getZ(i) * k);
      }
      pg.computeVertexNormals();
      add(pg, mHull, pole);
      const stripe = add(new THREE.BoxGeometry(poleLen * 0.7, 0.012, 0.08), mAccent, pole);
      stripe.position.set(-poleLen * 0.45, 0.058, 0);
      // foam chin pad near the bars
      const padG = new THREE.CapsuleGeometry(0.05, 0.12, 4, 10);
      padG.rotateZ(Math.PI / 2);
      const pad = add(padG, mPad, pole);
      pad.position.set(-poleLen + 0.18, 0.09, 0);
    }
    // bar mount at the end of the pole, kept level
    const steerRoot = new THREE.Group();
    steerRoot.position.set(-poleLen, 0.05, 0);
    steerRoot.rotation.z = 0.5; // undo the pole's angle
    pole.add(steerRoot);
    this.steerRoot = steerRoot;
    const steer = new THREE.Group();
    steerRoot.add(steer);
    this.steer = steer;
    {
      const post = add(new THREE.CylinderGeometry(0.03, 0.035, 0.1, 10), mDarkMetal, steer);
      post.position.y = 0.04;
      const top = new THREE.Group();
      top.position.y = 0.1;
      steer.add(top);
      const half = 0.31;
      const rise = 0.06;
      const bar = [[-0.05, rise, -half], [-0.035, rise, -half + 0.12], [0, 0, -0.08], [0, 0, 0.08], [-0.035, rise, half - 0.12], [-0.05, rise, half]];
      add(tube(bar, 0.0125, 8), mMetal, top);
      for (const side of [1, -1]) {
        const gg = new THREE.CylinderGeometry(0.019, 0.019, 0.13, 10);
        gg.rotateX(Math.PI / 2);
        const grip = add(gg, mRubber, top);
        grip.position.set(-0.05, rise, side * (half - 0.065));
        const anchor = new THREE.Object3D();
        anchor.position.set(-0.05, rise + 0.012, side * (half - 0.065));
        top.add(anchor);
        if (side > 0) this.gripR = anchor;
        else this.gripL = anchor;
      }
      const crossPad = new THREE.CapsuleGeometry(0.035, 0.12, 4, 10);
      crossPad.rotateX(Math.PI / 2);
      add(crossPad, mAccent, top).position.set(0, 0.012, 0);
    }

    // --- pump and nozzle (no reverse gate on a stand-up) ----------------------
    const tx = P.xOf(0);
    this.addPump(add, { mDarkMetal, mBlack, mMetal }, tx, -0.12, P.yk(0), false);
    // intake grate
    {
      const gx = -0.17 * L;
      const gy = P.yk(STERN - 0.17) - 0.004;
      for (let i = -2; i <= 2; i++) add(new THREE.BoxGeometry(0.26, 0.012, 0.012), mMetal).position.set(gx, gy, i * 0.026);
    }
    // bow bumper
    {
      const bump = add(new THREE.SphereGeometry(0.06, 14, 10), mRubber);
      bump.scale.set(1.2, 0.8, 1);
      bump.position.set(P.xOf(0.995), P.yb(0.995) + 0.02, 0);
    }

    // where the rider stands (model frame)
    const fl = (s) => P.floor(s) + 0.03;
    this.anchors = {
      standup: true,
      seat: new THREE.Vector3(P.xOf(0.29), P.floor(0.29) + 0.7, 0), // hips: knees bent, crouched over the bars
      footL: new THREE.Vector3(P.xOf(0.35), fl(0.35), -0.11),
      footR: new THREE.Vector3(P.xOf(0.27), fl(0.27), 0.12),
      footBackL: new THREE.Vector3(P.xOf(0.17), fl(0.17), -0.11),
      footBackR: new THREE.Vector3(P.xOf(0.12), fl(0.12), 0.12),
    };
    this._v = new THREE.Vector3();
  }

  // jet pump, steering nozzle (yaw for steering, pitch for trim) and the
  // optional iBR reverse gate, at the transom
  addPump(add, M, tx, ny, ykStern, withGate) {
    const { mDarkMetal, mBlack, mMetal } = M;
    const group = this.group;
    // ride plate
    const rp = add(new THREE.BoxGeometry(0.34, 0.016, 0.3), mDarkMetal);
    rp.position.set(tx - 0.03 + 0.17, ykStern + 0.006, 0);
    // pump housing (stator section) poking out of the tunnel
    const pg = new THREE.CylinderGeometry(0.082, 0.095, 0.16, 20, 1, true);
    pg.rotateZ(Math.PI / 2);
    const pump = add(pg, mDarkMetal);
    pump.position.set(tx - 0.05, ny, 0);
    const tunnel = add(new THREE.CircleGeometry(0.13, 20), mBlack);
    tunnel.rotation.y = -Math.PI / 2;
    tunnel.position.set(tx - 0.002, ny + 0.01, 0);
    // venturi
    const vg = new THREE.CylinderGeometry(0.066, 0.082, 0.08, 20, 1, true);
    vg.rotateZ(Math.PI / 2);
    const vent = add(vg, mMetal);
    vent.position.set(tx - 0.17, ny, 0);
    // nozzle: yaw (steer) then pitch (trim)
    const yawG = new THREE.Group();
    yawG.position.set(tx - 0.2, ny, 0);
    group.add(yawG);
    const pitchG = new THREE.Group();
    yawG.add(pitchG);
    const ng = new THREE.CylinderGeometry(0.058, 0.078, 0.17, 20, 1, true);
    ng.rotateZ(Math.PI / 2);
    ng.translate(-0.07, 0, 0);
    add(ng, mDarkMetal, pitchG);
    const ringG = new THREE.TorusGeometry(0.08, 0.012, 8, 20);
    ringG.rotateY(Math.PI / 2);
    add(ringG, mMetal, pitchG);
    // VTS trim ring arms
    for (const side of [1, -1]) {
      const arm = add(new THREE.BoxGeometry(0.1, 0.014, 0.012), mMetal, yawG);
      arm.position.set(0.03, 0, side * 0.092);
    }
    const exit = new THREE.Object3D();
    exit.position.set(-0.16, 0, 0);
    pitchG.add(exit);
    this.nozzleYaw = yawG;
    this.nozzlePitch = pitchG;
    this.nozzleExit = exit;
    // iBR reverse gate: a bucket that swings down over the jet
    const gatePivot = new THREE.Group();
    gatePivot.position.set(tx - 0.12, ny + 0.115, 0);
    group.add(gatePivot);
    if (withGate) {
      const gateG = new THREE.CylinderGeometry(0.125, 0.125, 0.25, 16, 1, true, 0, Math.PI);
      gateG.rotateX(Math.PI / 2);
      gateG.rotateY(Math.PI);
      gateG.translate(-0.06, -0.01, 0);
      add(gateG, mBlack, gatePivot);
    }
    this.gate = gatePivot;
  }

  // tele: physics telemetry
  update(tele, dt) {
    const sp = this.spec;
    // bars turn with the nozzle; a right turn swings the nozzle outlet to the right
    this.steer.rotation.y = -(tele.steerAngle / sp.steerMax) * 0.62;
    // (drawn swinging further than the physics angle, so you can see it steer;
    // the jet stream follows it exactly)
    this.nozzleYaw.rotation.y = tele.steerAngle * NOZZLE_SWING; // +Y rotation takes -X (aft) toward +Z (starboard)
    this.nozzlePitch.rotation.z = -tele.trimAngle; // nozzle outlet tilts up with trim
    const target = tele.reverse > 0.05 ? 1.25 : 0;
    this.gate.rotation.z = lerp(this.gate.rotation.z, -target, clamp(dt * 12, 0, 1));
    if (this.pole) {
      // mid-flip the rider hauls the pole up to their chest
      this.tk = lerp(this.tk || 0, tele.tuck || 0, clamp(dt * 14, 0, 1));
      this.pole.rotation.z = -0.5 - this.tk * 0.32;
      this.steerRoot.rotation.z = -this.pole.rotation.z;
    }
  }
}
