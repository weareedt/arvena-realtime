# Real-Time Scenario Generator — Tech Planning

**Project:** A website that takes a live person on camera and places them inside a generated scenario in real time (e.g. a reporter "covering a flood"), using Decart's Lucy real-time video models.

**Brand:** Built inside the **EDT (Experiential Design Team)** brand system. This product reads as the **ARVENA** sub-brand — EDT's "production / broadcast / cinematic" line (accent: Neon Red `#FF2D2D` + EDT Electric Blue). Full brand integration in §13.

**Last updated:** June 2026
**Status:** Planning / pre-MVP

---

## 1. What we're actually building

A user (a "presenter") opens the site, grants camera access, and stands in front of a plain background. The site streams their webcam to Decart's real-time model, which edits the feed live — adding floodwater, rain, a storm sky, debris, emergency lighting — and streams the transformed video back. The presenter sees themselves "on location" with near-zero latency, and an operator can switch scenarios on the fly ("flood" → "wildfire" → "studio").

The defining constraint is **real time**. This is not "render a clip and download it." Decart's Lucy models generate video continuously, frame by frame, autoregressively, so motion, body position, and timing are preserved from one frame to the next without buffering. That's what makes a live "broadcast" feel believable instead of like a slideshow.

### Primary use cases this unlocks
- Mock newsroom / journalism training and j-school teaching
- Film, TV, and VFX previs ("what would this shot look like flooded?")
- Emergency-response and disaster-preparedness training simulations
- Live streaming / entertainment (the mainstream Decart use case today)
- Interactive installations and demos

> ⚠️ **Synthetic-media note up front (not an afterthought):** This tool produces realistic footage of events that aren't happening. That's fine for the use cases above, but it becomes a problem the moment output leaves a clearly-labeled context. Disclosure, watermarking, and provenance are treated as **product requirements**, not optional polish. See §10.

---

## 2. Which Decart model fits

Decart exposes several real-time models through one SDK (`@decartai/sdk`). The right one depends on whether you want to **add elements to the real scene** or **restyle the whole frame**.

| Model (realtime) | What it does | Fit for "flood news" |
| --- | --- | --- |
| **Lucy Edit** (`lucy-edit`) — Realtime Video Editing | Add / remove / modify specific objects in the live feed via text prompt, while preserving the rest | **Primary choice.** Keeps the real presenter photoreal, adds floodwater/rain/debris around them |
| **Lucy Restyle** (`lucy-restyle-2`) — Realtime Style Transfer | Restyles the *entire* frame into a look (anime, oil painting, cyberpunk, cinematic) | Use for stylized/dramatized looks, not photoreal news |
| **Lucy 2.1** (`lucy-2.1` / `lucy-latest`) — Character Transform | Maps a reference face/character onto the live subject's motion | Optional: swap the presenter's appearance, not needed for scenery |

**Recommendation:** Build the MVP on **Lucy Edit** for the photoreal "add the flood around a real person" effect, and keep **Lucy Restyle** as a second mode for stylized scenarios. Both share the same `client.realtime.connect()` plumbing, so supporting both is mostly a prompt/model-id switch.

> 🔎 **Confirm before committing:** exact realtime model IDs, supported resolutions, and FPS change between releases (Lucy 2.0 → 2.1, restyle-2, etc.). Pull the live list from `https://docs.platform.decart.ai/getting-started/models` during setup rather than hardcoding from this doc.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         BROWSER (client)                     │
│                                                              │
│  getUserMedia() ──► local MediaStream ──► <video> preview    │
│        │                                                     │
│        ▼                                                     │
│  Decart SDK: client.realtime.connect(stream, {...})          │
│        │   ▲                                                 │
│   WebRTC│   │ onRemoteStream (edited video)                  │
│   uplink│   │                                                │
└────────┼───┼─────────────────────────────────────────────────┘
         │   │
         │   │   (auth: short-lived session token, NOT the raw key)
         ▼   │
