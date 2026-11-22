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
| `X` | Trick button on stand-ups: Superman, or barrel roll with steering |
| `C` | Camera |
| `F` | First person camera |
| `B` | Look behind you (toggle) |
| `S` + `W` stopped | Launch control (RXP-X skis): hold both, let go of `S` to launch |
| `N` | Rolling anti-lag on/off (600 turbo) |
| `R` | Reset to open water |
| `G` | Go to the wave zone (and back) |
| `T` / `V` | Change light / water |
| `M` / `Esc` | Sound / garage |

On the sit-down skis there are no in-air trick controls: to spin, throw the ski into a hard turn right at the lip and the rotation carries through the air. In the air `Space` / `Shift` only shift the rider's weight to nudge the nose.

Touch controls work too.

### Xbox controller

| Button | Action |
| --- | --- |
| `RT` / `LT` | Throttle / brake and reverse |
| Left stick | Steer (pull down to pull back) |
| `A` (hold) | Slide |
| `B` (hold) | Pull back (backflip on stand-ups) |
| `RB` / `LB` | Trim up / down |
| `X` | Hold to look behind (trick button on stand-ups) |
| `Y` | Camera |
| Right stick | Look around |
| D-pad | Up: wave zone, Down: reset, Right: first person, Left: look-behind toggle |
| `View` / `Menu` | Anti-lag / garage |

In the garage the D-pad or left stick moves between buttons, `A` picks, `B` goes back, and `LB` / `RB` change ski. The controller rumbles on landings, slaps and wipeouts.

## Stand-up skis

The Freestyle and Race stand-ups ride differently: no trim, a light hull that you lean right over into turns (`Shift` still slides it), no reverse, and a two-stroke engine. They flip.

- Off a jump: `Space` backflip, `X` Superman, `X` + steer barrel roll, steer to spin. Let go once the rotation is under way and the rider lands it. Land still stretched out in a Superman and you bail.
- A Superman fits a medium jump; flips and rolls need a big one. Hold `Space` up the face and through the lip for the biggest flips. The Freestyle rotates faster and can double off the biggest sets.
- Flat-water backflip: at low speed hold `Shift` without steering to sink the nose, then hit `Space`. The nose pops out of the water; keep holding `Space` to flip.

## Online

Two lobbies, up to 8 riders each, from the ONLINE section of the garage. Everyone needs the shared link to this page and must be signed in. Riders, skis, names, spray and tricks show for everyone, with a live leaderboard and trick feed. The wave sets are synced, so you all ride the same surf.

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

- `src/multiplayer.js`: online lobbies over the claude.ai room capability; `src/fakeroom.js` stands in for it locally (open the game with `?mpfake=1` in two tabs).

`tools/` holds headless test helpers: `node tools/physics-test.mjs trixx`, `node tools/wave-test.mjs trixx`, `node tools/spin-test.mjs trixx airsteer`, `node tools/standup-test.mjs sfree` (stand-up flips, Supermans, rolls and the flat-water pop), `node tools/launch-test.mjs rxp`, `node tools/mp-test.mjs <dir>` (two players), `node tools/pad-test.mjs <dir>` (simulated Xbox controller) and `node tools/audio-render.mjs <dir> rxp600` (renders a scripted ride to WAV).
