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

## Currently wired

| Scenario | Expected file |
| --- | --- |
| `flood` | `flood-loop.mp4` |

Add more by setting `bgVideo`/`bgImage` on the matching scenario and dropping the
file here.

## Tip: render a loop once with Decart

You can generate one photoreal loop per scenario with the Live AI engine a single
time, save the MP4, and reuse it here forever — zero per-session cost after that.
