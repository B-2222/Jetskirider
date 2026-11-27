// The style shop: things to buy once you have the skis you want, and to show
// off online (everyone sees your wrap, jet colour, outfit and name tag).
// Some unlock for free at a level (lv). Three-free (the save uses it).

// Wraps go on whichever ski you ride. finish: how the paint looks.
export const WRAPS = [
  { id: 'pink', name: 'Hot Pink', price: 8000, cw: { hull: 0xf4f6f8, deck: 0xff2f92, accent: 0xffffff, seat: 0x1a1d21, trim: 0xff2f92 } },
  { id: 'carbon', name: 'Carbon', price: 15000, lv: 20, cw: { hull: 0x121316, deck: 0x1c1e22, accent: 0x3a3f46, seat: 0x0e0f11, trim: 0xff3b1f }, finish: 'satin' },
  { id: 'neon', name: 'Neon Glow', price: 20000, cw: { hull: 0x0b0c0e, deck: 0x101114, accent: 0x39ff6a, seat: 0x101114, trim: 0x39ff6a }, finish: 'neon' },
  { id: 'chrome', name: 'Chrome', price: 30000, lv: 40, cw: { hull: 0xd9dde2, deck: 0xc8ced4, accent: 0x1a1c20, seat: 0x15171a, trim: 0x8fd8ff }, finish: 'chrome' },
  { id: 'gold', name: 'Solid Gold', price: 75000, cw: { hull: 0xd4a63a, deck: 0xe8c25a, accent: 0x1a1508, seat: 0x15120a, trim: 0xffe08a }, finish: 'gold' },
  // the admin's own: black chrome and glowing gold, only with the admin code
  { id: 'barsa', name: 'Barsa Edition', price: 0, admin: true, cw: { hull: 0x0c0d0f, deck: 0x14161a, accent: 0xffc531, seat: 0x0c0d0f, trim: 0xffc531, art: 'barsa' }, finish: 'owner', flair: 'barsa' },
];

// Jet stream colours (a tint over the white water).
export const JETS = [
  { id: 'ice', name: 'Ice Blue', price: 6000, lv: 10, color: 0x7fd8ff },
  { id: 'pink', name: 'Bubblegum', price: 6000, color: 0xff5fb0 },
  { id: 'lime', name: 'Toxic Lime', price: 8000, color: 0x9dff3a },
  { id: 'purple', name: 'Purple Haze', price: 8000, color: 0xa66bff },
  { id: 'gold', name: 'Gold', price: 12000, color: 0xffc531 },
  { id: 'inferno', name: 'Inferno', price: 40000, lv: 50, color: 0xff5a1f },
];

// Rider outfits: a whole kit. The life vest (its colour, panels and print),
// the tee and sleeves, the boardshorts, the cap, gloves and the straps.
// color is the swatch in the shop.
export const OUTFITS = [
  { id: 'white', name: 'White Out', price: 3000, color: 0xf2f2f2, kit: { pattern: 'race', vest: '#eef1f4', panel: '#15171b', text: '#15171b', tee: 0xe6e9ec, shorts: '#eef1f4', shortsPanel: '#15171b', stripe: '#15171b', cap: 0xf2f4f6, accent: 0x15171b, gloves: 0x15171b, shoe: 0xe9ecef } },
  { id: 'blue', name: 'Deep Blue', price: 3000, lv: 5, color: 0x1f7bff, kit: { pattern: 'wave', vest: '#1360d8', panel: '#7fe3ff', text: '#ffffff', tee: 0x0f1d33, shorts: '#0f1d33', shortsPanel: '#1f7bff', stripe: '#7fe3ff', cap: 0x1f7bff, accent: 0x7fe3ff, gloves: 0x0f1d33, shoe: 0x0f1d33 } },
  { id: 'lime', name: 'Toxic Lime', price: 4000, color: 0xb6f01e, kit: { pattern: 'chevron', vest: '#b6f01e', panel: '#101114', text: '#101114', tee: 0x101114, shorts: '#101114', shortsPanel: '#b6f01e', stripe: '#b6f01e', cap: 0x101114, accent: 0xb6f01e, gloves: 0xb6f01e, shoe: 0x101114 } },
  { id: 'pink', name: 'Hot Pink', price: 4000, color: 0xff2f92, kit: { pattern: 'split', vest: '#ff2f92', panel: '#ffffff', text: '#ffffff', tee: 0xf4f4f2, shorts: '#ff2f92', shortsPanel: '#ffffff', stripe: '#15171b', cap: 0xff2f92, accent: 0xffffff, gloves: 0xffffff, shoe: 0xf4f4f2 } },
  { id: 'stealth', name: 'Stealth', price: 7000, color: 0x2a2d33, kit: { pattern: 'reflect', vest: '#0c0d0f', panel: '#9aa3ad', text: '#9aa3ad', tee: 0x0c0d0f, shorts: '#0c0d0f', shortsPanel: '#2a2d33', stripe: '#9aa3ad', cap: 0x0c0d0f, accent: 0x9aa3ad, gloves: 0x0c0d0f, shoe: 0x0c0d0f } },
  { id: 'camo', name: 'Reef Camo', price: 9000, lv: 15, color: 0x2f8f8a, kit: { pattern: 'camo', vest: '#1d5c63', panel: '#0e2a30', camo: ['#2f8f8a', '#0e2a30', '#7fc9b8'], text: '#e9f5f2', tee: 0x0e2a30, shorts: '#0e2a30', shortsPanel: '#2f8f8a', stripe: '#7fc9b8', cap: 0x1d5c63, accent: 0xff8a3d, gloves: 0x0e2a30, shoe: 0x0e2a30 } },
  { id: 'gold', name: 'Gold', price: 10000, color: 0xffc531, kit: { pattern: 'race', vest: '#101114', panel: '#ffc531', text: '#ffc531', tee: 0x101114, shorts: '#101114', shortsPanel: '#ffc531', stripe: '#ffc531', cap: 0xffc531, accent: 0xffc531, gloves: 0xffc531, shoe: 0x101114 } },
];