┌─────────────────────────────────────────────────────────────┐
│                     YOUR BACKEND (token service)             │
│  • holds DECART_API_KEY (server-side secret)                 │
│  • mints/returns a scoped session token to the browser       │
│  • enforces auth, rate limits, usage caps per user/session   │
│  • logs usage for billing & abuse monitoring                 │
└────────────────────────────┬────────────────────────────────┘
                             │  REST (API key in header)
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                      DECART PLATFORM                         │
│  Lucy Edit / Restyle realtime models on DOS inference stack  │
│  (WebRTC media path connects browser ⇄ Decart directly)      │
└─────────────────────────────────────────────────────────────┘
```

The **media** path is WebRTC between the browser and Decart (low latency, peer-style). Your backend sits only in the **control/auth** path. This keeps your servers out of the heavy video flow.

### The one rule you cannot break
**The Decart API key must never reach the browser.** Decart's quickstart examples put `apiKey: "your-key"` directly in client code — that's fine for a local demo and a disaster in production (anyone can grab it from network/JS and bill your account). For the real site:

1. Browser asks **your** backend to start a session (user is authenticated).
2. Backend talks to Decart using the secret key and returns a **short-lived, scoped session token / connection credential** to the browser.
3. Browser passes that token to `realtime.connect()`.

> 🔎 **Open item to verify with Decart:** confirm they support ephemeral/session tokens or a server-initiated connect handshake. If the SDK currently requires the raw key client-side, options are (a) request token support, (b) proxy the WebRTC signaling through your backend, or (c) gate the demo behind strong auth + tight per-key usage caps + key rotation as an interim measure. **Resolve this before any public launch.**

---

## 4. Tech stack

### Frontend
- **Framework:** Next.js (React) or plain Vite + React. Next.js gives you the API routes for the token service in one repo.
- **Decart SDK:** `@decartai/sdk` (JavaScript/TypeScript).
- **Media:** browser `navigator.mediaDevices.getUserMedia` + WebRTC (handled by the SDK).
- **UI (EDT-branded, see §13):** the operator console is styled in EDT's **Neo-Brutalist Retro-Tech** language — each surface (camera preview, transformed output, scenario picker, live prompt box) rendered as **window-chrome panels** ("CAMERA.IN", "ARVENA.OUT", "SCENE.EXE") with 1px white borders, sharp corners, pixel-grid texture, and Electric-Blue accents. This aesthetic isn't decoration here — an OS-window control surface *is* the brand.
- **Type / colour:** Dela Gothic One (display), Space Grotesk (body/UI); Electric Blue `#2D2DFF` on Pure Black `#0A0A0A`, ARVENA Neon Red `#FF2D2D` reserved for the live/REC state. Tokens in §13.
- **Styling:** Tailwind with the EDT theme extension (`edt-blue`, `edt-black`, etc.). Corners always `0px`. No shadows. No gradients on UI.

### Backend
- **Runtime:** Node.js (matches the SDK, lets you share types). Next.js API routes, or a small Express/Fastify service, or serverless functions.
- **Responsibilities:** auth, session-token minting, usage metering, rate limiting, abuse logging. *Not* in the video path.
- **Secrets:** `DECART_API_KEY` in a secrets manager (Vercel/AWS/Doppler), never in the repo or client bundle.

### Data / infra
- **Auth:** Clerk / Auth0 / Supabase Auth — pick one, don't roll your own.
- **DB:** Postgres (Supabase/Neon) for users, sessions, usage records.
- **Storage:** S3/R2 only if you let users save recordings.
- **Hosting:** Vercel (frontend + API routes) is the fastest path; AWS/Fly if you need more control. Decart itself runs the GPUs (Trainium) — you don't host inference.

### SDK languages available
JavaScript/TypeScript (web — this project), plus Python, Swift, Android if you later build native apps.

---

## 5. Core implementation snippets

These are scaffolding patterns, not final code — treat model IDs and option names as things to confirm against current docs.

