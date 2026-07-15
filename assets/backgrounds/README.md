# Scenario background footage (OFFLINE engine)

Pre-rendered backplates for the **OFFLINE · FREE** engine. When a scenario in
[`src/scenarios.js`](../../src/scenarios.js) has a `bgVideo` (or `bgImage`) field,
the offline compositor paints that media behind the presenter instead of the
procedural canvas painter in [`src/backgrounds.js`](../../src/backgrounds.js).

If the file is missing or fails to load, the app **falls back to the procedural
painter automatically** — so it's safe to ship the `bgVideo` path before the clip
exists.

## Convention

- Path: `assets/backgrounds/<scenario-id>-loop.mp4` (served same-origin).
- Format: **H.264 MP4**, **no audio**, **seamless loop**, ideally **1920×1080**.
- Keep it small (a few MB) — it loops forever and ships with the static site.

## Orientation-specific assets

When the app runs **portrait** (`CONFIG.LOCAL.ORIENTATION`), a scenario can use a
different, portrait-native clip via `bgVideoPortrait` (or `bgImagePortrait`) — it
falls back to the generic `bgVideo`/`bgImage` when not set. Portrait-native media
(9:16) also removes the cover-fit zoom you get from a landscape clip in a tall
frame.

```js
{ id: "concert", label: "Concert", primary: true,
  bgVideo:         "assets/backgrounds/concert-loop.mp4",          // landscape / fallback
  bgVideoPortrait: "assets/backgrounds/concert-loop-portrait.mp4"  // used when portrait
}
```

## Still images (PNG / JPG)

A scenario can use a still instead of (or as well as) a clip via a `bgImage`
field, e.g. `bgImage: "assets/backgrounds/klcc.png"`. PNG transparency and
cover-fit are handled. The fallback order is **`bgVideo` → `bgImage` →
procedural painter**, so you can ship a lightweight PNG as the backplate now
and add a video later, or use the PNG purely as a nicer fallback behind a clip.
Same rules: same-origin, ideally 1920×1080, keep it small.

## Currently wired

Scenario chips render in two rows: **main** (top, larger) and **secondary**
(smaller). See [`src/scenarios.js`](../../src/scenarios.js) (`primary: true` marks
the main row).

**Main row**

| Scenario | Expected file(s) | Painter fallback | Media present? |
| --- | --- | --- | --- |
| `interactive` | `interactive-loop.mp4` (or `interactive.png`) | `studio` (no dedicated painter) | ✅ video |
| `concert` | `concert-loop.mp4` | reuses `festival` | ✅ |
| `terjah` | `terjah-loop.mp4` (or `terjah.png`) | `studio` (no dedicated painter) | ✅ video |
| `stadium` | `stadium-loop.mp4` | `stadium` | ✅ |

**Secondary row**

| Scenario | Expected file(s) | Painter fallback | Media present? |
| --- | --- | --- | --- |
| `flood` | `flood-loop.mp4` | `flood` | ✅ |
| `festival` | `festival-loop.mp4` | `festival` | ✅ |
| `mountain` | `mountain-loop.mp4` | `mountain` | ✅ |
| `klcc` | `klcc-loop.mp4` | `klcc` (KL night skyline) | ✅ |
| `piala` | `piala.png` | reuses `stadium` | ✅ |
| `studio` | `studio.png` | `studio` (news backdrop) | ✅ |

`interactive` and `terjah` each accept **either** an MP4 (`<id>-loop.mp4`) or a
still (`<id>.png`) — video preferred; both now ship an MP4. Each scenario falls
back to its procedural painter until its file is present.

## Tip: render a loop once with Decart

You can generate one photoreal loop per scenario with the Live AI engine a single
time, save the MP4, and reuse it here forever — zero per-session cost after that.
