// The world everyone shares: time of day, the water, and the admin's fun
// extras. Only the admin (who knows the admin code) can change it. Their game
// signs each change with a key made from the code; everyone else's game checks
// the signature against the public key below and ignores anything unsigned or
// forged. Every rider passes the latest signed settings on in their own
// presence, so they hold for as long as anyone is online.
//
// Neither the code nor anything that would reveal it is stored here: only a
// check value for unlocking and the public half of the signing key.

const UNLOCK = '792d505b985102019da53f8801c5c825b8ffd95a90fcf1df34f4f33d5b579cfd';
const PUB = { kty: 'EC', crv: 'P-256', x: 'A2KC7kmfXTGrcGs8Ct6HN70Z3KyWkF1lY6cyehqBt_Y', y: 'Db_KGZHivyKdz5IoBRubhmFI6qWu6dCkkaC3WfAMLmw' };

export const FUN = [
  { id: 'lowGrav', name: 'Moon gravity' },
  { id: 'turbo', name: 'Turbo for all' },
  { id: 'mega', name: 'Mega spray' },
  { id: 'allHuge', name: 'Every set huge' },
];

export const DEFAULT_WORLD = Object.freeze({ v: 0, sea: 1, day: null, fun: {}, huge: null, summon: 0, banner: null, mute: [] });

// Whatever arrives from the network: keep only what we know, in range.
export function cleanWorld(o, seaCount) {
  const w = { v: 0, sea: 1, day: null, fun: {}, huge: null, summon: 0, banner: null, mute: [] };
  if (!o || typeof o !== 'object') return w;
  if (Number.isFinite(o.v)) w.v = o.v;
  if (Number.isInteger(o.sea) && o.sea >= 0 && o.sea < seaCount) w.sea = o.sea;
  const d = o.day;
  if (d && typeof d === 'object' && [d.t0, d.p0, d.speed].every(Number.isFinite)) {
    w.day = { t0: d.t0, p0: ((d.p0 % 1) + 1) % 1, speed: Math.max(0, Math.min(60, d.speed)) };
  }
  if (o.fun && typeof o.fun === 'object') for (const f of FUN) if (o.fun[f.id] === true) w.fun[f.id] = true;
  if (Number.isInteger(o.huge)) w.huge = o.huge;
  if (Number.isFinite(o.summon)) w.summon = o.summon;
  // a message across everyone's screen
  const b = o.banner;
  if (b && typeof b === 'object' && typeof b.m === 'string' && Number.isFinite(b.t) && typeof b.i === 'string') {
    w.banner = { m: b.m.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g, '').slice(0, 140), t: b.t, i: b.i.slice(0, 12) };
  }
  // riders whose chat nobody sees for a while (by their label this visit and their name)
  if (Array.isArray(o.mute)) {
    for (const m of o.mute.slice(0, 20)) {
      if (m && typeof m.p === 'string' && typeof m.n === 'string' && Number.isFinite(m.u)) w.mute.push({ p: m.p.slice(0, 40), n: m.n.slice(0, 16), u: m.u });
    }
  }
  return w;
}

const enc = new TextEncoder();
const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function sha(s) {
  return new Uint8Array(await subtle().digest('SHA-256', enc.encode(s)));
}

// Is this the admin code? (Resolves to a signing key if so, else null.)
export async function unlock(code) {
  if (!subtle()) return null;
  code = String(code || '').trim();
  const h = [...(await sha('jetski-admin-unlock:' + code))].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (h !== UNLOCK) return null;
  const d = b64u(await sha('jetski-admin-key:' + code));
  return subtle().importKey('jwk', { ...PUB, d, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function sign(key, json) {
  return b64u(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(json)));
}

let pubKey = null;
const seen = new Map(); // signature -> verified?
export async function verify(json, sig) {
  if (!subtle() || typeof json !== 'string' || typeof sig !== 'string' || sig.length > 200) return false;
  const k = sig + '|' + json;
  if (seen.has(k)) return seen.get(k);
  try {
    pubKey = pubKey || (await subtle().importKey('jwk', PUB, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
    const ok = await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, unb64(sig), enc.encode(json));
    if (seen.size > 64) seen.clear();
    seen.set(k, ok);
    return ok;
  } catch {
    return false;
  }
}
