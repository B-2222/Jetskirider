// Online riding outside claude.ai (e.g. on Vercel): the same room interface
// the game uses with the claude.ai `room` capability (presence, peers,
// onPeers, join, leave), backed by a Firebase Realtime Database.
//
// Each rider writes one small node per room they are in and listens to the
// room's children, so every update costs one rider's worth of data, not the
// whole room. Firebase deletes a rider's nodes the moment their connection
// drops, and a rider who goes quiet for a few seconds is dropped locally too.
//
// Data: jetski/<room>/<peerId> = { s: presence as JSON text, t: server time }
// (database.rules.json in the repo allows exactly this and nothing else).

const ROOT = 'jetski';
const ROOMS = new Set(['lobby', 'lobby-1', 'lobby-2']);
const MAX_S = 1100; // presence JSON, characters (the rules allow 1200)
const STALE_MS = 8000; // a joined rider who has said nothing for this long is gone

function newPeerId() {
  const a = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

function parse(snap) {
  const v = snap.val();
  if (!v || typeof v.s !== 'string' || v.s.length > 4000) return null;
  try {
    const o = JSON.parse(v.s);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

// config: the Firebase web app config. opts.emulator = { host, port } for
// local testing against the Firebase emulator.
export async function makeFireRoom(config, opts = {}) {
  const fb = await import('../vendor/firebase-db.js');
  const app = fb.initializeApp(config, 'jetski-' + newPeerId().slice(0, 6));
  const db = fb.getDatabase(app);
  if (opts.emulator) fb.connectDatabaseEmulator(db, opts.emulator.host, opts.emulator.port);
  const me = newPeerId();
  const rooms = new Set();
  let conn = false;
  const connFns = new Set();

  function room(name, stale) {
    const base = fb.ref(db, ROOT + '/' + name);
    const mineRef = fb.child(base, me);
    const peers = new Map();
    const listeners = new Set();
    const errFns = new Set();
    let mine = {};
    let wrote = false;
    let closed = false;
    const self = () =>
      Object.freeze({ peer: me, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze({ ...mine }), updatedAt: Date.now() });
    peers.set(me, self());
    let snapshot = Object.freeze([...peers.values()]);
    const emit = (joined, left, updated) => {
      snapshot = Object.freeze([...peers.values()]);
      for (const fn of listeners) {
        try {
          fn({ peers: snapshot, joined, left, updated });
        } catch (e) {
          console.error(e);
        }
      }
    };
    const failed = (err) => {
      console.warn('jetski online:', err && err.message ? err.message : err);
      for (const fn of errFns) fn(err);
    };
    const upsert = (snap) => {
      if (closed || snap.key === me) return;
      const pr = parse(snap);
      if (!pr) return;
      const existed = peers.has(snap.key);
      const p = Object.freeze({ peer: snap.key, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: Object.freeze(pr), updatedAt: Date.now() });
      peers.set(snap.key, p);
      emit(existed ? [] : [p], [], existed ? [p] : []);
    };
    const drop = (id) => {
      const p = peers.get(id);
      if (!p || id === me) return;
      peers.delete(id);
      emit([], [p], []);
    };
    const offs = [
      fb.onChildAdded(base, upsert, failed),
      fb.onChildChanged(base, upsert, failed),
      fb.onChildRemoved(base, (snap) => drop(snap.key), failed),
    ];
    const sweep = stale
      ? setInterval(() => {
          const now = Date.now();
          for (const [id, p] of peers) if (id !== me && now - p.updatedAt > STALE_MS) drop(id);
        }, 1000)
      : 0;
    // write my node; Firebase removes it by itself when my connection drops
    const write = () => {
      if (closed) return Promise.resolve();
      const s = JSON.stringify(mine);
      if (s.length > MAX_S) return Promise.reject(new Error('presence too large'));
      if (!wrote) {
        wrote = true;
        fb.onDisconnect(mineRef).remove().catch(() => {});
      }
      return fb.set(mineRef, { s, t: fb.serverTimestamp() });
    };
    const r = {
      name,
      presence(patch) {
        for (const [k, v] of Object.entries(patch || {})) {
          if (v === null || v === undefined) delete mine[k];
          else mine[k] = v;
        }
        peers.set(me, self());
        emit([], [], [peers.get(me)]);
        return write();
      },
      peers: () => snapshot,
      onPeers(fn, onError) {
        listeners.add(fn);
        if (onError) errFns.add(onError);
        queueMicrotask(() => {
          if (listeners.has(fn)) fn({ peers: snapshot, joined: snapshot, left: [], updated: [] });
        });
        return () => {
          listeners.delete(fn);
          if (onError) errFns.delete(onError);
        };
      },
      connected: () => conn,
      onConnection(fn) {
        connFns.add(fn);
        queueMicrotask(() => fn(conn));
        return () => connFns.delete(fn);
      },
      leave() {
        if (closed) return Promise.resolve();
        closed = true;
        rooms.delete(r);
        for (const off of offs) off();
        if (sweep) clearInterval(sweep);
        listeners.clear();
        errFns.clear();
        return Promise.all([fb.onDisconnect(mineRef).cancel(), fb.remove(mineRef)]).then(() => {});
      },
      // after a dropped connection Firebase has already removed my node:
      // put it back (and re-arm the clean-up) once I am connected again
      _reconnected() {
        if (closed || !wrote) return;
        wrote = false;
        write().catch(() => {});
      },
    };
    rooms.add(r);
    return r;
  }

  fb.onValue(fb.ref(db, '.info/connected'), (snap) => {
    const was = conn;
    conn = !!snap.val();
    if (conn && !was) for (const r of rooms) r._reconnected();
    for (const fn of connFns) fn(conn);
  });

  const lobby = room('lobby', false);
  const joined = new Map();
  return {
    ...lobby,
    transport: 'firebase',
    sendHz: 12, // a little under the claude.ai rate: keeps well inside Firebase's free tier
    join(name) {
      if (!ROOMS.has(name) || name === 'lobby') return Promise.reject(new Error('unknown room'));
      let r = joined.get(name);
      if (!r) {
        r = room(name, true);
        const leave = r.leave;
        r.leave = () => {
          joined.delete(name);
          return leave();
        };
        joined.set(name, r);
      }
      return Promise.resolve(r);
    },
  };
}
