// Online riding: two lobbies, each a named room. Every rider shares their
// ski's state as presence (12-15 times a second, compactly), and everyone
// else draws them smoothly a moment in the past so jitter never shows.
// Nothing is kept: when you leave, you are gone.
//
// Inside the claude.ai viewer this rides on its `room` capability (signed-in
// people who can open the page). Anywhere else (e.g. on Vercel) it uses a
// Firebase Realtime Database when src/firebase-config.js has a config;
// without one the game stays solo.

import { mapById } from './maps.js';
import * as THREE from 'three';
import { JetskiModel } from './jetski.js';
import { Rider } from './rider.js';
import { skiById } from './specs.js';
import { clamp, smoothstep } from './util.js';
import { makeFakeRoom } from './fakeroom.js';
import { FIREBASE_CONFIG } from './firebase-config.js';
import { firebase } from './fbapp.js';
import { JetStream } from './jetstream.js';
import { itemOf, skiLook, applyFinish, riderLook } from './cosmetics.js';
import { addFlair } from './flair.js';
import { DEFAULT_WORLD, cleanWorld, sign, verify } from './world.js';
import { SEA_STATES } from './waves.js';

export const LOBBIES = [
  { id: 'lobby-1', name: 'Lobby 1' },
  { id: 'lobby-2', name: 'Lobby 2' },
];
export const MAX_PER_LOBBY = 16;
const SEND_HZ = 15;
const DELAY = 0.12; // seconds behind real time that remote riders are drawn
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const cleanChat = (s) => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, '').trim().slice(0, 16);

const rx0 = (s) => (Number.isFinite(s.rx) ? clamp(s.rx, 1, 2.5) : 1);

class Remote {
  constructor(mp, peer) {
    this.mp = mp;
    this.peer = peer;
    this.samples = [];
    this.group = new THREE.Group();
    this.skiId = null;
    this.cw = -1;
    this.name = 'Rider';
    this.score = 0;
    this.trickI = -1;
    this.wasAir = false;
    this.lastVy = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.state = null;
    this.frame = 0;
    this.shadow = true;
    this.tag = document.createElement('div');
    this.tag.className = 'tag';
    this.tagName = document.createElement('b');
    this.tagDist = document.createElement('span');
    this.tag.append(this.tagName, this.tagDist);
    mp.tagRoot.appendChild(this.tag);
    mp.game.scene.add(this.group);
    this.acc = 0;
    // their jet and pump wash, the same real streams of water as your own
    const u = mp.game.spray.uniforms;
    // their stream a touch fuller than your own (you see it from further away)
    this.jet = new JetStream(u, { wide: 1.2 });
    this.wash = new JetStream(u, { wide: 1.7, sheath: 1.45 });
    mp.game.scene.add(this.jet.mesh, this.wash.mesh);
  }

  // their ski, colourway and style (wrap, outfit, jet colour)
  setLook(skiId, cw, cs) {
    const spec = skiById(skiId);
    const cwI = clamp(cw | 0, 0, spec.colorways.length - 1);
    const st = cs && typeof cs === 'object' ? cs : {};
    const wrap = typeof st.wrap === 'string' && itemOf('wrap', st.wrap) ? st.wrap : '';
    const fit = typeof st.fit === 'string' && itemOf('fit', st.fit) ? st.fit : '';
    const jetI = typeof st.jet === 'string' ? itemOf('jet', st.jet) : null;
    const gold = !!wrap && itemOf('wrap', wrap).flair === 'barsa';
    const jetKey = (jetI ? jetI.id : '') + (gold ? '|gold' : '');
    if (jetKey !== this.jetKey) {
      this.jetKey = jetKey;
      this.jet.setTint(jetI ? jetI.color : gold ? 0xffc531 : null);
    }
    const tag = typeof st.tag === 'string' ? itemOf('tag', st.tag) : null;
    this.tagColor = tag ? tag.color : '';
    const key = spec.id + '|' + cwI + '|' + wrap + '|' + fit;
    if (key === this.lookKey) return;
    this.lookKey = key;
    this.dispose(true);
    this.skiId = spec.id;
    this.cw = cwI;
    this.spec = spec;
    const look = skiLook(spec, cwI, wrap);
    this.model = new JetskiModel(spec, look.cw);
    applyFinish(this.model.group, look.finish, look.cw);
    if (this.flair) this.flair.dispose();
    this.flair = addFlair(this.model, look, spec, this.mp.game.scene);
    this.rider = new Rider(riderLook(look.cw, fit));
    this.group.add(this.model.group, this.rider.group);
    this.applyEnv();
  }

  applyEnv() {
    const k = this.mp.game.sky.time.ambient * 1.05;
    this.group.traverse((o) => {
      if (o.material && 'envMapIntensity' in o.material) o.material.envMapIntensity = k;
    });
  }

  setShadow(on) {
    if (on === this.shadow) return;
    this.shadow = on;
    this.group.traverse((o) => {
      if (o.isMesh) o.castShadow = on;
    });
  }

