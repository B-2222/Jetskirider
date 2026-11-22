// Online riding over the claude.ai `room` capability: two lobbies, each a
// named room. Every rider shares their ski's state as presence (about 15
// times a second, compactly), and everyone else draws them smoothly a
// moment in the past so jitter never shows. Nothing is stored: when you
// leave, you are gone.
//
// Works only where the page runs inside the claude.ai viewer for a
// signed-in person who can open it; everywhere else the game stays solo.

import * as THREE from 'three';
import { JetskiModel } from './jetski.js';
import { Rider } from './rider.js';
import { skiById } from './specs.js';
import { clamp, smoothstep } from './util.js';
import { makeFakeRoom } from './fakeroom.js';

export const LOBBIES = [
  { id: 'lobby-1', name: 'Lobby 1' },
  { id: 'lobby-2', name: 'Lobby 2' },
];
export const MAX_PER_LOBBY = 8;
const SEND_HZ = 15;
const DELAY = 0.12; // seconds behind real time that remote riders are drawn
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, '').trim().slice(0, 16);

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
  }

  setLook(skiId, cw) {
    const spec = skiById(skiId);
    const cwI = clamp(cw | 0, 0, spec.colorways.length - 1);
    if (spec.id === this.skiId && cwI === this.cw) return;
    this.dispose(true);
    this.skiId = spec.id;
    this.cw = cwI;
    this.spec = spec;
    this.model = new JetskiModel(spec, spec.colorways[cwI]);
    this.rider = new Rider(spec.colorways[cwI]);
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
    this.setLook(typeof s.k === 'string' ? s.k : 'trixx', s.c);
    this.name = cleanName(s.n) || this.mp.profileName(p.by) || 'Rider';
    this.score = Number.isFinite(s.sc) ? Math.max(0, Math.min(1e8, s.sc | 0)) : 0;
    const t = p.updatedAt / 1000;
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
    if (!this.model || !this.sample(now)) {
      this.group.visible = false;
      this.tag.hidden = true;
      return;
    }
    const s = this.state;
    const dist = this.pos.distanceTo(camPos);
    const far = dist > 900;
    this.group.visible = !far;
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.quat);
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
    if (dist > 160 || s.w) return;
    const power = clamp(s.pw || 0, 0, 1);
    if (power > 0.05 && !(s.f & 1)) {
      const exit = new THREE.Vector3();
      this.model.nozzleExit.getWorldPosition(exit);
      const q = new THREE.Quaternion();
      this.model.nozzlePitch.getWorldQuaternion(q);
      const jd = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
      const out = air ? 1 : clamp(0.35 + jd.y * 3, 0.15, 1);
      const trimK = clamp(jd.y * 3, 0, 1);
      this.acc += 2600 * power * out * (1 + trimK) * budget * dt;
      let n = this.acc | 0;
      this.acc -= n;
      n = Math.min(n, 160);
      const vj = this.spec.jet * (0.5 + 0.5 * power);
      for (let i = 0; i < n; i++) {
        const sp = 0.06 + Math.random() * Math.random() * 0.12;
        const sv = vj * (0.62 + Math.random() * 0.5);
        const dx = jd.x + (Math.random() - 0.5) * sp * 2;
        const dy = jd.y * (1 + trimK * 1.15) + (Math.random() - 0.5) * sp * 1.6 + sp * 0.3;
        const dz = jd.z + (Math.random() - 0.5) * sp * 2;
        g.spray.emit(exit.x, Math.max(exit.y, this.pos.y - 0.25), exit.z, this.vel.x + dx * sv, this.vel.y + dy * sv, this.vel.z + dz * sv, 1.4 + Math.random() * 1.5, 0.09 + Math.random() * 0.07, 0.4 + Math.random() * 0.6, 1, 0.12, 0.9, 0.12);
      }
    }
    // wake foam
    if (!air && speed > 2 && dist < 140) {
      const k = clamp(speed / 18, 0, 1.2);
      g.foam.stamp(this.pos.x - fxz(this.quat).x * 0.8, this.pos.z - fxz(this.quat).z * 0.8, 0.55, k * dt * 2.6, k * dt * 2.6);
    }
  }

  dispose(keepTag) {
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
    this.trickI = 0;
    this.lastTrick = null;
    this.names = new Map();
    this.onChange = null;
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
    const fake = new URLSearchParams(location.search).get('mpfake');
    try {
      if (fake) this.room = makeFakeRoom();
      else if (window.claude && typeof window.claude.use === 'function') {
        this.room = await window.claude.use('room');
        this.user = await window.claude.use('user').catch(() => null);
      }
    } catch {
      this.room = null;
    }
    if (!this.room) {
      this.status = 'offline';
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
      () => this.changed(),
      () => {
        this.status = 'offline';
        this.changed();
      }
    );
    this.room.presence({ lobby: null, n: this.nick }).catch(() => {});
    this.status = 'ready';
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
    this.sendT = idle ? 0.5 : 1 / SEND_HZ;
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
      a: T.airborne ? 1 : 0,
      w: g.wipe.on ? 1 : 0,
      f: T.reverse > 0.05 ? 1 : 0,
      sc: g.tricks.score | 0,
      t: Date.now() + this.clockOffset,
    };
    if (this.lastTrick) st.tk = this.lastTrick;
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
      if (r.tagName.textContent !== r.name) r.tagName.textContent = r.name;
      const dt = d > 60 ? Math.round(d) + ' m' : '';
      if (r.tagDist.textContent !== dt) r.tagDist.textContent = dt;
      r.tag.style.opacity = String(1 - smoothstep(300, 700, d) * 0.6);
    }
  }

  // leaderboard rows for the HUD: me plus everyone here, best first
  board() {
    const rows = [{ name: this.nick, score: this.game.tricks.score | 0, me: true }];
    for (const r of this.remotes.values()) rows.push({ name: r.name, score: r.score, me: false });
    rows.sort((a, b) => b.score - a.score);
    return rows;
  }
}
