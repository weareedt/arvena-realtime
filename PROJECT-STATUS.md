# ARVENA — Project Status

_Last updated: 2026-07-17_

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
3. Operator clicks **START →**: recording begins, **all chrome is hidden except the STOP
   button** (clean recording view, `body.live-recording`), and a top-center **countdown
   timer** shows. Recording burns in the mic audio + `SIMULATED — AI GENERATED` label.
   (`beginRecording()` + `startRecTimer()`.)
4. **Recording auto-stops at `LOCAL.MAX_SESSION_SECONDS`** (currently **60s** = 1 min);
   the timer counts down to 0:00 (counts up if the cap is 0/unlimited). Guard fires
   `onMaxReached` → `stopRecording()`.
5. On **STOP** (manual or cap): the UI + timer restore immediately, the clip is saved (see
   below), and the app returns to the **live preview** — never a black screen.

**Recording format:** modern Chrome/Edge record **MP4 (H.264) directly** (MediaRecorder
mime is MP4-first), so the save is instant — no transcode. Browsers that can't record MP4
fall back to WebM → MP4 via ffmpeg.wasm (`src/mp4.js`; loads its worker from a same-origin
blob `classWorkerURL` to dodge the cross-origin-worker block).

**Scan-a-QR download (LIVE):** after STOP the MP4 is (a) saved locally AND (b) uploaded to
Supabase Storage (public `ArvenaLapor` bucket, anon INSERT policy), whose public URL is
shown as a **QR-only modal** the person scans on their phone. `src/upload.js` = Supabase
adapter (direct browser upload, no `x-upsert` — that would need an UPDATE policy);
`src/qr.js` renders the QR via the `qrcode` lib. Creds live in `CONFIG.STORAGE`; the anon
key is client-safe by design. Set `STORAGE.ENABLE_QR:false` to fall back to local-only.

**Orientation** (`CONFIG.LOCAL.ORIENTATION`) drives output/recording size, presenter fit,
on-screen fill, and which assets load:
- **Currently forced to `"landscape"`** per client request — always renders/records 16:9
  regardless of window shape or device rotation. `"auto"` (the other option) detects from
  the **window** instead and flips the whole pipeline live on resize/rotate
  (`detectPortrait()`/`orientationView()` in main.js; a `matchMedia`+`resize` listener
  rebuilds the scene via `restartScene()`). Won't flip mid-recording — deferred to when
  recording stops (`pendingReorient`).
- **`"portrait"` / `"landscape"`** — force one or the other (fixed kiosk). Portrait =
  1080×1920, bg cover-fills edge-to-edge, presenter cover-cropped; landscape = 16:9,
  presenter letterboxed.
- Output size derives from capture size (or set `OUT_WIDTH/OUT_HEIGHT` explicitly).
  `PRESENTER_SCALE` (1) can pull the presenter back to ease zoom.
- **Orientation-specific backgrounds:** a scenario's `bgVideoPortrait`/`bgImagePortrait`
  is used when portrait (else the generic `bgVideo`/`bgImage`). Portrait-native clips also
  remove the landscape-in-portrait cover-fit zoom. `bgOffsetX/Y` (or global `BG_OFFSET_X/Y`,
  −1…1) pans a cover-fit background to choose which slice shows.

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
- `ALPHA_EDGE_LO` (segment.js const, default `0.05`, tunable via
  `CONFIG.LOCAL.ALPHA_EDGE_LO`) **chokes the low-alpha rim** to remove the background-spill
  halo — lower it if hair is getting clipped (dark hair on a dark background is the
  hardest case), raise it if you see background bleed through as a halo instead.
