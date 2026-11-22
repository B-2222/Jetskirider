// Synthesised Sea-Doo sound. No audio files.
//
// Engine: like a sample-based racing game. At start-up we synthesise short,
// seamlessly looping recordings of a three-cylinder four-stroke at several
// rpm points, on throttle and off throttle. Each loop is a train of firing
// pulses (with the uneven, lumpy cylinder-to-cylinder spacing of a real
// triple) run through fixed exhaust and hull resonances. Live, the two loops
// nearest the current rpm are crossfaded and nudged in pitch, so the
// resonances stay put while the firing note sweeps, which is what makes it
// sound like an engine rather than a tape speeding up.
//
// On top: the wet exhaust gurgle, jet pump whine and water roar, supercharger
// whine, turbo spool and compressor flutter, a rev limiter that bounces off
// the cut when the pump runs dry, and hull slaps, splashes, spray and wind.

import { clamp, smoothstep, makeRng } from './util.js';

function character(spec) {
  if (spec.twoStroke) {
    // two-stroke twin: fires every revolution on each cylinder, through a
    // ringing expansion chamber: high, raspy and busy ("braap")
    return { fires: 4, cylOff: [0, 0.012, 0.004, 0.016], cylAmp: [1, 0.86, 0.97, 0.9], f: [160, 440, 1020, 2450], bw: [85, 170, 360, 1000], g: [0.8, 0.8, 0.52, 0.3], noise: 0.95, lump: 0.15, thump: 0.7, seed: 13 };
  }
  if (spec.style === 'spark') {
    // 900 ACE: smaller, raspier, higher resonances
    return { f: [124, 350, 840, 1950], bw: [70, 140, 300, 900], g: [1.0, 0.62, 0.36, 0.16], noise: 0.55, lump: 0.1, thump: 0.9, seed: 3 };
  }
  if (spec.turbo) {
    // built motor with a big cam: deeper, lumpier, more bark
    return { f: [82, 240, 560, 1320], bw: [52, 110, 240, 700], g: [1.0, 0.72, 0.44, 0.22], noise: 0.75, lump: 0.17, thump: 1.15, seed: 9 };
  }
  // 1630 ACE
  return { f: [92, 272, 645, 1540], bw: [58, 120, 260, 760], g: [1.0, 0.64, 0.38, 0.18], noise: 0.6, lump: 0.11, thump: 1.0, seed: 5 };
}