  push(p) {
    const s = p.presence;
    if (!s || !Array.isArray(s.p) || !Array.isArray(s.q)) return;
    const ok = (a, n) => a.length === n && a.every((v) => Number.isFinite(v));
    if (!ok(s.p, 3) || !ok(s.q, 4) || (s.u && !ok(s.u, 3))) return;
    if (Math.abs(s.p[0]) > 3000 || Math.abs(s.p[2]) > 3000 || Math.abs(s.p[1]) > 200) return;
    this.setLook(typeof s.k === 'string' ? s.k : 'trixx', s.c, s.cs);
    this.lv = Number.isInteger(s.lv) ? clamp(s.lv, 1, 50) : 0;
    this.pr = Number.isInteger(s.pr) ? clamp(s.pr, 0, 10) : 0;
    this.cr = Number.isInteger(s.cr) ? clamp(s.cr, 0, 3) : 0;
    this.name = cleanName(s.n) || this.mp.profileName(p.by) || 'Rider';
    this.score = Number.isFinite(s.sc) ? Math.max(0, Math.min(1e8, s.sc | 0)) : 0;
    // Samples go on the local clock that sample() is called with
    // (performance.now). Spaced by the sender's own timestamps, so network
    // bunching does not show, with the sender-to-local offset tracked (it
    // snaps down to the fastest delivery seen, creeps up slowly, and resets
    // if the sender's clock jumps).
    const recv = performance.now() / 1000;
    let t = recv;
    if (Number.isFinite(s.t)) {
      const off = recv - s.t / 1000;
      if (this.off === undefined || off < this.off || Math.abs(off - this.off) > 1) this.off = off;
      else this.off += (off - this.off) * 0.02;
      t = s.t / 1000 + this.off;
    }
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) return;
    this.samples.push({ t, s });
    if (this.samples.length > 6) this.samples.shift();
    this.state = s;
    // a new trick in their feed (whatever they had before we arrived is old news)
    const ti = s.tk && Number.isFinite(s.tk.i) ? s.tk.i : 0;
    if (this.trickI < 0) this.trickI = ti;
    else if (ti !== this.trickI) {
      this.trickI = ti;
      if (s.tk) this.mp.feed(this.name, cleanName(s.tk.l).slice(0, 28), Math.max(0, s.tk.p | 0));
    }
  }

  // where they are at local time `now` (seconds), drawn DELAY behind
  sample(now) {
    const S = this.samples;
    if (!S.length) return false;
    const rt = now - DELAY;
    let a = S[0];
    let b = null;
    for (let i = 0; i < S.length; i++) {
      if (S[i].t <= rt) a = S[i];
      else {
        b = S[i];
        break;
      }
    }
    const sa = a.s;
    if (b && b.t > a.t) {
      const k = clamp((rt - a.t) / (b.t - a.t), 0, 1);
      const sb = b.s;
      this.pos.set(sa.p[0] + (sb.p[0] - sa.p[0]) * k, sa.p[1] + (sb.p[1] - sa.p[1]) * k, sa.p[2] + (sb.p[2] - sa.p[2]) * k);
      this.quat.set(sa.q[0], sa.q[1], sa.q[2], sa.q[3]).normalize();
      const qb = new THREE.Quaternion(sb.q[0], sb.q[1], sb.q[2], sb.q[3]).normalize();
      this.quat.slerp(qb, k);
      if (sa.u && sb.u) this.vel.set(sa.u[0] + (sb.u[0] - sa.u[0]) * k, sa.u[1] + (sb.u[1] - sa.u[1]) * k, sa.u[2] + (sb.u[2] - sa.u[2]) * k);
    } else {
      // past the newest sample: carry on along their velocity for a moment
      const ex = clamp(rt - a.t, 0, 0.35);
      const u = sa.u || [0, 0, 0];
      this.vel.set(u[0], u[1], u[2]);
      this.pos.set(sa.p[0] + u[0] * ex, sa.p[1] + u[1] * ex * 0.5, sa.p[2] + u[2] * ex);
      this.quat.set(sa.q[0], sa.q[1], sa.q[2], sa.q[3]).normalize();
    }
    return true;
  }

  update(dt, now, camPos, budget) {
    // riders on another map are in another world: not drawn here
    if (!this.model || !this.sample(now) || (this.state.m || 'bay') !== this.mp.game.mapId) {
      this.group.visible = false;
      this.tag.hidden = true;
      if (this.flair) this.flair.hide();
      if (this.jet) {
        this.jet.clear();
        this.wash.clear();
      }
      return;
    }
    const s = this.state;
    const dist = this.pos.distanceTo(camPos);
    const far = dist > 1800;
    this.group.visible = !far;
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.quat);
    if (this.flair) {
      const surfAt = this.mp.game._surfAt;
      if (far || !surfAt) this.flair.hide();
      else {
        const hx = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
        this.flair.update(now, this.pos.x, surfAt(this.pos.x, this.pos.z), this.pos.z, this.pos.y, Math.atan2(-hx.z, hx.x));
      }
    }
    this.frame++;
    if (far) return;
    const wiped = !!s.w;
    this.rider.group.visible = !wiped && dist < 420;
    // telemetry-shaped state for the model and rider poses
    const fx = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);
    const ux = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const tele = {
      steerAngle: (s.st || 0) * this.spec.steerMax,
      trimAngle: s.tr || 0,
      reverse: s.f & 1 ? 1 : 0,
      u: this.vel.x * fx.x + this.vel.z * fx.z,
      pitch: Math.asin(clamp(fx.y, -1, 1)),
      slip: 0,
      gLat: 0,
      gLong: 0,
      airborne: !!s.a,
      impact: 0,
      leanIn: s.li || 0,
      uy: ux.y,
      tuck: clamp(s.tu || 0, 0, 1),
    };
    this.model.update(tele, dt);
    // full rider IK up close, every few frames further out
    if (this.rider.group.visible && (dist < 90 || this.frame % 4 === 0)) {
      this.group.updateMatrixWorld(true);
      this.rider.update(dist < 90 ? dt : dt * 4, this.model, this.group, { steer: s.st || 0, lean: s.ln || 0, tele, sea: 0.5, superman: clamp(s.sm || 0, 0, 1) });
    }
    this.effects(dt, s, tele, dist, speed, budget);
  }

  // a light version of the local spray: their jet / rooster tail, wake foam
  // and landing splashes, only near the camera and within a shared budget
  effects(dt, s, tele, dist, speed, budget) {
    const g = this.mp.game;
    const air = !!s.a;
    if (this.wasAir && !air && this.lastVy < -3 && dist < 200) {
      const im = Math.min(-this.lastVy, 12);
      const n = Math.round(Math.min(220, im * 22) * budget);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28;
        const sp = 1.5 + im * (0.25 + Math.random() * 0.4);
        g.spray.emit(this.pos.x + Math.cos(a), this.pos.y - 0.2, this.pos.z + Math.sin(a), Math.cos(a) * sp + this.vel.x * 0.5, 1.5 + im * (0.25 + Math.random() * 0.5), Math.sin(a) * sp + this.vel.z * 0.5, 0.8 + Math.random(), 0.07 + Math.random() * 0.06, 0.3 + Math.random() * 0.4, 1, 0.4, 0.85, 0.15);
      }
    }
    this.wasAir = air;
    this.lastVy = this.vel.y;
    const power = clamp(s.pw || 0, 0, 1);
    const surf = g._surfAt;
    if (dist < 260 && !s.w && power > 0.03 && !(s.f & 1) && this.model && surf) {
      const exit = this._exit || (this._exit = new THREE.Vector3());
      this.model.nozzleExit.getWorldPosition(exit);
      const q = this._q || (this._q = new THREE.Quaternion());
      this.model.nozzlePitch.getWorldQuaternion(q);
      const jd = (this._jd || (this._jd = new THREE.Vector3())).set(-1, 0, 0).applyQuaternion(q);
      const trimK = clamp(jd.y * 3, 0, 1);
      // how much is out in the air and how much boils up as wash: sent by
      // their game (older versions: worked out from the nozzle)
      const jo = Number.isFinite(s.jo) ? clamp(s.jo, 0, 1) : power * (air ? 1 : clamp(0.35 + jd.y * 3, 0.15, 1));
      const jw = Number.isFinite(s.jw) ? clamp(s.jw, 0, 1) : air ? 0 : power * 0.6;
      const vj = this.spec.jet * (0.5 + 0.5 * power) * (1 + (rx0(s) - 1) * 0.22);
      // a TRIM-X kit on their ski: a taller rooster tail
      const rx = Number.isFinite(s.rx) ? clamp(s.rx, 1, 2.5) : 1;
      // trimmed right up in its own range (as on your own ski)
      const trimN = clamp((s.tr || 0) / Math.max(this.spec.trimUp, s.tr || 0, 1e-3), 0, 1);
      const trimLift = Math.max(0, trimN - trimK) * 0.5;
      const ly = jd.y * (1 + trimK * 1.25) + (air ? 0 : 0.08 + 0.2 * trimK) * (1 - jo) + (rx - 1) * 0.4 * trimK + trimLift * (1 - jo * 0.5);
      const ll = Math.hypot(jd.x, ly, jd.z) || 1;
      const wy = surf(exit.x, exit.z);
      this.jet.feed(dt, exit.x, Math.max(exit.y, wy + 0.02), exit.z, this.vel.x, this.vel.y, this.vel.z, jd.x / ll, ly / ll, jd.z / ll, vj * (0.5 + 0.5 * jo / Math.max(power, 0.05)), Math.min(1, jo * 1.3), (0.8 + 0.5 * (1 - clamp(jo / Math.max(power, 0.05), 0, 1)) - trimK * 0.15 + speed / 80) * 1.15);
      // the droplets and mist round their stream (as on your own ski, within
      // the shared spray budget): this is what makes a rooster tail a wall
      if (dist < 220 && jo > 0.03) {
        const e = clamp(jo / Math.max(power, 0.05), 0, 1);
        const rnd = Math.random;
        const rs = () => Math.random() * 2 - 1;
        const vjet = vj * (0.5 + 0.5 * e);
        const spr = 0.045 + 0.1 * (1 - e) + 0.03 * power + trimK * 0.06 * (1 - e * 0.5);
        const boost = 1 + trimK * 1.15 + trimLift;
        const rate = 5600 * Math.pow(Math.min(1, jo * 1.3), 0.75) * (1 + trimK * 0.9) * (1 + e * 0.6) * budget * 0.24;
        const ex = exit.x, ey = Math.max(exit.y, wy + 0.02), ez = exit.z;
        const vx0 = this.vel.x, vy0 = this.vel.y, vz0 = this.vel.z;
        this.dropAcc = (this.dropAcc || 0) + rate * dt;
        let n = Math.min(260, this.dropAcc | 0);
        this.dropAcc -= this.dropAcc | 0;
        for (let i = 0; i < n; i++) {
          const sp = spr * (0.3 + rnd() * rnd() * 2.2);
          const dx = jd.x + rs() * sp, dy = jd.y * boost + rs() * sp * 0.8 + sp * 0.25, dz = jd.z + rs() * sp;
          const sv = vjet * (0.62 + rnd() * 0.52);
          const core = rnd() < 0.68;
          const grow = 1 + trimK * 0.4;
          g.spray.emit(ex + rs() * 0.06, ey + rs() * 0.04, ez + rs() * 0.06, vx0 + dx * sv, vy0 + dy * sv, vz0 + dz * sv,
            (1.5 + rnd() * 1.6) * (1 + trimK * 0.4), core ? 0.09 + rnd() * 0.06 : 0.13 + rnd() * 0.1, (core ? 0.36 + rnd() * 0.38 : 0.55 + rnd() * 0.65) * grow,
            1, core ? 0.09 : 0.36, core ? 1.0 : 0.72, 0.12);
        }
        this.mistAcc = (this.mistAcc || 0) + rate * (0.035 + e * 0.04) * dt;
        n = Math.min(40, this.mistAcc | 0);
        this.mistAcc -= this.mistAcc | 0;
        for (let i = 0; i < n; i++) {
          const sv = vjet * (0.35 + rnd() * 0.4);
          g.spray.emit(ex + rs() * 0.1, ey + rnd() * 0.1, ez + rs() * 0.1,
            vx0 * 0.4 + (jd.x + rs() * 0.25) * sv, vy0 * 0.3 + (jd.y * boost + rnd() * 0.25) * sv, vz0 * 0.4 + (jd.z + rs() * 0.25) * sv,
            (1.5 + rnd() * 1.3) * (1 + trimK * 0.4), 0.2, (0.8 + rnd() * 0.75) * (1 + trimK * 0.4), 0.3, 1.4, 0.14, 0.03);
        }
      }
      const hl = Math.hypot(jd.x, jd.z) || 1;
      const up = (1.0 + 4.2 * power) * (0.4 + 0.6 * Math.min(1, speed / 12));
      const wv = vj * 0.42;
      const wl = Math.hypot(wv, up) || 1;
      this.wash.feed(dt, exit.x - (jd.x / hl) * 0.25, wy + 0.04, exit.z - (jd.z / hl) * 0.25, this.vel.x * 0.55, 0, this.vel.z * 0.55,
        ((jd.x / hl) * wv) / wl, up / wl, ((jd.z / hl) * wv) / wl, wl, jw, 1);
    } else {
      this.jet.last = null;
      this.wash.last = null;
    }
    if (surf) {
      const dn = budget * (g.effects.density || 1);
      this.jet.update(dt, surf, dist < 160 ? g.foam : null, dist < 120 ? g.spray : null, dn);
      this.wash.update(dt, surf, dist < 160 ? g.foam : null, null, dn);
    }
    // wake foam
    if (!air && speed > 2 && dist < 140) {
      const k = clamp(speed / 18, 0, 1.2);
      g.foam.stamp(this.pos.x - fxz(this.quat).x * 0.8, this.pos.z - fxz(this.quat).z * 0.8, 0.55, k * dt * 2.6, k * dt * 2.6);
    }
  }

  dispose(keepTag) {
    if (!keepTag && this.jet) {
      this.jet.mesh.removeFromParent();
      this.wash.mesh.removeFromParent();
      this.jet.dispose();
      this.wash.dispose();
      this.jet = this.wash = null;
    }
    if (this.flair) {
      this.flair.dispose();
      this.flair = null;
    }
    if (this.model) {
      this.group.remove(this.model.group);
      this.model.dispose();
      this.model = null;
    }
    if (this.rider) {
      this.group.remove(this.rider.group);
      this.rider.dispose();
      this.rider = null;
    }
    if (!keepTag) {
      this.tag.remove();
      this.group.removeFromParent();
    }
  }
}

