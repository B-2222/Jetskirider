// Daily challenges: three a day, the same for everyone, new at midnight
// Perth time. Finish all three for a bonus. Riding on days in a row builds a
// streak that pays more each day (up to day 10).

const DAY_MS = 86400000;
const TZ_MS = 8 * 3600000; // Perth (UTC+8)

export const dayNow = () => Math.floor((Date.now() + TZ_MS) / DAY_MS);
// ms until the next day starts
export const msToNextDay = () => DAY_MS - ((Date.now() + TZ_MS) % DAY_MS);
// leaderboards run Monday to Sunday (1970-01-01 was a Thursday)
export const weekOf = (day) => Math.floor((day + 3) / 7);

export const SWEEP_PAY = 5000;
export const streakPay = (n) => 250 * Math.min(n, 10);

// ev: what counts. has: a trick label containing this. map: only on that map.
// need: only some skis can do it (at most one of these a day).
const POOL = [
  { id: 'slides', text: 'Pull 10 powerslides', has: ['SLIDE'], n: 10, pay: 1500 },
  { id: 'spins', text: 'Pull 5 360 spins', has: ['360'], n: 5, pay: 2500 },
  { id: 'waves', text: 'Launch off 10 waves', has: ['WAVE '], n: 10, pay: 2500 },
  { id: 'barrels', text: 'Get barrelled 3 times', has: ['BARREL'], n: 3, pay: 3000 },
  { id: 'clean', text: 'Stomp 5 clean landings', has: ['CLEAN LANDING'], n: 5, pay: 2500 },
  { id: 'wheelies', text: 'Hold 5 wheelies or tail stands', has: ['WHEELIE', 'TAIL STAND'], n: 5, pay: 2000 },
  { id: 'flips', text: 'Land 3 backflips (stand-up)', has: ['BACKFLIP'], n: 3, pay: 3500, need: 1 },
  { id: 'supers', text: 'Land 3 Supermans (sit-down)', has: ['SUPERMAN'], n: 3, pay: 3500, need: 1 },
  { id: 'air', text: 'Get 20 seconds of air in total', ev: 'air', n: 20, pay: 2500 },
  { id: 'score', text: 'Score 25,000 points', ev: 'pts', n: 25000, pay: 2500 },
  { id: 'races', text: 'Finish 2 buoy races', ev: 'race', n: 2, pay: 2500 },
  { id: 'gold', text: 'Win gold in a buoy race', ev: 'gold', n: 1, pay: 4000 },
  { id: 'combo', text: 'Build a x5 combo', ev: 'combo', n: 5, pay: 3000, max: true },
  { id: 'spray', text: 'Spray 3 riders online', ev: 'spray', n: 3, pay: 2500 },
  { id: 'reef', text: 'Score 10,000 on Thunder Reef', ev: 'pts', map: 'reef', n: 10000, pay: 3500 },
  { id: 'lake', text: 'Pull 8 slides on Glass Lake', has: ['SLIDE'], map: 'lake', n: 8, pay: 3000 },
  { id: 'storm', text: 'Launch off 5 waves on Storm Coast', has: ['WAVE '], map: 'storm', n: 5, pay: 4000 },
  { id: 'ramps', text: 'Get 5 ramp airs in Palm Bay', ev: 'ramp', map: 'bay', n: 5, pay: 2500 },
];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// today's three (the same on every device)
export function dailyFor(day) {
  const r = rng(day * 2654435761);
  const out = [];
  let needs = 0;
  let mapped = 0;
  const pool = POOL.slice();
  while (out.length < 3 && pool.length) {
    const c = pool.splice(Math.floor(r() * pool.length), 1)[0];
    if (c.need && needs) continue;
    if (c.map && mapped) continue;
    if (c.need) needs++;
    if (c.map) mapped++;
    out.push(c);
  }
  return out;
}

// how much an event moves a challenge on (0 = not at all)
export function dailyStep(c, ev, v, mapId) {
  if (c.map && c.map !== mapId) return 0;
  if (c.has) return ev === 'trick' && typeof v === 'string' && c.has.some((h) => v.includes(h)) ? 1 : 0;
  return ev === c.ev ? v : 0;
}
