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
| `Space` | Pull back: wheelies and tail stands |
| `Shift` | Slide: hold while turning to break the hull loose. Without it the ski carves |
| `C` | Camera |
| `F` | First person camera |
| `B` | Look behind you (toggle) |
| `S` + `W` stopped | Launch control (RXP-X skis): hold both, let go of `S` to launch |
| `N` | Rolling anti-lag on/off (600 turbo) |
| `R` | Reset to open water |
| `G` | Go to the wave zone (and back) |
| `T` / `V` | Change light / water |
| `M` / `Esc` | Sound / garage |

There are no in-air trick controls: to spin, throw the ski into a hard turn right at the lip and the rotation carries through the air. In the air `Space` / `Shift` only shift the rider's weight to nudge the nose.

Touch controls and gamepads work too.

## Wave zone

Breaking surf rolls through a marked patch of open water east of the lagoon: waves arrive in sets with calm gaps between, peak, then peel and barrel (follow the WAVE ZONE marker, press `G`, or pick it under START in the garage). Hit the faces flat out to launch, throw flat spins off the lip, ride the barrel under the curl, and land straight for the clean-landing bonus.

## The garage

Spark Trixx, Spark 2up, GTI SE 170, GTR 230, RXP-X 325, RXT-X 325 and a 600 hp tuned RXP-X, each with its own weight, thrust, grip, trim range and colourways.

## How it works

- `src/physics.js`: 6-DOF rigid body. The hull is sampled at 11 points for buoyancy, planing lift, drag and a tyre-like lateral grip that saturates and lets go (powerslides). Thrust acts at the steering nozzle along its steer and trim angles, and only while the intake grate is in the water.
- `src/waves.js`: Gerstner waves shared by the GPU ocean and the CPU physics, so the hull rides the waves you see.
- `src/water.js`: ocean shader plus a scrolling foam map. Hull wash and every spray droplet that lands stamp white water into it, which then ages into lace.
- `src/particles.js`, `src/effects.js`: jet stream, rooster tail, bow and slide spray, landing splashes.
- `src/jetski.js`, `src/rider.js`: lofted Sea-Doo hulls and an IK-posed rider.
- `src/audio.js`: engine loops synthesised at start-up from three-cylinder firing pulses through fixed exhaust resonances, crossfaded by rpm and load. Wet-exhaust gurgle, intake roar, jet pump, supercharger whine, turbo spool and flutter, and a rev limiter when the pump runs dry.

`tools/` holds headless test helpers: `node tools/physics-test.mjs trixx`, `node tools/wave-test.mjs trixx`, `node tools/spin-test.mjs trixx airsteer`, and `node tools/audio-render.mjs <dir> rxp600` (renders a scripted ride to WAV).