const _f = new THREE.Vector3();
function fxz(q) {
  _f.set(1, 0, 0).applyQuaternion(q);
  _f.y = 0;
  return _f.normalize();
}

export class Multiplayer {
  constructor(game) {
    this.game = game;
    this.status = 'connecting'; // connecting | offline | ready
    this.room = null;
    this.user = null;
    this.lobby = null;
    this.lobbyId = null;
    this.joining = false;
    this.remotes = new Map();
    this.clockOffset = 0; // ms added to Date.now() for the shared wave clock
    this.sendT = 0;
    this.sendHz = SEND_HZ;
    this.offlineWhy = 'none'; // none: no way online here · failed: could not connect
    this.trickI = 0;
    this.lastTrick = null;
    this.names = new Map();
    this.onChange = null;
    // the shared world (time, water, fun extras): see world.js
    this.world = cleanWorld(DEFAULT_WORLD, SEA_STATES.length);
    this.worldPack = null; // { j: settings JSON, g: admin signature }
    this.onWorld = null;
    this.adminKey = null;
    // chat: everyone online. Each rider carries their last few messages in
    // their presence; everyone shows the ones they have not seen yet.
    this.chatOut = [];
    this.chatId = Date.now() % 1e9; // ids keep rising across reloads
    this.chatSeen = new Map(); // peer -> newest message id shown
    this.chatTimes = [];
    this.onChat = null; // (name, text, kind)
    this.peersKnown = false;
    this.tagRoot = document.getElementById('tags');
    this.feedEl = document.getElementById('mpFeed');
    let nick = '';
    try {
      nick = localStorage.getItem('jetski-rider-nick') || '';
    } catch {
      /* ignore */
    }
    this.nick = cleanName(nick);
    this.init();
  }

