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

// ellipse-section body loft along +Y
function bodyLoft(sections, colorFn) {
  const seg = 20;
  const pos = [];
  const col = [];
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
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function limbGeo(r0, r1) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, 12, 1);
  g.translate(0, 0.5, 0);
  return g;
}

export class Rider {
  constructor(colorway) {
    this.group = new THREE.Group();
    this.mats = [];
    const M = (o) => {
      const m = new THREE.MeshPhysicalMaterial({ roughness: 0.7, ...o });
      this.mats.push(m);
      return m;
    };
    const vestCol = new THREE.Color(colorway.trim);
    const mSuit = M({ color: 0x121417, roughness: 0.62 });
    const mShorts = M({ color: 0x1b1e23, roughness: 0.85 });
    const mVest = M({ color: 0xffffff, vertexColors: true, roughness: 0.6 });
    const mGlove = M({ color: 0x0b0c0d, roughness: 0.8 });
    const mBoot = M({ color: 0x0d0e10, roughness: 0.75 });
    const mHelmet = M({ color: 0xf2f4f6, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 });
    const mHelmetAcc = M({ color: colorway.trim, roughness: 0.2, clearcoat: 1 });
    const mVisor = M({ color: 0x050608, roughness: 0.05, metalness: 0.6, clearcoat: 1 });
    const mSkin = M({ color: 0xc58a62, roughness: 0.6 });

    const mk = (geo, mat, parent = this.group) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // torso (oriented hip -> chest along +Y, front = +X)
    this.torso = new THREE.Group();
    this.group.add(this.torso);
    const T = DIM.torso;
    mk(
      bodyLoft([
        [-0.1, 0.085, 0.13],
        [-0.03, 0.105, 0.165],
        [0.08, 0.1, 0.155],
        [0.2, 0.1, 0.15],
        [0.34, 0.115, 0.175],
        [T - 0.05, 0.11, 0.19],
        [T + 0.02, 0.085, 0.16],
        [T + 0.06, 0.05, 0.07],
      ]),
      mSuit,
      this.torso
    );
    const cBlack = new THREE.Color(0x111316);
    const cWhite = new THREE.Color(0xe9edf0);
    mk(
      bodyLoft(
        [
          [0.1, 0.115, 0.165],
          [0.14, 0.132, 0.178],
          [0.3, 0.15, 0.2],
          [T - 0.07, 0.148, 0.212],
          [T - 0.01, 0.125, 0.19],
          [T + 0.025, 0.09, 0.135],
        ],
        (v, a, c, y) => {
          const side = Math.abs(Math.sin(a));
          c.copy(vestCol);
          if (side > 0.86) c.copy(cBlack);
          if (y > 0.2 && y < 0.24) c.copy(cBlack);
          if (y > 0.33 && y < 0.36 && side < 0.8) c.copy(cWhite);
          if (y > T - 0.03) c.copy(cBlack);
        }
      ),
      mVest,
      this.torso
    );
    // shorts over the hips
    mk(
      bodyLoft([
        [-0.12, 0.09, 0.14],
        [-0.04, 0.115, 0.175],
        [0.07, 0.108, 0.165],
      ]),
      mShorts,
      this.torso
    );

    // head
    this.head = new THREE.Group();
    this.group.add(this.head);
    const neck = mk(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), mSkin, this.head);
    neck.position.y = -0.06;
    const shell = mk(new THREE.SphereGeometry(0.132, 24, 18), mHelmet, this.head);
    shell.scale.set(1.12, 1.0, 0.94);
    shell.position.set(0.0, 0.07, 0);
    const chin = mk(new THREE.SphereGeometry(0.1, 18, 12), mHelmet, this.head);
    chin.scale.set(1.0, 0.62, 0.9);
    chin.position.set(0.075, -0.01, 0);
    const visor = mk(new THREE.SphereGeometry(0.134, 24, 12, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.27), mVisor, this.head);
    visor.scale.set(1.13, 1.0, 0.95);
    visor.position.set(0.004, 0.07, 0);
    // only the front of the visor band should read as dark: cover the back with a shell stripe
    const back = mk(new THREE.SphereGeometry(0.136, 24, 12, Math.PI * 0.5 + 0.9, Math.PI * 2 - 1.8, Math.PI * 0.3, Math.PI * 0.32), mHelmet, this.head);
    back.scale.set(1.12, 1.0, 0.95);
    back.position.set(0.0, 0.07, 0);
    const stripe = mk(new THREE.TorusGeometry(0.128, 0.012, 6, 28, Math.PI), mHelmetAcc, this.head);
    stripe.rotation.set(0, 0, 0);
    stripe.scale.set(1.14, 1.04, 1);
    stripe.position.set(0, 0.075, 0);
    const peakG = new THREE.BoxGeometry(0.14, 0.012, 0.19);
    const peak = mk(peakG, mHelmetAcc, this.head);
    peak.position.set(0.15, 0.15, 0);
    peak.rotation.z = -0.25;

