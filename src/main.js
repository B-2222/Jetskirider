// Jetski Rider - game bootstrap and main loop.

import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, wrapAngle } from './util.js';
import { Waves, SEA_STATES, WAVE_ZONE } from './waves.js';
import { Terrain, World } from './terrain.js';
import { SKIS } from './specs.js';
import { SkiPhysics } from './physics.js';
import { makeNoiseTexture, makeWaterNormalTexture, makeHeightTexture } from './textures.js';
import { Sky, TIMES } from './sky.js';
import { Ocean, FoamField } from './water.js';
import { Spray } from './particles.js';
import { Breakers } from './breakers.js';
import { SkiEffects } from './effects.js';
import { JetskiModel } from './jetski.js';
import { Rider } from './rider.js';
import { buildTerrainMesh, buildVegetation, buildRampMesh, buildZoneArch, Buoys } from './scenery.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Tricks } from './tricks.js';

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

const SPAWN = { x: 0, z: -150, yaw: -Math.PI / 2 };
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
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.15, 12000);

    // --- world -------------------------------------------------------------
    this.waves = new Waves();
    this.terrain = new Terrain();
    this.world = new World(this.waves, this.terrain);
    for (const r of [
      [0, 40, -Math.PI / 2],
      [-190, 250, -Math.PI / 2 - 0.9],
      [270, -70, 0.4],
      [430, 320, 2.5],
      [-420, -20, Math.PI * 0.8],
    ]) {
      this.world.addRamp(r[0], r[1], r[2]);
    }

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
    this.scene.fog = new THREE.FogExp2(0xffffff, 1 / 3600);

    this.terrainMesh = buildTerrainMesh(this.terrain);
    this.scene.add(this.terrainMesh);
    this.scene.add(buildVegetation(this.terrain));
    for (const r of this.world.ramps) this.scene.add(buildRampMesh(this.world, r));
    this.buoys = new Buoys(this.world, this.makeBuoyList());
    this.scene.add(this.buoys.group);
    this.scene.add(buildZoneArch(ZONE_IN.x + ZONE_IN.hx * 30, ZONE_IN.z + ZONE_IN.hz * 30, ZONE_IN.yaw));

    this.spray = new Spray({ max: coarse ? 9000 : 18000, noiseTex: this.noiseTex });
    this.scene.add(this.spray.mesh);
    this.breakers = new Breakers({ waves: this.waves, ocean: this.ocean, sky: this.sky, spray: this.spray, foam: this.foam });
    this.scene.add(this.breakers.mesh);

    // --- player ------------------------------------------------------------
    this.skiIndex = clamp(parseInt(store.get('ski', '0'), 10) || 0, 0, SKIS.length - 1);
    if (params.get('ski')) this.skiIndex = Math.max(0, SKIS.findIndex((s) => s.id === params.get('ski')));
    this.cwIndex = {};
    this.spec = SKIS[this.skiIndex];
    this.phys = new SkiPhysics(this.spec, this.world);
    this.effects = new SkiEffects(this.spray, this.foam, this.world);
    if (coarse) this.effects.density = 0.6;
    this.skiGroup = new THREE.Group();
    this.scene.add(this.skiGroup);
    this.input = new Input($('touch'));
    this.audio = new Audio();
    this.buildSki();
    this.tricks = new Tricks((label, pts, kind, combo) => this.popTrick(label, pts, kind));
    this.tricks.zoneAt = (x, z) => this.waves.zoneMask(x, z);
    this.tricks.barrelAt = (x, z) => this.waves.surf.barrelAt(x, z, this.phys.time);
    this.inZone = false;

    // --- state ---------------------------------------------------------------
    this.state = 'menu';
    this.hasRidden = false;
    this.seaIndex = clamp(parseInt(params.get('sea') || store.get('sea', '1'), 10) || 0, 0, SEA_STATES.length - 1);
    this.timeIndex = clamp(parseInt(params.get('tod') || store.get('tod', '0'), 10) || 0, 0, TIMES.length - 1);
    this.camMode = 0;
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
    this.applyTime();
    this.phys.reset(SPAWN.x, SPAWN.z, SPAWN.yaw);
    this.setupUI();
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
    // slalom from the start to the first ramp
    for (let i = 0; i < 6; i++) list.push({ x: (i % 2 ? 7 : -7), z: -120 + i * 24, color: i % 2 ? red : yel });
    // ramp approach gates
    for (const r of this.world.ramps) {
      for (const s of [-1, 1]) {
        const lx = -14;
        const lz = s * 4.6;
        list.push({ x: r.x + lx * r.c + lz * r.s, z: r.z - lx * r.s + lz * r.c, color: s > 0 ? red : 0x2e9e4f, scale: 1.15 });
      }
    }
    // a wide slalom arc in the lagoon
    for (let i = 0; i < 14; i++) {
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

  selectSki(i) {
    this.skiIndex = (i + SKIS.length) % SKIS.length;
    this.spec = SKIS[this.skiIndex];
    store.set('ski', this.skiIndex);
    this.buildSki();
    this.phys.trim = 0;
    this.refreshMenu();
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

  applyTime() {
    const tod = TIMES[this.timeIndex];
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
    if (this.envTex) this.envTex.dispose();
    this.envTex = this.sky.makeEnvironment(this.renderer);
    this.scene.environment = this.envTex;
    this.applyEnv();
    store.set('tod', this.timeIndex);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- UI
  setupUI() {
    const list = $('skiList');
    SKIS.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'ski-opt';
      b.setAttribute('role', 'option');
      b.innerHTML = `${s.name}<small>${s.tagline.split('·')[1].trim()}</small>`;
      b.addEventListener('click', () => this.selectSki(i));
      list.appendChild(b);
    });
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
    seg($('segSea'), SEA_STATES, () => this.seaIndex, (i) => {
      this.seaIndex = i;
      this.applySea();
    });
    this.spotIndex = 0;
    seg($('segSpot'), [{ name: 'Lagoon' }, { name: 'Wave zone' }], () => this.spotIndex, (i) => {
      this.spotIndex = i;
      this.teleport(i === 1 ? 'zone' : 'lagoon');
    });
    seg($('segTime'), TIMES, () => this.timeIndex, (i) => {
      this.timeIndex = i;
      this.applyTime();
    });
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
    $('btnRear').addEventListener('click', () => this.toggleLookBack());
    $('btnAls').addEventListener('click', () => this.toggleAls());
    $('btnMute').addEventListener('click', () => this.toggleMute());
    this.refreshMenu();
    this.ui = {
      speed: $('speed'), rpmFill: $('rpmFill'), rpmVal: $('rpmVal'), trimVal: $('trimVal'), pumpVal: $('pumpVal'), modeVal: $('modeVal'), boostVal: $('boostVal'),
      score: $('score'), best: $('best'), live: $('live'), liveName: $('liveName'), livePts: $('livePts'), combo: $('combo'), pops: $('pops'),
      banner: $('banner'), hint: $('hint'), flash: $('flash'),
      zoneDir: $('zoneDir'), zoneArrow: $('zoneArrow'), zoneDist: $('zoneDist'), zoneLbl: $('zoneLbl'), zoneKeyTip: $('zoneKey'),
    };
    this.uiCache = {};
  }

  refreshMenu() {
    const s = this.spec;
    [...$('skiList').children].forEach((b, i) => b.setAttribute('aria-selected', i === this.skiIndex ? 'true' : 'false'));
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
    if (this.spotIndex !== undefined) this.spotIndex = this.waves.zoneMask(this.phys.px, this.phys.pz) > 0.05 || Math.hypot(this.phys.px - ZONE_IN.x, this.phys.pz - ZONE_IN.z) < 200 ? 1 : 0;
    for (const id of ['segSpot', 'segSea', 'segTime']) {
      const el = $(id);
      [...el.children].forEach((b, i) => b.setAttribute('aria-pressed', i === el._get() ? 'true' : 'false'));
    }
    $('btnRide').textContent = this.hasRidden ? 'RESUME' : 'RIDE';
  }

  ride() {
    this.state = 'ride';
    this.hasRidden = true;
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
      this.showHint(this.mobile ? 'Hold GAS to go. No gas means no steering. TRIM + for rooster tails.' : '<kbd>W</kbd> gas · <kbd>A</kbd><kbd>D</kbd> steer · <kbd>E</kbd>/<kbd>Q</kbd> trim · <kbd>Space</kbd> pull back · hold <kbd>Shift</kbd> to slide', 9);
      setTimeout(() => {
        if (this.state === 'ride' && this.spec.launchControl && !this.shownLaunchHint) {
          this.shownLaunchHint = true;
          this.showLaunchHint();
        }
      }, 9500);
    } else if (this.spec.launchControl && !this.shownLaunchHint) {
      this.shownLaunchHint = true;
      this.showLaunchHint();
    }
  }

  showLaunchHint() {
    const als = this.spec.turbo ? (this.mobile ? ' ALS button: rolling anti-lag.' : ' <kbd>N</kbd> rolling anti-lag.') : '';
    this.showHint((this.mobile ? 'Launch control: hold BRAKE + GAS stopped, let go of BRAKE to launch.' : 'Launch control: hold <kbd>S</kbd> + <kbd>W</kbd> stopped, let go of <kbd>S</kbd> to launch.') + als, 8);
  }

  // show the turbo / launch-control bits of the HUD for the current ski
  syncSkiHud() {
    const turbo = !!this.spec.turbo;
    $('boostRow').hidden = !turbo;
    $('btnAls').hidden = !turbo;
    $('btnAls').classList.toggle('on', turbo && this.phys.als);
    $('alsTag').hidden = !(turbo && this.phys.als);
  }

  toggleAls() {
    if (!this.spec.turbo) return;
    this.phys.als = !this.phys.als;
    this.syncSkiHud();
    this.showHint(this.phys.als ? 'Rolling anti-lag ON: boost stays up when you lift' : 'Rolling anti-lag OFF', 1.6);
  }

  openMenu() {
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

  popTrick(label, pts, kind) {
    const el = document.createElement('div');
    el.className = 'pop' + (kind === 'note' ? ' note' : '');
    el.innerHTML = kind === 'note' ? label : `${label}<b>+${pts.toLocaleString()}</b>`;
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
    if (c.userT > 0 && !this._orbiting()) c.userT -= dt;
    if (c.userT <= 0) {
      c.userYaw = damp(c.userYaw, 0, 0.35, dt);
      c.userPitch = damp(c.userPitch, 0, 0.35, dt);
    }
    // swing out to a rear three-quarter view when the rooster tail is up so you can see it
    c.rooster = damp(c.rooster || 0, clamp(this.effects.rooster * 1.6, 0, 1) * smoothstep(4, 12, spd), 0.9, dt);
    const yaw = c.yaw + c.userYaw + c.rooster * 0.62 + (this.lookBack ? Math.PI : 0);
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
      if (this.lookBack) {
        // turn round to look over your shoulder at the wake
        hx = -p.fhx;
        hz = -p.fhz;
        pitch = -clamp(T.pitch, -0.6, 1.2) * 0.4 - 0.1;
      }
      const dir = new THREE.Vector3(hx * Math.cos(pitch), Math.sin(pitch), hz * Math.cos(pitch));
      eye.addScaledVector(dir, this.lookBack ? -0.05 : 0.05);
      eye.y += this.lookBack ? 0.1 : 0.05;
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
      u.trimVal.textContent = (lit > 0 ? '+' : '') + lit;
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
      if (!$('help').hidden) $('help').hidden = true;
      else if (this.state === 'ride') this.openMenu();
      else if (this.hasRidden) this.ride();
    }
    if (inp.was('Enter') && this.state === 'menu') this.ride();
    if (inp.was('KeyM')) this.toggleMute();
    if (inp.was('KeyT')) {
      this.timeIndex = (this.timeIndex + 1) % TIMES.length;
      this.applyTime();
      this.showHint(TIMES[this.timeIndex].name, 1.6);
      this.refreshMenu();
    }
    if (inp.was('KeyV')) {
      this.seaIndex = (this.seaIndex + 1) % SEA_STATES.length;
      this.applySea();
      this.showHint('Water: ' + SEA_STATES[this.seaIndex].name, 1.6);
      this.refreshMenu();
    }
    if (inp.was('KeyH')) $('help').hidden = !$('help').hidden;
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
      if (inp.was('ArrowRight')) this.selectSki(this.skiIndex + 1);
      if (inp.was('ArrowLeft')) this.selectSki(this.skiIndex - 1);
    }
  }

  frame(now) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 1 / 60;
    this.frameMs = lerp(this.frameMs, dt * 1000, 0.05);
    if (dt > 0.05) dt = 0.05;
    const p = this.phys;
    const T = p.tele;

    this.handleKeys();
    const riding = this.state === 'ride' && !this.wipe.on && $('help').hidden;
    const ctl = this.input.update(dt, T.speed / this.spec.top);
    if (riding) {
      p.ctrl.throttle = ctl.throttle;
      p.ctrl.brake = ctl.brake;
      p.ctrl.steer = ctl.steer;
      p.ctrl.lean = ctl.lean;
      p.ctrl.trimCmd = ctl.trimCmd;
    } else {
      p.ctrl.throttle = 0;
      p.ctrl.brake = 0;
      p.ctrl.steer = this.state === 'menu' ? Math.sin(now * 0.0006) * 0.5 : 0;
      p.ctrl.lean = 0;
      p.ctrl.trimCmd = 0;
    }
    this.input.endFrame();

    // --- simulate ----------------------------------------------------------
    const steps = clamp(Math.round(dt / FIXED), 1, 12);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) p.step(h);
    this.waves.update(dt);
    const time = p.time;

    this.syncSki();
    this.model.update(T, dt);
    this.rider.update(dt, this.model, this.skiGroup, { steer: p.ctrl.steer, lean: p.ctrl.lean, tele: T, sea: SEA_STATES[this.seaIndex].scale });

    // --- effects -----------------------------------------------------------
    this.effects.impactFlag = 0;
    this.effects.smallImpact = 0;
    this.effects.update(dt, p, time);
    if (this.effects.impactFlag > 2.4) {
      const s = clamp((this.effects.impactFlag - 2) / 9, 0.1, 1);
      this.audio.splash(s);
      this.cam.shake = Math.max(this.cam.shake, s);
    } else if (this.effects.smallImpact > 1.3 && T.speed > 4) {
      this.audio.slap(clamp((this.effects.smallImpact - 1.1) / 2.5, 0, 1));
    }
    const shallow = this.terrain.heightAt(p.px, p.pz) > -3;
    const bound = shallow ? 1e9 : this.waves.maxHeight(p.px, p.pz, time) + 0.4;
    const waves = this.waves;
    const terrain = this.terrain;
    const tmp = this._d || (this._d = {});
    this.spray.update(dt, (x, z) => {
      const wy = waves.displace(x, z, time, tmp).y;
      if (!shallow) return wy;
      const g = terrain.heightAt(x, z);
      return g > wy ? g : wy;
    }, bound, this.foam);
    // breaking surf: lips, barrels, spray and whitewater foam (only nearby)
    if (Math.hypot(p.px - WAVE_ZONE.x, p.pz - WAVE_ZONE.z) < 1100) this.breakers.update(dt, time, p, this.effects.density);
    else {
      this.breakers.mesh.visible = false;
      this.breakers.roar = 0;
    }
    this.audio.surfLevel = this.breakers.roar;
    this.foam.update(p.px + p.vx * 0.8, p.pz + p.vz * 0.8, dt);
    this.buoys.update(dt, time, p);

    // --- rules -------------------------------------------------------------
    if (this.state === 'ride') {
      this.updateZone();
      if (this.wipe.on) this.updateWipeout(dt);
      else {
        this.tricks.update(dt, p);
        this.checkWipeout(dt);
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
          if (this.stuckT > 1.2 && this.hintTimer <= 0) this.showHint(this.mobile ? 'Beached. Open MENU and RESUME, or steer clear next time.' : 'Beached. Press <kbd>R</kbd> to get back on the water.', 3);
          if (this.stuckT > 5) this.respawn(true);
        } else this.stuckT = 0;
      }
    }

    // --- render state ------------------------------------------------------
    this.sky.update(dt);
    this.updateCamera(dt);
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

    if (this.state === 'ride') this.updateHUD(dt);
    this.audio.update(T, p.ctrl, this.effects.sprayLevel, this.state !== 'ride', dt);
    if (!this.noRender) this.renderer.render(this.scene, this.camera);
    if (!this.fixedQuality) this.adaptQuality(dt);
    this.frames = (this.frames || 0) + 1;
  }

  // ----------------------------------------------------------- wave zone
  teleport(where) {
    const spot = where === 'zone' ? ZONE_IN : SPAWN;
    this.phys.reset(spot.x, spot.z, spot.yaw);
    this.phys.trim = 0;
    this.safe.x = spot.x;
    this.safe.z = spot.z;
    this.safe.yaw = spot.yaw;
    this.foam.clear();
    this.spray.clear();
    this.tricks.lastYaw = null;
    for (let i = 0; i < 120; i++) this.phys.step(FIXED);
    this.syncSki();
    this.snapCamera();
    this.cam.orbit = this.cam.yaw + 0.5;
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
