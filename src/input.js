// Keyboard, gamepad and touch input folded into one control state.

import { clamp, damp } from './util.js';

// Standard gamepad mapping (Xbox layout)
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export class Input {
  constructor(touchRoot) {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.state = { throttle: 0, brake: 0, steer: 0, lean: 0, trimCmd: 0, trick: 0 };
    this.steerSmooth = 0;
    this.touch = { active: false, steer: 0, throttle: 0, brake: 0, lean: 0, trim: 0 };
    this.usingGamepad = false;
    this.enabled = true;
    this._padPrev = [];
    this.padPressed = new Set(); // gamepad buttons pressed this frame (100+ = stick flick)
    this.padLook = false; // X held: look behind
    this.camStick = { x: 0, y: 0 };
    this.padIndex = -1;
    this.padBlocked = false;
    this.onPadChange = null;
    this._rumbleT = 0;
    this._impactUntil = 0;
    addEventListener('gamepadconnected', (e) => {
      if (e.gamepad && e.gamepad.mapping === 'standard') this.padIndex = e.gamepad.index;
      if (this.onPadConnect) this.onPadConnect(e.gamepad);
    });

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (this.usingGamepad) {
        this.usingGamepad = false;
        if (this.onPadChange) this.onPadChange(false);
      }
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    if (touchRoot) this.setupTouch(touchRoot);
  }

  setupTouch(root) {
    const T = this.touch;
    const stick = root.querySelector('[data-stick]');
    const knob = root.querySelector('[data-knob]');
    let stickId = null;
    let sx = 0;
    const setStick = (cx) => {
      const r = stick.getBoundingClientRect();
      const v = clamp((cx - (r.left + r.width / 2)) / (r.width * 0.42), -1, 1);
      T.steer = v;
      knob.style.transform = `translateX(${v * r.width * 0.3}px)`;
    };
    stick.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      T.active = true;
      setStick(e.clientX);
      e.preventDefault();
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === stickId) setStick(e.clientX);
    });
    const end = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      T.steer = 0;
      knob.style.transform = '';
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    void sx;
    for (const b of root.querySelectorAll('[data-btn]')) {
      const name = b.dataset.btn;
      const set = (v) => {
        T.active = true;
        b.classList.toggle('on', v);
        if (name === 'gas') T.throttle = v ? 1 : 0;
        else if (name === 'brake') T.brake = v ? 1 : 0;
        else if (name === 'back') T.lean = v ? -1 : T.lean === -1 ? 0 : T.lean;
        else if (name === 'fwd') T.lean = v ? 1 : T.lean === 1 ? 0 : T.lean;
        else if (name === 'trimUp') T.trim = v ? 1 : T.trim === 1 ? 0 : T.trim;
        else if (name === 'trimDown') T.trim = v ? -1 : T.trim === -1 ? 0 : T.trim;
        else if (name === 'trick') T.trick = v ? 1 : 0;
      };
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId);
        set(true);
        e.preventDefault();
      });
      b.addEventListener('pointerup', () => set(false));
      b.addEventListener('pointercancel', () => set(false));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  was(code) {
    return this.pressed.has(code);
  }

  // gamepad button (PAD.*) pressed this frame; D-pad also answers to stick flicks
  padWas(i) {
    return this.padPressed.has(i) || (i >= PAD.UP && i <= PAD.RIGHT && this.padPressed.has(100 + i));
  }

  readPad() {
    let pads;
    try {
      pads = navigator.getGamepads ? navigator.getGamepads() : [];
    } catch {
      // a frame that is not allowed to use gamepads
      this.padBlocked = true;
      return null;
    }
    let pad = this.padIndex >= 0 ? pads[this.padIndex] : null;
    if (!pad || !pad.connected) {
      pad = null;
      for (const p of pads) {
        if (p && p.connected && p.axes.length >= 2 && (!pad || p.mapping === 'standard')) pad = p;
      }
      if (pad) this.padIndex = pad.index;
    }
    this.pad = pad;
    return pad;
  }

  // dual-motor rumble; quietly does nothing where unsupported
  rumble(strong, weak, ms, impact = true) {
    const pad = this.pad;
    const act = pad && pad.vibrationActuator;
    if (!act || !this.usingGamepad) return;
    if (impact) this._impactUntil = performance.now() + ms;
    try {
      const r = act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) });
      if (r && r.catch) r.catch(() => {});
    } catch {
      /* not supported */
    }
  }

  // a light continuous buzz that follows the engine; impacts take priority
  rumbleEngine(level, dt) {
    this._rumbleT -= dt;
    if (this._rumbleT > 0 || performance.now() < this._impactUntil) return;
    this._rumbleT = 0.1;
    if (level < 0.02) return;
    this.rumble(level * 0.1, level * 0.3, 140, false);
  }

  endFrame() {
    this.pressed.clear();
  }

  // speedN: 0..1 of top speed, used to slow the keyboard steering ramp
  update(dt, speedN = 0) {
    const k = this.keys;
    const s = this.state;
    const T = this.touch;
    const down = (...c) => c.some((x) => k.has(x));

    let throttle = down('KeyW', 'ArrowUp') ? 1 : 0;
    let brake = down('KeyS', 'ArrowDown') ? 1 : 0;
    let steerT = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0);
    let lean = (down('ShiftLeft', 'ShiftRight') ? 1 : 0) - (down('Space') ? 1 : 0);
    let trim = (down('KeyE', 'PageUp') ? 1 : 0) - (down('KeyQ', 'PageDown') ? 1 : 0);
    let trick = down('KeyX') ? 1 : 0;
    let analog = false;

    // ---- Xbox / standard-mapping gamepad ---------------------------------
    // RT gas, LT brake/reverse, left stick steer (and lean), A slide,
    // B pull back, LB/RB trim, X look behind (hold), Y camera, right stick
    // looks around, View anti-lag, Menu garage, D-pad shortcuts.
    this.padPressed.clear();
    this.padLook = false;
    this.camStick.x = this.camStick.y = 0;
    const pad = this.readPad();
    if (pad) {
      const P = PAD;
      const b = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const down = (i) => b(i) > 0.5;
      // radial deadzone for the sticks, small one for the triggers
      const stick = (ix, iy, dzr = 0.14) => {
        const x = pad.axes[ix] || 0;
        const y = pad.axes[iy] || 0;
        const m = Math.hypot(x, y);
        if (m < dzr) return [0, 0];
        const k = Math.min(1, (m - dzr) / (1 - dzr)) / m;
        return [x * k, y * k];
      };
      const [lx, ly] = stick(0, 1);
      const [rx, ry] = stick(2, 3, 0.18);
      const rt = Math.max(0, (b(P.RT) - 0.04) / 0.96);
      const lt = Math.max(0, (b(P.LT) - 0.04) / 0.96);
      // edges
      for (let i = 0; i < pad.buttons.length && i < 17; i++) {
        const v = down(i);
        if (v && !this._padPrev[i]) this.padPressed.add(i);
        this._padPrev[i] = v;
      }
      // left-stick flicks count as D-pad presses (menus), with repeat
      const flick = (Math.abs(lx) > 0.6 || Math.abs(ly) > 0.6) ? (Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? P.RIGHT : P.LEFT) : (ly > 0 ? P.DOWN : P.UP)) : -1;
      if (flick !== this._flick) {
        this._flick = flick;
        this._flickT = 0.4;
        if (flick >= 0) this.padPressed.add(100 + flick);
      } else if (flick >= 0) {
        this._flickT -= dt;
        if (this._flickT <= 0) {
          this._flickT = 0.14;
          this.padPressed.add(100 + flick);
        }
      }
      const active = Math.abs(lx) > 0 || Math.abs(rx) > 0 || rt > 0.05 || lt > 0.05 || this.padPressed.size > 0;
      if (active && !this.usingGamepad) {
        this.usingGamepad = true;
        if (this.onPadChange) this.onPadChange(true);
      }
      if (this.usingGamepad) {
        if (Math.abs(lx) > 0) {
          steerT = Math.sign(lx) * Math.pow(Math.abs(lx), 1.4);
          analog = true;
        }
        throttle = Math.max(throttle, rt);
        brake = Math.max(brake, lt);
        // A slides, B pulls back; the stick leans too (forward only nudges,
        // so it never starts a slide by accident)
        if (down(P.A)) lean = 1;
        else if (down(P.B)) lean = -1;
        else if (ly > 0.3) lean = -Math.min(1, (ly - 0.3) / 0.6);
        else if (ly < -0.3) lean = Math.min(1, (-ly - 0.3) / 0.6) * 0.45;
        trim += (down(P.RB) ? 1 : 0) - (down(P.LB) ? 1 : 0);
        this.padLook = down(P.X);
        if (down(P.X)) trick = 1;
        this.camStick.x = rx;
        this.camStick.y = ry;
      }
    }

    if (T.active) {
      if (T.steer !== 0) {
        steerT = T.steer;
        analog = true;
      }
      throttle = Math.max(throttle, T.throttle);
      brake = Math.max(brake, T.brake);
      if (T.lean) lean = T.lean;
      if (T.trim) trim = T.trim;
      if (T.trick) trick = 1;
    }

    if (!this.enabled) {
      throttle = brake = steerT = lean = trim = 0;
    }

    // Keys are on/off, handlebars are not: ramp toward full lock, slower at
    // speed so a tap is a nudge and a hold is a full-lock commitment.
    if (analog) {
      this.steerSmooth = damp(this.steerSmooth, steerT, 0.05, dt);
    } else {
      const rate = steerT === 0 ? 6.5 : Math.sign(steerT) !== Math.sign(this.steerSmooth) && this.steerSmooth !== 0 ? 8 : 5.2 - 1.8 * clamp(speedN, 0, 1);
      const diff = steerT - this.steerSmooth;
      this.steerSmooth += clamp(diff, -rate * dt, rate * dt);
    }
    s.steer = clamp(this.steerSmooth, -1, 1);
    s.throttle = throttle;
    s.brake = brake;
    s.lean = lean;
    s.trimCmd = clamp(trim, -1, 1);
    s.trick = this.enabled ? trick : 0;
    return s;
  }
}
