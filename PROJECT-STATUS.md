# ARVENA — Project Status

_Last updated: 2026-06-18_

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

1. Operator clicks **GO LIVE →**.
2. App fetches a credential from `api/session.mjs` and connects the webcam to Decart.
3. On the first edited frame, **recording auto-starts** (mic audio + burned-in
   `SIMULATED — AI GENERATED` label composited onto a canvas).
4. Session runs a **~20s hard cap** (`MAX_SESSION_SECONDS = 20`).
5. On cap (or END SESSION), it **auto-stops, transcodes WebM→MP4 (ffmpeg.wasm), downloads**,
   and ends the session.

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
src/scenarios.js  prompt catalog (Flood/Wildfire/Storm/Studio) — all restyle mode
src/recorder.js   canvas-composite recording (burned-in disclosure + mic)
src/mp4.js        in-browser WebM→MP4 via ffmpeg.wasm (lazy-loaded)
src/session.js    credential fetch + idle/time-cap guards
src/usage.js      dev usage meter (footer toggle)
src/ui.js         DOM helpers
```

## Open items

- **Rotate the Decart key** before wider launch — it was exposed in chat/screenshot
  (user deferred). Update the Vercel env var + local `.env`, then redeploy.
- C2PA content credentials on exports (currently only the visible burned-in label).
- Auth + per-user usage/billing persistence (Phase 3) if going beyond demo.