// One seamless loop of engine sound at roughly `rpm`.
function synthLoop(sr, rpm, ch, onLoad) {
  const tc = 120 / rpm; // one full four-stroke cycle (two revolutions)
  const cycles = Math.max(3, Math.round(0.55 / tc));
  const len = Math.round(cycles * tc * sr);
  const realRpm = (cycles * 120 * sr) / len;
  const spc = len / cycles;
  const rng = makeRng(ch.seed * 7919 + Math.round(rpm) * 3 + (onLoad ? 1 : 0));
  const ex = new Float32Array(len);
  // a triple fires every 240 degrees, but real ones are never perfectly even
  // a triple four-stroke fires 3 times per two revolutions; a twin
  // two-stroke 4 times. Real engines are never perfectly even.
  const fires = ch.fires || 3;
  const cylOff = ch.cylOff || [0, 0.02, -0.014];
  const cylAmp = ch.cylAmp || [1, 0.84, 0.93];
  const pw = Math.max(2, Math.round(sr * 0.00045));
  const nd = sr * (onLoad ? 0.0032 : 0.0014);
  const nlen = Math.round(nd * 5);
  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k < fires; k++) {
      // no two combustion events are the same: vary strength and timing
      let a = cylAmp[k] * (1 + (rng() - 0.5) * ch.lump * 2) * (0.8 + rng() * 0.4);
      if (!onLoad) {
        a *= 0.32 + rng() * 0.22;
        if (rng() < 0.07) a *= 0.15; // the odd weak, lazy fire on overrun
      }
      const pos = Math.floor((c + (k + cylOff[k] + (rng() - 0.5) * 0.025) / fires) * spc);
      for (let i = 0; i < pw; i++) ex[(pos + i) % len] += a * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / pw));
      const na = a * ch.noise * (onLoad ? 1 : 0.45);
      for (let i = 0; i < nlen; i++) ex[(pos + i) % len] += na * (rng() * 2 - 1) * Math.exp(-i / nd) * 0.6;
    }
  }
  const out = new Float32Array(len);
  const loadG = onLoad ? [1, 1, 1, 1] : [1, 0.75, 0.42, 0.22];
  for (let j = 0; j < 4; j++) {
    const w = (2 * Math.PI * ch.f[j]) / sr;
    const r = Math.exp((-Math.PI * ch.bw[j]) / sr);
    const a1 = 2 * r * Math.cos(w);
    const a2 = -r * r;
    const g = ch.g[j] * loadG[j] * (1 - r) * 2 * Math.sin(w) * 6;
    let y1 = 0;
    let y2 = 0;
    // two passes: the second starts with the tail of the first, so the loop
    // point is seamless
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < len; i++) {
        const y = ex[i] + a1 * y1 + a2 * y2;
        y2 = y1;
        y1 = y;
        if (pass) out[i] += y * g;
      }
    }
  }
  // the pressure pulse itself: a soft low thump on every firing. It gives
  // idle its putt-putt but would drone at high rpm, so it fades as revs rise.
  const thumpG = ch.thump * (onLoad ? 1 : 0.7) * clamp(1.45 - rpm / 6500, 0.3, 1);
  {
    const al = 1 - Math.exp((-2 * Math.PI * 150) / sr);
    let s1 = 0;
    let s2 = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < len; i++) {
        s1 += (ex[i] * 14 - s1) * al;
        s2 += (s1 - s2) * al;
        if (pass) out[i] += s2 * thumpG;
      }
    }
  }
  let mean = 0;
  for (let i = 0; i < len; i++) mean += out[i];
  mean /= len;
  let rms = 0;
  for (let i = 0; i < len; i++) {
    out[i] -= mean;
    rms += out[i] * out[i];
  }
  rms = Math.sqrt(rms / len) || 1;
  const k = (onLoad ? 0.26 : 0.17) / rms;
  for (let i = 0; i < len; i++) out[i] = Math.tanh(out[i] * k * 1.1) / 1.1;
  return { data: out, rpm: realRpm };
}

