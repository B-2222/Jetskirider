# Jetski Rider

Open-water Sea-Doo freestyle in the browser. No build step, no assets: every model, texture and sound is generated in code.

## Play

Serve the folder with any static server and open it:

```bash
python3 -m http.server 8000
```

Then go to `http://localhost:8000`.

## Controls

| Key | Action |
| --- | --- |
| `W` / `Up` | Throttle |
| `S` / `Down` | iBR brake, then reverse |
| `A` `D` / `Left` `Right` | Steer (almost no steering off the throttle, like a real ski) |
| `E` / `Q` | VTS trim up / down. Trim up for big rooster tails |
| `Space` | Pull back: wheelies and tail stands (backflip on stand-ups) |
| `Shift` | Slide: hold while turning to break the hull loose. Without it the ski carves |
| `X` | Trick button: Superman in the air on sit-downs, barrel roll (with steering) on stand-ups |
| `C` | Camera |
| `F` | First person camera |
| `B` | Look behind you (toggle) |
| `S` + `W` stopped | Launch control (RXP-X skis): hold both, let go of `S` to launch |
| `N` | Rolling anti-lag on/off (600 turbo) |
| `R` | Reset to open water |
| `G` | Go to the wave zone (and back) |
| `T` / `V` | Change light / water |
| `M` / `Esc` | Sound / garage |

On the sit-down skis there is one trick in the air, the Superman: off a wave jump press `X` right after take-off and the rider hangs on to the bars with their legs kicked out behind the ski. Let go before you land or you bail. To spin, throw the ski into a hard turn right at the lip and the rotation carries through the air (a Superman on top makes it a SUPERMAN + 360). Otherwise `Space` / `Shift` only shift the rider's weight to nudge the nose.

Touch controls work too.

### Xbox controller

| Button | Action |
| --- | --- |
| `RT` / `LT` | Throttle / brake and reverse |
| Left stick | Steer (pull down to pull back) |
| `A` (hold) | Slide |
| `B` (hold) | Pull back (backflip on stand-ups) |
| `RB` / `LB` | Trim up / down |
| `X` | Hold to look behind (in the air: Superman on sit-downs, trick button on stand-ups) |
| `Y` | Camera |
| Right stick | Look around |
| D-pad | Up: wave zone, Down: reset, Right: first person, Left: look-behind toggle |
| `View` / `Menu` | Anti-lag / garage |

In the garage the D-pad or left stick moves between buttons, `A` picks, `B` goes back, and `LB` / `RB` change ski. The controller rumbles on landings, slaps and wipeouts.

## Stand-up skis

The Freestyle and Race stand-ups ride differently: no trim, a light hull that you lean right over into turns (`Shift` still slides it), no reverse, and a two-stroke engine. They flip.

- Off a jump: `Space` backflip, `X` + steer barrel roll, steer to spin. Let go once the rotation is under way and the rider lands it.
- Flips need a decent wave jump; on a smaller one the rider tucks tighter to get round in time. If the jump really is too small (or you press too late) the game tells you. Hold `Space` up the face and through the lip for the biggest flips. The Freestyle rotates faster and can double off the biggest sets.
- Flat-water backflip: at low speed hold `Shift` without steering to sink the nose, then hit `Space`. The nose pops out of the water; keep holding `Space` to flip.

## Online

Two lobbies, up to 8 riders each, from the ONLINE section of the garage. Riders, skis, names, spray and tricks show for everyone, with a live leaderboard and trick feed. The wave sets are synced, so you all ride the same surf.

- Inside claude.ai it uses the page's built-in room (everyone needs the shared link and must be signed in).
- On any other host (Vercel, Netlify, GitHub Pages...) it uses a free Firebase Realtime Database. Set it up once as below; without it the game stays solo there.

### Put it online (Vercel + Firebase)

