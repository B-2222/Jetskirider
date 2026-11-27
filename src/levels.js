// Rider levels: XP from everything you do, a cash reward every level, a new
// title every five, and at level 50 you can prestige: back to level 1 with a
// star and a permanent cash bonus. XP is worked out per trick (not straight
// from the points, which combos multiply), so the climb takes real riding.

export const MAX_LEVEL = 50;
export const MAX_PRESTIGE = 10;
export const PRESTIGE_BONUS = 0.1; // extra cash per prestige star

// XP to go from this level to the next
export const xpFor = (lv) => 600 + 220 * lv;
// XP for a trick worth `pts` points
export const trickXp = (pts) => Math.round(8 + Math.sqrt(Math.max(0, pts)) * 0.9);
export const levelPay = (lv) => 300 * lv;

const TITLES = [
  [1, 'Grom'],
  [5, 'Rookie'],
  [10, 'Wave Rat'],
  [15, 'Spray King'],
  [20, 'Rooster'],
  [25, 'Barrel Hunter'],
  [30, 'Sky Pilot'],
  [35, 'Reef Legend'],
  [40, 'Storm Chaser'],
  [45, 'Jet Lord'],
  [50, 'Sea-Doo God'],
];
export function titleFor(lv) {
  let t = TITLES[0][1];
  for (const [l, n] of TITLES) if (lv >= l) t = n;
  return t;
}
export const newTitleAt = (lv) => (TITLES.some(([l]) => l === lv) ? titleFor(lv) : null);