// Compressor surge after a hard lift: "chu-tu-tu-tu-tu". Each pulse is air
// slamming back through the compressor wheel: a sharp resonant chuff with a
// tiny whistle on top. They start fast and slow down as the surge winds out.
function synthFlutter(sr, seed) {
  const rng = makeRng(seed);
  const len = Math.round(sr * 1.25);
  const d = new Float32Array(len);
  let t = 0.006;
  let rate = 22 + rng() * 6;
  const pulses = 9 + Math.floor(rng() * 5);
  const res = (f, bw) => {
    const w = (2 * Math.PI * f) / sr;
    const r = Math.exp((-Math.PI * bw) / sr);
    return { a1: 2 * r * Math.cos(w), a2: -r * r, g: (1 - r) * 2 * Math.sin(w) * 4 };
  };
  for (let k = 0; k < pulses && t < 1.12; k++) {
    const amp = Math.pow(0.84, k) * (0.8 + rng() * 0.4) * (k === 0 ? 1.25 : 1);
    const f0 = 820 + rng() * 280 - k * 26;
    const R1 = res(f0, 170);
    const R2 = res(f0 * 2.15, 420);
    const p0 = Math.floor(t * sr);
    const win = Math.floor(sr * 0.075);
    let y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    const exLen = sr * (0.0035 + rng() * 0.0015);
    for (let i = 0; i < win && p0 + i < len; i++) {
      const tt = i / sr;
      const ex = i < exLen * 3 ? (rng() * 2 - 1) * Math.exp(-i / exLen) : 0;
      const y = ex + R1.a1 * y1 + R1.a2 * y2;
      y2 = y1;
      y1 = y;
      const z = ex + R2.a1 * z1 + R2.a2 * z2;
      z2 = z1;
      z1 = z;
      // the little whistle: a fast downward chirp
      const chirp = Math.sin(2 * Math.PI * (2600 * tt - 9000 * tt * tt)) * Math.exp(-tt / 0.012) * 0.12;
      const thump = Math.sin(2 * Math.PI * 120 * tt) * Math.exp(-tt / 0.02) * 0.35;
      d[p0 + i] += amp * (y * R1.g + z * R2.g * 0.45 + ex * 0.22 + chirp + thump);
    }
    t += (1 / rate) * (0.9 + rng() * 0.2);
    rate *= 0.92;
  }
  // band-limit and normalise
  let hp = 0, prev = 0, lp = 0, pk = 0;
  const ah = Math.exp((-2 * Math.PI * 180) / sr);
  const al = 1 - Math.exp((-2 * Math.PI * 4200) / sr);
  for (let i = 0; i < len; i++) {
    hp = ah * (hp + d[i] - prev);
    prev = d[i];
    lp += (hp - lp) * al;
    d[i] = lp;
    pk = Math.max(pk, Math.abs(lp));
  }
  for (let i = 0; i < len; i++) d[i] = (d[i] / (pk || 1)) * 0.92;
  return d;
}

