// Trick detection + scoring: powerslides, 180s / 360s, wheelies and tail
// stands, air time, flips and spins off ramps and wave faces.

import { wrapAngle } from './util.js';

export class Tricks {
  constructor(onEvent) {
    this.onEvent = onEvent; // (label, points, kind)
    this.zoneAt = null; // (x, z) -> 0..1 wave-zone strength
    this.barrelAt = null; // (x, z) -> 0..1 how deep inside a barrel
    this.reset();
    this.best = 0;
    try {
      this.best = parseInt(localStorage.getItem('jetski-rider-best') || '0', 10) || 0;
    } catch {
      /* storage unavailable */
    }
  }

  reset() {
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.slide = { on: false, time: 0, yaw: 0, pts: 0, maxSlip: 0 };
    this.wheelie = { on: false, time: 0, pts: 0, max: 0 };
    this.air = { on: false, time: 0, pitch: 0, yaw: 0, roll: 0, maxH: 0 };
    this.barrel = { on: false, time: 0, pts: 0, grace: 0 };
    this.lastYaw = null;
    this.live = '';
    this.livePts = 0;
  }

  award(label, pts, kind = 'trick') {
    if (pts <= 0) return;
    const total = Math.round(pts * this.combo);
    this.score += total;
    this.onEvent(label, total, kind, this.combo);
    this.combo = Math.min(this.combo + 1, 8);
    this.comboTimer = 4.5;
    if (this.score > this.best) {
      this.best = this.score;
      try {
        localStorage.setItem('jetski-rider-best', String(this.best));
      } catch {
        /* ignore */
      }
    }
  }

  fail() {
    this.slide.on = this.wheelie.on = this.air.on = false;
    this.combo = 1;
    this.comboTimer = 0;
    this.live = '';
  }

  update(dt, phys) {
    const T = phys.tele;
    const yaw = phys.yaw;
    const dyaw = this.lastYaw === null ? 0 : wrapAngle(yaw - this.lastYaw);
    this.lastYaw = yaw;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 1;
    }
    this.live = '';
    this.livePts = 0;
    const onWater = T.wet > 0.05 && !T.airborne;
    if (T.pop) {
      // latched by the physics until read here
      this.popPending = true;
      T.pop = 0;
    }

    // --- powerslide --------------------------------------------------------
    const slipDeg = Math.abs(T.slip) * 57.3;
    const backwards = T.u < -1.5;
    const sliding = onWater && T.speed > 5 && (slipDeg > 22 || backwards);
    const s = this.slide;
    if (sliding) {
      if (!s.on) {
        s.on = true;
        s.time = 0;
        s.yaw = 0;
        s.pts = 0;
        s.maxSlip = 0;
      }
      s.time += dt;
      s.yaw += dyaw;
      s.grace = 0.3;
      s.maxSlip = Math.max(s.maxSlip, slipDeg);
      s.pts += dt * (40 + T.speed * 6) * (0.5 + Math.min(slipDeg, 90) / 60);
      if (s.time > 0.35) {
        this.live = 'POWERSLIDE';
        this.livePts = s.pts;
      }
    } else if (s.on) {
      s.grace -= dt;
      if (s.grace <= 0) {
        s.on = false;
        const rot = Math.abs(s.yaw) * 57.3;
        if (s.time > 0.45) {
          let label = 'POWERSLIDE';
          let bonus = 0;
          if (rot > 320) {
            label = '360 SPIN';
            bonus = 900;
          } else if (rot > 150) {
            label = '180 POWERSLIDE';
            bonus = 450;
          } else if (s.maxSlip > 60) {
            label = 'BIG SLIDE';
            bonus = 150;
          }
          this.award(label, s.pts + bonus);
        }
      }
    }

    // --- wheelie -----------------------------------------------------------
    const w = this.wheelie;
    const pitchDeg = T.pitch * 57.3;
    const wheelieing = onWater && pitchDeg > 24 && T.uy > 0.2;
    if (wheelieing) {
      if (!w.on) {
        w.on = true;
        w.time = 0;
        w.pts = 0;
        w.max = 0;
      }
      w.time += dt;
      w.grace = 0.25;
      w.max = Math.max(w.max, pitchDeg);
      w.pts += dt * (60 + pitchDeg * 3);
      if (w.time > 0.4) {
        this.live = pitchDeg > 52 ? 'TAIL STAND' : 'WHEELIE';
        this.livePts = w.pts;
      }
    } else if (w.on) {
      w.grace -= dt;
      if (w.grace <= 0) {
        w.on = false;
        if (w.time > 0.6) this.award(w.max > 52 ? 'TAIL STAND' : 'WHEELIE', w.pts + (w.max > 52 ? 200 : 0));
      }
    }

