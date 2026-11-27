// Procedural rider, dressed for a day on the water: backwards cap and shades,
// black and red life jacket over a tee, boardshorts, bare arms and legs,
// water shoes. Posed every frame with two-bone IK so the hands stay on the
// grips and the feet in the wells while the body shifts weight for turns,
// wheelies, flips and landings.

import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

const DIM = {
  thigh: 0.45,
  shin: 0.45,
  upper: 0.31,
  fore: 0.29,
  torso: 0.5,
  shoulder: 0.205,
  hip: 0.11,
  neck: 0.1,
};

// ellipse-section body loft along +Y, with UVs (u around from the front, v up)
function bodyLoft(sections, colorFn) {
  const seg = 28;
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const c = new THREE.Color();
  for (let i = 0; i < sections.length; i++) {
    const [y, rx, rz, ox = 0] = sections[i];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      // slightly squared ellipse
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const px = ox + Math.sign(ca) * Math.pow(Math.abs(ca), 0.8) * rx;
      const pz = Math.sign(sa) * Math.pow(Math.abs(sa), 0.8) * rz;
      pos.push(px, y, pz);
      uv.push(k / seg, i / (sections.length - 1));
      if (colorFn) {
        colorFn(i / (sections.length - 1), a, c, y);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const v0 = i * (seg + 1) + k;
      const v1 = v0 + 1;
      const v2 = v0 + seg + 1;
      const v3 = v2 + 1;
      idx.push(v0, v2, v1, v1, v2, v3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Muscle-shaped limb segment of unit length along +Y. profile: [t, radius]
function limbGeo(profile) {
  const pts = profile.map(([t, r]) => new THREE.Vector2(r, t));
  pts.unshift(new THREE.Vector2(0.001, profile[0][0]));
  pts.push(new THREE.Vector2(0.001, profile[profile.length - 1][0]));
  return new THREE.LatheGeometry(pts, 16);
}

const hex = (c) => '#' + new THREE.Color(c).getHexString();

function makeCanvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// The kit with no outfit on: a black and red vest, a dark tee, dark shorts
// with a panel and cap in the ski's trim colour.
const RED = '#d3212b';
const STOCK = { pattern: 'plain', vest: '#15171b', panel: RED, text: '#ffffff', chest: RED, tee: 0x2b2e34, shorts: '#20242b', stripe: '#f2f2ee', accent: 0xd3212b, gloves: null, shoe: 0x1d2026 };

// a little deterministic noise for the camo
function rnd(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Life vest: u = 0 (and 1) is the front centre, v runs up the body.
// The kit picks the colours and the print (pattern).
function vestTexture(k) {
  return makeCanvasTex(512, 256, (g, w, h) => {
    const Y = (v) => h * (1 - v);
    g.fillStyle = k.vest;
    g.fillRect(0, 0, w, h);
    // the print, under the panels and straps
    g.fillStyle = k.panel;
    if (k.pattern === 'split') {
      // a big diagonal: the lower half of the front and back in the panel colour
      for (const x0 of [0, 0.5]) {
        g.beginPath();
        g.moveTo(w * (x0 - 0.02), Y(0.06));
        g.lineTo(w * (x0 + 0.52), Y(0.06));
        g.lineTo(w * (x0 + 0.52), Y(0.28));
        g.lineTo(w * (x0 - 0.02), Y(0.62));
        g.fill();
      }
    } else if (k.pattern === 'chevron') {
      // bold chevrons pointing up the front and back
      for (const cx of [0, 0.5, 1]) {
        for (const v0 of [0.18, 0.4]) {
          g.beginPath();
          g.moveTo(w * (cx - 0.2), Y(v0));
          g.lineTo(w * cx, Y(v0 + 0.16));
          g.lineTo(w * (cx + 0.2), Y(v0));
          g.lineTo(w * (cx + 0.2), Y(v0 - 0.09));
          g.lineTo(w * cx, Y(v0 + 0.07));
          g.lineTo(w * (cx - 0.2), Y(v0 - 0.09));
          g.fill();
        }
      }
    } else if (k.pattern === 'wave') {
      // rolling swell lines round the body
      g.lineWidth = h * 0.05;
      g.strokeStyle = k.panel;
      for (const v0 of [0.2, 0.36, 0.52]) {
        g.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const v = v0 + 0.04 * Math.sin((x / w) * Math.PI * 8);
          if (x === 0) g.moveTo(x, Y(v));
          else g.lineTo(x, Y(v));
        }
        g.stroke();
      }
    } else if (k.pattern === 'race') {
      // twin racing stripes down the front and the back
      for (const cx of [0.04, 0.5, 0.96]) {
        g.fillRect(w * (cx - 0.075), 0, w * 0.04, h);
        g.fillRect(w * (cx + 0.035), 0, w * 0.04, h);
      }
    } else if (k.pattern === 'reflect') {
      // reflective tape: two bands round the body and down the sides
      g.fillRect(0, Y(0.3), w, h * 0.05);
      g.fillRect(0, Y(0.5), w, h * 0.05);
    } else if (k.pattern === 'camo') {
      const r = rnd(7);
      const cols = k.camo || [k.panel];
      for (let i = 0; i < 90; i++) {
        g.fillStyle = cols[i % cols.length];
        const x = r() * w, y = r() * h, rr = 10 + r() * 26;
        g.beginPath();
        for (let a = 0; a < 7; a++) {
          const t = (a / 7) * Math.PI * 2;
          const d = rr * (0.6 + r() * 0.6);
          g.lineTo(x + Math.cos(t) * d * 1.4, y + Math.sin(t) * d * 0.8);
        }
        g.fill();
      }
    }
    // subtle foam-panel shading so it is not flat
    for (const x of [0.06, 0.25, 0.5, 0.75, 0.94]) {
      const gr = g.createLinearGradient(w * (x - 0.07), 0, w * (x + 0.07), 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(w * (x - 0.07), 0, w * 0.14, h);
    }
    // side panels and the band across the chest and back
    g.fillStyle = k.panel;
    if (k.pattern === 'plain' || k.pattern === 'race' || k.pattern === 'reflect') {
      g.fillRect(w * 0.2, Y(0.84), w * 0.1, h * 0.75);
      g.fillRect(w * 0.7, Y(0.84), w * 0.1, h * 0.75);
    }
    if (k.pattern !== 'race' && k.pattern !== 'camo') g.fillRect(0, Y(0.72), w, h * 0.06);
    // dark binding top and bottom
    g.fillStyle = '#0b0c0e';
    g.fillRect(0, 0, w, Y(0.9));
    g.fillRect(0, Y(0.06), w, h);
    // panel seams
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 3;
    for (const x of [0.12, 0.38, 0.62, 0.88]) {
      g.beginPath();
      g.moveTo(w * x, Y(0.06));
      g.lineTo(w * x, Y(0.9));
      g.stroke();
    }
    // front zip
    g.fillStyle = '#08090a';
    g.fillRect(0, 0, w * 0.012, h);
    g.fillRect(w * 0.988, 0, w * 0.012, h);
    // three straps with buckles across the front
    for (const v of [0.2, 0.4, 0.58]) {
      g.fillStyle = '#0e1013';
      g.fillRect(0, Y(v + 0.035), w * 0.17, h * 0.07);
      g.fillRect(w * 0.83, Y(v + 0.035), w * 0.17, h * 0.07);
      g.fillStyle = '#c9ced4';
      g.fillRect(w * 0.035, Y(v + 0.05), w * 0.05, h * 0.1);
      g.fillStyle = '#5c6168';
      g.fillRect(w * 0.045, Y(v + 0.025), w * 0.03, h * 0.05);
    }
    // brand on the back and a small one on the chest
    g.save();
    g.fillStyle = k.text;
    g.font = 'italic 900 44px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SEA-DOO', w * 0.5, Y(0.45));
    g.fillStyle = k.chest || k.text;
    g.font = 'italic 800 20px "Arial Black", Arial, sans-serif';
    g.fillText('SEA-DOO', w * 0.9, Y(0.82));
    g.restore();
  });
}

// Boardshorts: a base colour with a bold panel and a stripe down each side.
function shortsTexture(k) {
  return makeCanvasTex(256, 128, (g, w, h) => {
    g.fillStyle = k.shorts;
    g.fillRect(0, 0, w, h);
    g.fillStyle = k.shortsPanel;
    for (const x0 of [0.25, 0.75]) {
      g.beginPath();
      g.moveTo(w * (x0 - 0.13), 0);
      g.lineTo(w * (x0 + 0.02), 0);
      g.lineTo(w * (x0 - 0.06), h);
      g.lineTo(w * (x0 - 0.2), h);
      g.fill();
    }
    g.fillStyle = k.stripe;
    for (const x0 of [0.5, 0.0, 1.0]) g.fillRect(w * x0 - 3, 0, 6, h);
    g.fillStyle = '#121418';
    g.fillRect(0, 0, w, h * 0.09);
  });
}

export class Rider {
  constructor(colorway) {
    this.group = new THREE.Group();
    this.mats = [];
    this.texs = [];
    const M = (o) => {
      const m = new THREE.MeshPhysicalMaterial({ roughness: 0.7, ...o });
      this.mats.push(m);
      return m;
    };
    const tex = (t) => (this.texs.push(t), t);
    const trim = colorway.trim;
    // the outfit (a whole kit), or the stock one in the ski's trim colour
    const kit = { ...STOCK, shortsPanel: hex(trim), cap: trim, ...(colorway.kit || {}) };
    const mSkin = M({ color: 0xc78f6a, roughness: 0.5, sheen: 0.3, sheenColor: new THREE.Color(0xe8b896), sheenRoughness: 0.5 });
    const mSuit = M({ color: kit.tee, roughness: 0.85 }); // the tee under the vest
    const mShorts = M({ map: tex(shortsTexture(kit)), roughness: 0.85, side: THREE.DoubleSide });
    const vt = tex(vestTexture(kit));
    vt.repeat.x = -1; // the loft runs round the body the other way: unmirror the print
    const mVest = M({ map: vt, roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.5 });
    const mShoe = M({ color: kit.shoe, roughness: 0.75 });
    const mSole = M({ color: 0x08090a, roughness: 0.95 });
    const mRed = M({ color: kit.accent, roughness: 0.5 }); // wrist band and shoe strap
    // riding gloves, or bare hands
    const mGlove = kit.gloves != null ? M({ color: kit.gloves, roughness: 0.8, sheen: 0.4, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.7 }) : mSkin;
    const mBlack = M({ color: 0x0b0c0e, roughness: 0.6 });
    const mHair = M({ color: 0x2a1c12, roughness: 0.95, sheen: 0.5, sheenColor: new THREE.Color(0x5a4030) });
    const mCap = M({ color: kit.cap, roughness: 0.75 });
    const mCapUnder = M({ color: 0x15171a, roughness: 0.8, side: THREE.DoubleSide });
    const mLens = M({ color: 0x0a0c10, metalness: 0.9, roughness: 0.08, clearcoat: 1, side: THREE.DoubleSide });
    const mEye = M({ color: 0x1a1210, roughness: 0.3 });

    const mk = (geo, mat, parent = this.group) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // --- torso (hip -> chest along +Y, front = +X) -------------------------
    this.torso = new THREE.Group();
    this.group.add(this.torso);
    const T = DIM.torso;
    mk(
      bodyLoft([
        [-0.1, 0.085, 0.13],
        [-0.03, 0.105, 0.165],
        [0.08, 0.098, 0.15],
        [0.2, 0.1, 0.15],
        [0.34, 0.115, 0.178],
        [T - 0.05, 0.112, 0.195],
        [T + 0.02, 0.088, 0.165],
        [T + 0.06, 0.05, 0.07],
      ]),
      mSuit,
      this.torso
    );
    mk(
      bodyLoft([
        [0.1, 0.118, 0.168],
        [0.15, 0.134, 0.18],
        [0.3, 0.152, 0.202],
        [T - 0.07, 0.15, 0.214],
        [T - 0.015, 0.128, 0.192],
        [T + 0.025, 0.092, 0.138],
      ]),
      mVest,
      this.torso
    );
    // vest collar
    const collar = mk(new THREE.TorusGeometry(0.075, 0.015, 8, 24), mBlack, this.torso);
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(1.15, 1.35, 0.8);
    collar.position.set(0, T + 0.035, 0);
    // board shorts over the hips
    mk(
      bodyLoft([
        [-0.13, 0.093, 0.145],
        [-0.05, 0.118, 0.178],
        [0.05, 0.11, 0.17],
        [0.1, 0.108, 0.166],
      ]),
      mShorts,
      this.torso
    );

    // --- head: face, hair, backwards cap, shades -------------------------------
    // (head space: +X forward, +Y up)
    this.head = new THREE.Group();
    this.group.add(this.head);
    const neck = mk(new THREE.CylinderGeometry(0.048, 0.056, 0.12, 14), mSkin, this.head);
    neck.position.y = -0.055;
    const skull = mk(new THREE.SphereGeometry(0.105, 32, 24), mSkin, this.head);
    skull.scale.set(1.06, 1.14, 0.92);
    skull.position.set(0, 0.07, 0);
    const jaw = mk(new THREE.SphereGeometry(0.075, 24, 16), mSkin, this.head);
    jaw.scale.set(1.08, 0.82, 0.92);
    jaw.position.set(0.032, 0.0, 0);
    const nose = mk(new THREE.SphereGeometry(0.017, 12, 8), mSkin, this.head);
    nose.scale.set(1.25, 1.15, 0.8);
    nose.position.set(0.112, 0.045, 0);
    for (const sd of [-1, 1]) {
      const ear = mk(new THREE.SphereGeometry(0.026, 12, 8), mSkin, this.head);
      ear.scale.set(0.62, 1, 0.42);
      ear.position.set(-0.005, 0.062, sd * 0.098);
    }
    // a hint of a smile under the shades
    const mouth = mk(new THREE.TorusGeometry(0.026, 0.0045, 6, 14, Math.PI * 0.75), mEye, this.head);
    mouth.rotation.set(0, Math.PI / 2, Math.PI + Math.PI * 0.125);
    mouth.position.set(0.097, 0.0, 0);
    // hair out the back and sides, under the cap
    const hair = mk(new THREE.SphereGeometry(0.11, 28, 16, -1.95, 3.9, 0.4, 1.45), mHair, this.head);
    hair.scale.set(1.08, 1.12, 0.97);
    hair.position.set(-0.008, 0.074, 0);
    // backwards cap: crown, brim out the back, snap strap over the forehead
    const crown = mk(new THREE.SphereGeometry(0.114, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), mCap, this.head);
    crown.scale.set(1.08, 0.86, 0.99);
    crown.position.set(-0.004, 0.104, 0);
    const btn = mk(new THREE.SphereGeometry(0.012, 10, 6), mCap, this.head);
    btn.position.set(-0.004, 0.203, 0);
    {
      const bg = new THREE.BoxGeometry(0.12, 0.008, 0.17, 6, 1, 8);
      const pa = bg.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const z = pa.getZ(i);
        pa.setY(i, pa.getY(i) - z * z * 1.8);
      }
      bg.computeVertexNormals();
      const brim = mk(bg, mCap, this.head);
      brim.position.set(-0.165, 0.1, 0);
      brim.rotation.z = 0.12;
      const under = mk(bg.clone(), mCapUnder, this.head);
      under.position.set(-0.165, 0.094, 0);
      under.rotation.z = 0.12;
    }
    const snap = mk(new THREE.CylinderGeometry(0.113, 0.113, 0.016, 24, 1, true, 1.15, 0.85), mBlack, this.head);
    snap.scale.set(1.08, 1, 0.99);
    snap.position.set(-0.004, 0.11, 0);
    // wraparound shades
    const lens = mk(new THREE.CylinderGeometry(0.108, 0.104, 0.036, 28, 1, true, 0.75, 1.64), mLens, this.head);
    lens.scale.set(1.06, 1, 0.97);
    lens.position.set(0.006, 0.075, 0);
    const brow = mk(new THREE.CylinderGeometry(0.11, 0.11, 0.009, 28, 1, true, 0.75, 1.64), mBlack, this.head);
    brow.scale.set(1.06, 1, 0.97);
    brow.position.set(0.006, 0.095, 0);
    for (const sd of [-1, 1]) {
      const arm = mk(new THREE.BoxGeometry(0.1, 0.008, 0.006), mBlack, this.head);
      arm.position.set(0.035, 0.084, sd * 0.1);
    }

    // --- limbs ----------------------------------------------------------------
    const G = {
      upper: limbGeo([[0, 0.05], [0.12, 0.054], [0.4, 0.051], [0.75, 0.043], [1, 0.039]]),
      sleeve: limbGeo([[0, 0.066], [0.2, 0.064], [0.4, 0.06], [0.42, 0.05]]),
      fore: limbGeo([[0, 0.04], [0.18, 0.046], [0.5, 0.04], [0.85, 0.031], [1, 0.029]]),
      thigh: limbGeo([[0, 0.082], [0.2, 0.087], [0.55, 0.077], [0.85, 0.06], [1, 0.055]]),
      shorts: limbGeo([[0, 0.1], [0.35, 0.101], [0.74, 0.093], [0.76, 0.08]]),
      shin: limbGeo([[0, 0.054], [0.25, 0.06], [0.55, 0.048], [0.85, 0.038], [1, 0.035]]),
      cuff: limbGeo([[0, 0.034], [0.2, 0.037], [1, 0.035]]),
    };
    for (const k of Object.keys(G)) G[k].userData.shared = true;
    this.sharedGeo = Object.values(G);
    const joint = (r, mat, sy = 1) => {
      const m = mk(new THREE.SphereGeometry(r, 14, 10), mat);
      m.scale.y = sy;
      return m;
    };
    this.arm = [];
    this.leg = [];
    for (let i = 0; i < 2; i++) {
      // hand: fingers wrapped round the grip (grip axis = Z), back of the hand
      // on top, thumb underneath
      const glove = new THREE.Group();
      this.group.add(glove);
      const fg = new THREE.CylinderGeometry(0.029, 0.029, 0.084, 18, 1, true, -1.0, 5.4);
      fg.rotateX(Math.PI / 2);
      mk(fg, mGlove, glove);
      for (const z of [-0.028, -0.009, 0.01, 0.028]) {
        const kn = mk(new THREE.TorusGeometry(0.029, 0.008, 6, 14, 3.6), mGlove, glove);
        kn.position.z = z;
        kn.rotation.z = -1.4;
      }
      const back = mk(new THREE.SphereGeometry(0.046, 14, 10), mGlove, glove);
      back.scale.set(0.95, 0.5, 0.9);
      back.position.set(-0.03, 0.028, 0);
      back.rotation.z = 0.7;
      const thumb = mk(new THREE.CapsuleGeometry(0.0105, 0.038, 4, 8), mGlove, glove);
      thumb.position.set(-0.022, -0.028, (i === 0 ? 1 : -1) * 0.042);
      thumb.rotation.set(Math.PI / 2, 0, 0.9);
      this.arm.push({
        upper: mk(G.upper, mSkin),
        sleeve: mk(G.sleeve, mSuit),
        fore: mk(G.fore, mSkin),
        // a red band on one wrist, a black one on the other
        cuff: mk(G.cuff, i === 0 || kit.gloves != null ? mRed : mBlack),
        shoulder: joint(0.064, mSuit, 1.1),
        elbow: joint(0.041, mSkin),
        glove,
      });
      // water shoe: low and light, with a red strap
      const boot = new THREE.Group();
      this.group.add(boot);
      const sole = mk(new THREE.BoxGeometry(0.27, 0.022, 0.104), mSole, boot);
      sole.position.set(0.0, -0.036, 0);
      const upper = mk(new THREE.CapsuleGeometry(0.043, 0.16, 4, 12), mShoe, boot);
      upper.rotation.z = Math.PI / 2;
      upper.scale.set(0.7, 1, 1.05);
      upper.position.set(0.012, -0.004, 0);
      const heel = mk(new THREE.SphereGeometry(0.047, 12, 8), mShoe, boot);
      heel.scale.set(1, 0.85, 1.05);
      heel.position.set(-0.075, 0.012, 0);
      const bstrap = mk(new THREE.BoxGeometry(0.035, 0.014, 0.11), mRed, boot);
      bstrap.position.set(0.02, 0.026, 0);
      bstrap.rotation.z = -0.3;
      const ankle = mk(new THREE.CylinderGeometry(0.038, 0.042, 0.07, 12), mSkin, boot);
      ankle.position.set(-0.06, 0.06, 0);
      this.leg.push({
        thigh: mk(G.thigh, mSkin),
        shorts: mk(G.shorts, mShorts),
        shin: mk(G.shin, mSkin),
        knee: joint(0.057, mSkin),
        hipJ: joint(0.09, mShorts),
        foot: boot,
      });
    }

    // dynamic pose state
    this.stand = 0;
    this.leanBack = 0;
    this.leanFwd = 0;
    this.side = 0;
    this.crouch = 0;
    this.headYaw = 0;
    this.hip = new THREE.Vector3();
    this.chest = new THREE.Vector3();
    this.ragdoll = false;
    this._hl = new THREE.Vector3();
    this._hr = new THREE.Vector3();
    this._barQ = new THREE.Quaternion();
    this._skiQi = new THREE.Quaternion();
  }

  dispose() {
    this.group.traverse((o) => o.geometry && o.geometry.dispose());
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
  }

  place(mesh, a, b) {
    _a.subVectors(b, a);
    const len = _a.length();
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(UP, _a.multiplyScalar(1 / Math.max(len, 1e-5)));
    mesh.scale.set(1, len, 1);
  }

  // two-bone IK: returns mid joint position in `out`
  ik(root, target, l1, l2, pole, out) {
    _a.subVectors(target, root);
    let d = _a.length();
    const maxD = (l1 + l2) * 0.999;
    if (d > maxD) d = maxD;
    const dir = _a.normalize();
    const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const along = l1 * cosA;
    const perp = l1 * Math.sqrt(1 - cosA * cosA);
    // pole perpendicular to dir
    _b.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (_b.lengthSq() < 1e-6) _b.set(0, 1, 0);
    _b.normalize();
    out.copy(root).addScaledVector(dir, along).addScaledVector(_b, perp);
    return d;
  }

  // model: JetskiModel, ski: THREE.Group of the ski, s: {steer, lean, tele}
  update(dt, model, skiGroup, s) {
    if (this.ragdoll) return;
    const T = s.tele;
    const A = model.anchors;
    const speedK = smoothstep(4, 14, Math.abs(T.u));
    // pose targets
    const rough = clamp(Math.abs(T.impact || 0) * 0.08, 0, 1);
    const standT = clamp((T.airborne ? 0.75 : 0) + rough + (s.lean < -0.2 ? 0.55 : 0) + (s.lean > 0.2 ? 0.35 : 0) + speedK * 0.12 * s.sea, 0, 1);
    this.stand = damp(this.stand, standT, standT > this.stand ? 0.12 : 0.35, dt);
    this.leanBack = damp(this.leanBack, s.lean < 0 ? -s.lean : 0, 0.16, dt);
    this.leanFwd = damp(this.leanFwd, s.lean > 0 ? s.lean : 0, 0.16, dt);
    const sideT = clamp(s.steer * (0.35 + 0.65 * speedK) + T.gLat * 0.1 + Math.sign(s.steer) * (T.leanIn || 0) * 0.9, -1.8, 1.8);
    this.side = damp(this.side, sideT, 0.14, dt);
    this.headYaw = damp(this.headYaw, clamp(-s.steer * 0.5 - T.slip * 0.5, -0.9, 0.9), 0.15, dt);
    this.crouch = damp(this.crouch, clamp((T.gLong || 0) * 0.3, -0.3, 0.5), 0.2, dt);

    const st = this.stand;
    const lb = this.leanBack;
    const lf = this.leanFwd;
    const sd = this.side;
    const su = !!A.standup;
    this.sm = damp(this.sm || 0, s.superman || 0, 0.06, dt);
    const sm = this.sm;

    // hips
    const hip = this.hip;
    hip.copy(A.seat);
    let lean;
    let rollIn;
    if (su) {
      // stand-up: standing in the tray, knees soaking up the chop, the whole
      // body thrown into the turn
      hip.y -= rough * 0.12 + Math.min(Math.abs(sd), 1.8) * 0.06 + Math.max(this.crouch, 0) * 0.1;
      hip.x += -lb * 0.22 + lf * 0.08;
      hip.z += sd * 0.16;
      lean = 0.78 + lf * 0.25 - lb * 0.3 + clamp(T.pitch, -0.3, 1.2) * 0.5 + this.crouch;
      rollIn = sd * 0.55;
      // flipping: tucked up, knees to the chest, folded over the pole
      this.tk = damp(this.tk || 0, T.tuck || 0, 0.05, dt);
      hip.y -= this.tk * 0.3;
      hip.x += this.tk * 0.06;
      lean += (1.08 - lean) * this.tk * 0.7;
      rollIn *= 1 - this.tk;
    } else {
      hip.y += 0.1 + st * 0.2 + lb * 0.1 + lf * 0.06;
      hip.x += -st * 0.04 - lb * 0.3 + lf * 0.14;
      hip.z += sd * 0.12;
      hip.y -= Math.min(Math.abs(sd), 1.8) * 0.03;
      // torso lean (from vertical, forward positive), keep the rider's body more
      // world-upright when the ski stands on its tail
      lean = 0.42 + lf * 0.35 - lb * 0.1 + st * 0.12 + clamp(T.pitch, -0.3, 1.2) * 0.62 + this.crouch;
      rollIn = sd * 0.3;
      if (sm > 0.001) {
        // Superman: up off the seat, hanging on to the bars, body stretched
        // out flat behind them
        hip.x -= sm * 0.22;
        hip.y += sm * 0.3;
        lean += (1.45 - lean) * sm;
        rollIn *= 1 - sm;
      }
    }
    lean = clamp(lean, -0.1, su || sm > 0.001 ? 1.5 : 1.25);
    const chest = this.chest;
    _c.set(Math.sin(lean), Math.cos(lean) * Math.cos(rollIn), Math.cos(lean) * Math.sin(rollIn));
    chest.copy(hip).addScaledVector(_c, DIM.torso);

    // hands on the grips (model space)
    const hl = this._hl;
    const hr = this._hr;
    model.gripL.getWorldPosition(hl);
    model.gripR.getWorldPosition(hr);
    skiGroup.worldToLocal(hl);
    skiGroup.worldToLocal(hr);
    // if the bars are out of reach, fold the torso forward toward them
    const reach = DIM.upper + DIM.fore - 0.03;
    _a.addVectors(hl, hr).multiplyScalar(0.5);
    for (let it = 0; it < 3; it++) {
      const dx = _a.distanceTo(chest);
      const want = Math.sqrt(Math.max(reach * reach - DIM.shoulder * DIM.shoulder * 0.8, 0.01));
      if (dx > want) {
        _b.subVectors(_a, chest).normalize();
        chest.addScaledVector(_b, dx - want);
        _b.subVectors(chest, hip).normalize();
        chest.copy(hip).addScaledVector(_b, DIM.torso);
      }
    }

    // torso frame
    const up = _c.subVectors(chest, hip).normalize();
    const right = new THREE.Vector3(0, 0, 1);
    // twist the shoulders a little with the bars
    right.set(Math.sin(-s.steer * 0.22), 0, Math.cos(s.steer * 0.22));
    right.addScaledVector(up, -right.dot(up)).normalize();
    const fwd = new THREE.Vector3().crossVectors(up, right).normalize(); // up x right = forward (+X)
    // (Y up) x (Z right) = +X
    _m.makeBasis(fwd, up, right);
    this.torso.position.copy(hip);
    this.torso.quaternion.setFromRotationMatrix(_m);

    // head: look where we are going
    this.head.position.copy(chest).addScaledVector(up, DIM.neck + 0.03).addScaledVector(fwd, 0.015);
    {
      // (tucked in a flip, the head tips back to spot the landing)
      const headPitch = clamp(lean * 0.55 - clamp(T.pitch, -0.4, 1.0) * 0.5 - (this.tk || 0) * 0.75, -0.3 - (this.tk || 0) * 0.4, 0.6);
      const hq = this.head.quaternion;
      hq.setFromRotationMatrix(_m);
      _q.setFromAxisAngle(UP, this.headYaw);
      hq.multiply(_q);
      _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), headPitch);
      hq.multiply(_q);
    }

    // the bar's orientation in ski space, for the gloves
    model.gripR.parent.getWorldQuaternion(this._barQ);
    this._skiQi.copy(skiGroup.quaternion).invert();
    this._barQ.premultiply(this._skiQi);

    // arms
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? -1 : 1;
      const arm = this.arm[i];
      const sh = new THREE.Vector3().copy(chest).addScaledVector(right, sgn * DIM.shoulder).addScaledVector(up, -0.045);
      const grip = i === 0 ? hl : hr;
      // the wrist sits behind and above the bar, over the back of the hand
      const hand = new THREE.Vector3(-0.07, 0.035, 0).applyQuaternion(this._barQ).add(grip);
      const pole = new THREE.Vector3(-0.25, -0.75, sgn * 0.75);
      const el = new THREE.Vector3();
      this.ik(sh, hand, DIM.upper, DIM.fore, pole, el);
      // actual wrist position (clamped reach)
      _a.subVectors(hand, el).normalize();
      const wrist = new THREE.Vector3().copy(el).addScaledVector(_a, DIM.fore);
      this.place(arm.upper, sh, el);
      this.place(arm.sleeve, sh, el);
      this.place(arm.fore, el, wrist);
      const c0 = new THREE.Vector3().copy(wrist).addScaledVector(_a, -0.04);
      const c1 = new THREE.Vector3().copy(wrist).addScaledVector(_a, 0.0);
      this.place(arm.cuff, c0, c1);
      arm.shoulder.position.copy(sh);
      arm.elbow.position.copy(el);
      arm.glove.position.copy(grip);
      arm.glove.quaternion.copy(this._barQ);
    }

    // legs
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? -1 : 1;
      const leg = this.leg[i];
      const hj = new THREE.Vector3().copy(hip).addScaledVector(right, sgn * DIM.hip).addScaledVector(up, -0.02);
      const f0 = i === 0 ? A.footL : A.footR;
      const f1 = i === 0 ? A.footBackL : A.footBackR;
      const k = clamp(lb * 1.1 + (su ? 0 : st * 0.25), 0, 1);
      const foot = new THREE.Vector3().lerpVectors(f0, f1, k);
      foot.x -= lf * -0.06;
      if (sm > 0.01) {
        // Superman: legs straight out behind, off the back of the seat
        const out = new THREE.Vector3(hip.x - 0.92, hip.y + 0.05, hip.z + sgn * 0.12);
        foot.lerp(out, sm);
      }
      const ankle = new THREE.Vector3(foot.x - 0.05, foot.y + 0.07, foot.z);
      const pole = new THREE.Vector3(0.75, 0.75, sgn * 0.42);
      const kn = new THREE.Vector3();
      this.ik(hj, ankle, DIM.thigh, DIM.shin, pole, kn);
      _a.subVectors(ankle, kn).normalize();
      const an = new THREE.Vector3().copy(kn).addScaledVector(_a, DIM.shin);
      this.place(leg.thigh, hj, kn);
      this.place(leg.shorts, hj, kn);
      this.place(leg.shin, kn, an);
      leg.knee.position.copy(kn);
      leg.hipJ.position.copy(hj);
      leg.foot.position.set(an.x + 0.06 * (1 - sm), an.y - 0.045 * (1 - sm), an.z);
      leg.foot.rotation.set(0, 0, sm * 1.45);
    }
  }
}
