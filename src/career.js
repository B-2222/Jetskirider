// Your progress: cash, the skis and TRIM-X kits you own, missions done, best
// race times and a few lifetime stats. Without an account it is saved on
// this device; signed in (accounts.js) it lives in your account and follows
// you to any device. If the browser will not store anything it still works
// for the session.

import { SKIS, TRIMX, trimxBase } from './specs.js';
import { MAX_LEVEL, MAX_PRESTIGE, xpFor, levelPay, newTitleAt } from './levels.js';
import { dailyFor, dailyStep, SWEEP_PAY, streakPay } from './daily.js';
import { itemOf } from './cosmetics.js';

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
    const fresh = {
      v: 1, cash: START_CASH, earned: 0, owned: [START_SKI], trimx: {}, missions: {}, races: {}, stats: { maps: {}, sprays: 0, races: 0, golds: 0 },
      lv: 1, xp: 0, pr: 0, // level, XP into it, prestige stars
      daily: { day: 0, prog: {}, done: {}, sweep: false },
      streak: { last: 0, n: 0 },
      cos: [], // style items bought, as 'kind:id'
      eq: {}, // style items worn: { wrap, jet, fit, tag }
      wk: { w: 0, tricks: 0, race: {} }, // this week's bests (leaderboards)
    };
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
    const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
    out.lv = int(d.lv, 1, MAX_LEVEL, 1);
    out.xp = int(d.xp, 0, 1e7, 0);
    out.pr = int(d.pr, 0, MAX_PRESTIGE, 0);
    if (d.daily && typeof d.daily === 'object') {
      const y = d.daily;
      out.daily.day = int(y.day, 0, 1e6, 0);
      out.daily.sweep = y.sweep === true;
      if (y.prog && typeof y.prog === 'object') for (const [k, v] of Object.entries(y.prog)) if (Number.isFinite(v)) out.daily.prog[k.slice(0, 16)] = v;
      if (y.done && typeof y.done === 'object') for (const k of Object.keys(y.done)) out.daily.done[k.slice(0, 16)] = true;
    }
    if (d.streak && typeof d.streak === 'object') out.streak = { last: int(d.streak.last, 0, 1e6, 0), n: int(d.streak.n, 0, 1e5, 0) };
    if (Array.isArray(d.cos)) out.cos = [...new Set(d.cos.filter((k) => typeof k === 'string' && itemOf(...k.split(':'))))];
    if (d.eq && typeof d.eq === 'object') for (const k of ['wrap', 'jet', 'fit', 'tag']) if (typeof d.eq[k] === 'string' && itemOf(k, d.eq[k])) out.eq[k] = d.eq[k];
    if (d.wk && typeof d.wk === 'object') {
      out.wk.w = int(d.wk.w, 0, 1e6, 0);
      out.wk.tricks = Number.isFinite(d.wk.tricks) ? d.wk.tricks : 0;
      if (d.wk.race && typeof d.wk.race === 'object') for (const [k, v] of Object.entries(d.wk.race)) if (Number.isFinite(v)) out.wk.race[k.slice(0, 8)] = v;
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

  // the admin can take cash away (never below zero); returns how much went
  take(n) {
    const t = Math.min(this.data.cash, Math.max(0, Math.round(n)));
    if (!t) return 0;
    this.data.cash -= t;
    this.save();
    return t;
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

  // ------------------------------------------------------------ levels
  // returns the level-ups this XP caused: [{ lv, pay, title }]
  addXp(n) {
    const d = this.data;
    const ups = [];
    d.xp += Math.max(0, Math.round(n));
    while (d.lv < MAX_LEVEL && d.xp >= xpFor(d.lv)) {
      d.xp -= xpFor(d.lv);
      d.lv++;
      const pay = levelPay(d.lv);
      d.cash += pay;
      d.earned += pay;
      ups.push({ lv: d.lv, pay, title: newTitleAt(d.lv) });
    }
    if (d.lv >= MAX_LEVEL) d.xp = Math.min(d.xp, xpFor(d.lv));
    this.save();
    return ups;
  }

  canPrestige() {
    return this.data.lv >= MAX_LEVEL && this.data.pr < MAX_PRESTIGE;
  }

  prestige() {
    if (!this.canPrestige()) return false;
    this.data.pr++;
    this.data.lv = 1;
    this.data.xp = 0;
    this.save();
    return true;
  }

  // ------------------------------------------------------------ daily
  // today's challenges with progress; starts a new day's set when it changes
  today(day) {
    const y = this.data.daily;
    if (y.day !== day) {
      this.data.daily = { day, prog: {}, done: {}, sweep: false };
      this.save();
    }
    return dailyFor(day).map((c) => ({ ...c, prog: Math.min(c.n, this.data.daily.prog[c.id] || 0), done: !!this.data.daily.done[c.id] }));
  }

  // something happened: returns { done: [challenges finished], sweep }
  dailyEvent(day, ev, v, mapId) {
    const list = this.today(day);
    const y = this.data.daily;
    const done = [];
    let moved = false;
    for (const c of list) {
      if (c.done) continue;
      const step = dailyStep(c, ev, v, mapId);
      if (!step) continue;
      y.prog[c.id] = c.max ? Math.max(y.prog[c.id] || 0, step) : (y.prog[c.id] || 0) + step;
      moved = true;
      if (y.prog[c.id] >= c.n) {
        y.done[c.id] = true;
        done.push(c);
      }
    }
    let sweep = false;
    if (done.length && !y.sweep && list.every((c) => y.done[c.id])) {
      y.sweep = true;
      sweep = true;
    }
    if (moved) this.save();
    return { done, sweep, sweepPay: SWEEP_PAY };
  }

  // the first ride of a day: the streak goes on (or starts again); returns
  // the new streak length, or 0 if today was already counted
  streakTick(day) {
    const s = this.data.streak;
    if (s.last === day) return 0;
    s.n = s.last === day - 1 ? s.n + 1 : 1;
    s.last = day;
    this.save();
    return s.n;
  }
  streakPay(n) {
    return streakPay(n);
  }

  // ------------------------------------------------------------ style
  // bought, or unlocked by level (any prestige star unlocks them all)
  hasCos(kind, id) {
    const it = itemOf(kind, id);
    if (!it) return false;
    if (it.lv && (this.data.pr > 0 || this.data.lv >= it.lv)) return true;
    return this.data.cos.includes(kind + ':' + id);
  }

  buyCos(kind, id) {
    const it = itemOf(kind, id);
    if (!it || this.hasCos(kind, id)) return 'owned';
    if (!this.spend(it.price)) return 'poor';
    this.data.cos.push(kind + ':' + id);
    this.data.eq[kind] = id;
    this.save();
    return 'ok';
  }

  wear(kind, id) {
    if (id && !this.hasCos(kind, id)) return;
    if (id) this.data.eq[kind] = id;
    else delete this.data.eq[kind];
    this.save();
  }

  // ------------------------------------------------------------ weekly bests
  week(w) {
    if (this.data.wk.w !== w) this.data.wk = { w, tricks: 0, race: {} };
    return this.data.wk;
  }
}

export const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