  async init() {
    const q = new URLSearchParams(location.search);
    // ?fbemu=9000: the local Firebase emulator (testing only)
    const emu = q.get('fbemu');
    try {
      if (q.get('mpfake')) this.room = makeFakeRoom();
      else if (emu) {
        const { makeFireRoom } = await import('./fireroom.js');
        const shared = await firebase();
        if (shared) this.room = await makeFireRoom(null, { shared });
      } else if (window.claude && typeof window.claude.use === 'function') {
        this.room = await window.claude.use('room');
        this.user = await window.claude.use('user').catch(() => null);
      }
    } catch {
      this.room = null;
    }
    // Firebase only outside claude.ai (inside it, the page's own room is the way)
    const useFire = !!FIREBASE_CONFIG && !window.claude;
    if (!this.room && useFire && !emu) {
      try {
        const { makeFireRoom } = await import('./fireroom.js');
        const shared = await firebase();
        if (shared) this.room = await makeFireRoom(FIREBASE_CONFIG, { shared });
      } catch (e) {
        console.warn('jetski online: Firebase did not start', e);
        this.room = null;
      }
    }
    this.transport = this.room ? this.room.transport || 'claude' : null;
    this.sendHz = (this.room && this.room.sendHz) || SEND_HZ;
    if (!this.room) {
      this.status = 'offline';
      this.offlineWhy = useFire || emu ? 'failed' : 'none';
      this.changed();
      return;
    }
    if (!this.nick && this.user) {
      try {
        const n = await this.user.name();
        this.nick = cleanName(String(n || '').split(' ')[0]);
      } catch {
        /* ignore */
      }
    }
    if (!this.nick) this.nick = 'Rider ' + (100 + Math.floor(Math.random() * 900));
    this.room.onPeers(
      (ch) => {
        this.readWorld();
        this.readChat(ch);
        this.readGifts();
        this.changed();
      },
      () => {
        this.status = 'offline';
        this.offlineWhy = 'failed';
        this.changed();
      }
    );
    this.room.presence({ lobby: null, n: this.nick }).catch(() => {});
    if (this.transport === 'firebase') {
      // ready once Firebase has actually connected; say so if it cannot
      // (e.g. a network that blocks it), and recover if it connects later
      this.status = 'connecting';
      const giveUp = setTimeout(() => {
        if (this.status === 'connecting') {
          this.status = 'offline';
          this.offlineWhy = 'failed';
          this.changed();
        }
      }, 12000);
      this.room.onConnection((on) => {
        if (on && this.status !== 'ready') {
          clearTimeout(giveUp);
          this.status = 'ready';
          this.changed();
          this.autoJoin();
        }
      });
    } else {
      this.status = 'ready';
      this.autoJoin();
    }
    this.changed();
  }

