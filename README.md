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
| `Shift` | Throw your weight in: tips the hull faster for slides, plants the bow |
| `C` | Camera |
| `R` | Reset to open water |
| `T` / `V` | Change light / water |
| `M` / `Esc` | Sound / garage |

Touch controls and gamepads work too.

## The garage

Spark Trixx, Spark 2up, GTI SE 170, GTR 230, RXP-X 325 and RXT-X 325, each with its own weight, thrust, grip, trim range and colourways.

## How it works

- `src/physics.js`: 6-DOF rigid body. The hull is sampled at 11 points for buoyancy, planing lift, drag and a tyre-like lateral grip that saturates and lets go (powerslides). Thrust acts at the steering nozzle along its steer and trim angles, and only while the intake grate is in the water.
- `src/waves.js`: Gerstner waves shared by the GPU ocean and the CPU physics, so the hull rides the waves you see.
- `src/water.js`: ocean shader plus a scrolling foam map. Hull wash and every spray droplet that lands stamp white water into it, which then ages into lace.
- `src/particles.js`, `src/effects.js`: jet stream, rooster tail, bow and slide spray, landing splashes.
- `src/jetski.js`, `src/rider.js`: lofted Sea-Doo hulls and an IK-posed rider.

`tools/` holds headless test helpers (`node tools/physics-test.mjs trixx`).
