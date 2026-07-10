# ARVENA — Project Status

_Last updated: 2026-07-10_

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

1. On page load the segmentation model loads and the composited scene runs as a **live
   preview from boot** — the presenter is already "in" the default scenario (flood), no
   black "OUTPUT IDLE" screen. UI is overlaid: title, **HIDE UI** + **⛶ FULLSCREEN**
   (top-right), START/STOP + scenario chips + status + footer (bottom), **CAMERA.IN** raw
   PiP (bottom-right). (`startScene()` in `main.js`.)
2. Picking a scenario chip swaps the backplate live in the preview (no recording yet).
3. Operator clicks **START →**: recording begins and **all chrome is hidden except the
   STOP button** (clean recording view, `body.live-recording`). Recording burns in the
   mic audio + `SIMULATED — AI GENERATED` label. (`beginRecording()`.)
4. **No time cap** offline (`LOCAL.MAX_SESSION_SECONDS = 0`).
5. On **STOP**: the UI restores immediately, the clip is saved (see below), and the app
   returns to the **live preview** — never a black screen. (`stopRecording()`.)

**Recording format:** modern Chrome/Edge record **MP4 (H.264) directly** (MediaRecorder
mime is MP4-first), so the save is instant — no transcode. Browsers that can't record MP4
fall back to WebM → MP4 via ffmpeg.wasm (`src/mp4.js`; loads its worker from a same-origin
blob `classWorkerURL` to dodge the cross-origin-worker block).

**Scan-a-QR download (dormant until configured):** after STOP the MP4 is (a) saved locally
AND (b) uploaded to public cloud storage, whose URL is shown as a **QR modal** the person
scans on their phone. Storage is a pluggable adapter (`src/upload.js`, Supabase impl;
`src/qr.js` renders the QR). Stays off until `CONFIG.STORAGE` has real Supabase creds
(placeholders shipped) — see Open items.

**Orientation:** one switch `CONFIG.LOCAL.ORIENTATION` (`"portrait"` | `"landscape"`)
derives the output/recording frame size, presenter fit, and on-screen fill. Default is
**portrait** 1080×1920 (kiosk deployment): background cover-fills edge-to-edge, presenter
cover-cropped to fill the tall frame. Camera capture stays landscape for a sharp matte.

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
- Output canvas size/fit come from `CONFIG.LOCAL.ORIENTATION` (default portrait 1080×1920);
  background cover-fills full-bleed, presenter fit is `cover` (portrait) or `contain`
  (landscape). Camera capture stays landscape (`WIDTH`/`HEIGHT`) regardless.

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
src/scenarios.js  scenario catalog (9, video-only: id/label/bgVideo|bgImage — prompt/mode/enhance are dead Decart metadata)
src/recorder.js   canvas-composite recording (burned-in disclosure + mic); MP4-first mime
src/mp4.js        WebM→MP4 fallback via ffmpeg.wasm (lazy-loaded, same-origin classWorkerURL)
src/upload.js     pluggable cloud-storage adapter (Supabase impl) for the QR download
src/qr.js         renders a URL to a QR canvas (qrcode via esm.sh)
src/session.js    credential fetch + idle/time-cap guards
src/usage.js      dev usage meter (footer toggle)
src/ui.js         DOM helpers (incl. QR modal states)
```

## Scenarios

**Nine scenarios** (`src/scenarios.js`), **video-only** — the engine composites the
presenter over `bgVideo`/`bgImage`; it does NOT restyle, so only `id`/`label`/media are
read (`prompt`/`mode`/`enhance` are dead Decart-path metadata; don't add them to new
scenarios). Backplate resolves by `id` → `bgVideo` (mp4) → `bgImage` (png/jpg) →
procedural painter (`src/backgrounds.js`; unknown id → `studio`). Default: `flood`.

- Original 4 (video): `flood`, `stadium`, `festival`, `mountain`.
- Malaysian set (added 2026-07-08): `klcc` (video), `wartawan` (Malam Wartawan — painter
  only, no clip yet), `concert` (video; painter reuses `festival`), `piala` (Piala
  Malaysia — `piala.png`; painter reuses `stadium`), `studio` (Baca Berita — `studio.png`).
- `segment.js` is lazy-loaded (`await import(...)`) so its CDN deps can't break app boot.
  Don't reintroduce a static import of segment.js.

## Open items

- **QR download — finish Supabase setup** (planned next week): create a free Supabase
  project + a **public** `recordings` bucket + an anon **INSERT** policy, then paste the
  Project URL + anon key into `CONFIG.STORAGE` in `config.js`. Until then the QR flow is
  dormant (local download only). Adapter is pluggable (`src/upload.js`) so R2/Vercel Blob
  are a swap. Test by scanning from a phone on cellular (proves the link is public).
- `wartawan` still has no background clip (runs its procedural painter).
- C2PA content credentials on exports (currently only the visible burned-in label).
- Decart (Live AI) path is dormant; the leaked key isn't surfaced/billed while
  offline-only — rotate only if Decart is re-enabled.
- Auth + per-user usage/billing persistence (Phase 3) if going beyond demo.
