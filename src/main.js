// Jetski Rider - game bootstrap and main loop.

import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, wrapAngle } from './util.js';
import { Waves, SEA_STATES, WAVE_ZONE } from './waves.js';
import { Terrain, World } from './terrain.js';
import { SKIS, TRIMX, tunedSpec, trimxBase } from './specs.js';
import { SkiPhysics } from './physics.js';
import { makeNoiseTexture, makeWaterNormalTexture, makeHeightTexture } from './textures.js';
import { Sky, TIMES } from './sky.js';
import { Ocean, FoamField } from './water.js';
import { Spray } from './particles.js';
import { Breakers } from './breakers.js';
import { SkiEffects } from './effects.js';
import { JetStream } from './jetstream.js';
import { WetLens } from './wetlens.js';
import { todAt, DAY_LEN, PRESET_PHASE, clockText, hourOf, phaseOfHour } from './daycycle.js';
import { unlock, FUN } from './world.js';
import { SURF } from './surf.js';
import { MAPS, mapById, applyMap } from './maps.js';
import { Career, START_SKI, CASH_PER_POINT, RACE_PAY, SPRAY_PAY, money } from './career.js';
import { Accounts, authError } from './accounts.js';
import { MISSIONS, checkMissions } from './missions.js';
import { Race, clock, QUEUE_S } from './races.js';
import { Rain } from './rain.js';