1. **Firebase** (free Spark plan, no card needed): at [console.firebase.google.com](https://console.firebase.google.com) add a project (Analytics off). Open **Build > Realtime Database > Create database**, pick the nearest location (Singapore for Australia), start in **locked mode**.
2. In the database's **Rules** tab, replace everything with the contents of [`database.rules.json`](database.rules.json) and press **Publish**. Riders can then only write their own small node in the three rooms the game uses, and nothing else.
3. **Project settings** (gear icon) > **Your apps** > the web icon `</>` > register an app (no hosting). Copy the `firebaseConfig` object into [`src/firebase-config.js`](src/firebase-config.js) as `FIREBASE_CONFIG`. Make sure it has a `databaseURL` (if not, copy the URL shown at the top of the Realtime Database page). These values are not secret.
4. **Vercel**: at [vercel.com](https://vercel.com) sign in with GitHub, **Add New > Project**, import this repository. Framework preset **Other**, no build command, output directory left as it is. **Deploy**. Every push to the branch redeploys.
5. Send friends the Vercel link; everyone picks the same lobby in the garage.

The free plan allows 100 riders online at once and 10 GB of downloads a month: roughly 40 hours a month of four friends riding together. If the monthly allowance ever runs out, online riding pauses until the next month; the free plan never charges.

To test locally without Firebase, open the game with `?mpfake=1` in two tabs of one browser. To test the Firebase path, run the emulator (`firebase emulators:start --only database --project demo-jetski` with `database.rules.json`) and open `?fbemu=9000`.

## Wave zone

Breaking surf rolls through a marked patch of open water east of the lagoon: waves arrive in sets with calm gaps between, peak, then peel and barrel (follow the WAVE ZONE marker, press `G`, or pick it under START in the garage). Hit the faces flat out to launch, throw flat spins off the lip, ride the barrel under the curl, and land straight for the clean-landing bonus.

## The garage

Spark Trixx, Spark 2up, GTI SE 170, GTR 230, RXP-X 325, RXT-X 325, a 600 hp tuned RXP-X and two stand-ups (Freestyle and Race), each with its own weight, thrust, grip, trim range and colourways.

## How it works

- `src/physics.js`: 6-DOF rigid body. The hull is sampled at 11 points for buoyancy, planing lift, drag and a tyre-like lateral grip that saturates and lets go (powerslides). Thrust acts at the steering nozzle along its steer and trim angles, and only while the intake grate is in the water.
- `src/waves.js`: Gerstner waves shared by the GPU ocean and the CPU physics, so the hull rides the waves you see.
- `src/water.js`: ocean shader plus a scrolling foam map. Hull wash and every spray droplet that lands stamp white water into it, which then ages into lace.
- `src/particles.js`, `src/effects.js`: jet stream, rooster tail, bow and slide spray, landing splashes.
- `src/jetski.js`, `src/rider.js`: lofted Sea-Doo hulls and an IK-posed rider.
- `src/audio.js`: engine loops synthesised at start-up from three-cylinder (or two-stroke twin) firing pulses through fixed exhaust resonances, crossfaded by rpm and load. Wet-exhaust gurgle, intake roar, jet pump, supercharger whine, turbo spool and flutter, and a rev limiter when the pump runs dry.

- `src/multiplayer.js`: online lobbies over the claude.ai room capability, or `src/fireroom.js` (the same interface on a Firebase Realtime Database, SDK bundled in `vendor/firebase-db.js`) on other hosts; `src/fakeroom.js` stands in locally (`?mpfake=1` in two tabs).

`tools/` holds headless test helpers: `node tools/physics-test.mjs trixx`, `node tools/wave-test.mjs trixx`, `node tools/spin-test.mjs trixx airsteer`, `node tools/standup-test.mjs sfree` (stand-up flips, rolls, spins and the flat-water pop), `node tools/superman-test.mjs trixx` (sit-down Supermans), `node tools/launch-test.mjs rxp`, `node tools/mp-test.mjs <dir> [fake|fbemu]` (two players, over the stand-in room or the Firebase emulator), `node tools/pad-test.mjs <dir>` (simulated Xbox controller) and `node tools/audio-render.mjs <dir> rxp600` (renders a scripted ride to WAV).