  changed() {
    if (this.onChange) this.onChange();
  }

  setNick(n) {
    this.nick = cleanName(n) || this.nick;
    try {
      localStorage.setItem('jetski-rider-nick', this.nick);
    } catch {
      /* ignore */
    }
    if (this.room) this.room.presence({ n: this.nick }).catch(() => {});
  }

  profileName(by) {
    if (!by || !this.user) return '';
    if (this.names.has(by)) return this.names.get(by);
    this.names.set(by, '');
    this.user
      .profiles([by])
      .then((ps) => {
        const n = ps && ps[by] && ps[by].name;
        if (n) this.names.set(by, cleanName(n.split(' ')[0]));
      })
      .catch(() => {});
    return '';
  }

  // draw everyone else's jets for this frame's camera
  buildJets(camPos, camDir) {
    for (const r of this.remotes.values()) {
      if (!r.jet) continue;
      r.jet.build(camPos, camDir);
      r.wash.build(camPos, camDir);
    }
  }

  // Everyone starts in Lobby 1 (Lobby 2 if it is full), once, shortly after
  // connecting; leave it and you stay out.
  autoJoin() {
    // the player picks a lobby when they press RIDE (?autolobby=1: join
    // Lobby 1 by itself, as before)
    if (!new URLSearchParams(location.search).get('autolobby')) return;
    if (this.autoTried || this.lobbyId) return;
    this.autoTried = true;
    setTimeout(async () => {
      if (this.lobbyId || this.joining || this.status !== 'ready') return;
      const r = await this.joinLobby(LOBBIES[0].id);
      if (r === 'full') await this.joinLobby(LOBBIES[1].id);
    }, 1200);
  }

  // my own peer label (the same one everyone else sees)
  myId() {
    const ps = this.lobby ? this.lobby.peers() : [];
    const me = ps.find((p) => p.sameTab || p.isMe);
    return me ? me.peer : 'me';
  }

  // riders per lobby, from everyone's lobby-room presence
  counts() {
    const c = {};
    for (const l of LOBBIES) c[l.id] = 0;
    if (!this.room) return c;
    for (const p of this.room.peers()) {
      const id = p.presence && p.presence.lobby;
      if (typeof id === 'string' && id in c) c[id]++;
    }
    return c;
  }