// Name tags: the colour of your name over your ski for everyone else.
export const TAGS = [
  { id: 'neon', name: 'Neon', price: 5000, lv: 30, color: '#39ff6a' },
  { id: 'pink', name: 'Pink', price: 5000, color: '#ff5fb0' },
  { id: 'gold', name: 'Gold', price: 12000, color: '#ffc531' },
  { id: 'ice', name: 'Ice', price: 25000, color: '#7fd8ff' },
];

// Animated decals: light that lives on the hull sides and moves with the
// ski. Some react to the engine (shift lights fill with the revs, afterburn
// glows with the throttle, the tide line flows faster with speed). Others
// see them too. fx: the effect (see flair.js); color: the swatch.
export const DECALS = [
  { id: 'scan', name: 'Scanner', price: 12000, fx: 0, color: 0x9fe8ff, c2: 0xffffff },
  { id: 'chrome', name: 'Liquid Chrome', price: 15000, fx: 2, color: 0xdfe8f0, c2: 0xffffff },
  { id: 'tide', name: 'Tide Line', price: 18000, lv: 20, fx: 3, color: 0x2de2c8, c2: 0xd9fff8 },
  { id: 'heat', name: 'Afterburn', price: 25000, fx: 4, color: 0xffb020, c2: 0xff2a10 },
  { id: 'shift', name: 'Shift Lights', price: 35000, lv: 35, fx: 1, color: 0x39ff6a, c2: 0x5fb4ff },
];

// Underglow: neon under the hull that lights the water round the ski.
// mode: steady, breathe (a slow pulse), throttle (brighter on the gas),
// chase (a light runs round the hull).
export const GLOWS = [
  { id: 'ice', name: 'Ice', price: 8000, color: 0x5fd0ff, mode: 'steady' },
  { id: 'toxic', name: 'Toxic', price: 8000, color: 0x39ff6a, mode: 'steady' },
  { id: 'uv', name: 'Ultraviolet', price: 12000, color: 0x7a45ff, mode: 'breathe' },
  { id: 'red', name: 'Red Line', price: 16000, lv: 25, color: 0xff2a2a, mode: 'throttle' },
  { id: 'chase', name: 'Chase', price: 25000, color: 0xbff4ff, mode: 'chase' },
];

export const SHOP = [
  { kind: 'wrap', title: 'SKI WRAPS', items: WRAPS },
  { kind: 'jet', title: 'JET COLOUR', items: JETS },
  { kind: 'dec', title: 'DECALS (ANIMATED)', items: DECALS },
  { kind: 'glow', title: 'UNDERGLOW', items: GLOWS },
  { kind: 'fit', title: 'OUTFIT', items: OUTFITS },
  { kind: 'tag', title: 'NAME TAG', items: TAGS },
];

export const itemOf = (kind, id) => {
  const s = SHOP.find((x) => x.kind === kind);
  return (s && s.items.find((i) => i.id === id)) || null;
};

// The look for a ski: its own colourway, or a wrap over it.
export function skiLook(spec, cwI, wrapId) {
  const w = wrapId && itemOf('wrap', wrapId);
  return w ? { cw: w.cw, finish: w.finish || null, flair: w.flair || null } : { cw: spec.colorways[cwI] || spec.colorways[0], finish: null, flair: null };
}

// Paint finish on a built ski: chrome and gold go metallic, neon glows.
export function applyFinish(group, finish, cw) {
  if (!finish) return;
  group.traverse((o) => {
    const m = o.material;
    if (!m || !m.isMeshPhysicalMaterial) return;
    const body = m.clearcoat > 0.4; // the painted panels
    if ((finish === 'chrome' || finish === 'gold') && body) {
      m.metalness = 1;
      m.roughness = finish === 'chrome' ? 0.12 : 0.2;
      m.clearcoat = 1;
    } else if (finish === 'owner' && body) {
      // black chrome
      m.metalness = 0.9;
      m.roughness = 0.16;
      m.clearcoat = 1;
      if (m.color && m.color.getHex() === cw.trim) {
        m.emissive.setHex(cw.trim);
        m.emissiveIntensity = 0.9;
      }
    } else if (finish === 'owner' && m.color && m.color.getHex() === cw.trim) {
      m.emissive.setHex(cw.trim);
      m.emissiveIntensity = 1.2;
    } else if (finish === 'satin' && body) {
      m.roughness = 0.55;
      m.clearcoat = 0.3;
    } else if (finish === 'neon' && m.color && m.color.getHex() === cw.trim) {
      m.emissive.setHex(cw.trim);
      m.emissiveIntensity = 1.4;
    }
  });
}

// The rider's colourway with an outfit on (the whole kit).
export function riderLook(cw, fitId) {
  const f = fitId && itemOf('fit', fitId);
  return f ? { ...cw, trim: f.color, kit: f.kit } : cw;
}