- **Largest-blob isolation** (`CONFIG.LOCAL.ISOLATE_LARGEST_PERSON`, default `true`): keeps
  only the single largest connected "person" blob in the matte and drops everyone else, so
  a crowd/bystanders behind the presenter don't get composited in too. Runs a connected-
  component flood-fill on the low-res working buffer, with a small gap-bridging dilation
  (`BLOB_DILATE_RADIUS`) so thin hair wisps aren't read as a separate island and dropped.
  Finer control via `CONFIG.LOCAL.BLOB_ALPHA_THRESHOLD` / `BLOB_DILATE_RADIUS` (both
  `undefined` = segment.js defaults).
- Output canvas size/fit come from `CONFIG.LOCAL.ORIENTATION`; background cover-fills
  full-bleed, presenter fit is `cover` (portrait) or `contain` (landscape).

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
dashboard.html    admin/ops dashboard: browse, preview, download, QR, delete recordings
style.css         EDT/ARVENA tokens + layout
config.js         non-secret client config (model IDs, 20s cap, AUTO_RECORD, price)
api/session.mjs   serverless: holds DECART_API_KEY, returns credential (origin gate + rate limit)
api/videos-delete.mjs  serverless: admin-password-gated clip delete (holds the Supabase service-role key)
src/main.js       orchestrator: idle→live state machine, auto-record, guards
src/dashboard.js  dashboard logic: lists every clip from Supabase Storage (grouped by
                  YYYY-MM, sorted newest-first by parsed filename timestamp), storage-usage
                  meter + delete gated behind an admin password (sessionStorage)
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

**Ten scenarios** (`src/scenarios.js`, Malay-labelled), **video-only** — the engine
composites the presenter over `bgVideo`/`bgImage`; it does NOT restyle, so only
`id`/`label`/media are read (no `prompt`/`mode`/`enhance` anymore). Backplate resolves by
`id` → `bgVideo` (mp4) → `bgImage` (png/jpg) → procedural painter (`src/backgrounds.js`;
unknown id → `studio`). Chips render in **two rows** — `primary: true` scenarios in a
larger **top row**, the rest in a smaller **second row** (`ui.renderScenarios`). Default:
`stadium`.

- **Main row** (`primary`): `stadium` ("Stadium"), `studio` ("Bilik Berita"), `concert`
  ("Konsert"), `terjah` ("Terjah"), `interactive` ("Anak Gajah"). `terjah`/`interactive`
  accept EITHER `<id>-loop.mp4` or `<id>.png` (both paths set).
- **Second row**: `flood` ("Banjir"), `klcc` ("KLCC"), `festival` ("Festival"), `piala`
  ("Piala Malaysia"), `mountain` ("Gunung").
- `segment.js` is lazy-loaded (`await import(...)`) so its CDN deps can't break app boot.
  Don't reintroduce a static import of segment.js.

**Performance:** RVM matting is GPU-bound. `config.js` currently ships capture
**1280×720**, `RVM_WORKING_WIDTH`/`RVM_DOWNSAMPLE`/`INFERENCE_FPS` all **`"auto"`**
(device-tier adaptive — see `PERF_PRESETS` in segment.js: low/mid/high). These were
briefly bumped higher (1920×1080 capture, RVM forced to 512/0.6) to fight pixelation and
blocky hair edges, but that combination correlated with the live preview stalling near the
end of a ~60s recording, so both were reverted. Re-test higher settings deliberately
(ideally with profiling) rather than stacking quality bumps blind. Capture size also drives
output/recording size (`orientationView()` in main.js) unless `OUT_WIDTH`/`OUT_HEIGHT` are
set explicitly.

## Open items

- QR download is **live** (Supabase `ArvenaLapor`). Housekeeping: clips accumulate and the
  free tier is ~1 GB — prune old files in the Supabase Storage console periodically. A few
  `_test/` debug files may still sit in the bucket (safe to delete).
- C2PA content credentials on exports (currently only the visible burned-in label).
- Decart (Live AI) path is dormant; the leaked key isn't surfaced/billed while
  offline-only — rotate only if Decart is re-enabled.
- Auth + per-user usage/billing persistence (Phase 3) if going beyond demo.
