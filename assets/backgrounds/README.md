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
| `interactive` | `interactive-loop.mp4` *or* `interactive.png` | `studio` (no dedicated painter) | ❌ not yet |
| `concert` | `concert-loop.mp4` | reuses `festival` | ✅ |
| `terjah` | `terjah-loop.mp4` *or* `terjah.png` | `studio` (no dedicated painter) | ❌ not yet |
| `stadium` | `stadium-loop.mp4` | `stadium` | ✅ |

**Secondary row**

| Scenario | Expected file(s) | Painter fallback | Media present? |
| --- | --- | --- | --- |
| `flood` | `flood-loop.mp4` | `flood` | ✅ |
| `festival` | `festival-loop.mp4` | `festival` | ✅ |
| `mountain` | `mountain-loop.mp4` | `mountain` | ✅ |
| `klcc` | `klcc-loop.mp4` | `klcc` (KL night skyline) | ✅ |
| `wartawan` | `wartawan-loop.mp4` | `wartawan` (press gala) | ❌ painter only |
| `piala` | `piala.png` | reuses `stadium` | ✅ |
| `studio` | `studio.png` | `studio` (news backdrop) | ✅ |

`interactive` and `terjah` are new — drop **either** an MP4 (`<id>-loop.mp4`) or a
still (`<id>.png`) and it's used automatically (video preferred). Until then they
show the neutral `studio` painter. Each scenario falls back to its procedural
painter until its file is present.

## Tip: render a loop once with Decart

You can generate one photoreal loop per scenario with the Live AI engine a single
time, save the MP4, and reuse it here forever — zero per-session cost after that.