    // --- barrel ------------------------------------------------------------
    const bz = this.barrelAt && onWater ? this.barrelAt(phys.px, phys.pz) : 0;
    const br = this.barrel;
    if (bz > 0.3 && T.speed > 4) {
      if (!br.on) {
        br.on = true;
        br.time = 0;
        br.pts = 0;
      }
      br.time += dt;
      br.grace = 0.35;
      br.pts += dt * (260 + 340 * bz);
      if (br.time > 0.25) {
        this.live = 'IN THE BARREL';
        this.livePts = br.pts;
      }
    } else if (br.on) {
      br.grace -= dt;
      if (br.grace <= 0) {
        br.on = false;
        if (br.time > 0.5) this.award(br.time > 2.2 ? 'DEEP BARREL' : 'BARREL', br.pts + (br.time > 2.2 ? 800 : 200));
      }
    }

    // --- air ---------------------------------------------------------------
    const a = this.air;
    if (T.airborne) {
      if (!a.on) {
        a.on = true;
        a.time = 0;
        a.pitch = a.yaw = a.roll = 0;
        a.maxH = 0;
        a.y0 = phys.py;
        a.wave = this.zoneAt ? this.zoneAt(phys.px, phys.pz) > 0.4 : false;
        a.sm = 0;
        a.flat = this.popPending;
        this.popPending = false;
      }
      a.time += dt;
      // integrate body rates
      a.pitch += (phys.wx * T.rx + phys.wy * T.ry + phys.wz * T.rz) * dt;
      if ((T.superman || 0) > 0.7) a.sm += dt;
      a.yaw += (phys.wx * T.ux + phys.wy * T.uy + phys.wz * T.uz) * dt;
      a.roll += (phys.wx * T.fx + phys.wy * T.fy + phys.wz * T.fz) * dt;
      a.maxH = Math.max(a.maxH, phys.py - a.y0);
      if (a.time > 0.45) {
        this.live = (T.superman || 0) > 0.7 ? 'SUPERMAN' : 'AIR';
        this.livePts = a.time * 150 + a.sm * 600;
      }
    } else if (a.on) {
      a.on = false;
      if (a.time > 0.55 && T.uy > 0.3 && (T.superman || 0) < 0.45) {
        const spins = Math.floor(Math.abs(a.yaw) / Math.PI + 0.25);
        const parts = [];
        let pts = a.time * 180 + Math.min(a.maxH, 10) * 40;
        if (phys.spec.standup) {
          // stand-ups flip, roll and stretch out; a rotation counts once it
          // is ~80% done (the rider finishes it on the way down)
          const flips = Math.floor(Math.abs(a.pitch) / (Math.PI * 2) + 0.2);
          const rolls = Math.floor(Math.abs(a.roll) / (Math.PI * 2) + 0.2);
          if (a.sm > 0.25) {
            parts.push('SUPERMAN');
            pts += 700 + a.sm * 600;
          }
          if (flips > 0) {
            parts.push((flips > 1 ? 'DOUBLE ' : '') + (a.pitch > 0 ? 'BACKFLIP' : 'FRONTFLIP'));
            pts += 1500 * flips;
          }
          if (rolls > 0) {
            parts.push((rolls > 1 ? 'DOUBLE ' : '') + 'BARREL ROLL');
            pts += 1300 * rolls;
          }
          if (spins > 0) {
            parts.push(spins * 180 + (parts.length ? '' : ' SPIN'));
            pts += 450 * spins;
          }
          if (parts.length > 1) pts *= 1.3;
          if (a.flat && parts.length) {
            parts[0] = 'FLATWATER ' + parts[0];
            pts *= 1.2;
          }
        } else if (spins > 0) {
          // sit-downs: flat spins only, carried off the lip
          parts.push(spins * 180 + ' SPIN');
          pts += 450 * spins;
        }
        let label = parts.length ? parts.join(' + ') : a.time > 1.6 ? 'HUGE AIR' : a.time > 1.0 ? 'BIG AIR' : 'AIR';
        if (a.wave) {
          label = 'WAVE ' + label;
          pts *= 1.25;
        }
        // stomped it: level and straight on touchdown
        const clean = Math.abs(T.roll) < 0.25 && T.pitch > -0.2 && T.pitch < 0.45 && Math.abs(T.slip) < 0.35;
        if (clean && (parts.length || a.time > 1.0)) {
          pts *= 1.2;
          this.onEvent('CLEAN LANDING', 0, 'note', this.combo);
        }
        this.award(label, pts);
      }
    }
  }
}