  async joinLobby(id) {
    if (!this.room || this.joining || this.lobbyId === id) return;
    const c = this.counts();
    if (c[id] >= MAX_PER_LOBBY) return 'full';
    this.joining = true;
    this.changed();
    try {
      await this.leaveLobby(true);
      const room = await this.room.join(id);
      this.lobby = room;
      this.lobbyId = id;
      this.unsub = room.onPeers((ch) => this.onPeers(ch), () => this.leaveLobby());
      this.room.presence({ lobby: id }).catch(() => {});
      this.sendT = 0;
    } catch {
      this.lobby = null;
      this.lobbyId = null;
    }
    this.joining = false;
    this.changed();
    return this.lobbyId ? 'ok' : 'error';
  }

  async leaveLobby(quiet) {
    if (this.unsub) this.unsub();
    this.unsub = null;
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    const room = this.lobby;
    this.lobby = null;
    this.lobbyId = null;
    this.clockOffset = 0;
    if (room) await room.leave().catch(() => {});
    if (this.room) this.room.presence({ lobby: null }).catch(() => {});
    if (!quiet) this.changed();
  }

  onPeers(ch) {
    for (const p of ch.left) {
      const r = this.remotes.get(p.peer);
      if (r) {
        r.dispose();
        this.remotes.delete(p.peer);
      }
    }
    for (const list of [ch.joined, ch.updated]) {
      for (const p of list) {
        if (p.sameTab || p.kind !== 'viewer') continue;
        let r = this.remotes.get(p.peer);
        if (!r) {
          if (this.remotes.size >= MAX_PER_LOBBY - 1) continue;
          r = new Remote(this, p.peer);
          this.remotes.set(p.peer, r);
        }
        r.push(p);
      }
    }
    this.syncClock();
    this.changed();
  }

  // The rider with the lowest peer label keeps the wave clock; everyone else
  // lines their surf up with it so the same waves break for everybody.
  syncClock() {
    if (!this.lobby) return;
    const peers = this.lobby.peers();
    if (!peers.length) return;
    let host = null;
    for (const p of peers) if (p.kind === 'viewer' && (!host || p.peer < host.peer)) host = p;
    if (!host || host.sameTab) {
      this.isHost = true;
      return;
    }
    this.isHost = false;
    const t = host.presence && host.presence.t;
    if (!Number.isFinite(t)) return;
    const est = t - host.updatedAt + 40; // ~latency
    if (!this.clockSet || Math.abs(est - this.clockOffset) > 1500) {
      this.clockOffset = est;
      this.clockSet = true;
    } else this.clockOffset += (est - this.clockOffset) * 0.08;
  }

  // the shared clock in seconds (does not wrap)
  worldClock() {
    return (Date.now() + this.clockOffset) / 1000;
  }

  // Send a chat line to everyone online. Returns why not, if it was not sent.
  sendChat(text) {
    const t = cleanChat(text);
    if (!t) return 'empty';
    if (!this.room || this.status !== 'ready') return 'offline';
    const now = Date.now();
    this.chatTimes = this.chatTimes.filter((x) => now - x < 10000);
    if (this.chatTimes.length >= 5 || (this.chatTimes.length && now - this.chatTimes[this.chatTimes.length - 1] < 900)) return 'slow';
    this.chatTimes.push(now);
    this.chatOut.push({ i: ++this.chatId, m: t });
    while (this.chatOut.length > 3) this.chatOut.shift();
    this.room.presence({ chat: this.chatOut.slice() }).catch(() => {});
    if (this.onChat) this.onChat(this.nick, t, 'me');
    return null;
  }

  // New lines from everyone else (and who came and went).
  readChat(ch) {
    if (!this.onChat) return;
    const first = !this.peersKnown;
    this.peersKnown = true;
    for (const p of ch.peers || []) {
      if (p.sameTab || p.isMe) continue;
      const pr = p.presence || {};
      const name = cleanName(pr.n) || this.profileName(p.by) || 'Rider';
      const list = Array.isArray(pr.chat) ? pr.chat.slice(-3) : [];
      const seen = this.chatSeen.get(p.peer);
      let top = seen === undefined ? -1 : seen;
      for (const c of list) {
        if (!c || !Number.isFinite(c.i) || typeof c.m !== 'string') continue;
        // on first sight of a rider, what they said before you arrived is old news
        if (seen !== undefined && c.i > seen) this.onChat(name, cleanChat(c.m), 'them');
        if (c.i > top) top = c.i;
      }
      this.chatSeen.set(p.peer, top);
    }
    if (!first) {
      for (const p of ch.joined || []) if (!p.sameTab && !p.isMe) this.onChat(cleanName(p.presence && p.presence.n) || 'A rider', 'is online', 'sys');
      for (const p of ch.left || []) if (!p.sameTab && !p.isMe) {
        this.onChat(cleanName(p.presence && p.presence.n) || 'A rider', 'left', 'sys');
        this.chatSeen.delete(p.peer);
      }
    }
  }

  // Adopt the newest admin-signed world settings anyone online is carrying.
  readWorld() {
    if (!this.room) return;
    let best = null;
    let bestV = this.world.v;
    for (const p of this.room.peers()) {
      const w = p.presence && p.presence.ws;
      if (!w || typeof w.j !== 'string' || typeof w.g !== 'string' || w.j.length > 900) continue;
      let o;
      try {
        o = JSON.parse(w.j);
      } catch {
        continue;
      }
      if (o && Number.isFinite(o.v) && o.v > bestV) {
        best = { pack: { j: w.j, g: w.g }, o };
        bestV = o.v;
      }
    }
    if (!best || this.checking === best.pack.g) return;
    this.checking = best.pack.g;
    verify(best.pack.j, best.pack.g).then((ok) => {
      this.checking = null;
      if (ok && best.o.v > this.world.v) this.adoptWorld(best.pack, best.o);
    });
  }