// names come from other players: keep them out of anything read as HTML
const plain = (s) => String(s || '').replace(/[<>&"'`]/g, '');
import { JetskiModel } from './jetski.js';
import { Rider } from './rider.js';
import { buildTerrainMesh, buildVegetation, buildRampMesh, buildZoneArch, Buoys } from './scenery.js';
import { Input, PAD } from './input.js';
import { Multiplayer, LOBBIES, MAX_PER_LOBBY } from './multiplayer.js';
import { Audio } from './audio.js';
import { Tricks } from './tricks.js';
import { EffectComposer } from '../vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/addons/postprocessing/ShaderPass.js';
import { OutputPass } from '../vendor/addons/postprocessing/OutputPass.js';

// Final grade before tone mapping: a touch more colour and a soft vignette.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.24 }, uSat: { value: 1.07 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVig, uSat;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = max(mix(vec3(l), c.rgb, uSat), 0.0);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVig * smoothstep(0.2, 0.9, dot(d, d) * 2.0);
      gl_FragColor = c;
    }`,
};

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('jetski-rider-' + k);
      return v === null ? d : v;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('jetski-rider-' + k, String(v));
    } catch {
      /* private mode etc. */
    }
  },
};

// The map is picked before the world is built (switching maps reloads the
// page), so every module sees the same islands, surf and spawn point.
const MAP = applyMap(mapById(params.get('map') || store.get('map', 'bay')));
const SPAWN = MAP.spawn;
{
  const t = document.getElementById('loadText');
  if (t) t.textContent = MAP.load;
}

// The storm map's weather: greyer light, darker water, less sun.
function moodify(t, m) {
  for (const k of ['sun', 'zenith', 'horizon', 'glow', 'cloudLit', 'cloudShade']) {
    const c = t[k];
    const l = c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;
    const dk = k === 'sun' ? 1 : m.dark;
    for (let j = 0; j < 3; j++) c[j] = (c[j] + (l - c[j]) * m.grey) * dk;
  }
  for (const k of ['deep', 'shallow']) for (let j = 0; j < 3; j++) t[k][j] *= m.water[j];
  t.sunPower *= m.sun;
  t.exposure *= m.exposure;
  t.ambient *= 0.85;
}

// Xbox button glyph for hints
const PB_LABEL = { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', LS: 'LS', RS: 'RS', VIEW: 'VIEW', MENU: 'MENU', UP: '▲', DOWN: '▼', LEFT: '◀', RIGHT: '▶' };
const pb = (k) => `<span class="pb pb-${k}">${PB_LABEL[k]}</span>`;
// wave zone entry: downwave of the swell, pointing into it
const ZONE_IN = (() => {
  const hx = -Math.cos(WAVE_ZONE.dir);
  const hz = -Math.sin(WAVE_ZONE.dir);
  const r = WAVE_ZONE.rOut + 60;
  return { x: WAVE_ZONE.x - hx * r, z: WAVE_ZONE.z - hz * r, yaw: Math.atan2(-hz, hx), hx, hz };
})();
const FIXED = 1 / 240;

class Game {
  constructor() {
    this.canvas = $('gl');
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.mobile = coarse;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !coarse, powerPreference: 'high-performance' });
    this.maxPR = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    if (params.get('pr')) this.maxPR = parseFloat(params.get('pr'));
    this.pr = this.maxPR;
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.15, 20000);
    // bloom on the brightest highlights (sun glints, backlit spray), a light
    // grade and a vignette. Desktop only; it switches itself off if the frame
    // rate struggles (?bloom=0 turns it off).
    this.setupPost(!coarse && params.get('bloom') !== '0');

    // --- world -------------------------------------------------------------
    this.waves = new Waves();
    this.terrain = new Terrain();
    this.world = new World(this.waves, this.terrain);
    for (const r of MAP.ramps) this.world.addRamp(r[0], r[1], r[2]);

    this.noiseTex = makeNoiseTexture();
    this.normalTex = makeWaterNormalTexture();
    this.heightTex = makeHeightTexture(this.terrain);

    this.sky = new Sky(this.noiseTex);
    this.scene.add(this.sky.mesh);
    this.foam = new FoamField(this.renderer);
    this.ocean = new Ocean({ waves: this.waves, sky: this.sky, noiseTex: this.noiseTex, normalTex: this.normalTex, heightTex: this.heightTex, foam: this.foam });
    this.scene.add(this.ocean.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -4.5;
    sc.right = 4.5;
    sc.top = 4.5;
    sc.bottom = -4.5;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x224455, 0.5);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0xffffff, 1 / 7000); // a long way before the haze closes in

    this.terrainMesh = buildTerrainMesh(this.terrain);
    this.scene.add(this.terrainMesh);
    this.scene.add(buildVegetation(this.terrain, MAP.veg));
    for (const r of this.world.ramps) this.scene.add(buildRampMesh(this.world, r));
    this.buoys = new Buoys(this.world, this.makeBuoyList());
    this.scene.add(this.buoys.group);
    this.scene.add(buildZoneArch(ZONE_IN.x + ZONE_IN.hx * 30, ZONE_IN.z + ZONE_IN.hz * 30, ZONE_IN.yaw));
    // the map's buoy race
    this.race = new Race(this.world, MAP.race);
    this.race.onEvent = (kind, d) => this.onRace(kind, d);
    this.scene.add(this.race.group);
    // weather
    if (MAP.mood) {
      this.sky.uniforms.uCloudCover.value = MAP.mood.cloud;
      this.scene.fog.density = 1 / MAP.mood.fog;
      if (MAP.mood.rain) {
        this.rain = new Rain();
        this.scene.add(this.rain.mesh);
      }
      this.boltT = 6 + Math.random() * 10;
      this.bolt = 0;
    }

    this.spray = new Spray({ max: coarse ? 11000 : 30000, noiseTex: this.noiseTex });
    this.spray.uniforms.uSunDir = this.sky.uniforms.uSunDir;
    this.spray.uniforms.uSunColor = this.sky.uniforms.uSunColor;
    this.scene.add(this.spray.mesh);
    this.breakers = new Breakers({ waves: this.waves, ocean: this.ocean, sky: this.sky, spray: this.spray, foam: this.foam });
    this.scene.add(this.breakers.mesh);
    this.breakers.camPos = this.camera.position;

    // --- player ------------------------------------------------------------
    // your progress: cash, skis owned, kits, missions, race times
    this.mapId = MAP.id;
    this.map = MAP;
    this.career = new Career();
    this.career.onChange = () => this.refreshCareerUi();
    // an email account keeps it (on the Firebase build)
    this.accounts = new Accounts(this.career);
    this.accounts.onChange = () => this.onAccount();
    this.careerKey = this.career.key;
    // the garage in price order
    this.order = SKIS.map((s, i) => i).sort((a, b) => (SKIS[a].price || 0) - (SKIS[b].price || 0));
    // the last ski you rode, if you own it (?ski= picks any, for testing)
    const oldIdx = parseInt(store.get('ski', '-1'), 10);
    const want = params.get('ski') || store.get('ski-id', SKIS[oldIdx] ? SKIS[oldIdx].id : START_SKI);
    let idx = SKIS.findIndex((s) => s.id === want);
    if (idx < 0 || (!params.get('ski') && !this.career.owns(SKIS[idx].id))) idx = SKIS.findIndex((s) => s.id === START_SKI);
    this.skiIndex = idx;
    this.cwIndex = {};
    this.spec = this.tuned(SKIS[this.skiIndex]);
    this.phys = new SkiPhysics(this.spec, this.world);
    this.effects = new SkiEffects(this.spray, this.foam, this.world);
    // the jet as a real stream of water, and the wash it throws up when the
    // pump is under the surface
    this.effects.jet = new JetStream(this.spray.uniforms);
    this.effects.wash = new JetStream(this.spray.uniforms, { wide: 1.7, sheath: 1.45 });
    this.scene.add(this.effects.jet.mesh, this.effects.wash.mesh);
    if (coarse) this.effects.density = 0.6;
    this.skiGroup = new THREE.Group();
    this.scene.add(this.skiGroup);
    this.input = new Input($('touch'));
    this.audio = new Audio();
    this.buildSki();
    this.tricks = new Tricks((label, pts, kind, combo, info) => {
      this.popTrick(label, pts, kind, this.earnTrick(pts, kind, info));
      if (kind !== 'note' && this.mp) this.mp.noteTrick(label, pts);
      this.missionEvent('trick', label);
      if (kind !== 'note') {
        this.missionEvent('combo', combo);
        this.missionEvent('score', this.tricks.score);
        if (info && info.air) this.missionEvent('air', info.air);
      }
    });
    this.wetLens = new WetLens(document.body);
    this.mp = new Multiplayer(this);
    this.mp.onChange = () => this.refreshMp();
    this.mp.onChat = (name, text, kind) => this.addChat(name, text, kind);
    this.input.onPadChange = () => this.refreshPadUi();
    this.input.onPadConnect = (gp) => {
      if (gp && gp.mapping === 'standard') this.showHint('Controller connected. ' + this.ctlHint(), 6);
    };
    this.tricks.zoneAt = (x, z) => this.waves.zoneMask(x, z);
    this.tricks.barrelAt = (x, z) => this.waves.surf.barrelAt(x, z, this.phys.time);
    this.tricks.rampAt = (x, z) => this.world.ramps.some((r) => Math.hypot(r.x - x, r.z - z) < 30);
    this.inZone = false;

    // --- state ---------------------------------------------------------------
    this.state = 'menu';
    this.hasRidden = false;
    // The time of day and the water belong to the shared world (the admin
    // sets them, the same for everyone); ?sea= and ?tod= pin them for testing.
    this.seaFixed = params.get('sea') !== null || MAP.sea != null;
    this.seaIndex = params.get('sea') !== null ? clamp(parseInt(params.get('sea'), 10) || 0, 0, SEA_STATES.length - 1) : MAP.sea != null ? MAP.sea : this.mp.world.sea;
    this.fixedPhase = params.get('tod') !== null ? PRESET_PHASE[TIMES[clamp(parseInt(params.get('tod'), 10) || 0, 0, TIMES.length - 1)].id] : null;
    this.camMode = 0;
    let fpsOn = true;
    try {
      fpsOn = localStorage.getItem('jetski-rider-fps') !== '0';
    } catch {
      /* storage unavailable */
    }
    this.showFps = fpsOn;
    $('fps').hidden = !fpsOn;
    this.cam = { yaw: SPAWN.yaw + Math.PI, pos: new THREE.Vector3(), look: new THREE.Vector3(), orbit: 0.6, shake: 0, userYaw: 0, userPitch: 0, userT: 0, fov: 60 };
    this.wipe = { on: false, t: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), flipT: 0 };
    this.safe = { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw, t: 0 };
    this.frameMs = 16;
    this.prTimer = 0;
    this.hintTimer = 0;
    this.stuckT = 0;
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();

    this.applySea(true);
    this.applyTime(true);
    this.mp.onWorld = (w) => this.applyWorld(w);
    this.mp.onGift = (amount) => {
      if (amount > 0) {
        this.career.earn(amount);
        this.toast('GIFT FROM THE ADMIN', 'You got ' + money(amount) + '!', amount);
      } else {
        const took = this.career.take(-amount);
        this.toast('THE ADMIN TOOK CASH', money(took) + ' was taken from your wallet', 0);
      }
    };
    // one wave clock for everyone, so friends in a lobby see the same surf
    // (start a second early: the settle below runs the clock forward)
    this.phys.time = this.mp.worldTime() - 1;
    this.phys.reset(SPAWN.x, SPAWN.z, SPAWN.yaw);
    this.setupUI();
    this.refreshMp();
    this.setupPointerOrbit();
    addEventListener('resize', () => this.resize());
    this.resize();

    // settle the hull on the water before the first frame
    for (let i = 0; i < 240; i++) this.phys.step(FIXED);
    this.syncSki();
    this.snapCamera();

    this.last = performance.now();
    $('loading').classList.add('done');
    $('menu').hidden = false;
    this.renderer.setAnimationLoop((t) => this.frame(t));
    if (params.get('autostart')) this.ride();
  }

  makeBuoyList() {
    const list = [];
    const red = 0xe53935;
    const yel = 0xffc81f;
    // slalom from the start to the first ramp (Palm Bay)
    if (MAP.slalom) for (let i = 0; i < 6; i++) list.push({ x: (i % 2 ? 7 : -7), z: -120 + i * 24, color: i % 2 ? red : yel });
    // ramp approach gates
    for (const r of this.world.ramps) {
      for (const s of [-1, 1]) {
        const lx = -14;
        const lz = s * 4.6;
        list.push({ x: r.x + lx * r.c + lz * r.s, z: r.z - lx * r.s + lz * r.c, color: s > 0 ? red : 0x2e9e4f, scale: 1.15 });
      }
    }
    // a wide slalom arc in the lagoon
    for (let i = 0; i < (MAP.slalom ? 14 : 0); i++) {
      const a = -0.6 + i * 0.26;
      const rad = 210 + (i % 2) * 22;
      const x = 60 + Math.cos(a) * rad;
      const z = 120 + Math.sin(a) * rad;
      if (this.terrain.heightAt(x, z) < -2) list.push({ x, z, color: i % 2 ? red : yel });
    }
    // big orange markers around the wave zone
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      list.push({ x: WAVE_ZONE.x + Math.cos(a) * (WAVE_ZONE.rOut + 15), z: WAVE_ZONE.z + Math.sin(a) * (WAVE_ZONE.rOut + 15), color: 0xff6a13, scale: 1.7 });
    }
    return list;
  }

  // ------------------------------------------------------------------ ski
  buildSki() {
    const spec = this.spec;
    const cwI = this.cwIndex[spec.id] ?? clamp(parseInt(store.get('cw-' + spec.id, '0'), 10) || 0, 0, spec.colorways.length - 1);
    this.cwIndex[spec.id] = cwI;
    const cw = spec.colorways[cwI];
    if (this.model) {
      this.skiGroup.remove(this.model.group);
      this.model.dispose();
    }
    if (this.rider) {
      this.rider.group.removeFromParent();
      this.rider.dispose();
    }
    this.model = new JetskiModel(spec, cw);
    this.skiGroup.add(this.model.group);
    this.rider = new Rider(cw);
    this.skiGroup.add(this.rider.group);
    this.phys.setSpec(spec);
    this.audio.setSpec(spec);
    this.ocean.uniforms.uSkiDim.value.set(spec.L * 0.56, spec.B * 0.62);
    document.documentElement.style.setProperty('--accent', '#' + new THREE.Color(cw.trim).getHexString());
    const lum = new THREE.Color(cw.trim).getHSL({}).l;
    document.documentElement.style.setProperty('--accent-ink', lum > 0.45 ? '#07131a' : '#f1f7f9');
    if (this.scene.environment) this.applyEnv();
  }

  applyEnv() {
    this.skiGroup.traverse((o) => {
      if (o.material && 'envMapIntensity' in o.material) o.material.envMapIntensity = this.sky.time.ambient * 1.05;
    });
  }

  // a ski with whatever TRIM-X kit you have fitted to it
  tuned(spec) {
    return tunedSpec(spec, this.career.trimx(spec));
  }

  selectSki(i) {
    this.skiIndex = (i + SKIS.length) % SKIS.length;
    this.spec = this.tuned(SKIS[this.skiIndex]);
    if (this.career.owns(this.spec.id)) store.set('ski-id', this.spec.id);
    this.buildSki();
    this.phys.trim = 0;
    this.refreshMenu();
  }

  // step through the garage in price order
  stepSki(d) {
    const k = this.order.indexOf(this.skiIndex);
    this.selectSki(this.order[(k + d + this.order.length) % this.order.length]);
  }

  buySki() {
    const spec = SKIS[this.skiIndex];
    const r = this.career.buy(spec);
    if (r === 'poor') return this.toast('NOT YET', 'You need ' + money(spec.price - this.career.cash) + ' more for the ' + spec.name, 0);
    if (r !== 'ok') return;
    store.set('ski-id', spec.id);
    this.audio.cash?.();
    this.toast('NEW SKI', spec.name + ' is yours!', 0);
    this.missionEvent('owned', this.career.data.owned.length);
    this.refreshMenu();
  }

  buyTrimx() {
    const base = SKIS[this.skiIndex];
    const cur = this.career.trimx(base);
    const next = TRIMX[cur + 1];
    const r = this.career.buyTrimx(base);
    if (r === 'poor') return this.toast('NOT YET', 'You need ' + money(next.price - this.career.cash) + ' more for ' + next.name, 0);
    if (r !== 'ok') return;
    this.spec = this.tuned(base);
    this.buildSki();
    this.toast('FITTED', TRIMX[cur + 1].name + ' on the ' + base.name, 0);
    this.missionEvent('trimx', 1);
    this.refreshMenu();
  }

  // ------------------------------------------------------------- money
  // Storm Coast's danger pay doubles up everything except missions
  mapMult() {
    return MAP.bonus.id === 'all' ? 1.5 : 1;
  }

  // a trick's points turn into cash (with the map's bonus where it applies)
  earnTrick(pts, kind, info = {}) {
    if (kind === 'note' || !(pts > 0)) return null;
    const b = MAP.bonus.id;
    let mult = 1;
    if ((b === 'ramp' && info.ramp) || (b === 'wave' && info.wave) || (b === 'flat' && (info.water || info.flat))) mult = 2;
    else if (b === 'all') mult = 1.5;
    const cash = this.career.earn(pts * CASH_PER_POINT * mult + (info.spray ? SPRAY_PAY * this.mapMult() : 0));
    return { cash, mult };
  }

  missionEvent(ev, v) {
    const done = checkMissions(this.career, ev, v);
    for (const m of done) {
      this.career.earn(m.pay);
      this.toast('MISSION COMPLETE', m.text, m.pay);
    }
  }

  // a message across the top: missions, purchases, race results
  toast(title, text, pay) {
    const q = this.toastQ || (this.toastQ = []);
    q.push({ title, text, pay });
    if (q.length === 1) this.nextToast();
  }

  nextToast() {
    const q = this.toastQ;
    const el = $('toast');
    if (!q.length) {
      el.classList.remove('show');
      return;
    }
    const t = q[0];
    el.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = t.title;
    const sp = document.createElement('span');
    sp.textContent = t.text;
    el.append(b, sp);
    if (t.pay) {
      const i = document.createElement('i');
      i.textContent = '+' + money(t.pay);
      el.append(i);
    }
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => {
      q.shift();
      this.nextToast();
    }, 3200);
  }

  refreshCareerUi() {
    const c = money(this.career.cash);
    $('wallet').textContent = c;
    if (this.ui) this.ui.cash.textContent = c;
    if (this.state === 'menu') this.refreshMenu();
  }

  // ------------------------------------------------------------- races
  // Racing starts in the race circle: wait in it for QUEUE_S seconds and you
  // (and any mates in it with you) go to the start grid. Everyone in the
  // circle shares their arrival time (presence `rq`), so all their games
  // agree on when the wait ends, who is racing and the grid order. During
  // the race each rider shares their progress (`rr`) for live positions.
  updateRaceQueue() {
    const r = this.race;
    const p = this.phys;
    const now = this.mp.worldClock();
    const free = this.state === 'ride' && !this.wipe.on && (r.state === 'idle' || r.state === 'done');
    const inside = free && r.inCircle(p.px, p.pz);
    if (inside && !this.raceQ) this.raceQ = { t: Math.round(now * 100) / 100 };
    if (!inside && this.raceQ) this.raceQ = null;
    if (!this.raceQ) {
      r.setQueue(0, false);
      this.queueInfo = null;
      return;
    }
    if (r.state === 'done') this.endRace();
    // mates waiting in the circle with me
    const mates = [];
    for (const m of this.mp.remotes.values()) {
      const q = m.state && m.state.rq;
      if (m.group.visible && q && Number.isFinite(q.t) && now - q.t < 40) mates.push(m);
    }
    const t0 = Math.min(this.raceQ.t, ...mates.map((m) => m.state.rq.t));
    const startAt = t0 + QUEUE_S;
    r.setQueue(Math.min(1, (now - t0) / QUEUE_S), true);
    this.queueInfo = { left: startAt - now, names: mates.map((m) => plain(m.name)) };
    if (now < startAt) return;
    // go: everyone in the circle lines up, in the same order on every game
    const me = this.mp.myId();
    const ids = [me, ...mates.map((m) => m.peer)].sort();
    this.raceQ = null;
    this.queueInfo = null;
    this.startRace(Math.round(startAt * 10), ids.indexOf(me), ids.length, startAt + 5);
  }

  startRace(id, slot, n, goAt) {
    const spot = this.race.gridSpot(slot, n);
    this.teleport('race', spot);
    this.race.begin(goAt);
    this.raceRun = { id, g: 0, d: 0, f: 0 };
    this.raceField = new Map(); // peer -> { name, rr } of everyone racing with me
    this.countShown = 0;
    this.input.rumble(0.3, 0.5, 120);
    this.showHint('<b>' + MAP.race.name + '</b>' + (n > 1 ? ' against ' + (n - 1) + (n === 2 ? ' mate' : ' mates') : '') + '. Follow the green arrow: the start line, every gate, then back to the finish.', 5);
  }

  // back to free riding (the results stay up a moment)
  endRace() {
    this.race.reset();
    this.raceRun = null;
    this.raceField = null;
    this.ui.raceResults.hidden = true;
  }

  // everyone in my race, in order: finished first (fastest first), then the
  // most lines crossed, then the closest to the next one
  standings() {
    const rows = [{ me: true, name: this.mp.nick || 'You', ...this.raceRun }];
    if (this.raceField) {
      for (const m of this.mp.remotes.values()) {
        const rr = m.state && m.state.rr;
        if (rr && rr.id === this.raceRun.id) this.raceField.set(m.peer, { name: plain(m.name), rr });
      }
      for (const [peer, e] of this.raceField) {
        const m = this.mp.remotes.get(peer);
        const quit = !m || !m.state || !m.state.rr || m.state.rr.id !== this.raceRun.id;
        rows.push({ me: false, name: e.name, ...e.rr, quit: quit && !e.rr.f });
      }
    }
    rows.sort((a, b) => (a.quit - b.quit) || ((b.f > 0) - (a.f > 0)) || (a.f && b.f ? a.f - b.f : 0) || b.g - a.g || a.d - b.d);
    return rows;
  }

  onRace(kind, d) {
    const race = MAP.race;
    if (kind === 'go') {
      this.banner('GO!', 1.1);
      this.input.rumble(0.5, 0.8, 200);
    } else if (kind === 'gate') {
      this.audio.tick?.();
    } else if (kind === 'finish') {
      this.raceRun.f = Math.round(d.time * 100) / 100;
      const rows = this.standings();
      const place = rows.findIndex((r) => r.me);
      const field = rows.filter((r) => !r.quit).length;
      const beaten = rows.slice(place + 1).filter((r) => !r.quit).length;
      const best = this.career.finishRace(MAP.id, d.time, d.medal);
      const pay = Math.round(((d.medal >= 0 ? RACE_PAY[d.medal] : 150) + beaten * 750) * this.mapMult());
      this.career.earn(pay);
      const medal = ['BRONZE', 'SILVER', 'GOLD'][d.medal] || 'FINISHED';
      const ord = (k) => k + (['th', 'st', 'nd', 'rd'][k % 100 > 10 && k % 100 < 14 ? 0 : Math.min(k % 10, 4) % 4] || 'th');
      this.banner(field > 1 ? ord(place + 1).toUpperCase() + ' · ' + clock(d.time) : medal + ' · ' + clock(d.time), 2.6);
      this.toast(race.name.toUpperCase(), (field > 1 ? ord(place + 1) + ' of ' + field + ' · ' : '') + medal.charAt(0) + medal.slice(1).toLowerCase() + ' in ' + clock(d.time) + (best ? ' · new best!' : ''), pay);
      this.missionEvent('race', d.medal);
      this.missionEvent('golds', Object.values(this.career.data.races).filter((r) => r.medal === 2).length);
      if (place === 0 && field > 1) this.missionEvent('racewin', 1);
      this.resultsT = 30;
    } else if (kind === 'cancel') {
      this.raceRun = null;
      this.raceField = null;
      this.showHint('Race over: you went off course. Ride back into the race circle to race again.', 3);
    }
  }

  updateRaceHud(dt) {
    const r = this.race;
    const el = this.ui.race;
    const p = this.phys;
    const now = this.mp.worldClock();
    const racing = r.state === 'grid' || r.state === 'run';
    const q = this.queueInfo;
    const show = this.state === 'ride' && !this.wipe.on && (racing || !!q);
    if (el.hidden === show) el.hidden = !show;
    // the guide arrow over the ski
    {
      const fp = this.camMode === 4;
      const at = this._guideAt || (this._guideAt = new THREE.Vector3());
      if (fp) {
        // out over the bow, just under your eye line
        const c = this.camera.position;
        at.set(c.x + p.fhx * 7, c.y - 0.45, c.z + p.fhz * 7);
      } else at.set(p.px + p.fhx * 3.2, p.py + 1.9, p.pz + p.fhz * 3.2);
      r.steer(at, dt, show && racing);
    }
    // finished: the results board until everyone is in (or 30 s)
    if (r.state === 'done') {
      this.resultsT -= dt;
      const rows = this.standings();
      this.renderResults(rows);
      const waiting = rows.some((x) => !x.f && !x.quit);
      if (this.resultsT <= 0 || (!waiting && this.resultsT < 24)) this.endRace();
    }
    if (!show) return;
    let big, sub, goal;
    if (q) {
      big = String(Math.max(1, Math.ceil(q.left)));
      sub = 'RACE STARTS IN';
      goal = q.names.length ? 'You + ' + q.names.join(', ') : 'Stay in the circle. Mates who ride in race you.';
    } else if (r.state === 'grid') {
      const left = r.goAt - now;
      big = left > 3 ? 'READY' : String(Math.max(1, Math.ceil(left)));
      sub = MAP.race.name.toUpperCase();
      goal = 'Hold on… the clock starts on GO';
      if (left <= 3 && Math.ceil(left) !== this.countShown) {
        this.countShown = Math.ceil(left);
        if (this.countShown > 0) this.banner(String(this.countShown), 0.8);
      }
    } else {
      big = clock(r.t);
      const rows = this.standings();
      const n = rows.filter((x) => !x.quit).length;
      const pos = rows.findIndex((x) => x.me) + 1;
      sub = r.stage() + (n > 1 ? ' · ' + pos + ' / ' + n : '');
      const tg = r.target();
      const dist = Math.hypot(tg.x - p.px, tg.z - p.pz);
      this.raceRun.g = r.next;
      this.raceRun.d = Math.round(dist);
      const m = MAP.race.medals;
      goal = Math.round(dist) + ' m to go · Gold ' + clock(m[2]) + ' · Silver ' + clock(m[1]);
    }
    if (this.uiCache.raceT !== big) {
      this.uiCache.raceT = big;
      this.ui.raceTime.textContent = big;
    }
    if (this.uiCache.raceSub !== sub) {
      this.uiCache.raceSub = sub;
      this.ui.raceSub.textContent = sub;
    }
    if (this.uiCache.raceGoal !== goal) {
      this.uiCache.raceGoal = goal;
      this.ui.raceGoal.textContent = goal;
    }
    el.classList.toggle('queue', !!q);
    // the arrow to the next gate (or to nothing while waiting)
    this.ui.raceArrow.style.visibility = racing ? 'visible' : 'hidden';
    if (racing) {
      const tg = r.target();
      const dx = tg.x - p.px, dz = tg.z - p.pz;
      this.camera.getWorldDirection(this._v);
      const ang = Math.atan2(dx * this._v.z - dz * this._v.x, dx * this._v.x + dz * this._v.z);
      this.ui.raceArrow.style.transform = `rotate(${(ang * 180) / Math.PI}deg)`;
    }
  }

  // a pointer to the race circle while you are free riding
  updateCirclePointer() {
    const r = this.race;
    const p = this.phys;
    const el = this.ui.circleDir;
    const c = r.circle;
    const dx = c.x - p.px, dz = c.z - p.pz;
    const d = Math.hypot(dx, dz);
    const show = this.state === 'ride' && !this.wipe.on && r.state !== 'grid' && r.state !== 'run' && !this.raceQ && d > 25;
    if (el.hidden === show) el.hidden = !show;
    if (!show) return;
    this.camera.getWorldDirection(this._v);
    const ang = Math.atan2(dx * this._v.z - dz * this._v.x, dx * this._v.x + dz * this._v.z);
    this.ui.circleArrow.style.transform = `rotate(${(ang * 180) / Math.PI}deg)`;
    const txt = d > 950 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m';
    if (this.uiCache.circle !== txt) {
      this.uiCache.circle = txt;
      this.ui.circleDist.textContent = txt;
    }
  }

  renderResults(rows) {
    const box = this.ui.raceResults;
    if (box.hidden) box.hidden = false;
    const ol = this.ui.raceList;
    const ord = (k) => k + (['th', 'st', 'nd', 'rd'][k % 100 > 10 && k % 100 < 14 ? 0 : Math.min(k % 10, 4) % 4] || 'th');
    const html = rows.map((x, i) => `<li class="${x.me ? 'me' : ''}"><span>${ord(i + 1)} ${x.me ? 'You' : x.name}</span><b>${x.f ? clock(x.f) : x.quit ? 'out' : 'racing…'}</b></li>`).join('');
    if (this.uiCache.results !== html) {
      this.uiCache.results = html;
      ol.innerHTML = html;
    }
  }

  syncSki() {
    const p = this.phys;
    this.skiGroup.position.set(p.px, p.py, p.pz);
    this.skiGroup.quaternion.set(p.qx, p.qy, p.qz, p.qw);
    this.skiGroup.updateMatrixWorld(true);
  }

  // --------------------------------------------------------- environment
  applySea(immediate = false) {
    const s = SEA_STATES[this.seaIndex];
    this.waves.setSeaState(s.scale, immediate);
    this.ocean.setSea(s);
    store.set('sea', this.seaIndex);
  }

  // where we are in the day: the admin's clock if they set one, else the
  // shared world clock (the same for everyone online)
  dayPhase() {
    if (this.fixedPhase !== null) return this.fixedPhase;
    const d = this.mp.world.day;
    const now = this.mp.worldClock();
    if (d) return (((d.p0 + ((now - d.t0) * d.speed) / DAY_LEN) % 1) + 1) % 1;
    return (((now / DAY_LEN + 0.3) % 1) + 1) % 1;
  }

  // Light the world for the time of day. Cheap enough to run every frame;
  // the sky reflections are re-baked only every few seconds.
  applyTime(force = false) {
    const tod = todAt(this.dayPhase(), this._tod || (this._tod = {}));
    if (MAP.mood) moodify(tod, MAP.mood);
    if (this.bolt > 0.01) {
      tod.exposure *= 1 + this.bolt * 1.6;
      tod.ambient *= 1 + this.bolt * 2.5;
    }
    this.sky.setTime(tod);
    this.ocean.setTime(tod);
    this.spray.setLight(tod);
    this.renderer.toneMappingExposure = tod.exposure;
    this.sun.color.setRGB(tod.sun[0], tod.sun[1], tod.sun[2]);
    this.sun.intensity = tod.sunPower * 0.92;
    this.hemi.color.setRGB(
      tod.zenith[0] * 0.6 + tod.horizon[0] * 0.5,
      tod.zenith[1] * 0.6 + tod.horizon[1] * 0.5,
      tod.zenith[2] * 0.6 + tod.horizon[2] * 0.5
    );
    this.hemi.groundColor.setRGB(tod.shallow[0] * 0.5 + 0.05, tod.shallow[1] * 0.5 + 0.05, tod.shallow[2] * 0.5 + 0.05);
    this.hemi.intensity = 0.9 * tod.ambient;
    this.scene.fog.color.setRGB(tod.horizon[0], tod.horizon[1], tod.horizon[2]);
    const now = performance.now();
    const moved = Math.abs(tod.phase - (this.envPhase ?? -1));
    if (force || !this.envTex || (now - (this.envT || 0) > 2500 && Math.min(moved, 1 - moved) > 0.002)) {
      this.envT = now;
      this.envPhase = tod.phase;
      if (this.envTex) this.envTex.dispose();
      this.envTex = this.sky.makeEnvironment(this.renderer);
      this.scene.environment = this.envTex;
      this.applyEnv();
      if (this.mp) for (const r of this.mp.remotes.values()) r.applyEnv();
    }
    return tod;
  }

  // the shared world changed (or arrived): water, fun extras, events
  applyWorld(w) {
    if (!this.seaFixed && w.sea !== this.seaIndex) {
      this.seaIndex = w.sea;
      this.applySea();
    }
    const f = w.fun;
    this.phys.fun.lowGrav = f.lowGrav ? 0.62 : 0;
    this.phys.fun.turbo = f.turbo ? 1.45 : 1;
    this.effects.mega = f.mega ? 1.7 : 1;
    this.spray.uniforms.uRainbow.value = f.rainbow ? 1 : 0;
    this.waves.surf.allHuge = !!f.allHuge;
    this.waves.surf.forcedSet = w.huge;
    if (w.summon && w.summon !== this.lastSummon) {
      const fresh = this.mp.worldClock() * 1000 - w.summon < 60000;
      if (this.lastSummon !== undefined && fresh && this.state === 'ride' && !this.wipe.on) {
        this.teleport('zone');
        this.showHint('The admin called everyone to the wave zone!', 3);
      }
      this.lastSummon = w.summon;
    }
    if (this.lastSummon === undefined) this.lastSummon = w.summon;
    this.refreshWorldUi();
  }

  refreshWorldUi() {
    const tod = this._tod;
    $('worldSea').textContent = SEA_STATES[this.seaIndex].name;
    if (tod) $('worldTime').textContent = clockText(tod.phase) + ' · ' + tod.name + (this.mp.world.day && this.mp.world.day.speed === 0 ? ' (frozen)' : '');
    if (this.mp.adminKey) {
      const el = $('admTime');
      if (document.activeElement !== el && tod) el.value = hourOf(tod.phase).toFixed(2);
      $('admTimeLbl').textContent = tod ? clockText(tod.phase) : '';
      const d = this.mp.world.day;
      const mode = !d ? 'auto' : String(d.speed === 0 ? 0 : d.speed <= 1 ? 1 : 12);
      for (const b of $('admClock').children) b.setAttribute('aria-pressed', b.dataset.s === mode ? 'true' : 'false');
      for (const b of $('admFun').children) b.setAttribute('aria-pressed', this.mp.world.fun[b.dataset.f] ? 'true' : 'false');
      [...$('admSea').children].forEach((b, i) => b.setAttribute('aria-pressed', i === this.seaIndex ? 'true' : 'false'));
    }
  }

  // ------------------------------------------------------------- admin
  setupAdmin(seg) {
    const mp = this.mp;
    const go = async (code, quiet) => {
      const key = await unlock(code).catch(() => null);
      if (!key) {
        if (!quiet) {
          const el = $('adminCode');
          el.classList.remove('admin-bad');
          void el.offsetWidth;
          el.classList.add('admin-bad');
          this.showHint('That is not the admin code.', 2);
        }
        return;
      }
      mp.adminKey = key;
      try {
        localStorage.setItem('jetski-admin', code);
      } catch {
        /* ignore */
      }
      $('adminLock').hidden = true;
      $('adminPanel').hidden = false;
      // the all-time rider count, for the admin's eyes
      this.accounts.watchRiders((n) => {
        this.accounts.riders = n;
        this.refreshRiderStats();
      });
      if (!quiet) this.showHint('Admin unlocked.', 1.6);
      this.refreshWorldUi();
    };
    $('adminGo').addEventListener('click', () => go($('adminCode').value));
    $('adminCode').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') go($('adminCode').value);
    });
    try {
      const saved = localStorage.getItem('jetski-admin');
      if (saved) go(saved, true);
    } catch {
      /* ignore */
    }
    const say = (t) => {
      $('admStatus').textContent = (mp.room ? 'Sent to everyone online: ' : 'Offline, so just for you: ') + t;
    };
    // time of day
    $('admTime').addEventListener('input', (e) => {
      const d = mp.world.day;
      mp.setWorld({ day: { t0: mp.worldClock(), p0: phaseOfHour(parseFloat(e.target.value)), speed: d ? d.speed : 1 } });
      say('time set to ' + clockText(phaseOfHour(parseFloat(e.target.value))) + '.');
    });
    for (const b of $('admClock').children) {
      b.addEventListener('click', () => {
        const s = b.dataset.s;
        if (s === 'auto') mp.setWorld({ day: null });
        else mp.setWorld({ day: { t0: mp.worldClock(), p0: this.dayPhase(), speed: parseFloat(s) } });
        say(s === 'auto' ? 'the normal day and night cycle.' : s === '0' ? 'time frozen.' : s === '1' ? 'time running.' : 'time running fast.');
      });
    }
    // water
    seg($('admSea'), SEA_STATES, () => this.seaIndex, (i) => {
      mp.setWorld({ sea: i });
      say('water ' + SEA_STATES[i].name.toLowerCase() + '.');
    });
    // fun extras
    for (const f of FUN) {
      const b = document.createElement('button');
      b.textContent = f.name;
      b.dataset.f = f.id;
      b.addEventListener('click', () => {
        const on = !mp.world.fun[f.id];
        mp.setWorld({ fun: { [f.id]: on } });
        say(f.name.toLowerCase() + (on ? ' on.' : ' off.'));
      });
      $('admFun').appendChild(b);
    }
    // events
    $('admHuge').addEventListener('click', () => {
      // the next set that has not got close to breaking yet
      const t = this.phys.time;
      const cur = Math.floor(t / SURF.period);
      const sc = SURF.spawnS + SURF.c * (t - cur * SURF.period);
      const set = sc < -180 ? cur : cur + 1;
      const eta = Math.round(set * SURF.period - t + 44);
      mp.setWorld({ huge: set });
      say('a huge set is on its way (about ' + Math.max(10, eta) + ' s).');
    });
    $('admSummon').addEventListener('click', () => {
      mp.setWorld({ summon: Math.round(mp.worldClock() * 1000) });
      if (this.state === 'ride') this.teleport('zone');
      say('everyone is off to the wave zone.');
    });
    // gifts: cash for one rider online
    $('admGiftAmt').addEventListener('keydown', (e) => e.stopPropagation());
    $('admGift').addEventListener('click', async () => {
      const sel = $('admGiftTo');
      const peer = sel.value;
      const amt = parseInt($('admGiftAmt').value, 10);
      if (!peer) return say('pick someone to give to.');
      if (!amt) return say('type an amount (minus to take cash away).');
      const name = sel.options[sel.selectedIndex].textContent;
      $('admGift').disabled = true;
      const ok = await mp.sendGift(peer, amt);
      const a = Math.max(-1000000, Math.min(1000000, amt));
      $('admStatus').textContent = !ok ? 'Not online, so nothing sent.' : a > 0 ? 'Gave ' + money(a) + ' to ' + name + '.' : 'Took ' + money(-a) + ' from ' + name + ' (never below $0).';
      // one at a time, so each gift reaches its rider
      setTimeout(() => ($('admGift').disabled = false), 3000);
    });
    $('admCash').addEventListener('click', () => {
      this.career.earn(10000);
      $('admStatus').textContent = 'Added $10,000 to your wallet (just you).';
    });
    $('admReset').addEventListener('click', () => {
      mp.setWorld({ sea: 1, day: null, fun: Object.fromEntries(FUN.map((f) => [f.id, false])), huge: null });
      say('world back to normal.');
    });
  }

  setupPost(on) {
    this.bloomOn = false;
    if (!on) return;
    try {
      const w = innerWidth;
      const h = innerHeight;
      const rt = new THREE.WebGLRenderTarget(Math.round(w * this.pr), Math.round(h * this.pr), { type: THREE.HalfFloatType, samples: 4 });
      const c = new EffectComposer(this.renderer, rt);
      c.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.45, 1.05);
      c.addPass(this.bloom);
      c.addPass(new ShaderPass(GradeShader));
      c.addPass(new OutputPass());
      this.composer = c;
      this.bloomOn = true;
    } catch (e) {
      console.warn('post effects off:', e);
      this.composer = null;
    }
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.pr);
      this.composer.setSize(w, h);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- UI
  setupUI() {
    const list = $('skiList');
    for (const i of this.order) {
      const s = SKIS[i];
      const b = document.createElement('button');
      b.className = 'ski-opt';
      b.dataset.i = i;
      b.setAttribute('role', 'option');
      const hp = document.createElement('small');
      hp.textContent = s.tagline.split('·').pop().trim();
      const pr = document.createElement('em');
      pr.className = 'price';
      b.append(s.name, hp, pr);
      b.addEventListener('click', () => this.selectSki(i));
      list.appendChild(b);
    }
    $('btnBuy').addEventListener('click', () => this.buySki());
    $('btnTrimx').addEventListener('click', () => this.buyTrimx());
    // maps (switching rebuilds the world: the page reloads into the new map)
    MAPS.forEach((m) => {
      const b = document.createElement('button');
      b.textContent = m.name.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
      b.dataset.map = m.id;
      b.addEventListener('click', () => this.switchMap(m.id));
      $('segMap').appendChild(b);
    });
    this.buildMissionList();
    const seg = (el, items, get, set) => {
      items.forEach((it, i) => {
        const b = document.createElement('button');
        b.textContent = it.name;
        b.addEventListener('click', () => {
          set(i);
          this.refreshMenu();
        });
        el.appendChild(b);
      });
      el._get = get;
    };
    this.spotIndex = 0;
    seg($('segSpot'), [{ name: 'Lagoon' }, { name: 'Wave zone' }, { name: 'Race circle' }], () => this.spotIndex, (i) => {
      this.spotIndex = i;
      this.teleport(['lagoon', 'zone', 'circle'][i]);
    });
    this.setupAdmin(seg);
    const bars = $('vtsBars');
    for (let i = 0; i < 9; i++) {
      const b = document.createElement('i');
      if (i === 4) b.className = 'mid';
      bars.appendChild(b);
    }
    this.vtsBars = [...bars.children];

    $('btnRide').addEventListener('click', () => this.ride());
    $('btnHelp').addEventListener('click', () => ($('help').hidden = false));
    $('btnHelpClose').addEventListener('click', () => ($('help').hidden = true));
    $('btnPause').addEventListener('click', () => this.openMenu());
    $('btnCam').addEventListener('click', () => this.nextCam());
    $('btnChat').addEventListener('click', () => this.openChat());
    $('chatInput').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const r = this.mp.sendChat(e.target.value);
        if (r === 'slow') return this.showHint('Easy, one message at a time.', 1.4);
        if (r === 'offline') this.showHint('Chat works when you are online.', 2);
        e.target.value = '';
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
    $('btnRear').addEventListener('click', () => this.toggleLookBack());
    $('btnAls').addEventListener('click', () => this.toggleAls());
    LOBBIES.forEach((l, i) => $('mpL' + (i + 1)).addEventListener('click', () => this.toggleLobby(l.id)));
    $('mpName').addEventListener('change', (e) => {
      this.mp.setNick(e.target.value);
      this.accounts.setNick(this.mp.nick);
    });
    $('mpName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.target.blur();
      e.stopPropagation();
    });
    $('btnMute').addEventListener('click', () => this.toggleMute());
    this.refreshMenu();
    this.ui = {
      speed: $('speed'), rpmFill: $('rpmFill'), rpmVal: $('rpmVal'), trimVal: $('trimVal'), pumpVal: $('pumpVal'), modeVal: $('modeVal'), boostVal: $('boostVal'),
      score: $('score'), best: $('best'), cash: $('cash'), live: $('live'),
      race: $('race'), raceTime: $('raceTime'), raceSub: $('raceSub'), raceGoal: $('raceGoal'), raceArrow: $('raceArrow'),
      raceResults: $('raceResults'), raceList: $('raceList'), circleDir: $('circleDir'), circleArrow: $('circleArrow'), circleDist: $('circleDist'), liveName: $('liveName'), livePts: $('livePts'), combo: $('combo'), pops: $('pops'),
      banner: $('banner'), hint: $('hint'), flash: $('flash'),
      zoneDir: $('zoneDir'), zoneArrow: $('zoneArrow'), zoneDist: $('zoneDist'), zoneLbl: $('zoneLbl'), zoneKeyTip: $('zoneKey'),
    };
    this.uiCache = {};
    this.career.visit(MAP.id);
    this.missionEvent('maps', Object.keys(this.career.data.stats.maps).length);
    this.missionEvent('owned', this.career.data.owned.length);
    this.refreshCareerUi();
    this.setupAccountUi();
    this.accounts.init();
  }

  // ------------------------------------------------------------- account
  setupAccountUi() {
    const A = this.accounts;
    const box = $('authBox');
    const msg = (t, kind = '') => {
      $('authMsg').textContent = t;
      $('authMsg').className = 'auth-msg ' + kind;
    };
    const busy = (on) => {
      for (const id of ['authSignUp', 'authLogIn', 'authForgot']) $(id).disabled = on;
    };
    const go = async (how) => {
      const email = $('authEmail').value;
      const pass = $('authPass').value;
      if (!email) return msg('Type your email.', 'bad');
      if (how !== 'forgot' && pass.length < 6) return msg('Passwords are at least 6 characters.', 'bad');
      busy(true);
      msg(how === 'up' ? 'Making your account…' : how === 'in' ? 'Logging in…' : 'Sending…');
      try {
        if (how === 'up') await A.signUp(email, pass);
        else if (how === 'in') await A.logIn(email, pass);
        else {
          await A.resetPassword(email);
          msg('Check your email for a link to set a new password.', 'good');
          busy(false);
          return;
        }
        $('authPass').value = '';
        box.hidden = true;
        this.toast(how === 'up' ? 'ACCOUNT MADE' : 'WELCOME BACK', how === 'up' ? 'Your progress now saves to your account' : 'Your progress is loaded', 0);
      } catch (e) {
        msg(authError(e), 'bad');
      }
      busy(false);
    };
    $('authForm').addEventListener('submit', (e) => {
      e.preventDefault();
      go('up');
    });
    $('authLogIn').addEventListener('click', () => go('in'));
    $('authForgot').addEventListener('click', () => go('forgot'));
    $('authClose').addEventListener('click', () => (box.hidden = true));
    for (const id of ['authEmail', 'authPass']) $(id).addEventListener('keydown', (e) => e.stopPropagation());
    $('btnAccount').addEventListener('click', async () => {
      if (A.state === 'in' || A.state === 'offline') {
        await A.logOut().catch(() => {});
        this.toast('LOGGED OUT', 'Playing as a guest on this device', 0);
      } else {
        msg('');
        box.hidden = false;
        $('authEmail').focus();
      }
    });
  }

  // riders online right now (everyone connected, all lobbies and maps); the
  // admin also sees how many have ever played
  refreshRiderStats() {
    const mp = this.mp;
    const online = mp.room && mp.status === 'ready' ? mp.room.peers().filter((p) => p.kind === 'viewer').length : 0;
    const t = online ? online.toLocaleString() + ' online now' : '';
    if ($('mpStats').textContent !== t) $('mpStats').textContent = t;
    if (mp.adminKey) {
      const sel = $('admGiftTo');
      const list = mp.online();
      const key = list.map((o) => o.peer + o.name + o.lobby).join('|');
      if (sel._key !== key && document.activeElement !== sel) {
        sel._key = key;
        const keep = sel.value;
        sel.textContent = '';
        if (!list.length) sel.append(new Option('Nobody online', ''));
        for (const o of list) sel.append(new Option(o.name + (o.lobby ? ' · ' + o.lobby.replace('lobby-', 'Lobby ') : ''), o.peer));
        if (list.some((o) => o.peer === keep)) sel.value = keep;
      }
      const n = this.accounts.riders;
      const a = (n === undefined ? 'Counting…' : n < 0 ? 'Not available here' : n.toLocaleString() + (n === 1 ? ' rider has' : ' riders have') + ' played') + ' · ' + online + ' online now';
      if ($('admRiders').textContent !== a) $('admRiders').textContent = a;
    }
  }

  onAccount() {
    const A = this.accounts;
    const el = $('account');
    el.hidden = A.state === 'off';
    el.classList.toggle('guest', A.state === 'guest');
    const t = $('accountText');
    t.textContent = '';
    if (A.state === 'in' || A.state === 'offline') {
      const b = document.createElement('b');
      b.textContent = A.email || 'your account';
      t.append(A.state === 'offline' ? 'Offline · ' : A.saving ? 'Saving · ' : 'Saved to ', b);
      t.title = A.email;
      $('btnAccount').textContent = 'LOG OUT';
      // your online name follows your account
      if (A.nick && A.nick !== this.mp.nick) {
        this.mp.setNick(A.nick);
        $('mpName').value = A.nick;
      }
    } else {
      t.textContent = A.state === 'loading' ? 'Loading your account…' : 'Guest (saved on this device)';
      $('btnAccount').textContent = 'SIGN UP / LOG IN';
    }
    $('btnAccount').hidden = A.state === 'loading';
    this.refreshRiderStats();
    // a different save: make sure the ski you are on is one you own
    if (this.careerKey !== this.career.key) {
      this.careerKey = this.career.key;
      if (!this.career.owns(this.spec.id) && !params.get('ski')) this.selectSki(SKIS.findIndex((s) => s.id === START_SKI));
      else {
        this.spec = this.tuned(SKIS[this.skiIndex]);
        this.buildSki();
      }
      this.refreshCareerUi();
      this.refreshMenu();
    }
  }

  switchMap(id) {
    if (id === MAP.id) return;
    store.set('map', id);
    $('loadText').textContent = mapById(id).load;
    $('loading').classList.remove('done');
    $('menu').hidden = true;
    setTimeout(() => {
      if (params.has('map')) {
        params.set('map', id);
        location.search = params.toString();
      } else location.reload();
    }, 60);
  }

  buildMissionList() {
    const ol = $('missionList');
    ol.textContent = '';
    this.missionEls = MISSIONS.map((m) => {
      const li = document.createElement('li');
      const t = document.createElement('span');
      t.textContent = m.text;
      const p = document.createElement('b');
      p.textContent = money(m.pay);
      li.append(t, p);
      ol.appendChild(li);
      return li;
    });
  }

  refreshMenu() {
    const s = this.spec;
    const C = this.career;
    for (const b of $('skiList').children) {
      const i = +b.dataset.i;
      const sk = SKIS[i];
      const own = C.owns(sk.id);
      b.setAttribute('aria-selected', i === this.skiIndex ? 'true' : 'false');
      b.classList.toggle('locked', !own);
      const pr = b.querySelector('.price');
      const t = own ? 'OWNED' : money(sk.price);
      if (pr.textContent !== t) pr.textContent = t;
      pr.classList.toggle('owned', own);
    }
    // buy / owned
    const own = C.owns(s.id) || !!params.get('ski');
    $('buyRow').hidden = own;
    if (!own) {
      $('btnBuy').textContent = 'BUY ' + money(s.price);
      const short = s.price - C.cash;
      $('btnBuy').disabled = short > 0;
      $('buyNote').textContent = short > 0 ? money(short) + ' more to go' : 'You can afford it!';
    }
    // TRIM-X
    const base = SKIS[this.skiIndex];
    const tb = trimxBase(base);
    $('trimxRow').hidden = tb < 0;
    if (tb >= 0) {
      const cur = C.trimx(base);
      $('trimxVal').textContent = cur === 0 ? 'Stock trim' : TRIMX[cur].name.replace('TRIM-X ', '') + (cur === tb && tb > 0 ? ' (built in)' : '');
      const next = TRIMX[cur + 1];
      const btn = $('btnTrimx');
      btn.hidden = !next || !own;
      if (next) {
        btn.textContent = (cur === 0 ? 'STAGE 1 ' : 'STAGE 2 ') + money(next.price);
        btn.disabled = next.price > C.cash;
        btn.title = cur === 0 ? 'More trim range for a proper rooster tail' : 'Even more trim for a massive rooster tail';
      }
    }
    $('btnRide').disabled = !own;
    // map
    for (const b of $('segMap').children) b.setAttribute('aria-pressed', b.dataset.map === MAP.id ? 'true' : 'false');
    const rb = C.race(MAP.id);
    const medal = rb ? ['', ' (bronze)', ' (silver)', ' (gold)'][rb.medal + 1] : '';
    $('mapInfo').innerHTML = '';
    {
      const a = document.createElement('span');
      a.textContent = MAP.blurb;
      const b = document.createElement('span');
      b.className = 'map-meta';
      b.textContent = 'Waves: ' + MAP.waves + ' · Race: ' + MAP.race.name + (rb ? ' · best ' + clock(rb.best) + medal : '');
      const c = document.createElement('b');
      c.className = 'map-bonus';
      c.textContent = 'BONUS: ' + MAP.bonus.text;
      $('mapInfo').append(a, b, c);
    }
    // missions: done ones ticked and moved to the end
    let nDone = 0;
    MISSIONS.forEach((m, i) => {
      const done = C.done(m.id);
      if (done) nDone++;
      this.missionEls[i].classList.toggle('done', done);
      this.missionEls[i].style.order = done ? 100 + i : i;
    });
    $('missionCount').textContent = nDone + ' / ' + MISSIONS.length + ' done';
    $('wallet').textContent = money(C.cash);
    $('mName').textContent = s.name;
    $('mTag').textContent = s.tagline;
    $('mBlurb').textContent = s.blurb;
    $('skiName').textContent = s.name;
    const st = $('mStats');
    const rows = [
      ['TOP SPEED', s.stats.speed, Math.round(s.top * 3.6) + ' km/h'],
      ['LAUNCH', s.stats.accel],
      ['GRIP', s.stats.grip],
      ['FREESTYLE', s.stats.tricks],
    ];
    if (!st.children.length) {
      for (const r of rows) {
        const l = document.createElement('span');
        l.className = 'lbl';
        l.textContent = r[0];
        const b = document.createElement('div');
        b.className = 'bar';
        b.appendChild(document.createElement('i'));
        st.append(l, b);
      }
    }
    rows.forEach((r, i) => {
      st.children[i * 2 + 1].firstChild.style.transform = `scaleX(${r[1]})`;
      st.children[i * 2 + 1].title = r[2] || '';
    });
    const cols = $('mColors');
    cols.textContent = '';
    const cwI = this.cwIndex[s.id] || 0;
    s.colorways.forEach((cw, i) => {
      const b = document.createElement('button');
      b.className = 'sw';
      b.title = cw.name;
      b.setAttribute('aria-label', cw.name);
      b.setAttribute('aria-pressed', i === cwI ? 'true' : 'false');
      b.style.setProperty('--c1', '#' + new THREE.Color(cw.deck).getHexString());
      b.style.setProperty('--c2', '#' + new THREE.Color(cw.accent).getHexString());
      b.addEventListener('click', () => {
        this.cwIndex[s.id] = i;
        store.set('cw-' + s.id, i);
        this.buildSki();
        this.refreshMenu();
      });
      cols.appendChild(b);
    });
    $('mColorName').textContent = s.colorways[cwI].name;
    if (this.spotIndex !== undefined) {
      const rs = this.race.startSpot();
      const p = this.phys;
      this.spotIndex = this.waves.zoneMask(p.px, p.pz) > 0.05 || Math.hypot(p.px - ZONE_IN.x, p.pz - ZONE_IN.z) < 200 ? 1 : Math.hypot(p.px - rs.x, p.pz - rs.z) < 60 ? 2 : 0;
    }
    for (const id of ['segSpot', 'admSea']) {
      const el = $(id);
      [...el.children].forEach((b, i) => b.setAttribute('aria-pressed', i === el._get() ? 'true' : 'false'));
    }
    $('btnRide').textContent = this.hasRidden ? 'RESUME' : 'RIDE';
  }

  ride() {
    if (!this.career.owns(this.spec.id) && !params.get('ski')) {
      this.toast('LOCKED', 'That ski is not yours yet. Buy it, or pick one you own.', 0);
      return;
    }
    this.state = 'ride';
    this.hasRidden = true;
    this.accounts.countRider();
    $('menu').hidden = true;
    $('help').hidden = true;
    $('hud').hidden = false;
    $('touch').hidden = !this.mobile;
    this.audio.start(this.spec);
    this.input.enabled = true;
    this.canvas.focus?.();
    this.syncSkiHud();
    if (!this.shownHint) {
      this.shownHint = true;
      this.showHint(this.ctlHint(), 9);
      setTimeout(() => {
        if (this.state === 'ride' && this.spec.launchControl && !this.shownLaunchHint) {
          this.shownLaunchHint = true;
          this.showLaunchHint();
        } else if (this.state === 'ride' && this.spec.standup && !this.shownStandupHint) {
          this.shownStandupHint = true;
          this.showStandupHint();
        }
      }, 9500);
    } else if (this.spec.launchControl && !this.shownLaunchHint) {
      this.shownLaunchHint = true;
      this.showLaunchHint();
    } else if (this.spec.standup && !this.shownStandupHint) {
      this.shownStandupHint = true;
      this.showStandupHint();
    }
  }

  // The breaking lip caught the rider: it shoves them along with the wave and
  // down, explodes into white water around them, and a big one landing on a
  // slow rider takes them out. Punch through it at speed and you ride on.
  lipHit(dt) {
    const p = this.phys;
    const b = this.breakers;
    const k = b.lipHit;
    p.vx += b.lipDir.x * 10 * k * dt;
    p.vz += b.lipDir.z * 10 * k * dt;
    p.vy -= 7 * k * dt;
    const now = performance.now();
    if (now - (this.lipT || -1e9) > 450) {
      this.lipT = now;
      const n = Math.round(70 * Math.min(1, k) * (this.effects.density || 1));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 1.2;
        const sv = 3 + Math.random() * 6 * k;
        this.spray.emit(p.px + Math.cos(a) * r, p.py + 0.3 + Math.random() * 0.8, p.pz + Math.sin(a) * r,
          b.lipDir.x * sv + Math.cos(a) * 2, 2 + Math.random() * 5 * k, b.lipDir.z * sv + Math.sin(a) * 2,
          0.8 + Math.random() * 0.9, 0.1 + Math.random() * 0.1, 0.7 + Math.random() * 0.9, 1, 0.6, 0.85, 0.3);
      }
      this.foam.stamp(p.px, p.pz, 2.2 + k, 0.9 * k, 1.2 * k);
      this.cam.shake = Math.max(this.cam.shake, 0.5 + 0.5 * Math.min(1, k));
      this.input.rumble(0.6 + 0.4 * Math.min(1, k), 0.7, 260);
      this.audio.splash(Math.min(1, 0.4 + 0.6 * k));
    }
    if (b.lipLand && k > 0.55 && p.tele.speed < 11) this.startWipeout('SMASHED BY THE LIP');
  }

  // Online: someone's jet catching you (water all over your lens), and yours
  // catching them (a burst of spray on them, and points). Each game works
  // this out from the streams it draws, so both players see the same thing.
  sprayHits(dt) {
    const mp = this.mp;
    if (!mp.lobbyId || !mp.remotes.size) return;
    this.sprayT = (this.sprayT || 0) + dt;
    if (this.sprayT < 1 / 30) return;
    this.sprayT = 0;
    const p = this.phys;
    const now = performance.now();
    for (const r of mp.remotes.values()) {
      if (!r.jet || !r.state || !r.group.visible) continue;
      const theirs = r.jet.hits(p.px, p.py + 0.9, p.pz, 0.7) + 0.4 * r.wash.hits(p.px, p.py + 0.5, p.pz, 0.7);
      if (theirs > 0.8) {
        const k = Math.min(1, theirs / 6);
        this.wetLens.splash(k);
        this.splashAt(p.px, p.py + 0.9, p.pz, k, r.vel);
        this.input.rumble(0.3 + 0.5 * k, 0.6, 160);
        if (now - (r.hitMeT || -1e9) > 3500) {
          r.hitMeT = now;
          this.showHint('<b>' + plain(r.name) + '</b> sprayed you!', 2);
        }
      }
      const mine = this.effects.jet.hits(r.pos.x, r.pos.y + 0.9, r.pos.z, 0.7) + 0.4 * this.effects.wash.hits(r.pos.x, r.pos.y + 0.5, r.pos.z, 0.7);
      if (mine > 0.8) {
        this.splashAt(r.pos.x, r.pos.y + 0.9, r.pos.z, Math.min(1, mine / 6), p.tele.nozzleVel);
        if (now - (r.hitThemT || -1e9) > 5000) {
          r.hitThemT = now;
          // a bounty for hosing them (pays out with the trick)
          this.tricks.award('SPRAYED ' + plain(r.name).toUpperCase(), 150, 'trick', { spray: true });
          this.career.spray();
          this.missionEvent('spray', this.career.data.stats.sprays);
        }
      }
    }
  }

  // water bursting off someone who is being hosed
  splashAt(x, y, z, k, v) {
    const n = Math.round((8 + 30 * k) * (this.effects.density || 1));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 4 * k;
      this.spray.emit(x + Math.cos(a) * 0.4, y + (Math.random() - 0.3) * 0.8, z + Math.sin(a) * 0.4,
        Math.cos(a) * sp + (v ? v.x * 0.15 : 0), 1 + Math.random() * 3, Math.sin(a) * sp + (v ? v.z * 0.15 : 0),
        0.5 + Math.random() * 0.6, 0.07 + Math.random() * 0.06, 0.3 + Math.random() * 0.4, 1, 0.6, 0.8, 0.15);
    }
  }

  // ------------------------------------------------------------- chat
  addChat(name, text, kind) {
    if (!text) return;
    const log = $('chatLog');
    const el = document.createElement('div');
    el.className = 'chat-line ' + kind;
    if (kind === 'sys') el.textContent = name + ' ' + text;
    else {
      const b = document.createElement('b');
      b.textContent = name;
      el.append(b, document.createTextNode(text));
    }
    log.appendChild(el);
    while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => el.classList.add('old'), 14000);
  }

  openChat() {
    if (this.state !== 'ride' || this.mp.status !== 'ready') return;
    this.input.keys.clear(); // let go of the throttle while typing
    $('chat').classList.add('open');
    const inp = $('chatInput');
    inp.hidden = false;
    inp.focus();
  }

  closeChat() {
    $('chat').classList.remove('open');
    const inp = $('chatInput');
    inp.hidden = true;
    inp.blur();
    this.canvas.focus?.();
  }

  // frames per second, counted over half a second at a time
  countFps(dt) {
    if (!this.showFps) return;
    this.fpsN = (this.fpsN || 0) + 1;
    this.fpsT = (this.fpsT || 0) + dt;
    if (this.fpsT < 0.5) return;
    const fps = this.fpsN / this.fpsT;
    const el = $('fpsVal');
    el.textContent = Math.round(fps);
    el.className = fps >= 50 ? '' : fps >= 30 ? 'mid' : 'low';
    $('fpsMs').textContent = ((this.fpsT / this.fpsN) * 1000).toFixed(1) + ' ms';
    this.fpsN = 0;
    this.fpsT = 0;
  }

  setFps(on) {
    this.showFps = on;
    $('fps').hidden = !on;
    this.fpsN = this.fpsT = 0;
    try {
      localStorage.setItem('jetski-rider-fps', on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  // pressed for a trick the jump could not fit: say why, now and then
  trickTryHint() {
    const now = performance.now();
    if (now - (this.lastTryHint || -1e9) < 9000 || (this.tryHints || 0) >= 6) return;
    this.lastTryHint = now;
    this.tryHints = (this.tryHints || 0) + 1;
    const pad = this.input.usingGamepad;
    if (this.spec.standup) {
      const pull = pad ? 'hold ' + pb('B') : this.mobile ? 'hold PULL BACK' : 'hold <kbd>Space</kbd>';
      this.showHint('Not enough air left to flip: hit a bigger wave flat out and ' + pull + ' as you leave the lip', 3);
    } else {
      const x = pad ? pb('X') : this.mobile ? 'TRICK' : '<kbd>X</kbd>';
      this.showHint('Not enough air for a Superman: hit a bigger jump and press ' + x + ' right after take-off', 3);
    }
  }

  showStandupHint() {
    const pad = this.input.usingGamepad;
    this.showHint(
      pad
        ? 'Stand-up: no trim, lean into turns, hold ' + pb('A') + ' to slide. Off a wave: hold ' + pb('B') + ' up the face and through the lip to backflip, steer to spin. Flat water: hold ' + pb('A') + ' slow to sink the nose, then ' + pb('B') + ' to pop.'
        : this.mobile
          ? 'Stand-up: no trim. Off a wave: hold PULL BACK through the lip to backflip. Flat water: hold SLIDE slow to sink the nose, then PULL BACK to pop.'
          : 'Stand-up: no trim, lean into turns, hold <kbd>Shift</kbd> to slide. Off a wave: hold <kbd>Space</kbd> up the face and through the lip to backflip, steer to spin. Flat water: hold <kbd>Shift</kbd> slow to sink the nose, then <kbd>Space</kbd> to pop.',
      11
    );
  }

  showLaunchHint() {
    const pad = this.input.usingGamepad;
    const als = this.spec.turbo ? (pad ? ' ' + pb('VIEW') + ' rolling anti-lag.' : this.mobile ? ' ALS button: rolling anti-lag.' : ' <kbd>N</kbd> rolling anti-lag.') : '';
    this.showHint((pad ? 'Launch control: hold ' + pb('LT') + ' + ' + pb('RT') + ' stopped, let go of ' + pb('LT') + ' to launch.' : this.mobile ? 'Launch control: hold BRAKE + GAS stopped, let go of BRAKE to launch.' : 'Launch control: hold <kbd>S</kbd> + <kbd>W</kbd> stopped, let go of <kbd>S</kbd> to launch.') + als, 8);
  }

  // show the turbo / launch-control bits of the HUD for the current ski
  syncSkiHud() {
    const turbo = !!this.spec.turbo;
    $('boostRow').hidden = !turbo;
    $('btnAls').hidden = !turbo;
    $('btnAls').classList.toggle('on', turbo && this.phys.als);
    $('tTrick').hidden = !!this.spec.standup; // Superman on sit-downs
    // stand-ups have no trim system, so no VTS gauge
    document.querySelector('#hud .vts').hidden = !!this.spec.standup;
    $('trimVal').parentElement.hidden = !!this.spec.standup;
    $('alsTag').hidden = !(turbo && this.phys.als);
  }

  toggleAls() {
    if (!this.spec.turbo) return;
    this.phys.als = !this.phys.als;
    this.syncSkiHud();
    this.showHint(this.phys.als ? 'Rolling anti-lag ON: boost stays up when you lift' : 'Rolling anti-lag OFF', 1.6);
  }

  openMenu() {
    this.closeChat();
    this.state = 'menu';
    $('menu').hidden = false;
    $('hud').hidden = true;
    $('touch').hidden = true;
    this.cam.orbit = this.cam.yaw + 0.5;
    this.refreshMenu();
  }

  toggleMute() {
    this.audio.setMuted(!this.audio.muted);
    $('btnMute').classList.toggle('off', this.audio.muted);
  }

  nextCam() {
    this.setCam((this.camMode + 1) % 5);
  }

  toggleLookBack() {
    this.lookBack = !this.lookBack;
    $('btnRear').classList.toggle('on', this.lookBack);
    this.showHint(this.lookBack ? 'Looking back' : 'Looking forward', 1.2);
  }

  setCam(mode) {
    this.camMode = mode;
    this.showHint(['Chase camera', 'Wide camera', 'Low action camera', 'Handlebar camera', 'First person'][mode], 1.6);
  }

  showHint(html, secs = 4) {
    this.ui.hint.innerHTML = html;
    this.ui.hint.classList.add('show');
    this.hintTimer = secs;
  }

  popTrick(label, pts, kind, earned) {
    const el = document.createElement('div');
    el.className = 'pop' + (kind === 'note' ? ' note' : '');
    el.textContent = label;
    if (kind !== 'note') {
      const b = document.createElement('b');
      b.textContent = '+' + pts.toLocaleString();
      el.appendChild(b);
      if (earned && earned.cash) {
        const c = document.createElement('i');
        c.className = 'cash';
        c.textContent = '+' + money(earned.cash) + (earned.mult > 1 ? ' · ' + earned.mult + 'x' : '');
        el.appendChild(c);
      }
    }
    const pops = this.ui.pops;
    while (pops.children.length > 2) pops.firstChild.remove();
    for (const c of pops.children) c.style.marginTop = (parseFloat(c.style.marginTop || '0') + 44) + 'px';
    pops.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  banner(text, secs = 1.6) {
    this.ui.banner.textContent = text;
    this.ui.banner.hidden = false;
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => (this.ui.banner.hidden = true), secs * 1000);
  }

  setupPointerOrbit() {
    let id = null;
    let lx = 0;
    let ly = 0;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.state !== 'ride') return;
      id = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.cam.userYaw -= (e.clientX - lx) * 0.006;
      this.cam.userPitch = clamp(this.cam.userPitch + (e.clientY - ly) * 0.004, -0.25, 0.7);
      this.cam.userT = 1.8;
      lx = e.clientX;
      ly = e.clientY;
    });
    const up = (e) => {
      if (e.pointerId === id) id = null;
    };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    this._orbiting = () => id !== null;
  }

  // ------------------------------------------------------------- wipeout
  startWipeout(reason) {
    if (this.wipe.on) return;
    const w = this.wipe;
    const p = this.phys;
    w.on = true;
    w.t = 0;
    this.tricks.fail();
    this.banner(reason, 1.8);
    // throw the rider clear
    const rg = this.rider.group;
    this.rider.ragdoll = true;
    this.scene.attach(rg);
    w.vel.set(p.vx * 0.85, Math.max(p.vy, 0) + 3.2, p.vz * 0.85);
    w.spin.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6 - 3);
    this.audio.splash(0.8);
    this.cam.shake = 1;
    this.input.rumble(1, 1, 450);
  }

  updateWipeout(dt) {
    const w = this.wipe;
    const p = this.phys;
    w.t += dt;
    const rg = this.rider.group;
    const wh = this.world.waterHeight(rg.position.x, rg.position.z, p.time);
    if (rg.position.y > wh - 0.25) {
      w.vel.y -= 9.81 * dt;
      rg.position.addScaledVector(w.vel, dt);
      this._e.set(w.spin.x * dt, w.spin.y * dt, w.spin.z * dt);
      this._q.setFromEuler(this._e);
      rg.quaternion.premultiply(this._q);
      if (rg.position.y <= wh - 0.25 && !w.splashed) {
        w.splashed = true;
        for (let i = 0; i < 160; i++) {
          const a = Math.random() * 6.28;
          const s = 1 + Math.random() * 4;
          this.spray.emit(rg.position.x, wh + 0.05, rg.position.z, Math.cos(a) * s + w.vel.x * 0.3, 2 + Math.random() * 5, Math.sin(a) * s + w.vel.z * 0.3, 0.8 + Math.random(), 0.07, 0.35, 1, 0.5, 0.85, 0.12);
        }
        this.foam.stamp(rg.position.x, rg.position.z, 1.6, 1.2, 0.8);
        this.audio.splash(0.6);
      }
    } else {
      w.vel.multiplyScalar(Math.exp(-dt * 3));
      rg.position.x += w.vel.x * dt;
      rg.position.z += w.vel.z * dt;
      rg.position.y = damp(rg.position.y, wh - 0.35, 0.2, dt);
    }
    if (w.t > 2.6) this.respawn(false);
  }

  respawn(toSafe) {
    const p = this.phys;
    const w = this.wipe;
    let x = p.px;
    let z = p.pz;
    let yaw = p.yaw;
    if (toSafe || this.terrain.heightAt(x, z) > -1.2) {
      x = this.safe.x;
      z = this.safe.z;
      yaw = this.safe.yaw;
    }
    p.reset(x, z, yaw);
    this.race.jumped();
    w.on = false;
    w.splashed = false;
    this.rider.ragdoll = false;
    this.skiGroup.add(this.rider.group);
    this.rider.group.position.set(0, 0, 0);
    this.rider.group.quaternion.identity();
    this.rider.group.scale.set(1, 1, 1);
    this.ui.flash.style.transition = 'none';
    this.ui.flash.style.opacity = '0.55';
    requestAnimationFrame(() => {
      this.ui.flash.style.transition = 'opacity 0.5s';
      this.ui.flash.style.opacity = '0';
    });
    this.tricks.lastYaw = null;
    this.stuckT = 0;
  }

  checkWipeout(dt) {
    const T = this.phys.tele;
    const w = this.wipe;
    const touching = T.wet > 0.15 || T.ground > 0.05;
    if (T.uy < 0.12 && touching) w.flipT += dt;
    else w.flipT = Math.max(0, w.flipT - dt * 2);
    if (w.flipT > 0.3) return this.startWipeout('WIPEOUT');
    // landed still stretched out in a Superman: off the back you go
    if (T.superman > 0.45 && touching && !T.airborne) return this.startWipeout('BAILED');
    const im = this.effects.impactFlag || 0;
    if (im > 9.5 && (Math.abs(T.roll) > 0.75 || T.pitch < -0.6 || T.pitch > 1.25)) return this.startWipeout('WIPEOUT');
    if (T.ground > 0.3 && T.speed > 14 && this.terrain.heightAt(this.phys.px, this.phys.pz) > -0.3) return this.startWipeout('BEACHED IT');
  }

  // --------------------------------------------------------------- camera
  snapCamera() {
    const c = this.cam;
    c.yaw = this.phys.yaw;
    this.updateCamera(1, true);
  }

  updateCamera(dt, snap = false) {
    const p = this.phys;
    const T = p.tele;
    const c = this.cam;
    const cam = this.camera;
    // on a stand-up, X is the trick button rather than look-behind
    // pad X: hold to look behind on the water. In the air a fresh press of X
    // is a Superman on a sit-down, so only keep looking back if it was
    // already held when the ski took off.
    if (!T.airborne) this.lookHeldAir = true;
    else if (!this.input.padLook) this.lookHeldAir = false;
    const look = this.lookBack || (this.input.padLook && !this.spec.standup && this.lookHeldAir);
    const target = this._v.set(p.px, p.py, p.pz);
    if (this.wipe.on) target.lerp(this.rider.group.position, 0.5);

    if (this.state === 'menu') {
      c.orbit += dt * 0.22;
      const r = this.mobile || innerWidth < 760 ? 7.2 : 6.4;
      const side = innerWidth >= 760 ? 1.15 : 0; // push the ski to the right of the panel
      const ox = Math.cos(c.orbit) * r;
      const oz = Math.sin(c.orbit) * r;
      const des = new THREE.Vector3(p.px + ox, p.py + 1.55, p.pz + oz);
      const lookAt = new THREE.Vector3(p.px + Math.sin(c.orbit) * side, p.py + 0.35, p.pz - Math.cos(c.orbit) * side);
      const k = snap ? 1 : 1 - Math.exp(-dt * 3);
      c.pos.lerp(des, k);
      c.look.lerp(lookAt, k);
      c.fov = damp(c.fov, 40, 0.3, dt);
      cam.position.copy(c.pos);
      const wh = this.world.waterHeight(cam.position.x, cam.position.z, p.time);
      if (cam.position.y < wh + 0.4) cam.position.y = wh + 0.4;
      cam.up.set(0, 1, 0);
      cam.lookAt(c.look);
      if (Math.abs(cam.fov - c.fov) > 0.01) {
        cam.fov = c.fov;
        cam.updateProjectionMatrix();
      }
      return;
    }

    const modes = [
      { dist: 6.8, h: 2.35, look: 1.4, lookH: 0.75, fov: 62 },
      { dist: 11.5, h: 4.6, look: 1.0, lookH: 0.6, fov: 58 },
      { dist: 4.4, h: 1.05, look: 1.6, lookH: 0.7, fov: 70 },
      { dist: 0, h: 0, look: 6, lookH: 0, fov: 78 },
      { dist: 0, h: 0, look: 6, lookH: 0, fov: 80 },
    ];
    const m = modes[this.camMode];
    const spd = T.speed;

    // follow a blend of where the ski points and where it is actually going
    let dx = p.fhx;
    let dz = p.fhz;
    if (spd > 2.5) {
      const vx = p.vx / spd;
      const vz = p.vz / spd;
      const back = vx * p.fhx + vz * p.fhz;
      let k = 0.62 * smoothstep(2.5, 9, spd);
      if (back < 0) k = Math.max(k, smoothstep(0.1, -0.5, back));
      dx = lerp(p.fhx, vx, k);
      dz = lerp(p.fhz, vz, k);
    }
    const want = Math.atan2(-dz, dx);
    const diff = wrapAngle(want - c.yaw);
    c.yaw = snap ? want : c.yaw + diff * (1 - Math.exp(-dt * (2.2 + spd * 0.12)));
    const cs = this.input.camStick;
    if (this.state === 'ride' && (cs.x || cs.y)) {
      c.userYaw -= cs.x * dt * 2.8;
      c.userPitch = clamp(c.userPitch + cs.y * dt * 1.4, -0.25, 0.7);
      c.userT = 0.9;
    }
    if (c.userT > 0 && !this._orbiting() && !(cs.x || cs.y)) c.userT -= dt;
    if (c.userT <= 0) {
      c.userYaw = damp(c.userYaw, 0, 0.35, dt);
      c.userPitch = damp(c.userPitch, 0, 0.35, dt);
    }
    // swing out to a rear three-quarter view when the rooster tail is up so you can see it
    c.rooster = damp(c.rooster || 0, clamp(this.effects.rooster * 1.6, 0, 1) * smoothstep(4, 12, spd), 0.9, dt);
    const yaw = c.yaw + c.userYaw + c.rooster * 0.62 + (look ? Math.PI : 0);
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);

    const fp = this.camMode === 4 && !this.wipe.on;
    this.rider.head.visible = !fp;
    this.rider.torso.visible = !fp;
    const near = fp ? 0.04 : 0.15;
    if (cam.near !== near) {
      cam.near = near;
      cam.updateProjectionMatrix();
    }
    if (fp) {
      // first person: at the rider's eyes. Looks where the ski is heading
      // plus some of the rider's head turn into the corner, with the horizon
      // steadied the way a real head does it (the body's lean is ignored).
      const g = this.skiGroup;
      const head = this.rider.head;
      const eye = new THREE.Vector3().copy(head.position).applyMatrix4(g.matrixWorld);
      const hy = this.rider.headYaw * 0.4;
      const c0 = Math.cos(hy);
      const s0 = Math.sin(hy);
      // rotate the heading left for +hy (ski +Z is starboard)
      let hx = p.fhx * c0 + p.fhz * s0;
      let hz = p.fhz * c0 - p.fhx * s0;
      let pitch = clamp(T.pitch, -0.6, 1.2) * 0.55 - 0.24;
      if (look) {
        // turn round to look over your shoulder at the wake
        hx = -p.fhx;
        hz = -p.fhz;
        pitch = -clamp(T.pitch, -0.6, 1.2) * 0.4 - 0.1;
      }
      const dir = new THREE.Vector3(hx * Math.cos(pitch), Math.sin(pitch), hz * Math.cos(pitch));
      eye.addScaledVector(dir, look ? -0.05 : 0.05);
      eye.y += look ? 0.1 : 0.05;
      cam.position.copy(eye);
      cam.up.set(T.ux, T.uy, T.uz).lerp(new THREE.Vector3(0, 1, 0), 0.65).normalize();
      const prev = cam.quaternion.clone();
      cam.lookAt(this._v.copy(eye).add(dir));
      // smooth toward the new view (slerp from a copy: slerping a quaternion
      // into itself froze the camera on its first direction)
      if (!snap && this._fpWas) {
        const target = cam.quaternion.clone();
        cam.quaternion.copy(prev).slerp(target, 1 - Math.exp(-dt * 16));
      }
      this._fpWas = true;
    } else if (this.camMode === 3) {
      // handlebar cam: rigidly on the ski, behind the rider's shoulders
      const g = this.skiGroup;
      const local = new THREE.Vector3(-0.55, 1.42, 0);
      cam.position.copy(local).applyMatrix4(g.matrixWorld);
      const look = new THREE.Vector3(8, 0.6, 0).applyMatrix4(g.matrixWorld);
      cam.up.set(T.ux, T.uy, T.uz).lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize();
      cam.lookAt(look);
      this._fpWas = false;
    } else {
      this._fpWas = false;
      const dist = m.dist + spd * 0.055 + c.userPitch * 2 + c.rooster * 3.5;
      const h = m.h + c.userPitch * 5 + Math.max(0, T.pitch) * 1.2 + c.rooster * 0.6;
      const des = new THREE.Vector3(target.x - fx * dist, target.y + h, target.z - fz * dist);
      if (snap) c.pos.copy(des);
      else {
        c.pos.x = des.x;
        c.pos.z = des.z;
        c.pos.y = damp(c.pos.y, des.y, 0.16, dt);
      }
      const wh = Math.max(this.world.waterHeight(c.pos.x, c.pos.z, p.time), this.world.groundAt(c.pos.x, c.pos.z)) + 0.45;
      if (c.pos.y < wh) c.pos.y = wh;
      cam.position.copy(c.pos);
      c.shake = Math.max(0, c.shake - dt * 2.2);
      const sh = c.shake * 0.12 + smoothstep(18, 32, spd) * 0.012;
      if (sh > 0) {
        cam.position.x += (Math.random() - 0.5) * sh;
        cam.position.y += (Math.random() - 0.5) * sh;
        cam.position.z += (Math.random() - 0.5) * sh;
      }
      const la = new THREE.Vector3(target.x + fx * m.look, target.y + m.lookH, target.z + fz * m.look);
      if (snap) c.look.copy(la);
      else c.look.lerp(la, 1 - Math.exp(-dt * 14));
      cam.up.set(-T.roll * 0.12 * fz * 0, 1, 0);
      cam.lookAt(c.look);
      cam.rotateZ(-T.roll * 0.1);
    }
    const fovT = m.fov + smoothstep(8, 32, spd) * 14;
    c.fov = damp(c.fov, fovT, 0.4, dt);
    if (Math.abs(cam.fov - c.fov) > 0.02) {
      cam.fov = c.fov;
      cam.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------ HUD
  updateHUD(dt) {
    this.updateBoard(dt);
    const T = this.phys.tele;
    const u = this.ui;
    const cch = this.uiCache;
    const set = (k, el, v) => {
      if (cch[k] !== v) {
        cch[k] = v;
        el.textContent = v;
      }
    };
    set('speed', u.speed, String(Math.round(T.speed * 3.6)));
    const rn = clamp((T.rpmN - 0.11) / 0.89, 0, 1.03);
    u.rpmFill.style.transform = `scaleX(${clamp(0.08 + rn * 0.92, 0, 1).toFixed(3)})`;
    const lim = this.audio.limiter || (T.rpmN > 1.02 && this.phys.ctrl.throttle > 0.5 ? 1 : 0);
    const rpmTop = T.lcArmed ? this.spec.idleRpm + (this.spec.maxRpm - this.spec.idleRpm) * (((this.spec.launchRpm ?? 0.62) - 0.11) / 0.89) : this.spec.maxRpm;
    const rpmShow = lim > 0.5 ? rpmTop - (Math.sin(performance.now() * 0.069) > 0 ? 0 : 350) : this.spec.idleRpm + (this.spec.maxRpm - this.spec.idleRpm) * Math.min(rn, 1);
    set('rpm', u.rpmVal, String(Math.round(rpmShow / 50) * 50));
    u.rpmFill.classList.toggle('lim', lim > 0.5);
    const trim = this.phys.trim;
    const lit = Math.round(trim * 4);
    if (cch.trim !== lit) {
      cch.trim = lit;
      this.vtsBars.forEach((b, i) => {
        const k = i - 4;
        b.classList.toggle('on', k === 0 || (lit > 0 && k > 0 && k <= lit) || (lit < 0 && k < 0 && k >= lit));
      });
      u.trimVal.textContent = this.spec.standup ? '—' : (lit > 0 ? '+' : '') + lit;
    }
    const pump = T.pumpLoad > 0.5 ? 'LOADED' : 'AIR';
    if (cch.pump !== pump) {
      cch.pump = pump;
      u.pumpVal.textContent = pump;
      u.pumpVal.classList.toggle('warn', pump === 'AIR');
    }
    set('mode', u.modeVal, T.lcArmed ? 'LAUNCH' : T.lcLaunch > 0 ? 'GO' : lim > 0.5 ? 'LIMIT' : T.reverse > 0.05 ? (T.u < 0.5 ? 'R' : 'iBR') : T.power > 0.02 ? 'F' : 'N');
    if (this.spec.turbo) set('boost', u.boostVal, Math.round((T.boost || 0) * 32) + ' psi');
    set('score', u.score, this.tricks.score.toLocaleString());
    set('best', u.best, this.tricks.best.toLocaleString());
    const live = this.tricks.live;
    if (live) {
      u.live.hidden = false;
      set('liveName', u.liveName, live);
      set('livePts', u.livePts, String(Math.round(this.tricks.livePts)));
    } else u.live.hidden = true;
    const combo = this.tricks.combo;
    u.combo.hidden = combo < 2;
    if (combo >= 2) set('combo', u.combo, 'x' + combo);
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) u.hint.classList.remove('show');
    }
  }

  // ----------------------------------------------------------------- loop
  handleKeys() {
    const inp = this.input;
    if (inp.was('Escape') || inp.was('KeyP')) {
      if (!$('authBox').hidden) $('authBox').hidden = true;
      else if (!$('help').hidden) $('help').hidden = true;
      else if (this.state === 'ride') this.openMenu();
      else if (this.hasRidden) this.ride();
    }
    if (inp.was('Enter') && this.state === 'menu') this.ride();
    else if (inp.was('Enter') && this.state === 'ride' && this.mp.status === 'ready') this.openChat();
    if (inp.was('KeyM')) this.toggleMute();
    // time and water belong to the shared world: only the admin moves them
    if (inp.was('KeyT') || inp.was('KeyV')) {
      if (!this.mp.adminKey) this.showHint('The time and the water are the same for everyone. The admin sets them.', 2.2);
      else if (inp.was('KeyT')) {
        const p = phaseOfHour(hourOf(this.dayPhase()) + 1.5);
        const d = this.mp.world.day;
        this.mp.setWorld({ day: { t0: this.mp.worldClock(), p0: p, speed: d ? d.speed : 1 } });
        this.showHint('Time: ' + clockText(p), 1.4);
      } else {
        const i = (this.seaIndex + 1) % SEA_STATES.length;
        this.mp.setWorld({ sea: i });
        this.showHint('Water: ' + SEA_STATES[i].name, 1.4);
      }
    }
    if (inp.was('KeyH')) $('help').hidden = !$('help').hidden;
    if (inp.was('KeyI')) this.setFps(!this.showFps);
    if (this.state === 'ride') {
      if (inp.was('KeyC')) this.nextCam();
      if (inp.was('KeyF')) this.setCam(this.camMode === 4 ? 0 : 4);
      if (inp.was('KeyB')) this.toggleLookBack();
      if (inp.was('KeyN')) this.toggleAls();
      if (inp.was('KeyR') && !this.wipe.on) this.respawn(true);
      if (inp.was('KeyG') && !this.wipe.on) {
        this.teleport(this.inZone ? 'lagoon' : 'zone');
        this.showHint(this.inZone ? 'Back to the lagoon' : 'Wave zone. Ride into the swell flat out.', 2.2);
      }
    } else if (this.state === 'menu') {
      if (inp.was('ArrowRight') && !this.padFocusEl) this.stepSki(1);
      if (inp.was('ArrowLeft') && !this.padFocusEl) this.stepSki(-1);
    }
    this.handlePad();
  }

  // ---------------------------------------------------------------- gamepad
  handlePad() {
    const inp = this.input;
    if (!inp.padPressed.size) return;
    const helpOpen = !$('help').hidden;
    if (this.state === 'ride' && !helpOpen) {
      if (inp.padWas(PAD.MENU)) return this.openMenu();
      if (inp.padWas(PAD.Y)) this.nextCam();
      if (inp.padWas(PAD.VIEW)) this.toggleAls();
      if (inp.padWas(PAD.RS) || inp.padPressed.has(PAD.RIGHT)) this.setCam(this.camMode === 4 ? 0 : 4);
      if (inp.padPressed.has(PAD.LEFT)) this.toggleLookBack();
      if (inp.padPressed.has(PAD.DOWN) && !this.wipe.on) this.respawn(true);
      if (inp.padPressed.has(PAD.UP) && !this.wipe.on) {
        this.teleport(this.inZone ? 'lagoon' : 'zone');
        this.showHint(this.inZone ? 'Back to the lagoon' : 'Wave zone. Ride into the swell flat out.', 2.2);
      }
      return;
    }
    // garage / help: move a highlight with the D-pad or stick, A presses it
    for (const [b, dx, dy] of [[PAD.UP, 0, -1], [PAD.DOWN, 0, 1], [PAD.LEFT, -1, 0], [PAD.RIGHT, 1, 0]]) {
      if (inp.padWas(b)) this.padNav(dx, dy);
    }
    if (inp.padWas(PAD.A) && this.padFocusEl && document.contains(this.padFocusEl)) this.padFocusEl.click();
    if (inp.padWas(PAD.B)) {
      if (helpOpen) $('help').hidden = true;
      else if (this.hasRidden) this.ride();
    }
    if (inp.padWas(PAD.MENU)) {
      if (helpOpen) $('help').hidden = true;
      else this.ride();
    }
    if (!helpOpen && inp.padWas(PAD.RB)) this.stepSki(1);
    if (!helpOpen && inp.padWas(PAD.LB)) this.stepSki(-1);
    if (!helpOpen && inp.padWas(PAD.Y)) $('help').hidden = false;
  }

  padNav(dx, dy) {
    const root = !$('help').hidden ? $('help') : $('menu');
    const items = [...root.querySelectorAll('button, input')].filter((el) => el.offsetParent !== null && !el.disabled);
    if (!items.length) return;
    let cur = this.padFocusEl;
    if (!cur || !items.includes(cur)) return this.setPadFocus(root.querySelector('.go') || items[0]);
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = null;
    let bestScore = 1e9;
    for (const el of items) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const ox = r.left + r.width / 2 - ax;
      const oy = r.top + r.height / 2 - ay;
      const along = ox * dx + oy * dy;
      if (along <= 4) continue;
      const across = Math.abs(ox * dy - oy * dx);
      const score = along + across * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) this.setPadFocus(best);
  }

  setPadFocus(el) {
    if (this.padFocusEl) this.padFocusEl.classList.remove('pad-focus');
    this.padFocusEl = el;
    if (!el) return;
    el.classList.add('pad-focus');
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // controller or keyboard glyphs in hints and help
  refreshPadUi() {
    const on = this.input.usingGamepad;
    document.body.classList.toggle('pad', on);
    if (!on && this.padFocusEl) this.setPadFocus(null);
    if (on && this.state === 'menu' && !this.padFocusEl) this.setPadFocus($('btnRide'));
  }

  ctlHint() {
    if (this.spec.standup) {
      if (this.input.usingGamepad) return pb('RT') + ' gas · ' + pb('LS') + ' steer · hold ' + pb('A') + ' to slide · ' + pb('B') + ' backflip';
      return this.mobile ? 'Hold GAS to go. Lean into turns. PULL BACK off big launches to backflip.' : '<kbd>W</kbd> gas · <kbd>A</kbd><kbd>D</kbd> steer · hold <kbd>Shift</kbd> to slide · <kbd>Space</kbd> backflip';
    }
    if (this.input.usingGamepad) return pb('RT') + ' gas · ' + pb('LS') + ' steer · ' + pb('LB') + pb('RB') + ' trim · ' + pb('B') + ' pull back · hold ' + pb('A') + ' to slide · ' + pb('X') + ' look back (Superman in the air)';
    return this.mobile ? 'Hold GAS to go. No gas means no steering. TRIM + for rooster tails. TRICK in the air for a Superman.' : '<kbd>W</kbd> gas · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>E</kbd>/<kbd>Q</kbd> trim · <kbd>Space</kbd> pull back · hold <kbd>Shift</kbd> to slide · <kbd>X</kbd> Superman in the air';
  }

  // keep the shared wave clock: tiny slews, a snap if it ever drifts far
  syncWorldClock(dt) {
    const p = this.phys;
    let drift = this.mp.worldTime() - p.time;
    if (drift < -1800) drift += 3600;
    else if (drift > 1800) drift -= 3600;
    if (Math.abs(drift) > 0.3) {
      p.time = this.mp.worldTime();
      this.foam.clear();
    } else p.time += drift * Math.min(1, dt * 0.8);
    if (p.time >= 3600) p.time -= 3600;
  }

  // ------------------------------------------------------------ multiplayer
  refreshMp() {
    const mp = this.mp;
    const st = $('mpStatus');
    this.refreshRiderStats();
    const counts = mp.counts();
    LOBBIES.forEach((l, i) => {
      const b = $('mpL' + (i + 1));
      const n = counts[l.id] || 0;
      const inIt = mp.lobbyId === l.id;
      b.textContent = inIt ? l.name + ' · LEAVE' : l.name + ' · ' + n + '/' + MAX_PER_LOBBY;
      b.setAttribute('aria-pressed', inIt ? 'true' : 'false');
      b.disabled = mp.status !== 'ready' || mp.joining || (!inIt && n >= MAX_PER_LOBBY);
    });
    if (mp.status === 'offline') {
      st.textContent =
        mp.offlineWhy === 'failed'
          ? 'Could not reach the online server. Check your connection and reload.'
          : window.claude
            ? 'Online riding works on the shared claude.ai link, signed in.'
            : 'Online riding is not set up on this site yet (it needs Firebase: see the README).';
    }
    else if (mp.status === 'connecting') st.textContent = 'Connecting…';
    else if (mp.joining) st.textContent = 'Joining…';
    else if (mp.lobbyId) st.textContent = 'You are in ' + LOBBIES.find((l) => l.id === mp.lobbyId).name + '. Everyone here rides the same waves.';
    else st.textContent = 'Pick a lobby to ride with friends (up to ' + MAX_PER_LOBBY + ' each).';
    const nameEl = $('mpName');
    if (document.activeElement !== nameEl && nameEl.value !== mp.nick) nameEl.value = mp.nick;
    nameEl.disabled = mp.status !== 'ready';
    $('mpPanel').hidden = !mp.lobbyId;
    $('btnChat').hidden = mp.status !== 'ready';
    this.boardT = 0;
  }

  async toggleLobby(id) {
    const mp = this.mp;
    if (mp.lobbyId === id) {
      await mp.leaveLobby();
      this.showHint('Left the lobby. Riding solo.', 2);
      return;
    }
    const r = await mp.joinLobby(id);
    if (r === 'full') this.showHint('That lobby is full.', 2);
    else if (r === 'ok') {
      // spread everyone out at the start line
      const off = (Math.random() - 0.5) * 30;
      this.phys.reset(SPAWN.x + off, SPAWN.z + Math.random() * 10, SPAWN.yaw);
      this.syncSki();
      this.snapCamera();
    } else if (r === 'error') this.showHint('Could not join right now. Try again in a moment.', 2.5);
  }

  updateBoard(dt) {
    this.boardT = (this.boardT || 0) - dt;
    if (this.boardT > 0 || !this.mp.lobbyId) return;
    this.boardT = 0.25;
    const rows = this.mp.board();
    const lobby = LOBBIES.find((l) => l.id === this.mp.lobbyId);
    $('mpTitle').textContent = lobby.name.toUpperCase() + ' · ' + rows.length + (rows.length === 1 ? ' RIDER' : ' RIDERS');
    const ol = $('mpBoard');
    while (ol.children.length > rows.length) ol.lastChild.remove();
    rows.forEach((r, i) => {
      let li = ol.children[i];
      if (!li) {
        li = document.createElement('li');
        li.append(document.createElement('span'), document.createElement('b'));
        ol.appendChild(li);
      }
      li.classList.toggle('me', r.me);
      if (li.firstChild.textContent !== r.name) li.firstChild.textContent = r.name;
      const sc = r.score.toLocaleString();
      if (li.lastChild.textContent !== sc) li.lastChild.textContent = sc;
    });
  }

  frame(now) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 1 / 60;
    this.frameMs = lerp(this.frameMs, dt * 1000, 0.05);
    this.countFps(dt);
    if (dt > 0.05) dt = 0.05;
    const p = this.phys;
    const T = p.tele;

    this.handleKeys();
    const riding = this.state === 'ride' && !this.wipe.on && $('help').hidden;
    const ctl = this.input.update(dt, T.speed / this.spec.top);
    if (riding) {
      const held = this.race.state === 'grid'; // on the start line until GO
      p.ctrl.throttle = held ? 0 : ctl.throttle;
      p.ctrl.brake = held ? 0 : ctl.brake;
      p.ctrl.steer = ctl.steer;
      p.ctrl.lean = ctl.lean;
      p.ctrl.trimCmd = ctl.trimCmd;
      p.ctrl.trick = ctl.trick;
    } else {
      p.ctrl.throttle = 0;
      p.ctrl.brake = 0;
      p.ctrl.steer = this.state === 'menu' ? Math.sin(now * 0.0006) * 0.5 : 0;
      p.ctrl.lean = 0;
      p.ctrl.trimCmd = 0;
      p.ctrl.trick = 0;
    }
    this.input.endFrame();

    // --- simulate ----------------------------------------------------------
    const steps = clamp(Math.round(dt / FIXED), 1, 12);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) p.step(h);
    this.syncWorldClock(dt);
    this.waves.update(dt);
    const time = p.time;

    this.syncSki();
    this.model.update(T, dt);
    this.rider.update(dt, this.model, this.skiGroup, { steer: p.ctrl.steer, lean: p.ctrl.lean, tele: T, sea: SEA_STATES[this.seaIndex].scale, superman: T.superman || 0 });

    // --- effects -----------------------------------------------------------
    this.effects.impactFlag = 0;
    this.effects.smallImpact = 0;
    this.effects.update(dt, p, time);
    if (this.effects.impactFlag > 2.4) {
      const s = clamp((this.effects.impactFlag - 2) / 9, 0.1, 1);
      this.audio.splash(s);
      this.cam.shake = Math.max(this.cam.shake, s);
      this.input.rumble(0.35 + 0.65 * s, 0.6 * s + 0.2, 120 + 260 * s);
    } else if (this.effects.smallImpact > 1.3 && T.speed > 4) {
      const ss = clamp((this.effects.smallImpact - 1.1) / 2.5, 0, 1);
      this.audio.slap(ss);
      this.input.rumble(0.1 + 0.3 * ss, 0.25 + 0.3 * ss, 70);
    }
    const shallow = this.terrain.heightAt(p.px, p.pz) > -3;
    const bound = shallow ? 1e9 : this.waves.maxHeight(p.px, p.pz, time) + 0.4;
    const waves = this.waves;
    const terrain = this.terrain;
    const tmp = this._d || (this._d = {});
    const surfAt = (this._surfAt = (x, z) => {
      const wy = waves.displace(x, z, time, tmp).y;
      if (!shallow) return wy;
      const g = terrain.heightAt(x, z);
      return g > wy ? g : wy;
    });
    this.spray.update(dt, surfAt, bound, this.foam);
    this.effects.jet.update(dt, surfAt, this.foam, this.spray, this.effects.density);
    this.effects.wash.update(dt, surfAt, this.foam, null, this.effects.density);
    // breaking surf: lips, barrels, spray and whitewater foam (only nearby)
    if (Math.hypot(p.px - WAVE_ZONE.x, p.pz - WAVE_ZONE.z) < 2400) {
      this.breakers.update(dt, time, p, this.effects.density);
      if (this.breakers.lipHit > 0.06 && this.state === 'ride' && !this.wipe.on) this.lipHit(dt);
    } else {
      this.breakers.mesh.visible = false;
      this.breakers.roar = 0;
    }
    this.audio.surfLevel = this.breakers.roar;
    this.foam.update(p.px + p.vx * 0.8, p.pz + p.vz * 0.8, dt);
    this.buoys.update(dt, time, p);
    this.race.update(dt, time, p, this.state === 'ride' && !this.wipe.on, this.mp.worldClock());
    this.updateRaceQueue();
    if (this.rain) this.rain.update(dt, this.camera.position);
    if (this.boltT !== undefined) {
      // lightning: a double flash every so often
      this.boltT -= dt;
      if (this.boltT <= 0) {
        this.boltT = 7 + Math.random() * 16;
        this.bolt = 1;
        this.bolt2 = 0.14;
      }
      if (this.bolt2 > 0 && (this.bolt2 -= dt) <= 0) this.bolt = 0.8;
      this.bolt *= Math.exp(-dt * 9);
    }

    // --- rules -------------------------------------------------------------
    if (this.state === 'ride') {
      this.updateZone();
      if (this.wipe.on) this.updateWipeout(dt);
      else {
        this.tricks.update(dt, p);
        this.checkWipeout(dt);
        this.missionT = (this.missionT || 0) - dt;
        if (this.missionT <= 0) {
          this.missionT = 0.25;
          this.missionEvent('speed', T.speed * 3.6);
        }
        if (T.trickTry) this.trickTryHint();
        // remember a safe spot to reset to
        this.safe.t += dt;
        if (this.safe.t > 1 && T.wet > 0.3 && T.uy > 0.8 && this.terrain.heightAt(p.px, p.pz) < -4) {
          this.safe.t = 0;
          this.safe.x = p.px;
          this.safe.z = p.pz;
          this.safe.yaw = p.yaw;
        }
        // beached and going nowhere
        if (T.ground > 0.3 && T.speed < 1 && T.pumpLoad < 0.3) {
          this.stuckT += dt;
          if (this.stuckT > 1.2 && this.hintTimer <= 0) this.showHint(this.input.usingGamepad ? 'Beached. Press ' + pb('DOWN') + ' to get back on the water.' : this.mobile ? 'Beached. Open MENU and RESUME, or steer clear next time.' : 'Beached. Press <kbd>R</kbd> to get back on the water.', 3);
          if (this.stuckT > 5) this.respawn(true);
        } else this.stuckT = 0;
      }
    }

    // --- render state ------------------------------------------------------
    this.sky.update(dt);
    this.updateCamera(dt);
    this.applyTime();
    this.worldUiT = (this.worldUiT || 0) - dt;
    if (this.worldUiT <= 0 && this.state === 'menu') {
      this.worldUiT = 0.5;
      this.refreshWorldUi();
    }
    const sd = this.sky.sunDir;
    this.sun.position.set(p.px + sd.x * 40, p.py + sd.y * 40, p.pz + sd.z * 40);
    this.sun.target.position.set(p.px, p.py, p.pz);
    const ou = this.ocean.uniforms;
    ou.uSkiPos.value.set(p.px, p.py, p.pz);
    ou.uSkiFwd.value.set(p.fhx, p.fhz);
    this.ocean.update(time, this.camera.position.x * 0.35 + p.px * 0.65, this.camera.position.z * 0.35 + p.pz * 0.65);
    if (this.model.mScreen) {
      const v = 0.75 + 0.25 * Math.sin(now * 0.004);
      this.model.mScreen.color.setRGB(0.5 * v, 0.9 * v, 1.0 * v);
    }

    // other riders, their name tags and the lobby board
    this.mp.update(dt, this.camera.position);
    if (this.state === 'ride' && !this.wipe.on) this.sprayHits(dt);
    this.wetLens.update(dt);
    this.mp.tags(this.camera);
    if (this.state === 'ride') {
      this.updateHUD(dt);
      this.updateRaceHud(dt);
      this.updateCirclePointer();
    } else {
      if (!this.ui.race.hidden) this.ui.race.hidden = true;
      this.race.steer(null, dt, false);
    }
    this.audio.update(T, p.ctrl, this.effects.sprayLevel, this.state !== 'ride', dt);
    // controller rumble follows the engine; hits and landings jolt it
    const rumbling = this.state === 'ride' && !this.wipe.on;
    this.input.rumbleEngine(rumbling ? 0.12 + 0.55 * T.power * T.pumpLoad + (this.audio.limiter || 0) * 0.6 + (T.lcArmed ? 0.35 : 0) : 0, dt);
    if (!this.noRender) {
      const cd = this.camera.getWorldDirection(this._camDir || (this._camDir = new THREE.Vector3()));
      this.effects.jet.build(this.camera.position, cd);
      this.effects.wash.build(this.camera.position, cd);
      this.mp.buildJets(this.camera.position, cd);
      if (this.bloomOn && this.composer) this.composer.render(dt);
      else this.renderer.render(this.scene, this.camera);
    }
    if (!this.fixedQuality) this.adaptQuality(dt);
    this.frames = (this.frames || 0) + 1;
  }

  // ----------------------------------------------------------- wave zone
  // where: 'lagoon', 'zone', 'circle' (the race circle) or 'race' with the
  // start-grid spot
  teleport(where, gridSpot) {
    const spot = where === 'zone' ? ZONE_IN : where === 'race' ? gridSpot : where === 'circle' ? this.race.startSpot() : SPAWN;
    if (where !== 'race') {
      this.race.cancel(true);
      if (this.race.state === 'done') this.endRace();
      this.raceRun = null;
      this.raceField = null;
    }
    this.phys.time = this.mp.worldTime() - 0.5;
    this.phys.reset(spot.x, spot.z, spot.yaw);
    this.phys.trim = 0;
    this.safe.x = spot.x;
    this.safe.z = spot.z;
    this.safe.yaw = spot.yaw;
    this.foam.clear();
    this.spray.clear();
    this.effects.jet.clear();
    this.effects.wash.clear();
    this.tricks.lastYaw = null;
    for (let i = 0; i < 120; i++) this.phys.step(FIXED);
    this.syncSki();
    this.snapCamera();
    this.cam.orbit = this.cam.yaw + 0.5;
    this.race.jumped();
    if (where === 'circle' && this.state === 'ride') this.showHint('<b>Race circle</b>: stay in it for ' + QUEUE_S + ' seconds and you go to the start line. Anyone in it with you races you.', 5);
  }

  updateZone() {
    const p = this.phys;
    const m = this.waves.zoneMask(p.px, p.pz);
    const inZone = this.inZone ? m > 0.25 : m > 0.45;
    if (inZone !== this.inZone) {
      this.inZone = inZone;
      if (inZone) {
        if (!this.shownZoneHint) {
          this.shownZoneHint = true;
          this.showHint(this.mobile ? 'Waves come in sets. Hit the faces before they break to launch, or ride along under the curl for a barrel. To spin, turn hard at the lip.' : 'Waves come in sets. Hit the faces before they break to launch, or ride along the face under the curl for a barrel. To spin, throw the ski into a hard turn at the lip.', 9);
        }
      }
    }
    // marker pointing at the zone when you are away from it
    const el = this.ui.zoneDir;
    const dx = WAVE_ZONE.x - p.px;
    const dz = WAVE_ZONE.z - p.pz;
    const d = Math.hypot(dx, dz) - WAVE_ZONE.rIn;
    // a bigger set on the horizon: say so while there is time to get there
    if (d < 450 && this.state === 'ride') {
      const S = this.waves.surf;
      S.update(p.time);
      for (let i = 0; i < S.count; i++) {
        const w = S.waves[i];
        if (w.big > 1.2 && w.sc > -260 && w.sc < -140 && this.announcedSet !== w.set) {
          this.announcedSet = w.set;
          this.showHint(w.big > 1.6 ? '<b>HUGE SET</b> rolling in. Get out the back and line one up!' : 'Bigger set rolling in.', 4);
        }
      }
    }
    const show = this.state === 'ride' && !this.wipe.on;
    const inside = d <= 120;
    if (el.hidden === show) el.hidden = !show;
    if (el.classList.contains('inside') !== inside) {
      el.classList.toggle('inside', inside);
      this.ui.zoneLbl.textContent = inside ? 'IN THE WAVE ZONE' : 'WAVE ZONE';
      this.ui.zoneKeyTip.title = inside ? 'Back to the lagoon' : 'Go to the wave zone';
    }
    if (show && !inside) {
      const cam = this.camera;
      cam.getWorldDirection(this._v);
      const ang = Math.atan2(dx * this._v.z - dz * this._v.x, dx * this._v.x + dz * this._v.z);
      this.ui.zoneArrow.style.transform = `rotate(${(ang * 180) / Math.PI}deg)`;
      const txt = d > 950 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m';
      if (this.uiCache.zone !== txt) {
        this.uiCache.zone = txt;
        this.ui.zoneDist.textContent = txt;
      }
    }
  }

  adaptQuality(dt) {
    this.prTimer += dt;
    if (this.prTimer < 2) return;
    this.prTimer = 0;
    const ms = this.frameMs;
    let pr = this.pr;
    if (ms > 26 && pr > 0.6) pr = Math.max(0.6, pr - 0.2);
    else if (ms < 14 && pr < this.maxPR) pr = Math.min(this.maxPR, pr + 0.1);
    if (ms > 30) this.effects.density = Math.max(0.35, this.effects.density - 0.15);
    // struggling: the glow goes first
    if (ms > 30 && this.bloomOn) this.bloomOn = false;
    if (pr !== this.pr) {
      this.pr = pr;
      this.resize();
    }
  }
}

function boot() {
  try {
    window.game = new Game();
  } catch (err) {
    console.error(err);
    const t = document.getElementById('loadText');
    if (t) t.textContent = 'Could not start the 3D engine: ' + (err && err.message ? err.message : err);
  }
}
// let the loading screen paint first
requestAnimationFrame(() => setTimeout(boot, 30));
