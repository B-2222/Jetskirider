// Weekly leaderboards (Firebase): the biggest single trick of the week and
// the fastest lap of each map's buoy race. They run Monday to Sunday, Perth
// time. You need an account to be on them (the rules only let you write your
// own entry); everyone can read them. The top three wear a crown online.
//
// Data: boards/w<week>/<board>/<uid> = { n: name, v: score or time, t }
// boards: 'tricks' (higher is better), 'race-<map>' (lower is better)

import { firebase } from './fbapp.js';
import { dayNow, weekOf } from './daily.js';
import { cleanWords } from './filter.js';

export const thisWeek = () => weekOf(dayNow());
const low = (board) => board.startsWith('race-');

export class Boards {
  constructor(accounts) {
    this.accounts = accounts;
    this.cache = new Map(); // board -> { at, rows }
  }

  ok() {
    return this.accounts.state === 'in' && this.accounts.F;
  }

  ref(F, board, uid) {
    return F.fb.ref(F.db, 'boards/w' + thisWeek() + '/' + board + (uid ? '/' + uid : ''));
  }

  // post my best if it beats what I have this week
  async submit(board, value, name) {
    if (!this.ok()) return false;
    const F = this.accounts.F;
    try {
      await F.fb.set(this.ref(F, board, this.accounts.user.uid), { n: String(name || 'Rider').slice(0, 16), v: Math.round(value * 100) / 100, t: F.fb.serverTimestamp() });
      this.cache.delete(board);
      return true;
    } catch (e) {
      console.warn('jetski: leaderboard', e);
      return false;
    }
  }

  // the top ten: [{ uid, name, v, me }]
  async top(board, maxAge = 30000) {
    const c = this.cache.get(board);
    if (c && Date.now() - c.at < maxAge) return c.rows;
    const F = this.accounts.F || (this.accounts.state === 'off' ? null : await firebase());
    if (!F) return [];
    const { fb } = F;
    try {
      const q = fb.query(this.ref(F, board), fb.orderByChild('v'), low(board) ? fb.limitToFirst(10) : fb.limitToLast(10));
      const snap = await Promise.race([fb.get(q), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 8000))]);
      const rows = [];
      snap.forEach((ch) => {
        const v = ch.val();
        if (v && Number.isFinite(v.v) && typeof v.n === 'string') rows.push({ uid: ch.key, name: cleanWords(v.n.replace(/[<>&"'`]/g, '').slice(0, 16)), v: v.v });
      });
      rows.sort((a, b) => (low(board) ? a.v - b.v : b.v - a.v));
      const me = this.accounts.user && this.accounts.user.uid;
      for (const r of rows) r.me = r.uid === me;
      this.cache.set(board, { at: Date.now(), rows });
      return rows;
    } catch (e) {
      console.warn('jetski: leaderboard read', e);
      return c ? c.rows : [];
    }
  }

  // my best rank (1..3) on these boards, for a crown; 0 if none
  async crown(boards) {
    if (!this.ok()) return 0;
    let best = 0;
    for (const b of boards) {
      const rows = await this.top(b, 60000);
      const i = rows.findIndex((r) => r.me);
      if (i >= 0 && i < 3 && (!best || i + 1 < best)) best = i + 1;
    }
    return best;
  }
}
