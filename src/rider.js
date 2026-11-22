// Procedural rider: helmet, life vest, wetsuit, gloves, boots. Posed every
// frame with two-bone IK so the hands stay on the grips and the feet in the
// wells while the body shifts weight for turns, wheelies and landings.

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

// Life vest: u = 0 (and 1) is the front centre, v runs up the body.
function vestTexture(trim) {
  return makeCanvasTex(512, 256, (g, w, h) => {
    const Y = (v) => h * (1 - v);
    g.fillStyle = hex(trim);
    g.fillRect(0, 0, w, h);
    // black side panels and shoulders
    g.fillStyle = '#121418';
    g.fillRect(w * 0.19, 0, w * 0.12, h);
    g.fillRect(w * 0.69, 0, w * 0.12, h);
    g.fillRect(0, 0, w, Y(0.86));
    g.fillRect(0, Y(0.07), w, h);
    // panel seams
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 3;
    for (const x of [0.12, 0.38, 0.62, 0.88]) {
      g.beginPath();
      g.moveTo(w * x, Y(0.07));
      g.lineTo(w * x, Y(0.86));
      g.stroke();
    }
    // front zip
    g.fillStyle = '#0b0c0e';
    g.fillRect(0, 0, w * 0.012, h);
    g.fillRect(w * 0.988, 0, w * 0.012, h);
    // three straps with buckles across the front
    for (const v of [0.2, 0.42, 0.64]) {
      g.fillStyle = '#16181c';
      g.fillRect(0, Y(v + 0.035), w * 0.17, h * 0.07);
      g.fillRect(w * 0.83, Y(v + 0.035), w * 0.17, h * 0.07);
      g.fillStyle = '#c9ced4';
      g.fillRect(w * 0.035, Y(v + 0.05), w * 0.05, h * 0.1);
      g.fillStyle = '#5c6168';
      g.fillRect(w * 0.045, Y(v + 0.025), w * 0.03, h * 0.05);
    }
    // brand on the back and a small one on the chest
    g.save();
    g.fillStyle = '#ffffff';
    g.font = 'italic 900 44px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SEA-DOO', w * 0.5, Y(0.55));
    g.font = 'italic 800 20px "Arial Black", Arial, sans-serif';
    g.fillText('SEA-DOO', w * 0.9, Y(0.8));
    g.restore();
  });
}

function shortsTexture(trim) {
  return makeCanvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#1a1d22';
    g.fillRect(0, 0, w, h);
    g.fillStyle = hex(trim);
    g.globalAlpha = 0.9;
    // angular print down each side
    for (const x0 of [0.22, 0.72]) {
      g.beginPath();
      g.moveTo(w * (x0 - 0.05), 0);
      g.lineTo(w * (x0 + 0.06), 0);
      g.lineTo(w * (x0 + 0.02), h);
      g.lineTo(w * (x0 - 0.09), h);
      g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#0d0f12';
    g.fillRect(0, 0, w, h * 0.08);
  });
}