  adoptWorld(pack, o) {
    this.world = cleanWorld(o, SEA_STATES.length);
    this.worldPack = pack;
    // pass it on, so it holds after the admin has gone
    if (this.room) this.room.presence({ ws: pack }).catch(() => {});
    if (this.onWorld) this.onWorld(this.world);
  }

  // ---------------------------------------------------------------- gifts
  // The admin can give cash to one rider online. The gift rides in the
  // admin's presence, signed with the admin key like the world settings, and
  // names the rider by their label for this visit; only that rider's game
  // takes it, once. Nobody else can fake one.
  generalId() {
    const me = this.room ? this.room.peers().find((p) => p.sameTab || p.isMe) : null;
    return me ? me.peer : null;
  }

  // everyone online right now (all lobbies and maps), for the admin's list
  online() {
    if (!this.room) return [];
    return this.room
      .peers()
      .filter((p) => !p.sameTab && !p.isMe && p.kind === 'viewer')
      .map((p) => ({ peer: p.peer, name: cleanName(p.presence && p.presence.n) || 'Rider', lobby: (p.presence && p.presence.lobby) || null }));
  }

  async sendGift(peer, amount) {
    if (!this.adminKey || !this.room) return false;
    // negative takes cash away
    const a = Math.max(-1000000, Math.min(1000000, Math.round(amount)));
    if (!a) return false;
    const j = JSON.stringify({ to: peer, a, i: Math.random().toString(36).slice(2, 9), t: Date.now() });
    const g = await sign(this.adminKey, j);
    await this.room.presence({ gf: { j, g } }).catch(() => {});
    return true;
  }

  readGifts() {
    if (!this.room || !this.onGift) return;
    const me = this.generalId();
    if (!me) return;
    const seen = this.giftsSeen || (this.giftsSeen = new Set());
    for (const p of this.room.peers()) {
      const gf = p.presence && p.presence.gf;
      if (!gf || typeof gf.j !== 'string' || typeof gf.g !== 'string' || gf.j.length > 300 || seen.has(gf.g)) continue;
      let o;
      try {
        o = JSON.parse(gf.j);
      } catch {
        continue;
      }
      seen.add(gf.g);
      if (!o || o.to !== me || !Number.isFinite(o.a) || !o.a || Math.abs(o.a) > 1000000 || Math.abs(Date.now() - o.t) > 600000) continue;
      verify(gf.j, gf.g).then((ok) => {
        if (ok && this.onGift) this.onGift(Math.round(o.a));
      });
    }
  }

  // Admin only: change the world for everyone (and for you, offline).
  async setWorld(changes) {
    if (!this.adminKey) return false;
    // build on any change still being signed, so quick clicks all count
    const base = this.nextWorld || this.world;
    const w = { ...base, ...changes, fun: { ...base.fun, ...(changes.fun || {}) } };
    w.v = Math.max(base.v + 1, Math.round(this.worldClock() * 1000));
    this.nextWorld = w;
    const j = JSON.stringify(w);
    const g = await sign(this.adminKey, j);
    if (w.v > this.world.v) this.adoptWorld({ j, g }, w);
    if (this.nextWorld === w) this.nextWorld = null;
    return true;
  }

  worldTime() {
    return (((Date.now() + this.clockOffset) / 1000) % 3600 + 3600) % 3600;
  }

  noteTrick(label, pts) {
    this.trickI++;
    this.lastTrick = { i: this.trickI, l: String(label).slice(0, 28), p: pts | 0 };
  }

  feed(name, label, pts) {
    if (!this.feedEl) return;
    const el = document.createElement('div');
    el.className = 'feed-line';
    const b = document.createElement('b');
    b.textContent = name;
    el.append(b, document.createTextNode(' ' + label + ' +' + pts.toLocaleString()));
    this.feedEl.prepend(el);
    while (this.feedEl.children.length > 4) this.feedEl.lastChild.remove();
    setTimeout(() => el.remove(), 5000);
  }

  // what everyone else needs to draw me
  send(dt) {
    if (!this.lobby) return;
    const g = this.game;
    const idle = g.state !== 'ride';
    this.sendT -= dt;
    if (this.sendT > 0) return;
    // a full lobby sends a little less often each, so the total traffic
    // (everyone hears everyone) stays reasonable
    const n = this.remotes.size + 1;
    const crowd = n > 10 ? 0.6 : n > 5 ? 0.8 : 1;
    this.sendT = idle ? 0.5 : 1 / (this.sendHz * crowd);
    const p = g.phys;
    const T = p.tele;
    const st = {
      n: this.nick,
      k: g.spec.id,
      c: g.cwIndex[g.spec.id] || 0,
      p: [r2(p.px), r2(p.py), r2(p.pz)],
      q: [r4(p.qx), r4(p.qy), r4(p.qz), r4(p.qw)],
      u: [r2(p.vx), r2(p.vy), r2(p.vz)],
      st: r2(p.ctrl.steer),
      tr: r4(T.trimAngle || 0),
      pw: r2(T.power * T.pumpLoad),
      ln: r2(p.ctrl.lean),
      li: r2(p.leanIn || 0),
      sm: r2(T.superman || 0),
      jo: r2(g.effects.jetOut || 0),
      jw: r2(g.effects.washAmt || 0),
      tu: r2(T.tuck || 0),
      rx: g.spec.rooster || 1,
      m: g.mapId,
      lv: g.career.data.lv,
      pr: g.career.data.pr,
      cs: g.career.data.eq,
      cr: g.crown || 0,
      a: T.airborne ? 1 : 0,
      w: g.wipe.on ? 1 : 0,
      f: T.reverse > 0.05 ? 1 : 0,
      sc: g.tricks.score | 0,
      t: Date.now() + this.clockOffset,
    };
    if (this.lastTrick) st.tk = this.lastTrick;
    // racing: waiting in the race circle, or how far round the course I am
    if (g.raceQ) st.rq = g.raceQ;
    if (g.raceRun) st.rr = g.raceRun;
    this.lobby.presence(st).catch(() => {});
  }

