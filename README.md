# ARVENA · Realtime Scenario Generator

Put a live presenter "on location" — flood, wildfire, storm — **in real time**.
The presenter shows full-screen as a **SIMULATION VIEW** with the operator UI
overlaid on top; an operator switches scenarios on the fly and the output
auto-records to MP4.

Two engines (toggle while idle):

- **LIVE AI** (`decart`) — streams the webcam to Decart's Lucy realtime models,
  which restyle the feed live and stream it back (per-second cost; ~20s cap).
- **OFFLINE · FREE** (`local`) — runs entirely in-browser: matting cuts the
  presenter out and composites them over a procedural scenario background. No
  Decart calls, no per-second bill, no key, no time cap.

Built inside the **EDT (Experiential Design Team)** brand system, as the
**ARVENA** production/broadcast sub-brand. Vanilla static site + one serverless
function — same stack as the sibling EDT projects, no build step.

> ⚠️ **Synthetic media.** Every output frame is AI-generated and labelled
> `SIMULATED — AI GENERATED`. Do not present output as real news. See
> [Responsible use](#responsible-use).

---

## How it works

**LIVE AI engine (Decart):**

```
Browser  ──getUserMedia──►  Decart SDK  ──WebRTC──►  Decart Lucy models
   │                              ▲                         (edited video back)
   └──POST /api/session──►  serverless fn  ──►  holds DECART_API_KEY (server-side)
                                              returns a connection credential
```

- **Media path:** WebRTC, browser ⇄ Decart directly (low latency).
- **Control/auth path:** `api/session.mjs` is the only thing that touches the
  secret key. **The key never reaches the browser.**

**OFFLINE · FREE engine (in-browser, no server):**

```
webcam ──► RVM matting (TensorFlow.js/WebGL) ──► alpha matte
              │                                       │
              └── full-res webcam ──[ composite ]──◄──┘ over procedural background
                                        │
                                        └──► output canvas → recorder
```

- Runs on-device; the model (`assets/models/rvm-tfjs/`) is served same-origin.
- Falls back to MediaPipe `ImageSegmenter` if WebGL/TF.js can't load.
- No Decart calls → free, no per-second bill, no time cap.

## Flow

START auto-connects the selected engine, auto-starts recording on the first
output frame (mic audio + burned-in `SIMULATED — AI GENERATED` label), and on
STOP (or the Live-AI time cap) transcodes WebM→MP4 in-browser (ffmpeg.wasm) and
downloads it. A loading overlay covers the screen while the offline model warms
up; a fullscreen button toggles native fullscreen.

## Models (verify current IDs at docs.platform.decart.ai/getting-started/models)

| Mode in UI | Model ID | Use |
| --- | --- | --- |
| RESTYLE 2 · STYLE | `lucy-restyle-2` | Full-frame stylization — the current default for the Live AI engine |
| (legacy) LUCY 2.1 | `lucy-2.1` | Edit/character-ref model; the mode button was removed from the UI |

> Note: the older `lucy-edit` ID no longer exists; `lucy-2.1` handles both text
> editing and character reference in one model.

---

## Run locally

**Offline · Free engine — no key, any static server:**

```bash
cp config.sample.js config.js   # client config (holds NO secrets)
npx serve -l 5000               # or: python -m http.server 5000
```

Open `http://localhost:5000`, click **OFFLINE · FREE**, pick a scenario, press
**START →**. No Decart key or `vercel dev` needed.

**Live AI engine — needs the serverless function:**

Requires the [Vercel CLI](https://vercel.com/docs/cli) so the static site and the
`/api/session` function run together.

```bash
cp config.sample.js config.js              # if not already done
echo "DECART_API_KEY=your-decart-key" > .env   # server-side only
vercel dev
```

Open the printed URL, allow camera access, pick **Flood**, press **START →**.

> Camera + WebRTC require a secure context. `localhost` counts as secure, so both
> `npx serve` and `vercel dev` work. The offline engine needs no `/api`; the Live
> AI engine does — use `vercel dev` for that.

## Deploy

1. Push to a repo and import into Vercel (framework preset: **Other** — it's static).
2. Add env var **`DECART_API_KEY`** in Project → Settings → Environment Variables.
3. (Recommended) set **`ALLOWED_ORIGINS`** to your deployment origin(s),
   comma-separated, so only your site can mint credentials.

---

## Configuration

`config.js` (client, non-secret):

| Key | Meaning |
| --- | --- |
| `SESSION_ENDPOINT` | Where to fetch the credential (`/api/session`) |
| `MODELS.edit` / `MODELS.restyle` | Realtime model IDs |
| `DEFAULT_SCENARIO` | Scenario loaded on go-live |
| `DEFAULT_ENGINE` | `"decart"` (Live AI) or `"local"` (Offline · Free) |
| `MAX_SESSION_SECONDS` | Hard cap for the Live AI engine (cost control) |
| `IDLE_TIMEOUT_SECONDS` | Auto-disconnect when idle (cost control) |
| `AUTO_RECORD` | Auto-start recording on the first output frame |
| `SHOW_SIMULATED_BADGE` | Disclosure badge on output (keep `true`) |
| `PRICE_PER_SECOND_USD` | Dev usage-meter estimate only (`?dev=1`) |
| `LOCAL.*` | Offline engine: capture `WIDTH`/`HEIGHT`/`FPS`, `MAX_SESSION_SECONDS` (0 = unlimited), `SEG_ENGINE` (`rvm`/`mediapipe`), `RVM_WORKING_WIDTH`, `RVM_DOWNSAMPLE`, `EDGE_FEATHER_PX` |

Scenarios live in [`src/scenarios.js`](src/scenarios.js) as plain data — edit
prompts there without touching app code. Offline backgrounds are procedural in
[`src/backgrounds.js`](src/backgrounds.js) (a scenario can set `bgVideo`/`bgImage`
to use a pre-rendered loop instead).

Server env vars: `DECART_API_KEY` (required), `ALLOWED_ORIGINS` (optional).

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