    // limbs
    const seg = (r0, r1, mat) => mk(limbGeo(r0, r1), mat);
    const joint = (r, mat) => mk(new THREE.SphereGeometry(r, 12, 10), mat);
    this.arm = [];
    this.leg = [];
    for (let i = 0; i < 2; i++) {
      this.arm.push({
        upper: seg(0.052, 0.043, mSuit),
        fore: seg(0.042, 0.034, mSuit),
        shoulder: joint(0.062, mSuit),
        elbow: joint(0.044, mSuit),
        hand: mk(new THREE.BoxGeometry(0.1, 0.05, 0.085), mGlove),
      });
      this.leg.push({
        thigh: seg(0.082, 0.06, mShorts),
        shin: seg(0.056, 0.042, mSuit),
        knee: joint(0.062, mSuit),
        hipJ: joint(0.085, mShorts),
        foot: mk(new THREE.BoxGeometry(0.26, 0.085, 0.1), mBoot),
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
  }

  dispose() {
    this.group.traverse((o) => o.geometry && o.geometry.dispose());
    for (const m of this.mats) m.dispose();
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
    const sideT = clamp(s.steer * (0.35 + 0.65 * speedK) + T.gLat * 0.1, -1, 1);
    this.side = damp(this.side, sideT, 0.14, dt);
    this.headYaw = damp(this.headYaw, clamp(-s.steer * 0.5 - T.slip * 0.5, -0.9, 0.9), 0.15, dt);
    this.crouch = damp(this.crouch, clamp((T.gLong || 0) * 0.3, -0.3, 0.5), 0.2, dt);

    const st = this.stand;
    const lb = this.leanBack;
    const lf = this.leanFwd;
    const sd = this.side;

    // hips
    const hip = this.hip;
    hip.copy(A.seat);
    hip.y += 0.1 + st * 0.2 + lb * 0.1 + lf * 0.06;
    hip.x += -st * 0.04 - lb * 0.3 + lf * 0.14;
    hip.z += sd * 0.13;

    // torso lean (from vertical, forward positive), keep the rider's body more
    // world-upright when the ski stands on its tail
    let lean = 0.42 + lf * 0.35 - lb * 0.1 + st * 0.12 + clamp(T.pitch, -0.3, 1.2) * 0.62 + this.crouch;
    lean = clamp(lean, -0.1, 1.25);
    const rollIn = sd * 0.32;
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

    // arms
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? -1 : 1;
      const arm = this.arm[i];
      const sh = new THREE.Vector3().copy(chest).addScaledVector(right, sgn * DIM.shoulder).addScaledVector(up, -0.045);
      const hand = i === 0 ? hl : hr;
      const pole = new THREE.Vector3(-0.25, -0.75, sgn * 0.75);
      const el = new THREE.Vector3();
      this.ik(sh, hand, DIM.upper, DIM.fore, pole, el);
      // actual wrist position (clamped reach)
      _a.subVectors(hand, el).normalize();
      const wrist = new THREE.Vector3().copy(el).addScaledVector(_a, DIM.fore);
      this.place(arm.upper, sh, el);
      this.place(arm.fore, el, wrist);
      arm.shoulder.position.copy(sh);
      arm.elbow.position.copy(el);
      arm.hand.position.copy(hand);
      arm.hand.quaternion.copy(model.steer.quaternion);
    }

    // legs
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? -1 : 1;
      const leg = this.leg[i];
      const hj = new THREE.Vector3().copy(hip).addScaledVector(right, sgn * DIM.hip).addScaledVector(up, -0.02);
      const f0 = i === 0 ? A.footL : A.footR;
      const f1 = i === 0 ? A.footBackL : A.footBackR;
      const k = clamp(lb * 1.1 + st * 0.25, 0, 1);
      const foot = new THREE.Vector3().lerpVectors(f0, f1, k);
      foot.x -= lf * -0.06;
      const ankle = new THREE.Vector3(foot.x - 0.05, foot.y + 0.07, foot.z);
      const pole = new THREE.Vector3(0.75, 0.75, sgn * 0.42);
      const kn = new THREE.Vector3();
      this.ik(hj, ankle, DIM.thigh, DIM.shin, pole, kn);
      _a.subVectors(ankle, kn).normalize();
      const an = new THREE.Vector3().copy(kn).addScaledVector(_a, DIM.shin);
      this.place(leg.thigh, hj, kn);
      this.place(leg.shin, kn, an);
      leg.knee.position.copy(kn);
      leg.hipJ.position.copy(hj);
      leg.foot.position.set(an.x + 0.06, an.y - 0.045, an.z);
      leg.foot.rotation.set(0, 0, 0);
    }
  }
}
