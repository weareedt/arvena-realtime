# ARVENA · Realtime Scenario Generator

Put a live presenter "on location" — flood, wildfire, storm — **in real time**.
The browser streams the webcam to Decart's Lucy realtime models, which edit the
feed live and stream it back. An operator switches scenarios on the fly.

Built inside the **EDT (Experiential Design Team)** brand system, as the
**ARVENA** production/broadcast sub-brand. Vanilla static site + one serverless
function — same stack as the sibling EDT projects, no build step.

> ⚠️ **Synthetic media.** Every output frame is AI-generated and labelled
> `SIMULATED — AI GENERATED`. Do not present output as real news. See
> [Responsible use](#responsible-use).

---

## How it works

```
Browser  ──getUserMedia──►  Decart SDK  ──WebRTC──►  Decart Lucy models
   │                              ▲                         (edited video back)
   └──POST /api/session──►  serverless fn  ──►  holds DECART_API_KEY (server-side)
                                              returns a connection credential
```

- **Media path:** WebRTC, browser ⇄ Decart directly (low latency).
- **Control/auth path:** `api/session.mjs` is the only thing that touches the
  secret key. **The key never reaches the browser.**

## Models (verify current IDs at docs.platform.decart.ai/getting-started/models)

| Mode in UI | Model ID | Use |
| --- | --- | --- |
| LUCY 2.1 · EDIT | `lucy-2.1` | Photoreal — adds the scenario *around* the real presenter (default) |
| RESTYLE 2 · STYLE | `lucy-restyle-2` | Full-frame stylization |

> Note: the older `lucy-edit` ID no longer exists; `lucy-2.1` now handles both
> text editing and character reference in one model.

---

## Run locally

Requires the [Vercel CLI](https://vercel.com/docs/cli) so the static site and the
`/api/session` function run together.

```bash
# 1. client config (holds NO secrets)
cp config.sample.js config.js

# 2. the secret key — server-side only, for `vercel dev`
echo "DECART_API_KEY=your-decart-key" > .env

# 3. run
vercel dev
```

Open the printed URL, allow camera access, pick **Flood**, press **GO LIVE →**.

> Camera + WebRTC require a secure context. `localhost` counts as secure, so
> `vercel dev` is fine. A plain static file server won't run the `/api` function
> or get camera in some browsers — use `vercel dev`.

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
| `MAX_SESSION_SECONDS` | Hard session time cap (cost control) |
| `IDLE_TIMEOUT_SECONDS` | Auto-disconnect when idle (cost control) |
| `SHOW_SIMULATED_BADGE` | Disclosure badge on output (keep `true`) |

Scenarios live in [`src/scenarios.js`](src/scenarios.js) as plain data — edit
prompts there without touching app code.

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
index.html            operator console markup (window-chrome panels)
style.css             EDT/ARVENA tokens + window chrome + layout
config.sample.js      client config template  →  copy to config.js
vercel.json           security headers + camera permissions policy
api/session.mjs       serverless: holds DECART_API_KEY, returns credential
src/
  main.js             orchestrator: idle → connecting → live state machine
  decart.js           @decartai/sdk wrapper (start / setPrompt / stop)
  scenarios.js        prompt catalog (Flood / Wildfire / Storm / Studio)
  session.js          credential fetch + idle/time-cap guardrails
  ui.js               DOM helpers
assets/favicon/       EDT brand favicon + PWA kit
```

## Not in this build (Phase 3 in the plan)

Auth provider + user accounts, billing/usage persistence, recording/export with
C2PA provenance, mobile/native SDK evaluation. The serverless function and
time-cap logic leave clean seams for these.

See [`decart-realtime-scenario-plan.md`](decart-realtime-scenario-plan.md) for the
full product/brand spec.
