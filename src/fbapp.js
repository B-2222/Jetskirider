// One Firebase app for the whole game: the online lobbies and your account
// share it, so each player is a single connection to the database (the free
// plan counts connections). Loaded only when it is needed.
//
// ?fbemu=9000 points everything at the local Firebase emulators (testing:
// database on that port, accounts on 9099).

import { FIREBASE_CONFIG } from './firebase-config.js';

let pending = null;

export function firebase() {
  if (pending) return pending;
  pending = (async () => {
    const q = new URLSearchParams(location.search);
    const emu = q.get('fbemu');
    const port = parseInt(emu, 10) || 9000;
    const config = emu ? { projectId: 'demo-jetski', apiKey: 'demo-key', authDomain: '127.0.0.1', databaseURL: 'http://127.0.0.1:' + port + '?ns=demo-jetski-default-rtdb' } : FIREBASE_CONFIG;
    if (!config) return null;
    const fb = await import('../vendor/firebase-db.js');
    const app = fb.initializeApp(config, 'jetski');
    const db = fb.getDatabase(app);
    if (emu) fb.connectDatabaseEmulator(db, '127.0.0.1', port);
    return { fb, app, db, emu: !!emu };
  })().catch((e) => {
    console.warn('jetski: Firebase did not load', e);
    return null;
  });
  return pending;
}