**Capture camera and connect (style/scene transform):**
```typescript
import { createDecartClient, models } from "@decartai/sdk";

// model.fps / width / height drive the camera constraints
const model = models.realtime("lucy-restyle-2"); // or "lucy-edit"

const stream = await navigator.mediaDevices.getUserMedia({
  video: { frameRate: model.fps, width: model.width, height: model.height },
}).catch((err) => { console.error("Camera access failed:", err.message); throw err; });

// IMPORTANT: in production, fetch a session token from YOUR backend
// instead of embedding the raw API key here.
const client = createDecartClient({ apiKey: sessionTokenFromBackend });

const realtimeClient = await client.realtime.connect(stream, {
  model,
  onRemoteStream: (edited) => {
    document.getElementById("output").srcObject = edited;
  },
  onError: (err) => console.error("Connection error:", err),
  onDisconnect: (reason) => console.log("Disconnected:", reason),
  initialState: {
    prompt: {
      text: "Heavy urban flood: brown floodwater up to knee height, "
          + "heavy rain, overcast storm sky, submerged cars in background, "
          + "keep the presenter sharp and photorealistic",
      enhance: true,
    },
  },
});
```

**Switch scenarios live (this is the operator's main control):**
```typescript
realtimeClient.setPrompt("Wildfire evacuation: orange smoke haze, embers in air, "
  + "emergency vehicle lights, keep presenter photorealistic");
```

**Optional — character transform with a reference image (Lucy 2.1):**
```typescript
const model = models.realtime("lucy-latest");
// ...connect with initialState.image = referencePhoto (File | Blob | URL)
```

**Backend token endpoint (sketch, Next.js route):**
```typescript
// /app/api/session/route.ts  (server-side only)
export async function POST(req) {
  const user = await requireAuth(req);          // your auth
  await assertUnderUsageCap(user);              // your metering
  const token = await mintDecartSessionToken(); // calls Decart w/ DECART_API_KEY
  return Response.json({ token });              // raw key never leaves here
}
```

---

## 6. Scenario / prompt design

The product is really a **prompt library** wrapped in a friendly UI. Each "scenario" is a tuned prompt (and optionally a reference image). Build a small internal catalog:

- **Flood (news):** floodwater height, water color/turbidity, rain intensity, sky, background props (submerged cars, sandbags), and an explicit "keep presenter photorealistic and sharp" clause.
- **Wildfire, storm/hurricane, earthquake aftermath, snowstorm:** same structure, different elements.
- **Studio reset:** a clean prompt to return the presenter to a neutral newsroom or plain background.

Practical prompt rules learned from how these models behave:
- Be concrete about **placement and scale** ("knee-height water," "background only") — vague prompts drift.
- Always pin what must *not* change (the presenter) so the edit stays around them.
- Keep a "panic button" prompt that resets to neutral instantly via `setPrompt()`.
- Store prompts as data (DB/JSON), not hardcoded, so non-engineers can tune scenarios.

---

## 7. Performance & latency

- **Latency target:** Decart advertises sub-40ms frame transformation; the felt latency includes camera capture, WebRTC round trip, and render. Budget for ~100–200ms end-to-end and test on real networks.
- **Resolution/FPS:** driven by the model (e.g. 720p flagship realtime). Don't request a camera resolution the model doesn't support; read it off the `model` object.
- **Network:** WebRTC needs decent upstream bandwidth and tolerates jitter poorly. Detect weak connections and warn the user; implement the SDK's reconnection pattern on `onDisconnect`.
- **Devices:** test mobile Safari and Android Chrome early — `getUserMedia` permission flows and codecs differ. Native Swift/Android SDKs exist if web mobile proves too flaky.

---

## 8. Cost model

- Decart's video models are billed **per second of generated video** (real-time minutes add up fast since you're generating continuously while the camera is on).
- Free credits exist for getting started; confirm current per-second pricing at `docs.platform.decart.ai` pricing page.
- **Cost-control requirements for the build:**
  - Per-session and per-user **time caps** enforced in the backend.
  - **Idle auto-disconnect** (camera on but no activity → end the session).
  - Usage metering and a live "minutes used" indicator so users aren't surprised.
  - Alerting on spend anomalies (a leaked token would burn money continuously).

