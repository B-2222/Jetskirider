// A light word filter for chat, names and leaderboard names: swears and
// slurs turn into stars. It reads through l33t spelling, stretched letters
// (fuuuck) and symbols stuck in the middle (f.u.c.k). Short words that hide
// inside normal ones (ass in class, cock in peacock) only count on their own.

// anywhere inside a word
const ROOTS = ['fuck', 'fuk', 'fck', 'fuc', 'shit', 'cunt', 'nigg', 'niga', 'nigr', 'fagot', 'faggot', 'fagget', 'bitch', 'biatch', 'whore', 'slut', 'wank', 'bollock', 'twat', 'retard', 'dildo', 'porn', 'pussy', 'bastard', 'asshole', 'arsehole', 'motherf', 'dickhead', 'jizz', 'spastic', 'tranny', 'kike', 'chink', 'coon', 'wetback', 'beaner', 'rapist', 'molest', 'pedo', 'paedo'];
// only as a whole word
const WHOLE = new Set(['ass', 'arse', 'asses', 'cum', 'cock', 'cocks', 'dick', 'dicks', 'fag', 'fags', 'rape', 'raped', 'tits', 'titty', 'hoe', 'hoes', 'kys', 'penis', 'vagina', 'sex', 'nazi', 'nazis', 'hitler', 'spaz', 'prick', 'boob', 'boobs', 'damn']);

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '€': 'e' };

function norm(w) {
  let s = '';
  for (const ch of w.toLowerCase()) {
    const c = LEET[ch] || ch;
    if (c >= 'a' && c <= 'z') s += c;
  }
  return s;
}

const squash = (s) => s.replace(/(.)\1+/g, '$1');

function bad(word) {
  const n = norm(word);
  if (!n) return false;
  const q = squash(n);
  if (WHOLE.has(n) || WHOLE.has(q)) return true;
  for (const r of ROOTS) if (n.includes(r) || q.includes(squash(r))) return true;
  return false;
}

// the text with any bad words starred out
export function cleanWords(text) {
  const s = String(text || '');
  if (!s) return s;
  // whole tokens first (keeps punctuation round normal words)
  let out = s.replace(/[^\s]+/g, (w) => (bad(w) ? '*'.repeat(Math.min(w.length, 8)) : w));
  // words split up with spaces or dots: "f u c k", "s.h.i.t"
  const joined = norm(out.replace(/\*/g, ''));
  if (ROOTS.some((r) => joined.includes(r))) {
    out = out.replace(/(?:\b\w\b[\s.\-_]*){3,}/g, (m) => (bad(m.replace(/[\s.\-_]/g, '')) ? '*'.repeat(Math.min(m.trim().length, 8)) : m));
  }
  return out;
}

export const isClean = (text) => cleanWords(text) === String(text || '');
