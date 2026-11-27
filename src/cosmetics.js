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
  { id: 'barsa', name: 'Barsa Edition', price: 0, admin: true, cw: { hull: 0x0c0d0f, deck: 0x14161a, accent: 0xffc531, seat: 0x0c0d0f, trim: 0xffc531 }, finish: 'owner' },
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

// Rider outfits: the cap and boardshorts colour.
export const OUTFITS = [
  { id: 'white', name: 'White', price: 3000, color: 0xf2f2f2 },
  { id: 'blue', name: 'Ocean Blue', price: 3000, lv: 5, color: 0x1f7bff },
  { id: 'lime', name: 'Lime', price: 4000, color: 0xb6f01e },
  { id: 'pink', name: 'Hot Pink', price: 4000, color: 0xff2f92 },
  { id: 'gold', name: 'Gold', price: 10000, color: 0xffc531 },
];

// Name tags: the colour of your name over your ski for everyone else.
export const TAGS = [
  { id: 'neon', name: 'Neon', price: 5000, lv: 30, color: '#39ff6a' },
  { id: 'pink', name: 'Pink', price: 5000, color: '#ff5fb0' },
  { id: 'gold', name: 'Gold', price: 12000, color: '#ffc531' },
  { id: 'ice', name: 'Ice', price: 25000, color: '#7fd8ff' },
];

export const SHOP = [
  { kind: 'wrap', title: 'SKI WRAPS', items: WRAPS },
  { kind: 'jet', title: 'JET COLOUR', items: JETS },
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
  return w ? { cw: w.cw, finish: w.finish || null } : { cw: spec.colorways[cwI] || spec.colorways[0], finish: null };
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

// The rider's colourway with an outfit on (cap and shorts).
export function riderLook(cw, fitId) {
  const f = fitId && itemOf('fit', fitId);
  return f ? { ...cw, trim: f.color } : cw;
}
