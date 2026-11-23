// A stand-in for the claude.ai `room` capability, for local testing only
// (open the game with ?mpfake=1 in two tabs of the same browser). It speaks
// the same calls the game uses: presence, peers, onPeers, join, leave.

function room(channelName, me) {
  const ch = new BroadcastChannel(channelName);
  const peers = new Map();
  const listeners = new Set();
  let mine = {};
  const self = () => ({ peer: me, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze({ ...mine }), updatedAt: Date.now() });
  peers.set(me, self());
  let snapshot = Object.freeze([...peers.values()]);
  const emitChange = (joined, left, updated) => {
    snapshot = Object.freeze([...peers.values()]);
    for (const fn of listeners) fn({ peers: snapshot, joined, left, updated });
  };
  const upsert = (peer, presence) => {
    const existed = peers.has(peer);
    const p = Object.freeze({ peer, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: Object.freeze(presence || {}), updatedAt: Date.now() });
    peers.set(peer, p);
    emitChange(existed ? [] : [p], [], existed ? [p] : []);
  };
  ch.onmessage = (e) => {
    const m = e.data || {};
    if (m.peer === me) return;
    if (m.type === 'hello') {
      upsert(m.peer, m.presence);
      post({ type: 'state', peer: me, presence: mine });
    } else if (m.type === 'state' || m.type === 'presence') upsert(m.peer, m.presence);
    else if (m.type === 'bye' && peers.has(m.peer)) {
      const p = peers.get(m.peer);
      peers.delete(m.peer);
      emitChange([], [p], []);
    }
  };
  ch.postMessage({ type: 'hello', peer: me, presence: mine });
  let open = true;
  const post = (m) => {
    if (open) ch.postMessage(m);
  };
  addEventListener('pagehide', () => post({ type: 'bye', peer: me }));
  return {
    name: channelName,
    presence(patch) {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete mine[k];
        else mine[k] = v;
      }
      peers.set(me, self());
      post({ type: 'presence', peer: me, presence: mine });
      emitChange([], [], [peers.get(me)]);
      return Promise.resolve();
    },
    peers: () => snapshot,
    onPeers(fn) {
      listeners.add(fn);
      queueMicrotask(() => fn({ peers: snapshot, joined: snapshot, left: [], updated: [] }));
      return () => listeners.delete(fn);
    },
    connected: () => true,
    onConnection(fn) {
      queueMicrotask(() => fn(true));
      return () => {};
    },
    leave() {
      post({ type: 'bye', peer: me });
      open = false;
      ch.close();
      listeners.clear();
      return Promise.resolve();
    },
  };
}

export function makeFakeRoom() {
  const me = Math.random().toString(36).slice(2, 12);
  const lobby = room('jr-fake-lobby', me);
  const joined = new Map();
  return {
    ...lobby,
    join(name) {
      if (!joined.has(name)) {
        const r = room('jr-fake-' + name, me);
        const leave = r.leave;
        r.leave = () => {
          joined.delete(name);
          return leave();
        };
        joined.set(name, r);
      }
      return Promise.resolve(joined.get(name));
    },
  };
}
