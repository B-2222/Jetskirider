// Accounts: sign up with an email and a password and your progress (cash,
// skis, kits, missions, race times) is kept in your account, so it follows
// you to any device. Firebase Authentication checks who you are; the
// database rules only let you read and write your own save.
//
// Without an account the game works exactly the same and saves on this
// device. Signing up moves that progress into the new account; logging in
// to an existing account loads its progress instead.
//
// Only on the Firebase build (not inside claude.ai).

import { firebase } from './fbapp.js';
import { FIREBASE_CONFIG } from './firebase-config.js';
import { GUEST_KEY } from './career.js';

const remember = (uid) => {
  try {
    if (uid) localStorage.setItem('jetski-rider-uid', uid);
    else localStorage.removeItem('jetski-rider-uid');
  } catch {
    /* ignore */
  }
};
// give up on a network call that hangs (the database waits for a connection)
const within = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

const SAVE_DELAY = 2500; // ms after the last change before uploading
const ERRORS = {
  'auth/email-already-in-use': 'That email already has an account. Log in instead.',
  'auth/invalid-email': 'That does not look like an email address.',
  'auth/weak-password': 'Pick a longer password (at least 6 characters).',
  'auth/missing-password': 'Type a password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/invalid-login-credentials': 'Wrong email or password.',
  'auth/user-not-found': 'No account with that email. Sign up first.',
  'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
  'auth/network-request-failed': 'Could not reach the server. Check your connection.',
  'auth/operation-not-allowed': 'Email sign-up is not switched on for this game yet.',
  'auth/unauthorized-domain': 'This website is not allowed to sign in yet (Firebase authorised domains).',
};
export const authError = (e) => ERRORS[e && e.code] || 'Something went wrong (' + ((e && e.code) || 'unknown') + ').';

export class Accounts {
  constructor(career) {
    this.career = career;
    // off: no accounts here; loading: checking; guest: not signed in; in: signed in
    this.state = 'loading';
    this.user = null;
    this.saving = false;
    this.savedAt = 0;
    this.onChange = null;
    this.timer = 0;
    this.nick = '';
  }

  changed() {
    if (this.onChange) this.onChange();
  }

  async init() {
    const emu = new URLSearchParams(location.search).get('fbemu');
    if ((!FIREBASE_CONFIG && !emu) || (window.claude && !emu)) {
      this.state = 'off';
      return this.changed();
    }
    const F = await firebase();
    if (!F) {
      this.state = 'off';
      return this.changed();
    }
    this.F = F;
    const fb = F.fb;
    this.auth = fb.getAuth(F.app);
    if (F.emu) fb.connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    fb.onAuthStateChanged(this.auth, (u) => this.onUser(u));
    // save before the page goes away
    addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
  }

  ref(uid) {
    return this.F.fb.ref(this.F.db, 'accounts/' + uid);
  }

  async onUser(u) {
    const C = this.career;
    if (!u) {
      // signed out (or never signed in): the guest save on this device
      this.user = null;
      this.email = '';
      this.nick = '';
      C.sink = null;
      remember(null);
      if (C.key !== GUEST_KEY) C.use(C.loadKey(GUEST_KEY));
      this.state = 'guest';
      return this.changed();
    }
    this.user = u;
    this.email = u.email || '';
    this.state = 'loading';
    this.changed();
    const key = GUEST_KEY + '-' + u.uid;
    // what the account holds (null = a brand-new account); a few tries, as
    // the connection may still be coming up
    let v, ok = false;
    for (let i = 0; i < 3 && !ok; i++) {
      try {
        v = (await within(this.F.fb.get(this.ref(u.uid)), 8000)).val();
        ok = true;
      } catch (e) {
        if (i === 2) console.warn('jetski account: could not load', e);
        else await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (this.user !== u) return; // signed out meanwhile
    if (!ok) {
      // offline: play on the copy kept on this device, but do not write it
      // over the account (it may be out of date)
      C.use(C.loadKey(key) || C.data, key);
      this.state = 'offline';
      return this.changed();
    }
    let saved = null;
    try {
      if (v && typeof v.c === 'string') saved = JSON.parse(v.c);
    } catch {
      saved = null;
    }
    if (v && typeof v.n === 'string') this.nick = v.n;
    remember(u.uid);
    if (saved) {
      C.use(saved, key);
    } else {
      // a brand-new account: what you have done so far moves into it, and
      // the guest save on this device starts again
      const mine = C.key === GUEST_KEY ? C.data : C.loadKey(GUEST_KEY);
      try {
        localStorage.setItem(GUEST_KEY, JSON.stringify(C.fresh()));
      } catch {
        /* ignore */
      }
      C.use(mine, key);
    }
    C.sink = () => this.queue();
    this.state = 'in';
    this.changed();
    if (!saved) this.flush();
  }

  // upload a moment after the last change (lots of tricks = one write)
  queue() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY);
  }

  async flush() {
    clearTimeout(this.timer);
    if (this.state !== 'in' || !this.user) return;
    const fb = this.F.fb;
    this.saving = true;
    this.changed();
    try {
      const rec = { c: JSON.stringify(this.career.data), t: fb.serverTimestamp() };
      if (this.nick) rec.n = this.nick.slice(0, 16);
      await fb.set(this.ref(this.user.uid), rec);
      this.savedAt = Date.now();
    } catch (e) {
      console.warn('jetski account: could not save', e);
      this.saveError = true;
    }
    this.saving = false;
    this.changed();
  }

  setNick(n) {
    this.nick = String(n || '').slice(0, 16);
    if (this.state === 'in') this.queue();
  }

  async signUp(email, pass) {
    await this.F.fb.createUserWithEmailAndPassword(this.auth, String(email).trim(), pass);
  }

  async logIn(email, pass) {
    await this.F.fb.signInWithEmailAndPassword(this.auth, String(email).trim(), pass);
  }

  async logOut() {
    await this.flush();
    await this.F.fb.signOut(this.auth);
  }

  // The all-time rider count: each device adds itself once, the first time
  // it rides. Shown only in the admin panel.
  async countRider() {
    if (!this.F || this.counted) return;
    this.counted = true;
    try {
      if (localStorage.getItem('jetski-rider-counted')) return;
    } catch {
      return; // no storage: we could not avoid counting them again
    }
    try {
      await this.F.fb.set(this.F.fb.ref(this.F.db, 'stats/players'), this.F.fb.increment(1));
      localStorage.setItem('jetski-rider-counted', '1');
    } catch (e) {
      console.warn('jetski: rider count', e);
    }
  }

  async watchRiders(fn) {
    const F = this.F || (window.claude && !new URLSearchParams(location.search).get('fbemu') ? null : await firebase());
    if (!F) return fn(-1);
    if (this.watching) return;
    this.watching = true;
    F.fb.onValue(F.fb.ref(F.db, 'stats/players'), (s) => fn(Number(s.val()) || 0), () => fn(-1));
  }

  async resetPassword(email) {
    await this.F.fb.sendPasswordResetEmail(this.auth, String(email).trim());
  }
}