---

## 9. Build phases

**Phase 0 — Spike (1–2 days)**
Get the raw Decart quickstart running locally with a hardcoded key. Prove the flood edit looks acceptable on your camera before building anything else. Kill the project here if quality isn't there.

**Phase 1 — MVP (1–2 weeks)**
- Camera capture + connect + output preview.
- One hardcoded scenario (Flood) + a "reset to studio" button.
- Backend token service so the key is off the client.
- Basic auth + a hard session time cap.
- **Brand foundation:** install EDT fonts + colour tokens, set favicon/manifest, build the window-chrome panel + button components (§13). Get the shell looking like EDT/ARVENA from day one — retrofitting brand later is painful.

**Phase 2 — Operator console (1–2 weeks)**
- Scenario catalog (multiple disasters) + free-text prompt box + live `setPrompt()` switching.
- Lucy Edit *and* Lucy Restyle modes.
- Usage meter, idle disconnect, reconnection handling.
- **Brand build-out:** full window-chrome console (CAMERA.IN / ARVENA.OUT / SCENE.EXE), Neon-Red live/REC state, pixel-grid hero, EDT type scale applied.

**Phase 3 — Productionization**
- Recording/export (if needed) with provenance baked in (§10).
- Per-user usage limits & billing, abuse monitoring, spend alerts.
- Mobile testing / native SDK evaluation.

---

## 10. Responsible use (product requirement, not legalese)

Because the headline example is literally *fabricated news footage*, treat trust-and-safety as part of the spec:

- **Visible labeling:** an on-screen "Simulated / AI-generated" badge on the output and any exports, on by default and not trivially removable.
- **Provenance / content credentials:** attach C2PA-style content credentials to any saved/exported file so downstream tools can detect it's synthetic.
- **Acceptable-use gating:** terms that prohibit passing output off as real news; auth so usage is attributable.
- **Audit logging:** keep session/prompt logs for abuse investigation.
- **Editorial guardrails** if this is ever near a real newsroom: a clear human-in-the-loop sign-off before anything synthetic airs.

These are also just good engineering for any synthetic-media product, and several may be required depending on your jurisdiction's AI-disclosure rules — worth a quick legal check before launch.

---

## 11. Open questions to resolve during setup

1. **Secure auth pattern:** does Decart support ephemeral session tokens / server-initiated connect, or must the key be client-side? (Blocks public launch — see §3.)
2. **Current model IDs, resolutions, FPS, and per-second pricing** — confirm live from docs, don't trust this doc's snapshot.
3. **Lucy Edit vs Restyle quality** for photoreal "flood around a real person" — validate in Phase 0.
4. **Recording rights & storage** — are we saving output? If so, where, for how long, and with what consent?
5. **Concurrency limits** — how many simultaneous realtime sessions does the account/plan allow?
6. **Disclosure/legal requirements** in target markets for synthetic media.

---

## 12. Reference links

- Decart platform & playground: `https://platform.decart.ai`
- Docs / overview & quickstart: `https://docs.platform.decart.ai`
- Models list: `https://docs.platform.decart.ai/getting-started/models`
- SDK: `npm install @decartai/sdk` (JS/TS; Python, Swift, Android also available)

---

## 13. Brand & UI system — EDT / ARVENA

