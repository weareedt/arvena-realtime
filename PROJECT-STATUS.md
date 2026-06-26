# ARVENA — Project Status

_Last updated: 2026-06-26_

Current state of the ARVENA Realtime Scenario Generator. See [README.md](README.md) for
setup/run details and [decart-realtime-scenario-plan.md](decart-realtime-scenario-plan.md)
for the original product/brand spec.

## Live

| | |
|---|---|
| **App (production)** | https://arvena-realtime.vercel.app |
| **Repo (public)** | https://github.com/weareedt/arvena-realtime |
| **Vercel project** | `edt-projects/arvena-realtime` |
| **Deploy** | GitHub auto-deploy connected — `git push origin main` → Vercel builds |

## How it works now (one-click flow)

**The OFFLINE engine is the only engine** — the Live AI / Offline toggle was removed.
`DEFAULT_ENGINE = "local"` and START always runs the in-browser matting path. (The
Decart code — `src/decart.js`, `goLiveDecart`, `api/session.mjs` — is retained but no
longer reachable from the UI.)

1. Page loads with the **SIMULATION VIEW** filling the entire viewport as the backdrop
   (`object-fit: contain`); all UI is overlaid on top — title, **⛶ FULLSCREEN** button +
   `● ON AIR` (top-right), `SIMULATED — AI GENERATED` badge (top-left), START/STOP +
   scenario chips + status + footer (bottom-center), and a **CAMERA.IN** raw-camera PiP
   (bottom-right). The RVM model **prewarms at boot** so the first START is instant.
2. Operator clicks **START →**. A darken + spinner **"LOADING SEGMENTATION MODEL"**
   overlay covers the screen until the model is ready (brief, since it's prewarmed).
3. The webcam is captured locally; RVM produces a soft alpha matte, the presenter is
   composited (full-res, fit-centered) over the scenario background, and the result
   streams to the big panel.
4. On the first composited frame, **recording auto-starts** (mic audio + burned-in
   `SIMULATED — AI GENERATED` label composited onto a canvas).
5. **No time cap** offline (`LOCAL.MAX_SESSION_SECONDS = 0`).
6. On **STOP**, it **auto-stops, transcodes WebM→MP4 (ffmpeg.wasm), downloads**, and
   ends the session (big panel reverts to raw camera).

### Offline engine (free, on-device)

In-browser **RVM** (Robust Video Matting via TensorFlow.js/WebGL) cuts out the presenter
and composites them over a **scenario background** (`src/backgrounds.js`). Runs entirely
on-device → **no Decart calls, no per-second bill, no time cap**. Auto-falls back to
MediaPipe `ImageSegmenter` if WebGL/TF.js can't load (`LOCAL.SEG_ENGINE`,
`RVM_WORKING_WIDTH`, `RVM_DOWNSAMPLE`). NOTE: onnxruntime-web was tried first and
rejected — its WebGPU EP silently ran unsupported ops on the CPU/main thread and froze
the tab; TF.js WebGL keeps compute on the GPU.

Quality details:
- Matte gives only the **alpha**; the presenter's RGB is the **full-res webcam** painted
  through it (sharp, not upscaled from the working res).
- A **full-res snapshot** is grabbed the same instant the matte is computed, so the
  cutout doesn't trail on fast motion.
- `ALPHA_EDGE_LO` (segment.js const) **chokes the low-alpha rim** to remove the
  background-spill halo.
- Output canvas is a fixed **16:9** (1920×1080); the background is **full-bleed** and the
  presenter is **fit-centered** at the camera's native aspect → no black bars, no stretch.

Tradeoff: the presenter is composited, not neurally restyled — reads like a virtual set,
not a fully AI-generated frame.

- Record button removed (recording is automatic). `● ON AIR` marks the live/recording state.
- Dev usage meter: footer **USAGE METER** toggle (or `?dev=1`). Local estimate only;
  always 0 offline.

## Architecture / security

- Vanilla static site + one serverless function (`api/session.mjs`). No bundler.
- **Decart key never reaches the browser** — held server-side as the `DECART_API_KEY`
  Vercel env var; the browser only gets a connection credential from `/api/session`.
- Endpoint is **origin-locked** via `ALLOWED_ORIGINS` and rate-limited per IP.
- `config.js` is committed (no secrets); `.env` is gitignored.

## Key files

```
index.html        operator console (window-chrome panels)
style.css         EDT/ARVENA tokens + layout
config.js         non-secret client config (model IDs, 20s cap, AUTO_RECORD, price)
api/session.mjs   serverless: holds DECART_API_KEY, returns credential (origin gate + rate limit)
src/main.js       orchestrator: idle→live state machine, auto-record, guards
src/decart.js     @decartai/sdk wrapper (connect / setPrompt / stop)
src/segment.js    OFFLINE engine: RVM matting (TensorFlow.js/WebGL, default) w/ MediaPipe ImageSegmenter fallback → canvas MediaStream (free)
assets/models/rvm-tfjs/  RVM TF.js graph model (model.json + ~3.7MB shard), served same-origin
src/backgrounds.js procedural scenario backplates for the offline engine (+ optional bgVideo/bgImage)
src/scenarios.js  prompt catalog (Flood/Stadium Pitch/Festival/Mountain) — all restyle mode
src/recorder.js   canvas-composite recording (burned-in disclosure + mic)
src/mp4.js        in-browser WebM→MP4 via ffmpeg.wasm (lazy-loaded)
src/session.js    credential fetch + idle/time-cap guards
src/usage.js      dev usage meter (footer toggle)
src/ui.js         DOM helpers
```

## Scenarios

Four scenarios (`src/scenarios.js`), all `restyle` mode, all **video-backed**: `flood`,
`stadium` (Stadium Pitch), `festival`, `mountain`. Each sets `bgVideo` →
`assets/backgrounds/<id>-loop.mp4` and **falls back to a procedural painter**
(`src/backgrounds.js`) until the clip is present. Default scenario: `flood`.

- Committed so far: `flood-loop.mp4` (1.7MB, compressed). **To add:**
  `stadium-loop.mp4`, `festival-loop.mp4`, `mountain-loop.mp4` (1080p H.264, no audio,
  seamless loop, compressed). See `assets/backgrounds/README.md`.
- `segment.js` is lazy-loaded (`await import(...)`) so its CDN deps can't break app boot.
  Don't reintroduce a static import of segment.js.

## Open items

- Add the three remaining background clips (stadium/festival/mountain).
- C2PA content credentials on exports (currently only the visible burned-in label).
- Decart (Live AI) path is dormant; the leaked key isn't surfaced/billed while
  offline-only — rotate only if Decart is re-enabled.
- Auth + per-user usage/billing persistence (Phase 3) if going beyond demo.
