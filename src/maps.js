// The maps. Each one is a whole world: its own islands, its own surf (how big,
// how fast and how often the waves come through), its own sky and water mood,
// its own buoy race and its own cash bonus.
//
// The world modules keep their settings in plain objects (SURF, WAVE_ZONE,
// ISLANDS...). applyMap() rewrites them in place before the game builds the
// world, so everything (physics, GPU water, breakers) sees the same map.
// Palm Bay is the original world and changes nothing.
//
// Pure data and three-free, so the tools can use it too.

import { SURF, WAVE_ZONE, SET_SHAPE } from './surf.js';
import { ISLANDS, SANDBARS, TERRAIN } from './terrain.js';

const PI = Math.PI;

export const MAPS = [
  {
    id: 'bay',
    name: 'PALM BAY',
    blurb: 'The home lagoon: kickers, slalom buoys and a friendly reef break out past the point.',
    waves: 'Friendly sets of four',
    bonus: { id: 'ramp', text: 'Air off the ramps pays 2x' },
    load: 'Filling the lagoon…',
    spawn: { x: 0, z: -150, yaw: -PI / 2 },
    ramps: [
      [0, 40, -PI / 2],
      [-190, 250, -PI / 2 - 0.9],
      [270, -70, 0.4],
      [430, 320, 2.5],
      [-420, -20, PI * 0.8],
    ],
    slalom: true,
    // circle: where the race circle floats (wait in it to race)
    // medals: bronze, silver, gold times (s), set from autopilot laps: bronze
    // on the Spark Trixx, silver on a GTI, gold on an RXP-X 325
    race: { name: 'Lagoon Loop', circle: [40, -190], gates: [[-60, -160], [180, -170], [420, 40], [350, 380], [60, 330], [-220, 360], [-300, 120], [-200, -120]], medals: [113, 99, 77] },
  },
  {
    id: 'reef',
    name: 'THUNDER REEF',
    blurb: 'A volcanic island with an outer reef where the swell stands up into giant, fast walls.',
    waves: 'Giant, fast sets of three',
    bonus: { id: 'wave', text: 'Wave tricks and barrels pay 2x' },
    load: 'Waxing the reef…',
    seed: 4242,
    islands: [
      { x: -620, z: -420, r: 520, h: 150 },
      { x: -120, z: -980, r: 160, h: 34 },
      { x: 360, z: -1050, r: 70, h: 20 },
      { x: -1250, z: 520, r: 210, h: 48 },
      { x: 780, z: 820, r: 120, h: 26 },
      { x: -240, z: 1080, r: 95, h: 18 },
      { x: 520, z: -440, r: 30, h: 30 },
      { x: 590, z: -360, r: 24, h: 24 },
      { x: 1350, z: -1250, r: 180, h: 40 },
    ],
    sandbars: [{ x: 160, z: 560, r: 120, top: -1.0 }],
    zone: { x: 1050, z: -250, rIn: 230, rOut: 420, dir: 2.6 },
    surf: { A0: 3.5, c: 10.5, setN: 3, gap: 14, lull: 26, spawnS: -470, endS: 440, sBreak: -40 },
    setShape: [0.95, 1.07, 1.0],
    spawn: { x: 250, z: 120, yaw: 0.2 },
    ramps: [],
    veg: { palms: 180, canopy: 1700, rocks: 420 },
    race: { name: 'Volcano Run', circle: [290, 180], gates: [[200, 0], [380, -600], [650, -850], [760, -620], [560, 120], [300, 330]], medals: [141, 123, 96] },
  },
  {
    id: 'lake',
    name: 'GLASS LAKE',
    blurb: 'A mirror-flat lake in a ring of forest hills, with a wave pool kicking out quick rollers.',
    waves: 'Small, quick rollers in sixes',
    bonus: { id: 'flat', text: 'Slides, wheelies and flat-water flips pay 2x' },
    load: 'Smoothing the lake…',
    seed: 777,
    islands: (() => {
      // a ring of hills round the lake, with a couple of gaps out to sea
      const out = [];
      const n = 16;
      for (let i = 0; i < n; i++) {
        if (i === 5 || i === 12) continue;
        const a = (i / n) * PI * 2;
        const R = 1300 + ((i * 37) % 5) * 40;
        out.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, r: 330 + ((i * 53) % 4) * 30, h: 95 + ((i * 29) % 5) * 22 });
      }
      out.push({ x: -380, z: 420, r: 70, h: 14 }, { x: 160, z: -620, r: 48, h: 9 }, { x: -620, z: -380, r: 90, h: 22 });
      return out;
    })(),
    sandbars: [{ x: -140, z: 180, r: 90, top: -0.8 }],
    zone: { x: 420, z: 330, rIn: 110, rOut: 230, dir: 2.45 },
    surf: { A0: 1.0, c: 7.5, setN: 6, gap: 6, lull: 8, spawnS: -200, endS: 180, sBreak: 0 },
    setShape: [0.9, 0.97, 1.03, 1.06, 1.0, 0.94],
    sea: 0, // always glassy
    spawn: { x: 0, z: -150, yaw: -PI / 2 },
    ramps: [
      [-120, -60, -PI / 2],
      [120, 120, 0.5],
    ],
    veg: { palms: 0, canopy: 3200, rocks: 260, pine: true },
    race: { name: 'Lake Sprint', circle: [50, -190], gates: [[0, -320], [380, -360], [500, -80], [160, 100], [-60, 480], [-420, 160], [-340, -180]], medals: [143, 125, 96] },
  },
  {
    id: 'storm',
    name: 'STORM COAST',
    blurb: 'Black cliffs, sea stacks and a storm that never quits. Big messy surf, rain and lightning.',
    waves: 'Heavy surf that keeps coming',
    bonus: { id: 'all', text: 'Danger pay: all cash 1.5x' },
    load: 'Brewing a storm…',
    seed: 9001,
    islands: [
      { x: -1500, z: -1250, r: 420, h: 120 },
      { x: -800, z: -1350, r: 380, h: 140 },
      { x: -100, z: -1300, r: 400, h: 110 },
      { x: 650, z: -1400, r: 420, h: 150 },
      { x: 1400, z: -1250, r: 400, h: 120 },
      { x: -300, z: -700, r: 40, h: 46 },
      { x: 150, z: -760, r: 30, h: 38 },
      { x: 950, z: -720, r: 36, h: 44 },
      { x: -1100, z: -650, r: 70, h: 30 },
      { x: -900, z: 700, r: 220, h: 70 },
      { x: 900, z: 900, r: 160, h: 40 },
    ],
    sandbars: [],
    zone: { x: 400, z: -380, rIn: 220, rOut: 400, dir: 0.15 },
    surf: { A0: 2.9, c: 11, setN: 5, gap: 8, lull: 9, spawnS: -380, endS: 360, sBreak: -30 },
    setShape: [0.9, 1.05, 1.0, 1.1, 0.95],
    sea: 3, // always rough
    spawn: { x: -200, z: 250, yaw: -PI / 2 },
    ramps: [],
    veg: { palms: 50, canopy: 900, rocks: 650, dark: true },
    mood: { grey: 0.74, dark: 0.7, sun: 0.26, cloud: 0.95, fog: 1900, exposure: 0.92, water: [0.62, 0.74, 0.76], rain: true },
    race: { name: 'Headland Run', circle: [-150, 300], gates: [[-200, 150], [-600, 320], [-450, 800], [250, 950], [550, 520], [250, 220]], medals: [169, 150, 119] },
  },
];

export const mapById = (id) => MAPS.find((m) => m.id === id) || MAPS[0];

// Rewrite the world settings for this map (once, before the world is built).
export function applyMap(map) {
  if (map.seed) TERRAIN.seed = map.seed;
  if (map.islands) ISLANDS.splice(0, ISLANDS.length, ...map.islands.map((o) => ({ ...o })));
  if (map.sandbars) SANDBARS.splice(0, SANDBARS.length, ...map.sandbars.map((o) => ({ ...o })));
  if (map.zone) Object.assign(WAVE_ZONE, map.zone);
  if (map.surf) {
    Object.assign(SURF, map.surf);
    SURF.period = SURF.setN * SURF.gap + SURF.lull;
    SURF.life = (SURF.endS - SURF.spawnS) / SURF.c;
  }
  if (map.setShape) SET_SHAPE.splice(0, SET_SHAPE.length, ...map.setShape);
  return map;
}