// Anti-lag bang: fuel lighting off in the exhaust. A crack, a low boom and a
// crackling tail. Small ones are the pops in between.
function synthBang(sr, seed, big) {
  const rng = makeRng(seed);
  const len = Math.round(sr * 0.4);
  const d = new Float32Array(len);
  const crackT = sr * (big ? 0.016 : 0.008);
  const bodyT = sr * (big ? 0.05 : 0.025);
  const boomT = sr * (big ? 0.11 : 0.05);
  const f0 = big ? 88 + rng() * 20 : 120 + rng() * 40;
  let lpC = 0, lpB = 0;
  const aC = 1 - Math.exp((-2 * Math.PI * 4800) / sr);
  const aB = 1 - Math.exp((-2 * Math.PI * 900) / sr);
  for (let i = 0; i < len; i++) {
    const n = rng() * 2 - 1;
    lpC += (n - lpC) * aC;
    lpB += (n - lpB) * aB;
    const tt = i / sr;
    const att = Math.min(1, i / (sr * 0.0004));
    const crack = lpC * Math.exp(-i / crackT) * 1.3;
    const body = lpB * Math.exp(-i / bodyT) * 2.2;
    const boom = Math.sin(2 * Math.PI * f0 * tt * (1 - tt * 1.5)) * Math.exp(-i / boomT) * (big ? 0.9 : 0.4);
    d[i] = att * (crack + body + boom);
  }
  // crackle: sparse clicks dying away
  const clicks = big ? 14 : 5;
  for (let k = 0; k < clicks; k++) {
    const p0 = Math.floor(sr * (0.02 + Math.pow(rng(), 1.6) * (big ? 0.3 : 0.15)));
    const a = (0.25 + rng() * 0.4) * (1 - p0 / len);
    for (let i = 0; i < sr * 0.0025 && p0 + i < len; i++) d[p0 + i] += a * (rng() * 2 - 1) * Math.exp(-i / (sr * 0.0006));
  }
  let pk = 0;
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] = Math.tanh((d[i] / (pk || 1)) * 1.4) * 0.9;
  return d;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
    this.limiter = 0;
    this.boost = 0;
    this.shaft = 0;
    this.prevThr = 0;
    this.flutterCool = 0;
    this.slapCool = 0;
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
    const sr = ctx.sampleRate;

    // --- master: tame the top end, glue it together ------------------------
    const master = ctx.createGain();
    master.gain.value = 0;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 4200;
    shelf.gain.value = -6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.006;
    comp.release.value = 0.2;
    master.connect(shelf).connect(comp).connect(ctx.destination);
    this.master = master;

    // --- shared noise ------------------------------------------------------
    const nb = ctx.createBuffer(1, sr * 3, sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    // slow random wobble for the wet exhaust gurgle
    const gb = ctx.createBuffer(1, sr * 4, sr);
    const gd = gb.getChannelData(0);
    {
      let a = 0;
      let b = 0;
      const k = 1 - Math.exp((-2 * Math.PI * 16) / sr);
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < gd.length; i++) {
          a += (Math.random() * 2 - 1 - a) * k;
          b += (a - b) * k;
          if (pass) gd[i] = b;
        }
      }
      let pk = 0;
      for (let i = 0; i < gd.length; i++) pk = Math.max(pk, Math.abs(gd[i]));
      for (let i = 0; i < gd.length; i++) gd[i] /= pk || 1;
    }
    const noise = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = nb;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g);
      src.start(0, Math.random() * 2.5);
      return { f, g };
    };

    // --- engine bus ----------------------------------------------------------
    this.engMix = ctx.createGain();
    const drive = ctx.createGain();
    drive.gain.value = 1;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 900;
    tone.Q.value = 0.6;
    const chest = ctx.createBiquadFilter();
    chest.type = 'peaking';
    chest.frequency.value = 170;
    chest.Q.value = 0.8;
    chest.gain.value = 3;
    const engGain = ctx.createGain();
    engGain.gain.value = 0;
    this.engMix.connect(drive).connect(shaper).connect(tone).connect(chest).connect(engGain).connect(master);
    this.drive = drive;
    this.tone = tone;
    this.engGain = engGain;

    // wet exhaust: the water in the muffler makes the note wobble and burble
    const gur = ctx.createBufferSource();
    gur.buffer = gb;
    gur.loop = true;
    const gurAmp = ctx.createGain();
    gurAmp.gain.value = 0;
    gur.connect(gurAmp).connect(engGain.gain);
    gur.start();
    this.gurAmp = gurAmp;

    // rev limiter: an ignition cut that bounces ~11 times a second
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 11;
    const limAmp = ctx.createGain();
    limAmp.gain.value = 0;
    lfo.connect(limAmp).connect(engGain.gain);
    const limSmooth = ctx.createBiquadFilter();
    limSmooth.type = 'lowpass';
    limSmooth.frequency.value = 30;
    const limPitch = ctx.createGain();
    limPitch.gain.value = 0;
    lfo.connect(limSmooth).connect(limPitch);
    lfo.start();
    this.lfo = lfo;
    this.limAmp = limAmp;
    this.limPitch = limPitch;

    // intake roar: broadband air noise pulsing with every firing
    this.intake = noise('bandpass', 700, 0.7);
    const inGain = ctx.createGain();
    inGain.gain.value = 0;
    this.intake.g.gain.value = 1;
    this.intake.g.connect(inGain).connect(master);
    const inLfo = ctx.createOscillator();
    inLfo.type = 'sine';
    const inDepth = ctx.createGain();
    inDepth.gain.value = 0;
    inLfo.connect(inDepth).connect(inGain.gain);
    inLfo.start();
    this.inGain = inGain;
    this.inLfo = inLfo;
    this.inDepth = inDepth;
    // tiny, constant rpm wander so the note never sits dead still
    const wob = ctx.createGain();
    wob.gain.value = 0.006;
    gur.connect(wob);
    this.wobble = wob;

    // --- jet pump --------------------------------------------------------------
    this.pumpRoar = noise('bandpass', 400, 0.9);
    this.pumpRoar.g.connect(master);
    const imp = ctx.createOscillator();
    imp.type = 'triangle';
    const impF = ctx.createBiquadFilter();
    impF.type = 'bandpass';
    impF.Q.value = 6;
    const impG = ctx.createGain();
    impG.gain.value = 0;
    imp.connect(impF).connect(impG).connect(master);
    imp.start();
    this.imp = imp;
    this.impF = impF;
    this.impG = impG;
    this.vent = noise('highpass', 1700, 0.5); // pump sucking air
    this.vent.g.connect(master);

    // --- forced induction --------------------------------------------------------
    const sc1 = ctx.createOscillator();
    const sc2 = ctx.createOscillator();
    sc1.type = sc2.type = 'sine';
    const scG = ctx.createGain();
    scG.gain.value = 0;
    const sc2G = ctx.createGain();
    sc2G.gain.value = 0.3;
    sc1.connect(scG);
    sc2.connect(sc2G).connect(scG);
    scG.connect(master);
    sc1.start();
    sc2.start();
    this.sc1 = sc1;
    this.sc2 = sc2;
    this.scG = scG;
    // turbo: compressor whine (three partials with a slow wobble) and the
    // intake whoosh, both following the turbo shaft speed
    const twG = ctx.createGain();
    twG.gain.value = 0;
    twG.connect(master);
    const twWob = ctx.createOscillator();
    twWob.frequency.value = 5.3;
    const wobG = ctx.createGain();
    wobG.gain.value = 9; // cents
    twWob.connect(wobG);
    twWob.start();
    this.tw = [];
    for (const [mult, g] of [[1, 1], [2, 0.32], [0.5, 0.22]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(twG);
      wobG.connect(o.detune);
      o.start();
      this.tw.push({ o, mult });
    }
    this.twG = twG;
    this.whoosh = noise('bandpass', 1500, 2.2);
    this.whoosh.g.connect(master);
    const mkBuf = (data) => {
      const b = ctx.createBuffer(1, data.length, sr);
      b.getChannelData(0).set(data);
      return b;
    };
    this.flutterBufs = [11, 23, 37, 51].map((seed) => mkBuf(synthFlutter(sr, seed)));
    this.bangBufs = [1, 2, 3].map((seed) => mkBuf(synthBang(sr, seed, true)));
    this.popBufs = [4, 5, 6, 7].map((seed) => mkBuf(synthBang(sr, seed, false)));
    this.nextBang = 0;

    // --- water + air -------------------------------------------------------------
    this.rush = noise('lowpass', 420, 0.4);
    this.hiss = noise('bandpass', 3000, 0.5);
    this.wind = noise('bandpass', 800, 0.35);
    this.lap = noise('lowpass', 240, 0.4);
    this.surfRoar = noise('lowpass', 500, 0.5); // breaking waves
    for (const n of [this.rush, this.hiss, this.wind, this.lap, this.surfRoar]) n.g.connect(master);

    this.ready = true;
    this.setSpec(spec);
    master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.85, ctx.currentTime + 0.8);
  }

  // (Re)build the engine loops for this ski.
  setSpec(spec) {
    this.spec = spec;
    if (!this.ready) return;
    const ctx = this.ctx;
    const key = spec.style + (spec.turbo ? 't' : '') + (spec.twoStroke ? '2' : '') + spec.idleRpm + '-' + spec.maxRpm;
    if (key === this.loopKey) return;
    this.loopKey = key;
    const ch = character(spec);
    if (this.loops) {
      const t = ctx.currentTime;
      for (const l of this.loops) {
        l.g.gain.setTargetAtTime(0, t, 0.05);
        l.src.stop(t + 0.4);
      }
    }
    const lo = spec.idleRpm * 0.9;
    const hi = spec.maxRpm * 1.06;
    const n = Math.max(5, Math.ceil(Math.log(hi / lo) / Math.log(1.33)) + 1);
    this.points = [];
    this.loops = [];
    for (let i = 0; i < n; i++) {
      const rpm = lo * Math.pow(hi / lo, i / (n - 1));
      const pt = { rpm: 0, on: null, off: null };
      for (const onLoad of [true, false]) {
        const L = synthLoop(ctx.sampleRate, rpm, ch, onLoad);
        const b = ctx.createBuffer(1, L.data.length, ctx.sampleRate);
        b.getChannelData(0).set(L.data);
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(this.engMix);
        this.limPitch.connect(src.playbackRate);
        this.wobble.connect(src.playbackRate);
        src.start(0, Math.random() * b.duration);
        const loop = { src, g, rpm: L.rpm };
        this.loops.push(loop);
        pt.rpm = L.rpm;
        if (onLoad) pt.on = loop;
        else pt.off = loop;
      }
      this.points.push(pt);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  oneShotNoise(t, cutoff, peak, decay, offset = Math.random() * 2) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, offset);
    src.stop(t + decay + 0.05);
  }

  thump(t, f0, f1, peak, decay) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + decay * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  // big landing
  splash(strength) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const s = clamp(strength, 0, 1);
    this.oneShotNoise(t, 500 + s * 2000, 0.25 + s * 0.75, 0.5 + s * 0.8);
    this.oneShotNoise(t + 0.06, 2500, 0.08 + s * 0.2, 0.9 + s * 0.6);
    this.thump(t, 105, 36, 0.4 + s * 0.6, 0.32);
  }

  // hull slapping over chop
  slap(strength) {
    if (!this.ready || this.muted || this.slapCool > 0) return;
    this.slapCool = 0.09;
    const t = this.ctx.currentTime;
    const s = clamp(strength, 0, 1);
    this.oneShotNoise(t, 700 + s * 900, 0.08 + s * 0.22, 0.16 + s * 0.12);
    this.thump(t, 90, 48, 0.12 + s * 0.3, 0.14);
  }

  flutter(amount) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.flutterBufs[(Math.random() * this.flutterBufs.length) | 0];
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const g = ctx.createGain();
    g.gain.value = 0.3 + amount * 0.5;
    src.connect(g).connect(this.master);
    src.start();
  }

  bang(at, big, amount) {
    const ctx = this.ctx;
    const bufs = big ? this.bangBufs : this.popBufs;
    const src = ctx.createBufferSource();
    src.buffer = bufs[(Math.random() * bufs.length) | 0];
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const g = ctx.createGain();
    g.gain.value = (big ? 0.55 : 0.32) * amount * (0.7 + Math.random() * 0.4);
    src.connect(g).connect(this.master);
    src.start(at);
  }

  // tele: physics telemetry, ctrl: rider controls, idle: menu (quieter)
  update(tele, ctrl, sprayLevel, idle, dt = 1 / 60) {
    if (!this.ready || !this.points) return;
    const sp = this.spec;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const thr = clamp(ctrl ? ctrl.throttle : 0, 0, 1);
    this.slapCool -= dt;

    // --- rpm + limiter ---------------------------------------------------------
    const frac = (tele.rpmN - 0.11) / 0.89;
    const lim = tele.lcArmed ? 1 : smoothstep(1.005, 1.035, tele.rpmN) * smoothstep(0.4, 0.7, thr);
    if (sp.turbo) this.boost = tele.boost || 0;
    this.limiter = lim;
    const rpm = sp.idleRpm + (sp.maxRpm - sp.idleRpm) * clamp(frac, 0, 1);
    this.rpm = rpm;
    const load = clamp(thr * (0.35 + 0.65 * tele.pumpLoad) + tele.power * 0.25, 0, 1);
    this.loadS = this.loadS === undefined ? load : this.loadS + (load - this.loadS) * Math.min(1, dt * 10);
    const L = this.loadS;

    // pick the two loops either side of the current rpm and crossfade them
    const P = this.points;
    let i = 0;
    while (i < P.length - 2 && rpm > P[i + 1].rpm) i++;
    const x = clamp(Math.log(rpm / P[i].rpm) / Math.log(P[i + 1].rpm / P[i].rpm), 0, 1);
    const wOn = Math.sqrt(L);
    const wOff = Math.sqrt(1 - L);
    for (let k = 0; k < P.length; k++) {
      const w = k === i ? Math.cos((x * Math.PI) / 2) : k === i + 1 ? Math.sin((x * Math.PI) / 2) : 0;
      for (const [loop, lw] of [[P[k].on, wOn], [P[k].off, wOff]]) {
        loop.src.playbackRate.setTargetAtTime(clamp(rpm / loop.rpm, 0.5, 2), t, 0.025);
        loop.g.gain.setTargetAtTime(w * lw, t, 0.03);
      }
    }

    // --- engine tone and level ---------------------------------------------------
    // the exhaust is muffled by water; out of the water it opens right up
    const open = clamp(Math.max(tele.exposure || 0, tele.airborne ? 1 : 0), 0, 1);
    const rn = clamp(frac, 0, 1);
    this.tone.frequency.setTargetAtTime(520 + 1500 * L * (0.5 + 0.5 * rn) + 600 * rn + 1700 * open, t, 0.06);
    this.drive.gain.setTargetAtTime(0.75 + 1.1 * L + (sp.turbo ? this.boost * 0.6 : 0), t, 0.05);
    let base = (0.2 + 0.24 * L + 0.1 * rn) * (1 + 0.3 * open) * (idle ? 0.45 : 1);
    if (sp.turbo) base *= 1 + this.boost * 0.25;
    // limiter: the ignition cut takes most of the sound away for a moment
    const cutDepth = lim * 0.42;
    this.engGain.gain.setTargetAtTime(base * (1 - cutDepth), t, 0.03);
    this.limAmp.gain.setTargetAtTime(base * cutDepth, t, 0.03);
    this.limPitch.gain.setTargetAtTime(lim * 0.035, t, 0.03);
    // the launch two-step stutters faster than the top-end limiter
    this.lfo.frequency.setTargetAtTime(tele.lcArmed ? 15 + Math.random() * 2 : 10.5 + Math.random() * 1.5, t, 0.08);
    // more gurgle at idle and when sitting deep, almost none flat out
    this.gurAmp.gain.setTargetAtTime(base * (0.32 * (1 - rn) + 0.06) * (1 - open * 0.8), t, 0.1);

    // intake roar, strongest on load at high rpm
    const fire = (rpm / 60) * (sp.twoStroke ? 2 : 1.5);
    const ig = base * (0.05 + 0.5 * L * rn * rn) * (1 - lim * 0.5);
    this.intake.f.frequency.setTargetAtTime(520 + 900 * rn, t, 0.06);
    this.inLfo.frequency.setTargetAtTime(fire, t, 0.03);
    this.inGain.gain.setTargetAtTime(ig, t, 0.04);
    this.inDepth.gain.setTargetAtTime(ig * 0.7, t, 0.04);

    // --- jet pump ------------------------------------------------------------------
    const flow = tele.power * tele.pumpLoad;
    this.pumpRoar.f.frequency.setTargetAtTime(220 + 1000 * rn, t, 0.08);
    this.pumpRoar.g.gain.setTargetAtTime(flow * 0.11 * (idle ? 0.4 : 1), t, 0.08);
    const bpf = (rpm / 60) * 3; // impeller blade passing
    this.imp.frequency.setTargetAtTime(bpf, t, 0.03);
    this.impF.frequency.setTargetAtTime(bpf, t, 0.03);
    this.impG.gain.setTargetAtTime(flow * 0.012, t, 0.08);
    const pl = tele.pumpLoad;
    this.vent.g.gain.setTargetAtTime(tele.power * 4 * pl * (1 - pl) * 0.07, t, 0.05);

    // --- supercharger ------------------------------------------------------------------
    const scF = rpm * 0.31;
    this.sc1.frequency.setTargetAtTime(scF, t, 0.04);
    this.sc2.frequency.setTargetAtTime(scF * 2.01, t, 0.04);
    this.scG.gain.setTargetAtTime(sp.supercharged ? 0.014 * Math.pow(rn, 2.2) * (0.35 + 0.65 * L) * (idle ? 0.3 : 1) : 0, t, 0.06);

    // --- turbo ---------------------------------------------------------------------------
    if (sp.turbo) {
      const boost = this.boost;
      // shaft speed follows boost up and coasts down slowly
      const prevShaft = this.shaft;
      this.shaft += (boost - this.shaft) * Math.min(1, dt / (boost > this.shaft ? 0.22 : 1.6));
      const rising = Math.max(0, (this.shaft - prevShaft) / Math.max(dt, 1e-3));
      this.flutterCool -= dt;
      if (this.prevThr > 0.55 && thr < 0.3 && boost > 0.3 && this.flutterCool <= 0) {
        this.flutter(tele.als ? boost * 0.45 : boost);
        this.flutterCool = 0.6;
      }
      const sh = this.shaft;
      const f1 = 650 + 3500 * Math.pow(sh, 1.3);
      for (const { o, mult } of this.tw) o.frequency.setTargetAtTime(f1 * mult, t, 0.04);
      const spool = clamp(rising * 0.8, 0, 1);
      this.twG.gain.setTargetAtTime((0.026 * Math.pow(sh, 1.5) * (0.35 + 0.65 * L) + 0.012 * spool) * (idle ? 0.3 : 1), t, 0.04);
      this.whoosh.f.frequency.setTargetAtTime(700 + 2400 * sh, t, 0.05);
      this.whoosh.g.gain.setTargetAtTime((0.08 * boost * (0.3 + 0.7 * L) + 0.07 * spool) * (idle ? 0.3 : 1), t, 0.05);
      // anti-lag (two-step on the line, rolling ALS off throttle): bangs and pops
      if (tele.als && !idle) {
        const amt = 0.5 + 0.5 * boost;
        if (this.nextBang < t) this.nextBang = t + 0.01;
        while (this.nextBang < t + 0.12) {
          const big = Math.random() < (tele.lcArmed ? 0.4 : 0.3);
          this.bang(this.nextBang, big, amt);
          this.nextBang += tele.lcArmed ? 0.055 + Math.random() * 0.07 : 0.07 + Math.random() * 0.15;
        }
      }
    } else {
      this.shaft = this.boost = 0;
      this.twG.gain.setTargetAtTime(0, t, 0.05);
      this.whoosh.g.gain.setTargetAtTime(0, t, 0.05);
    }
    this.prevThr = thr;

    // --- water + air ---------------------------------------------------------------------
    const v = clamp(tele.speed / 30, 0, 1.3);
    this.rush.g.gain.setTargetAtTime(tele.wet * (0.03 + v * 0.3), t, 0.08);
    this.rush.f.frequency.setTargetAtTime(260 + v * 900, t, 0.1);
    this.hiss.g.gain.setTargetAtTime(clamp(sprayLevel, 0, 1) * 0.22, t, 0.06);
    this.wind.g.gain.setTargetAtTime(v * v * 0.14 + (tele.airborne ? 0.05 : 0), t, 0.1);
    this.wind.f.frequency.setTargetAtTime(450 + v * 1100, t, 0.1);
    const roar = clamp(this.surfLevel || 0, 0, 1);
    this.surfRoar.g.gain.setTargetAtTime(roar * 0.34, t, 0.2);
    this.surfRoar.f.frequency.setTargetAtTime(330 + 600 * roar, t, 0.2);
    const lapping = (1 - smoothstep(1, 6, tele.speed)) * tele.wet;
    this.lap.g.gain.setTargetAtTime(lapping * (0.05 + 0.04 * Math.sin(t * 1.7) * Math.sin(t * 0.63)), t, 0.2);
  }
}