This site lives inside the **EDT Brand Identity System v1.1**. It reads as the **ARVENA** sub-brand (EDT's production / broadcast / cinematic line). Base palette and type stay pure EDT; ARVENA adds a **Neon Red `#FF2D2D`** accent used *only* for the live / recording / "on air" state — a perfect semantic fit for a real-time broadcast tool.

### 13.1 Why the brand and the product fit
EDT's primary aesthetic is **Neo-Brutalist Retro-Tech**: OS window chrome, pixel-grid overlays, bold stacked type, electric blue on black, zero softness. A real-time scenario console is, structurally, a stack of live panels — camera in, AI feed out, scene controls. So we lean *into* the brand rather than bolting it on: every functional surface is an "OS window."

```
┌─ CAMERA.IN ───────────────[_][□][X]┐   ┌─ ARVENA.OUT ──────[● REC]─[_][□][X]┐
│                                    │   │                                    │
│        (raw webcam preview)        │   │     (Decart edited live feed)      │
│                                    │   │   ▓ SIMULATED — AI GENERATED ▓      │
└────────────────────────────────────┘   └────────────────────────────────────┘
┌─ SCENE.EXE ───────────────────────────────────────────────[_][□][X]┐
│  [ FLOOD ]  [ WILDFIRE ]  [ STORM ]  [ STUDIO ]      prompt > ____  │
│  ░░ pixel-grid texture · 1px white borders · sharp corners ░░       │
└─────────────────────────────────────────────────────────────────────┘
```

### 13.2 Colour tokens (EDT base + ARVENA accent)
```css
:root {
  /* EDT base */
  --color-electric-blue: #2D2DFF;  /* CTAs, accents, active states, arrows */
  --color-pure-black:    #0A0A0A;  /* app background, panels */
  --color-surface:       #111111;  /* card / window body */
  --color-mid-grey:      #8C8C8C;  /* secondary text, metadata */
  --color-pure-white:    #FFFFFF;  /* borders, lines, primary text on dark */

  /* ARVENA sub-brand accent — LIVE/REC state ONLY */
  --color-arvena-red:    #FF2D2D;

  /* semantic */
  --color-background:    var(--color-pure-black);
  --color-border:        var(--color-pure-white);
  --color-accent:        var(--color-electric-blue);
  --color-live:          var(--color-arvena-red);
  --color-text-primary:  var(--color-pure-white);
  --color-text-secondary:var(--color-mid-grey);
}
```

**Rules carried over from the brand book:** Electric Blue is a spotlight, never wallpaper. Never blue-on-blue. Neon Red is *not* a general accent here — it earns its place only on the live/REC indicator and the "ON AIR" badge, so "the feed is hot" reads instantly. No pastels, no "tech-startup blue," no gradients on UI.

### 13.3 Typography
- **Display / headlines:** Dela Gothic One, ALL-CAPS, tight tracking (`-0.02em` to `-0.03em`). Hero, section titles, big stats (latency, session minutes).
- **Body / UI / controls:** Space Grotesk (Light→Bold). Buttons and labels: SemiBold, all-caps, `letter-spacing: 0.08em`.
- **Window title bars / mono labels:** Space Grotesk ~13px (the `CAMERA.IN` / `SCENE.EXE` look).
- Never Dela Gothic below 28px; never Inter/Roboto/Arial anywhere.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```
Self-host the bundled `.ttf` / variable font from `Brand Identity/FONTS/` if you'd rather not depend on Google Fonts.

### 13.4 Tailwind theme extension
```js
// tailwind.config.ts
theme: { extend: {
  colors: {
    'edt-blue':  '#2D2DFF',
    'edt-black': '#0A0A0A',
    'edt-grey':  '#8C8C8C',
    'edt-white': '#FFFFFF',
    'arvena-red':'#FF2D2D',
  },
  fontFamily: {
    display: ['"Dela Gothic One"', 'sans-serif'],
    body:    ['"Space Grotesk"', 'sans-serif'],
  },
  borderRadius: { none: '0px' }, // corners are ALWAYS sharp
}}
```

### 13.5 Core components (brand-spec)
- **Window-chrome panel:** `bg-[#111] border border-white`, sharp corners, 32px title bar (`#0A0A0A` or `#2D2DFF`) with a mono `.exe`-style label + fake min/max/close glyphs. This is the default container for *everything* — feeds, controls, stat cards.
- **Primary CTA button:** Electric Blue bg, white Space-Grotesk SemiBold 14px all-caps, padding `14px 28px`, radius `0`, trailing `→`. Hover `#0000CC`, scale 1.02. (e.g. "GO LIVE →", "START SESSION →")
- **Secondary button:** transparent, 1px white border, hover inverts to white bg / black text.
- **Live / REC indicator:** ARVENA Neon Red dot + "● ON AIR" label, only visible while a Decart session is connected and generating.
- **Stat cards as OS windows:** title bar `#2D2DFF` mono label ("LATENCY.MS", "SESSION.MIN"), big number in Dela Gothic One. Good home for the latency/usage meters from §7–§8.
- **Pixel-grid hero:** full-viewport dark hero, white pixel-grid texture at 5–6% opacity, Dela Gothic One headline, Electric-Blue eyebrow.

### 13.6 The synthetic-media badge, on-brand
The "SIMULATED / AI-GENERATED" overlay from §10 doubles as a brand element: render it as a **panel block** — 1px border, all-caps Space Grotesk label, sitting inside the `ARVENA.OUT` window. On-brand *and* it satisfies the disclosure requirement. Keep it on by default and burned into any export.

### 13.7 Logo, favicon & manifest (from the brand kit)
- **Header / footer (dark bg):** `EDT-lockup-dark.svg` (all-white lockup). On-blue CTA sections: same all-white lockup stays legible.
- **Light sections / print:** `EDT Logo_Name-01.png` (black wordmark).
- **Icon-only (avatar, stamp):** `edt-favicon.svg` / `edt-icon.svg`.
- **Favicon kit:** copy the `edt-favicon/` folder into `public/favicon/` and wire it via the Next.js metadata API (icons + `apple-touch-icon` + manifest). Set `<meta name="theme-color" content="#2D2DFF">`.

### 13.8 ⚠️ Asset fixes required before launch (flagged in the brand kit)
1. **SVG colour bug:** the SVGs use `fill="blue"` (= `#0000FF`), **not** EDT Electric Blue `#2D2DFF`. Find-and-replace `fill="blue"` → `fill="#2D2DFF"` in `edt-favicon.svg`, `edt-icon.svg`, `EDT-lockup-light.svg`, and `edt-favicon/favicon.svg`. *(I can do this for you — just say so.)*
2. **`site.webmanifest` placeholders:** the shipped manifest still has "MyWebSite/MySite" and a white theme. Replace with EDT values: name "Experiential Design Team", `background_color #0A0A0A`, `theme_color #2D2DFF`, and the 192/512 maskable icons.

### 13.9 Brand do's & don'ts that bite this UI specifically
- ✅ Sharp corners on every panel, card, button, video frame. Always.
- ✅ One hero element per view — don't let blue become wallpaper.
- ✅ Window chrome as the organising metaphor for the whole console.
- ❌ No rounded corners, drop shadows, glows, or UI gradients (overlay gradients on the *video* are fine).
- ❌ Don't spend the Neon Red anywhere except the live/REC state.
- ❌ No stock "innovation" imagery — use real ARVENA output as the hero reel.

### 13.10 Asset manifest (what's in the brand kit)
```
Claude_EDT_BrandID/
├─ edt_brandidentity.md            ← full brand book (source of truth)
└─ Brand Identity/
   ├─ EDT-lockup-dark.svg          ← all-white horizontal lockup (nav/footer on dark)
   ├─ EDT-lockup-light.svg         ← blue-icon horizontal lockup (on dark)
   ├─ edt-icon.svg                 ← vertical stacked lockup
   ├─ edt-favicon.svg              ← icon mark only
   ├─ EDT Logo_Name-01.png         ← black wordmark (light bg)
   ├─ EDT Logo_Name_White-01.png   ← white wordmark (dark bg)
   ├─ EDT LOGO Large-01.png        ← large icon mark
   ├─ colourpalette.png            ← palette reference
   ├─ Website_Look.png             ← visual-direction mood board
   ├─ edt-favicon/                 ← favicon + PWA kit (.ico/.svg/.png + webmanifest)
   └─ FONTS/                       ← Dela Gothic One + Space Grotesk (.ttf + variable)
```

> **Brand source of truth:** `edt_brandidentity.md` (v1.1, March 2026). If anything here conflicts with that file, the brand book wins.
