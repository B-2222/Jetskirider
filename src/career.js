// Your progress: cash, the skis and TRIM-X kits you own, missions done, best
// race times and a few lifetime stats. Without an account it is saved on
// this device; signed in (accounts.js) it lives in your account and follows
// you to any device. If the browser will not store anything it still works
// for the session.

import { SKIS, TRIMX, trimxBase } from './specs.js';

const KEY = 'jetski-rider-career';
export const START_SKI = 'trixx';
export const GUEST_KEY = KEY;
export const START_CASH = 500;
// points from tricks turn into cash at this rate
export const CASH_PER_POINT = 0.06;
// a buoy race pays by medal (bronze, silver, gold)
export const RACE_PAY = [500, 1000, 2000];
export const SPRAY_PAY = 60;

export class Career {
  constructor() {
    // where this device keeps it: the guest save, or the copy of the account
    // you were last signed in to (until the account itself has loaded)
    this.key = KEY;
    try {
      const uid = localStorage.getItem('jetski-rider-uid');
      if (uid && /^[A-Za-z0-9]{6,64}$/.test(uid)) this.key = KEY + '-' + uid;
    } catch {
      /* ignore */
    }
    this.data = this.load();
    this.onChange = null;
    this.sink = null; // signed in: (data) => upload to the account
  }

  load() {
    return Career.clean(this.loadKey(this.key));
  }

  loadKey(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  // switch to another set of progress (your account's, or back to the guest
  // save on this device)
  use(d, key = KEY) {
    this.key = key;
    this.data = Career.clean(d);
    this.save();
  }

  fresh() {
    return Career.clean(null);
  }

  // keep only what we understand, in range
  static clean(d) {
    const fresh = { v: 1, cash: START_CASH, earned: 0, owned: [START_SKI], trimx: {}, missions: {}, races: {}, stats: { maps: {}, sprays: 0, races: 0, golds: 0 } };
    if (!d || typeof d !== 'object') return fresh;
    // keep only what we understand
    const out = fresh;
    if (Number.isFinite(d.cash)) out.cash = Math.max(0, Math.floor(d.cash));
    if (Number.isFinite(d.earned)) out.earned = Math.max(0, Math.floor(d.earned));
    if (Array.isArray(d.owned)) out.owned = [...new Set([START_SKI, ...d.owned.filter((id) => SKIS.some((s) => s.id === id))])];
    if (d.trimx && typeof d.trimx === 'object') for (const [k, v] of Object.entries(d.trimx)) if (v === 1 || v === 2) out.trimx[k] = v;
    if (d.missions && typeof d.missions === 'object') for (const k of Object.keys(d.missions)) out.missions[k] = true;
    if (d.races && typeof d.races === 'object') {
      for (const [k, v] of Object.entries(d.races)) if (v && Number.isFinite(v.best)) out.races[k] = { best: v.best, medal: Number.isInteger(v.medal) ? v.medal : -1 };
    }
    if (d.stats && typeof d.stats === 'object') {
      const s = d.stats;
      if (s.maps && typeof s.maps === 'object') for (const k of Object.keys(s.maps)) out.stats.maps[k] = true;
      for (const k of ['sprays', 'races', 'golds']) if (Number.isFinite(s[k])) out.stats[k] = s[k];
    }
    return out;
  }

  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch {
      /* storage unavailable: progress lasts for this session */
    }
    if (this.sink) this.sink(this.data);
    if (this.onChange) this.onChange();
  }

  get cash() {
    return this.data.cash;
  }

  earn(n) {
    n = Math.max(0, Math.round(n));
    if (!n) return 0;
    this.data.cash += n;
    this.data.earned += n;
    this.save();
    return n;
  }

  spend(n) {
    if (n > this.data.cash) return false;
    this.data.cash -= n;
    this.save();
    return true;
  }

  owns(id) {
    return this.data.owned.includes(id);
  }

  buy(spec) {
    if (this.owns(spec.id)) return 'owned';
    if (!this.spend(spec.price || 0)) return 'poor';
    this.data.owned.push(spec.id);
    this.save();
    return 'ok';
  }

  // TRIM-X stage fitted to this ski (the Trixx comes with stage 1)
  trimx(spec) {
    return Math.max(trimxBase(spec), this.data.trimx[spec.id] || 0);
  }

  buyTrimx(spec) {
    const cur = this.trimx(spec);
    if (cur < 0 || cur >= TRIMX.length - 1) return 'max';
    const next = TRIMX[cur + 1];
    if (!this.spend(next.price)) return 'poor';
    this.data.trimx[spec.id] = cur + 1;
    this.save();
    return 'ok';
  }

  done(id) {
    return !!this.data.missions[id];
  }

  complete(id) {
    if (this.data.missions[id]) return false;
    this.data.missions[id] = true;
    this.save();
    return true;
  }

  race(mapId) {
    return this.data.races[mapId] || null;
  }

  // a finished race: returns whether it was a new best
  finishRace(mapId, time, medal) {
    const r = this.data.races[mapId];
    const best = !r || time < r.best;
    this.data.races[mapId] = { best: best ? time : r.best, medal: Math.max(medal, r ? r.medal : -1) };
    this.data.stats.races++;
    if (medal === 2) this.data.stats.golds++;
    this.save();
    return best;
  }

  visit(mapId) {
    if (this.data.stats.maps[mapId]) return;
    this.data.stats.maps[mapId] = true;
    this.save();
  }

  spray() {
    this.data.stats.sprays++;
    this.save();
  }
}

export const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
