# ARVENA · Realtime Scenario Generator

Put a presenter "on location" — flood, stadium, festival, mountain — **in real
time**. The presenter shows full-screen as a **SIMULATION VIEW** with the
operator UI overlaid on top; an operator switches scenarios on the fly and the
output auto-records to MP4.

Runs **entirely in the browser, free, with no server** — matting cuts the
presenter out on-device and composites them over a scenario background (a looping
video, or a procedural fallback). No API key, no per-second cost, no time cap.

> The Live AI (Decart) path — streaming the webcam to Decart's Lucy models for a
> neural restyle — is retained in the codebase (`src/decart.js`,
> `api/session.mjs`) but is **no longer wired to the UI**. See
> [Re-enabling Decart](#re-enabling-decart-optional).

Built inside the **EDT (Experiential Design Team)** brand system, as the
**ARVENA** production/broadcast sub-brand. Vanilla static site + one serverless
function — same stack as the sibling EDT projects, no build step.

> ⚠️ **Synthetic media.** The output is composited/AI-assisted and labelled
> `SIMULATED — AI GENERATED`. Do not present output as real news. See
> [Responsible use](#responsible-use).

---

## How it works (offline engine)

```
webcam ──► RVM matting (TensorFlow.js/WebGL) ──► alpha matte
              │                                       │
              └── full-res webcam ──[ composite ]──◄──┘ over scenario background
                                        │                (looping video or procedural)
                                        └──► 16:9 output canvas → recorder
```

- Runs on-device; the RVM model (`assets/models/rvm-tfjs/`) is served same-origin
  and **prewarms at boot** so the first START is instant.
- The matte supplies only the **alpha**; the presenter's RGB is the full-res
  webcam, and a frame snapshot is taken the same instant as the matte so the
  cutout doesn't trail on fast motion.
- Output is a fixed **16:9** frame: the background is full-bleed, the presenter is
  fit-centered at the camera's aspect (no black bars, no stretch).
- Falls back to MediaPipe `ImageSegmenter` if WebGL/TF.js can't load.

## Flow

START shows a "LOADING SEGMENTATION MODEL" overlay until the model is ready, then
composites live and auto-starts recording on the first frame (mic audio +
burned-in `SIMULATED — AI GENERATED` label). STOP transcodes WebM→MP4 in-browser
(ffmpeg.wasm) and downloads it. A fullscreen button toggles native fullscreen.

---

## Run locally

The offline engine needs no key and no serverless function — any static server
over `localhost` works (camera requires a secure context; `localhost` counts):

```bash
cp config.sample.js config.js   # client config (holds NO secrets)
npx serve -l 5000               # or: python -m http.server 5000
```

Open `http://localhost:5000`, allow camera access, pick a scenario, press
**START →**.

## Deploy

Push to a repo and import into Vercel (framework preset: **Other** — it's static).
No env vars are required for the offline engine. (The `DECART_API_KEY` /
`ALLOWED_ORIGINS` vars only matter if you re-enable the Decart path below.)

---

## Scenarios & backgrounds

Four scenarios live in [`src/scenarios.js`](src/scenarios.js) as plain data:
**Flood, Stadium Pitch, Festival, Mountain** (default `flood`). Each is wired to a
looping backplate at `assets/backgrounds/<id>-loop.mp4` via `bgVideo`, and **falls
back to a procedural painter** in [`src/backgrounds.js`](src/backgrounds.js) until
the clip is present. Add clips per the convention in
[`assets/backgrounds/README.md`](assets/backgrounds/README.md) (1080p H.264, no
audio, seamless loop, compressed).

## Configuration

`config.js` (client, non-secret):

| Key | Meaning |
| --- | --- |
| `DEFAULT_SCENARIO` | Scenario loaded on start (`flood`) |
| `DEFAULT_ENGINE` | `"local"` (offline, the only engine in the UI) |
| `AUTO_RECORD` | Auto-start recording on the first output frame |
| `SHOW_SIMULATED_BADGE` | Disclosure badge on output (keep `true`) |
| `LOCAL.*` | Offline engine: output `WIDTH`/`HEIGHT`/`FPS` (16:9), `MAX_SESSION_SECONDS` (0 = unlimited), `SEG_ENGINE` (`rvm`/`mediapipe`), `RVM_WORKING_WIDTH`, `RVM_DOWNSAMPLE`, `EDGE_FEATHER_PX` |
| `MODELS.*`, `MAX_SESSION_SECONDS`, `PRICE_PER_SECOND_USD` | Used only by the dormant Decart path |

## Re-enabling Decart (optional)

The Live AI path is intact but unwired. To bring it back: restore an engine toggle
(or set `DEFAULT_ENGINE = "decart"`) and route `goLive()` to `goLiveDecart()` in
[`src/main.js`](src/main.js). It needs the serverless function (`vercel dev`
locally) with `DECART_API_KEY` set, and `ALLOWED_ORIGINS` in production. **The key
never reaches the browser** — `api/session.mjs` holds it and returns a connection
credential. (Rotate the key first — it was exposed during development.)

---

## Security — the one rule

**The Decart API key must never reach the browser.** `api/session.mjs` keeps it
server-side and returns a connection credential.

**Open item before public launch:** confirm whether Decart can mint a
**short-lived, scoped session token** from the key. If yes, return *only* that
token from `mintCredential()` in `api/session.mjs` (the function is structured for
a one-line swap). Until then, the endpoint returns the key over a gated path —
acceptable for **local / gated demo only**, not a public launch. For public use,
also add real auth + per-user usage caps + key rotation.

## Responsible use

- On-screen `SIMULATED — AI GENERATED` badge, on by default ([`config.js`](config.js)).
- Acceptable-use: don't pass output off as real footage.
- For production: provenance (C2PA) on any export, audit logging, human sign-off
  before anything synthetic airs near a real newsroom.

## Project layout

```
index.html            fullscreen simulation view + overlaid operator UI
style.css             EDT/ARVENA tokens + fullscreen/overlay layout
config.sample.js      client config template  →  copy to config.js
vercel.json           security headers + camera permissions policy
api/session.mjs       serverless: holds DECART_API_KEY, returns credential
src/
  main.js             orchestrator: idle → connecting → live state machine (both engines)
  decart.js           @decartai/sdk wrapper (start / setPrompt / stop)
  segment.js          OFFLINE engine: RVM matting (TF.js/WebGL) + MediaPipe fallback
  backgrounds.js      procedural scenario backplates for the offline engine
  scenarios.js        prompt catalog (Flood / Stadium Pitch / Festival / Mountain)
  recorder.js         canvas-composite recording (burned-in badge + mic)
  mp4.js              in-browser WebM→MP4 via ffmpeg.wasm (lazy-loaded)
  session.js          credential fetch + idle/time-cap guardrails
  usage.js            dev usage meter (footer toggle / ?dev=1)
  ui.js               DOM helpers
assets/models/rvm-tfjs/   RVM TF.js graph model (served same-origin)
assets/favicon/       EDT brand favicon + PWA kit
```

## Not in this build (Phase 3 in the plan)

Auth provider + user accounts, billing/usage persistence, C2PA provenance on
exports (the visible burned-in label ships today), mobile/native SDK evaluation.
The serverless function and time-cap logic leave clean seams for these.

See [`decart-realtime-scenario-plan.md`](decart-realtime-scenario-plan.md) for the
full product/brand spec.
