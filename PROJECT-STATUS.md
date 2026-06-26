# ARVENA — Project Status

_Last updated: 2026-06-24_

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

1. Page loads with the **SIMULATION VIEW** filling the entire viewport as the backdrop;
   all UI (title, engine toggle, START/STOP, scenario chips, status, footer) is overlaid
   on top of it, with a small **CAMERA.IN** picture-in-picture inset bottom-right.
2. Operator clicks **START →**.
3. App fetches a credential from `api/session.mjs` and connects the webcam to Decart; the
   big panel swaps from raw camera to the Decart-edited feed once frames arrive, and the
   raw feed continues in the bottom-center PiP.
4. On the first edited frame, **recording auto-starts** (mic audio + burned-in
   `SIMULATED — AI GENERATED` label composited onto a canvas).
5. Session runs a **~20s hard cap** (`MAX_SESSION_SECONDS = 20`).
6. On cap (or **STOP**), it **auto-stops, transcodes WebM→MP4 (ffmpeg.wasm), downloads**,
   and ends the session (big panel reverts to raw camera).

### Engines (cost control)

Two engines, switchable via the toggle while idle (`DEFAULT_ENGINE` in `config.js`):

- **LIVE AI** (`decart`) — Decart `lucy-restyle-2` full-frame restyle. Per-second
  cost; governed by the 20s `MAX_SESSION_SECONDS` cap.
- **OFFLINE · FREE** (`local`) — in-browser **MediaPipe Selfie Segmentation** cuts
  out the presenter and composites them over a **procedural scenario background**
  (`src/backgrounds.js`). Runs entirely on-device → **no Decart calls, no
  per-second bill, no tight time cap** (`LOCAL.MAX_SESSION_SECONDS = 0`).
  Matting engine = **RVM** (Robust Video Matting via TensorFlow.js/WebGL) for soft
  hair-level edges + temporal coherence; auto-falls back to MediaPipe
  ImageSegmenter if WebGL/TF.js can't load (`LOCAL.SEG_ENGINE`,
  `LOCAL.RVM_WORKING_WIDTH`, `LOCAL.RVM_DOWNSAMPLE`). NOTE: onnxruntime-web was
  tried first and rejected — its WebGPU EP silently ran unsupported ops on the
  CPU/main thread and froze the tab. TF.js WebGL keeps compute on the GPU.
  Tradeoff:
  the presenter is composited, not neurally restyled, so it reads more like a
  virtual set than a fully AI-generated frame. Backgrounds are procedural by
  default; drop in `bgVideo`/`bgImage` on a scenario to use a pre-rendered loop
  (render one per scenario with Decart once, reuse forever).

- Default model: **`lucy-restyle-2`** (restyle). Edit/Lucy-2.1 mode button removed.
- Record button removed (recording is automatic). `● ON AIR` marks the live/recording state.
- Dev usage meter: footer **USAGE METER** toggle (or `?dev=1`); shows generated seconds +
  estimated cost (`PRICE_PER_SECOND_USD` in `config.js`). Local estimate only.

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
src/scenarios.js  prompt catalog (Flood/Wildfire/Storm/Studio) — all restyle mode
src/recorder.js   canvas-composite recording (burned-in disclosure + mic)
src/mp4.js        in-browser WebM→MP4 via ffmpeg.wasm (lazy-loaded)
src/session.js    credential fetch + idle/time-cap guards
src/usage.js      dev usage meter (footer toggle)
src/ui.js         DOM helpers
```

## In progress / needs verification

- **OFFLINE engine** (free, MediaPipe selfie segmentation) is built but **not yet
  verified in a real browser**. `segment.js` is lazy-loaded (`await import(...)`)
  from `goLiveLocal()` so its CDN deps can't break app boot; MediaPipe loads via an
  injected `<script>` tag (global `SelfieSegmentation`), NOT esm.sh.
  - Earlier bug (fixed): a top-level `import` of `segment.js` threw at load time and
    killed the whole UI (blank toggle/chips, dead buttons). Don't reintroduce a
    static import of segment.js.
  - To test: serve over localhost (`npx serve -l 5000` or `python -m http.server
    5000`), open `http://localhost:5000`, click **OFFLINE · FREE**, pick a scenario,
    press START. No Decart key/`vercel dev` needed for the offline engine.
  - Still to check on real hardware: MediaPipe CDN loads/initializes, mask edge
    quality, recording/MP4 export from the composited canvas stream.
  - Possible next steps: per-scenario `bgVideo` (pre-render one loop per scenario
    with Decart once → photoreal backplate at one-time cost), mask edge feathering.

## Open items

- **Rotate the Decart key** before wider launch — it was exposed in chat/screenshot
  (user deferred). Update the Vercel env var + local `.env`, then redeploy.
- C2PA content credentials on exports (currently only the visible burned-in label).
- Auth + per-user usage/billing persistence (Phase 3) if going beyond demo.