// MX helmet shell. Sphere UVs: u = 0.5 faces +X (forward), v = 0 is the top.
function helmetTexture(base, trim) {
  return makeCanvasTex(512, 256, (g, w, h) => {
    g.fillStyle = hex(base);
    g.fillRect(0, 0, w, h);
    // swooping accent stripes
    g.fillStyle = hex(trim);
    for (const s of [1, -1]) {
      g.beginPath();
      const cx = w * 0.5;
      g.moveTo(cx + s * w * 0.06, h * 0.1);
      g.quadraticCurveTo(cx + s * w * 0.22, h * 0.22, cx + s * w * 0.42, h * 0.58);
      g.lineTo(cx + s * w * 0.36, h * 0.62);
      g.quadraticCurveTo(cx + s * w * 0.18, h * 0.3, cx + s * w * 0.02, h * 0.16);
      g.fill();
    }
    g.fillRect(w * 0.47, 0, w * 0.06, h * 0.32);
    // black lower edge
    g.fillStyle = '#121418';
    g.fillRect(0, h * 0.8, w, h * 0.2);
    // number on the back
    g.fillStyle = '#121418';
    g.font = 'italic 900 64px "Arial Black", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('7', w * 0.0 + 30, h * 0.42);
    g.fillText('7', w - 30, h * 0.42);
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
    const darkTrim = new THREE.Color(trim).getHSL({}).l < 0.25;
    const helmetBase = darkTrim ? 0xeff2f5 : 0x15171b;
    const mSuit = M({ color: 0x15171a, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0x30343a), sheenRoughness: 0.6 });
    const mShorts = M({ map: tex(shortsTexture(trim)), roughness: 0.85, side: THREE.DoubleSide });
    const vt = tex(vestTexture(trim));
    vt.repeat.x = -1; // the loft runs round the body the other way: unmirror the print
    const mVest = M({ map: vt, roughness: 0.6, clearcoat: 0.15 });
    const mGlove = M({ color: 0x0c0d0f, roughness: 0.75, side: THREE.DoubleSide });
    const mGloveAcc = M({ color: trim, roughness: 0.5 });
    const mBoot = M({ color: 0x111216, roughness: 0.7 });
    const mSole = M({ color: 0x050506, roughness: 0.95 });
    const mHelmet = M({ map: tex(helmetTexture(helmetBase, trim)), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 });
    const mHelmetPlain = M({ color: helmetBase, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 });
    const mAcc = M({ color: trim, roughness: 0.25, clearcoat: 1 });
    const mBlack = M({ color: 0x0b0c0e, roughness: 0.6 });
    const mLens = M({ color: 0xff8a3d, metalness: 1, roughness: 0.1, clearcoat: 1, side: THREE.DoubleSide });

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

    // --- head: MX helmet with goggles ---------------------------------------
    this.head = new THREE.Group();
    this.group.add(this.head);
    const neck = mk(new THREE.CylinderGeometry(0.052, 0.06, 0.11, 12), mSuit, this.head);
    neck.position.y = -0.06;
    const shell = mk(new THREE.SphereGeometry(0.135, 32, 22), mHelmet, this.head);
    shell.scale.set(1.13, 1.0, 0.95);
    shell.position.set(-0.005, 0.072, 0);
    // chin bar sticking forward
    const chin = mk(new THREE.SphereGeometry(0.1, 22, 14), mHelmetPlain, this.head);
    chin.scale.set(1.2, 0.58, 0.82);
    chin.position.set(0.095, -0.012, 0);
    const vent = mk(new THREE.BoxGeometry(0.03, 0.045, 0.07), mBlack, this.head);
    vent.position.set(0.205, -0.012, 0);
    for (const s of [-1, 1]) {
      const sv = mk(new THREE.BoxGeometry(0.02, 0.012, 0.03), mAcc, this.head);
      sv.position.set(0.19, -0.04, s * 0.05);
    }
    // eye port, goggle frame and mirrored lens
    const port = mk(new THREE.CylinderGeometry(0.136, 0.136, 0.07, 28, 1, true, 0.62, 1.9), mBlack, this.head);
    port.scale.set(1.12, 1, 0.96);
    port.position.set(-0.004, 0.068, 0);
    const frame = mk(new THREE.CylinderGeometry(0.141, 0.141, 0.062, 28, 1, true, 0.72, 1.7), mBlack, this.head);
    frame.scale.set(1.13, 1, 0.98);
    frame.position.set(-0.002, 0.068, 0);
    const lens = mk(new THREE.CylinderGeometry(0.1435, 0.1435, 0.046, 28, 1, true, 0.8, 1.54), mLens, this.head);
    lens.scale.set(1.13, 1, 0.98);
    lens.position.set(-0.002, 0.068, 0);
    const strap = mk(new THREE.TorusGeometry(0.138, 0.009, 6, 36), mAcc, this.head);
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(1.13, 0.96, 1);
    strap.position.set(-0.008, 0.068, 0);
    // peak: a gently curved plate over the eye port
    {
      const pg = new THREE.BoxGeometry(0.17, 0.008, 0.22, 6, 1, 8);
      const pa = pg.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i);
        const z = pa.getZ(i);
        pa.setY(i, pa.getY(i) - z * z * 1.6 + (x + 0.085) * 0.12);
      }
      pg.computeVertexNormals();
      const peak = mk(pg, mHelmet, this.head);
      peak.position.set(0.13, 0.168, 0);
      peak.rotation.z = 0.1;
    }

    // --- limbs ----------------------------------------------------------------
    const G = {
      upper: limbGeo([[0, 0.054], [0.12, 0.058], [0.4, 0.056], [0.75, 0.047], [1, 0.042]]),
      fore: limbGeo([[0, 0.044], [0.18, 0.05], [0.5, 0.044], [0.85, 0.035], [1, 0.033]]),
      thigh: limbGeo([[0, 0.084], [0.2, 0.09], [0.55, 0.08], [0.85, 0.062], [1, 0.058]]),
      shorts: limbGeo([[0, 0.096], [0.3, 0.098], [0.58, 0.092], [0.6, 0.08]]),
      shin: limbGeo([[0, 0.056], [0.25, 0.062], [0.55, 0.05], [0.85, 0.041], [1, 0.039]]),
      cuff: limbGeo([[0, 0.04], [0.2, 0.046], [1, 0.044]]),
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
      // glove: fingers wrapped round the grip (grip axis = Z), back of hand
      // on top, thumb underneath
      const glove = new THREE.Group();
      this.group.add(glove);
      const fg = new THREE.CylinderGeometry(0.031, 0.031, 0.088, 18, 1, true, -1.0, 5.4);
      fg.rotateX(Math.PI / 2);
      mk(fg, mGlove, glove);
      for (const z of [-0.03, -0.01, 0.01, 0.03]) {
        const kn = mk(new THREE.TorusGeometry(0.031, 0.0085, 6, 14, 3.6), mGlove, glove);
        kn.position.z = z;
        kn.rotation.z = -1.4;
      }
      const back = mk(new THREE.SphereGeometry(0.05, 14, 10), mGlove, glove);
      back.scale.set(0.95, 0.55, 0.95);
      back.position.set(-0.032, 0.03, 0);
      back.rotation.z = 0.7;
      const knuckle = mk(new THREE.BoxGeometry(0.05, 0.012, 0.075), mGloveAcc, glove);
      knuckle.position.set(-0.012, 0.046, 0);
      knuckle.rotation.z = 0.5;
      const thumb = mk(new THREE.CapsuleGeometry(0.011, 0.04, 4, 8), mGlove, glove);
      thumb.position.set(-0.022, -0.03, (i === 0 ? 1 : -1) * 0.045);
      thumb.rotation.set(Math.PI / 2, 0, 0.9);
      this.arm.push({
        upper: mk(G.upper, mSuit),
        fore: mk(G.fore, mSuit),
        cuff: mk(G.cuff, mGlove),
        shoulder: joint(0.064, mSuit, 1.1),
        elbow: joint(0.045, mSuit),
        glove,
      });
      // boot
      const boot = new THREE.Group();
      this.group.add(boot);
      const sole = mk(new THREE.BoxGeometry(0.29, 0.03, 0.112), mSole, boot);
      sole.position.set(0.0, -0.033, 0);
      const upper = mk(new THREE.CapsuleGeometry(0.047, 0.17, 4, 12), mBoot, boot);
      upper.rotation.z = Math.PI / 2;
      upper.scale.set(0.82, 1, 1.08);
      upper.position.set(0.01, 0.006, 0);
      const shaft = mk(new THREE.CylinderGeometry(0.048, 0.054, 0.13, 14), mBoot, boot);
      shaft.position.set(-0.07, 0.05, 0);
      const bstrap = mk(new THREE.BoxGeometry(0.06, 0.018, 0.118), mGloveAcc, boot);
      bstrap.position.set(0.03, 0.04, 0);
      bstrap.rotation.z = -0.35;
      this.leg.push({
        thigh: mk(G.thigh, mSuit),
        shorts: mk(G.shorts, mShorts),
        shin: mk(G.shin, mSuit),
        knee: joint(0.06, mSuit),
        hipJ: joint(0.088, mShorts),
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
      // Superman: hips up and back, body stretched out flat over the pole
      hip.x -= sm * 0.12;
      hip.y += sm * 0.3;
      lean = lean + (1.42 - lean) * sm;
      rollIn *= 1 - sm;
    } else {
      hip.y += 0.1 + st * 0.2 + lb * 0.1 + lf * 0.06;
      hip.x += -st * 0.04 - lb * 0.3 + lf * 0.14;
      hip.z += sd * 0.12;
      hip.y -= Math.min(Math.abs(sd), 1.8) * 0.03;
      // torso lean (from vertical, forward positive), keep the rider's body more
      // world-upright when the ski stands on its tail
      lean = 0.42 + lf * 0.35 - lb * 0.1 + st * 0.12 + clamp(T.pitch, -0.3, 1.2) * 0.62 + this.crouch;
      rollIn = sd * 0.3;
    }
    lean = clamp(lean, -0.1, su ? 1.5 : 1.25);
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
      const headPitch = clamp(lean * 0.55 - clamp(T.pitch, -0.4, 1.0) * 0.5, -0.3, 0.6);
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
      this.place(arm.fore, el, wrist);
      const c0 = new THREE.Vector3().copy(wrist).addScaledVector(_a, -0.075);
      const c1 = new THREE.Vector3().copy(wrist).addScaledVector(_a, 0.025);
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
      if (su && sm > 0.01) {
        // Superman: legs straight out behind, off the tray
        const out = new THREE.Vector3(hip.x - 0.92, hip.y + 0.04, hip.z + sgn * 0.1);
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
      leg.foot.rotation.set(0, 0, su ? sm * 1.45 : 0);
    }
  }
}
