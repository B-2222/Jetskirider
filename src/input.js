// Keyboard, gamepad and touch input folded into one control state.

import { clamp, damp } from './util.js';

export class Input {
  constructor(touchRoot) {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.state = { throttle: 0, brake: 0, steer: 0, lean: 0, trimCmd: 0 };
    this.steerSmooth = 0;
    this.touch = { active: false, steer: 0, throttle: 0, brake: 0, lean: 0, trim: 0 };
    this.usingGamepad = false;
    this.enabled = true;
    this._padPrev = [];

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
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
    let analog = false;

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected && p.axes.length >= 2) pad = p;
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const b = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const ax = dz(pad.axes[0]);
      const ay = dz(pad.axes[1] || 0);
      const rt = Math.max(b(7), b(0) > 0.5 ? 1 : 0);
      const lt = Math.max(b(6), b(2) > 0.5 ? 1 : 0);
      if (Math.abs(ax) > 0 || rt > 0.05 || lt > 0.05 || Math.abs(ay) > 0) this.usingGamepad = true;
      if (this.usingGamepad) {
        if (Math.abs(ax) > 0) {
          steerT = Math.sign(ax) * Math.pow(Math.abs(ax), 1.5);
          analog = true;
        }
        throttle = Math.max(throttle, rt);
        brake = Math.max(brake, lt);
        if (Math.abs(ay) > 0.25) lean = ay < 0 ? 1 : -1;
        if (b(1) > 0.5) lean = -1;
        if (b(3) > 0.5) lean = 1;
        trim += (b(12) > 0.5 || b(5) > 0.5 ? 1 : 0) - (b(13) > 0.5 || b(4) > 0.5 ? 1 : 0);
        // edge-triggered buttons -> virtual key presses
        const map = { 9: 'Escape', 8: 'KeyC', 3: null };
        for (const i of [8, 9]) {
          const v = b(i) > 0.5;
          if (v && !this._padPrev[i]) this.pressed.add(map[i]);
          this._padPrev[i] = v;
        }
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
    return s;
  }
}