  update(dt, camPos) {
    if (!this.lobby) return;
    this.send(dt);
    const now = performance.now() / 1000;
    // Shadows only for the two nearest riders; spray budget shrinks with
    // more riders around so a full lobby stays smooth.
    const list = [...this.remotes.values()];
    for (const r of list) r._d = r.state ? Math.hypot(r.state.p[0] - camPos.x, r.state.p[2] - camPos.z) : 1e9;
    list.sort((a, b) => a._d - b._d);
    const budget = clamp(1.6 / Math.max(1, list.length), 0.25, 0.8) * (this.game.effects.density || 1);
    list.forEach((r, i) => {
      r.setShadow(i < 2 && r._d < 45);
      r.update(dt, now, camPos, budget);
    });
    this.collide();
  }

  // skis bump off each other (each rider resolves their own side)
  collide() {
    const p = this.game.phys;
    for (const r of this.remotes.values()) {
      if (!r.group.visible || (r.state && r.state.w)) continue;
      const dx = p.px - r.pos.x;
      const dz = p.pz - r.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.3 || d < 1e-3 || Math.abs(p.py - r.pos.y) > 1.5) continue;
      const nx = dx / d;
      const nz = dz / d;
      const push = (2.3 - d) * 0.6;
      p.px += nx * push;
      p.pz += nz * push;
      const rv = (p.vx - r.vel.x) * nx + (p.vz - r.vel.z) * nz;
      if (rv < 0) {
        p.vx -= nx * rv * 1.3;
        p.vz -= nz * rv * 1.3;
        const s = clamp(-rv / 10, 0.15, 1);
        this.game.audio.slap(s);
        this.game.input.rumble(0.5 * s + 0.2, 0.6 * s, 160);
      }
    }
  }

  // project name tags over the riders
  tags(camera) {
    if (!this.remotes.size) return;
    camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    const w = innerWidth;
    const h = innerHeight;
    for (const r of this.remotes.values()) {
      if (!r.group.visible || this.game.state !== 'ride') {
        r.tag.hidden = true;
        continue;
      }
      v.copy(r.pos);
      v.y += 2.1;
      const d = v.distanceTo(camera.position);
      v.project(camera);
      if (v.z > 1 || d > 700) {
        r.tag.hidden = true;
        continue;
      }
      r.tag.hidden = false;
      r.tag.style.transform = `translate(${((v.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%)`;
      // name, level, their tag colour and a crown if they are top 3 this week
      const key = r.name + '|' + r.lv + '|' + r.pr + '|' + r.tagColor + '|' + r.cr;
      if (r.tagKey !== key) {
        r.tagKey = key;
        r.tagName.textContent = r.name;
        r.tagName.style.color = r.tagColor || '';
        if (!r.tagLv) {
          r.tagLv = document.createElement('em');
          r.tag.insertBefore(r.tagLv, r.tagName);
        }
        r.tagLv.textContent = r.lv ? (r.pr ? '★' + r.pr + ' ' : '') + 'LV ' + r.lv : '';
        if (r.cr && !r.tagCrown) {
          r.tagCrown = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          r.tagCrown.setAttribute('viewBox', '0 0 24 18');
          r.tagCrown.setAttribute('class', 'crown');
          r.tagCrown.innerHTML = '<path d="M2 16 L4 5 L9 10 L12 2 L15 10 L20 5 L22 16 Z" stroke="#04121a" stroke-width="1.2"/>';
          r.tag.insertBefore(r.tagCrown, r.tag.firstChild);
        }
        if (r.tagCrown) {
          r.tagCrown.style.display = r.cr ? '' : 'none';
          r.tagCrown.style.fill = ['', '#ffd54a', '#d9e2e8', '#e0a36a'][r.cr] || '';
        }
      }
      const dt = d > 60 ? Math.round(d) + ' m' : '';
      if (r.tagDist.textContent !== dt) r.tagDist.textContent = dt;
      r.tag.style.opacity = String(1 - smoothstep(300, 700, d) * 0.6);
    }
  }

  // leaderboard rows for the HUD: me plus everyone here, best first
  board() {
    const rows = [{ name: this.nick, score: this.game.tricks.score | 0, me: true }];
    for (const r of this.remotes.values()) {
      const m = r.state ? r.state.m || 'bay' : this.game.mapId;
      rows.push({ name: r.name + (m !== this.game.mapId ? ' · ' + mapById(m).name.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ') : ''), score: r.score, me: false });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows;
  }
}
