// Fully synthesised sound: three-cylinder Rotax-style engine, supercharger
// whine, hull/water rush, spray hiss and landing thumps. No audio files.

import { clamp } from './util.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
  }

  start(spec) {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.setSpec(spec);
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try {
      ctx = new AC();
    } catch {
      return;
    }
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    // --- engine: pulse train built from harmonically related oscillators
    const eng = ctx.createGain();
    eng.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.6) * 0.9;
    }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.Q.value = 0.9;
    const pre = ctx.createGain();
    pre.gain.value = 0.55;
    this.oscs = [];
    const mk = (type, mult, gain) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(pre);
      o.start();
      this.oscs.push({ o, mult });
    };
    mk('sawtooth', 1, 0.5); // firing frequency
    mk('square', 0.5, 0.34); // half order: the lumpy triple character
    mk('sawtooth', 2.01, 0.2);
    mk('triangle', 0.333, 0.4); // crank rumble
    pre.connect(shaper).connect(lp).connect(eng).connect(master);
    this.engGain = eng;
    this.engLP = lp;

    // supercharger whine
    const sc = ctx.createOscillator();
    sc.type = 'sine';
    const scg = ctx.createGain();
    scg.gain.value = 0;
    sc.connect(scg).connect(master);
    sc.start();
    this.sc = sc;
    this.scGain = scg;

    // --- noise bed
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = b0 * 0.97 + w * 0.03;
      d[i] = w * 0.5 + b0 * 4;
    }
    const mkNoise = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(master);
      src.start();
      return { f, g };
    };
    this.rush = mkNoise('lowpass', 420, 0.4); // hull through water
    this.hiss = mkNoise('bandpass', 3200, 0.5); // spray
    this.wind = mkNoise('bandpass', 900, 0.3); // wind in the helmet
    this.amb = mkNoise('lowpass', 260, 0.3); // gentle sea bed
    this.noiseBuf = buf;
    this.ready = true;
    this.setSpec(spec);
    master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.8, ctx.currentTime + 0.6);
  }

  setSpec(spec) {
    this.spec = spec;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  splash(strength) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500 + strength * 2200;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(clamp(0.25 + strength * 0.9, 0, 1.1), t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5 + strength * 0.7);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 1.5);
    // hull thump
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    const og = ctx.createGain();
    og.gain.setValueAtTime(clamp(strength, 0, 1) * 0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }

  // tele: physics telemetry, sprayLevel 0..1, idle: menu mode (quieter)
  update(tele, sprayLevel, idle) {
    if (!this.ready) return;
    const sp = this.spec;
    const t = this.ctx.currentTime;
    const rpm = sp.idleRpm + (sp.maxRpm - sp.idleRpm) * clamp((tele.rpmN - 0.11) / 0.89, 0, 1.06);
    const fire = (rpm / 60) * (sp.cyl / 2);
    for (const { o, mult } of this.oscs) o.frequency.setTargetAtTime(fire * mult, t, 0.03);
    const load = clamp(tele.power * 0.8 + 0.2, 0, 1);
    this.engLP.frequency.setTargetAtTime(380 + rpm * 0.16 + load * 1500, t, 0.05);
    const unloaded = tele.pumpLoad < 0.4 ? 1.15 : 1;
    this.engGain.gain.setTargetAtTime((0.11 + 0.26 * load) * unloaded * (idle ? 0.45 : 1), t, 0.05);
    this.sc.frequency.setTargetAtTime(rpm * 0.42, t, 0.04);
    this.scGain.gain.setTargetAtTime(sp.supercharged ? 0.028 * Math.pow(clamp(tele.rpmN, 0, 1), 2.5) * (idle ? 0.3 : 1) : 0, t, 0.06);
    const v = clamp(tele.speed / 30, 0, 1);
    this.rush.g.gain.setTargetAtTime(tele.wet * (0.04 + v * 0.42), t, 0.08);
    this.rush.f.frequency.setTargetAtTime(280 + v * 1100, t, 0.1);
    this.hiss.g.gain.setTargetAtTime(clamp(sprayLevel, 0, 1) * 0.3, t, 0.06);
    this.wind.g.gain.setTargetAtTime(v * v * 0.2, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(500 + v * 1300, t, 0.1);
    this.amb.g.gain.setTargetAtTime(0.06, t, 0.5);
  }
}
