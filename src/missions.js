// Missions: one-off challenges that pay cash. The game reports what happens
// (tricks, speed, air time, races, sprays...) and check() returns any
// missions that have just been completed.

export const MISSIONS = [
  { id: 'kmh80', text: 'Hit 80 km/h', pay: 300, ev: 'speed', n: 80 },
  { id: 'slide180', text: 'Land a 180 powerslide', pay: 400, has: '180 POWERSLIDE' },
  { id: 'wave', text: 'Launch off a wave in the wave zone', pay: 500, has: 'WAVE ' },
  { id: 'race', text: 'Finish a buoy race', pay: 500, ev: 'race', n: -1 },
  { id: 'clean', text: 'Stomp a clean landing', pay: 500, has: 'CLEAN LANDING' },
  { id: 'tail', text: 'Hold a tail stand', pay: 600, has: 'TAIL STAND' },
  { id: 'air2', text: 'Get 2 seconds of air in one jump', pay: 600, ev: 'air', n: 2 },
  { id: 'spray', text: 'Spray another rider online', pay: 500, ev: 'spray', n: 1 },
  { id: 'trimx', text: 'Fit a TRIM-X kit', pay: 750, ev: 'trimx', n: 1 },
  { id: 'spin360', text: 'Pull a 360 spin', pay: 900, has: '360 SPIN' },
  { id: 'barrel', text: 'Get barrelled', pay: 1000, has: 'BARREL' },
  { id: 'kmh110', text: 'Hit 110 km/h', pay: 1200, ev: 'speed', n: 110 },
  { id: 'superman', text: 'Land a Superman (sit-down ski)', pay: 1200, has: 'SUPERMAN' },
  { id: 'combo4', text: 'Build a x4 combo', pay: 1500, ev: 'combo', n: 4 },
  { id: 'backflip', text: 'Land a backflip (stand-up)', pay: 1500, has: 'BACKFLIP' },
  { id: 'garage3', text: 'Own 3 skis', pay: 1500, ev: 'owned', n: 3 },
  { id: 'maps', text: 'Ride every map', pay: 2000, ev: 'maps', n: 4 },
  { id: 'score10k', text: 'Reach a score of 10,000', pay: 2000, ev: 'score', n: 10000 },
  { id: 'air4', text: 'Get 4 seconds of air in one jump', pay: 2500, ev: 'air', n: 4 },
  { id: 'gold', text: 'Win a gold medal in a buoy race', pay: 3000, ev: 'race', n: 2 },
  { id: 'deep', text: 'Get a deep barrel (over 2 seconds)', pay: 3000, has: 'DEEP BARREL' },
  { id: 'spray10', text: 'Spray 10 riders online', pay: 3000, ev: 'spray', n: 10 },
  { id: 'kmh150', text: 'Hit 150 km/h', pay: 4000, ev: 'speed', n: 150 },
  { id: 'combo8', text: 'Max out the combo (x8)', pay: 5000, ev: 'combo', n: 8 },
  { id: 'score50k', text: 'Reach a score of 50,000', pay: 5000, ev: 'score', n: 50000 },
  { id: 'double', text: 'Land a double flip (stand-up)', pay: 6000, has: 'DOUBLE ' },
  { id: 'garage8', text: 'Own 8 skis', pay: 10000, ev: 'owned', n: 8 },
  { id: 'gold4', text: 'Win gold on every map', pay: 15000, ev: 'golds', n: 4 },
];

// ev: what happened; v: its value (a trick label, a speed in km/h, a count...)
export function checkMissions(career, ev, v) {
  const done = [];
  for (const m of MISSIONS) {
    if ((m.ev || 'trick') !== ev || career.done(m.id)) continue;
    const ok = ev === 'trick' ? typeof v === 'string' && v.includes(m.has) : v >= m.n;
    if (ok && career.complete(m.id)) done.push(m);
  }
  return done;
}
