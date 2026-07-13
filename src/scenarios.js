// Scenario catalog — DATA, not UI, so a non-engineer can add/reorder scenarios.
//
// The offline engine composites the presenter over a backplate; it does NOT
// restyle. Only `id`, `label`, and the media (`bgVideo`/`bgImage`) are used —
// each id also maps to a procedural painter in backgrounds.js (the fallback
// when no media is present; unknown ids use the neutral `studio` painter).
//
// Scenarios flagged `primary: true` render in the TOP row (larger chips); the
// rest render in a smaller second row. Order within each row follows this array.
export const SCENARIOS = [
  // ---- MAIN scenarios (top row) ---------------------------------------------
  {
    id: "interactive",
    label: "Interactive",
    primary: true,
    // Media coming: drop EITHER assets/backgrounds/interactive-loop.mp4 (video)
    // OR assets/backgrounds/interactive.png (still) — whichever exists is used
    // (video preferred), else it falls back to the neutral studio painter.
    bgVideo: "assets/backgrounds/interactive-loop.mp4",
    bgImage: "assets/backgrounds/interactive.png",
  },
  {
    id: "concert",
    label: "Concert",
    primary: true,
    bgVideo: "assets/backgrounds/concert-loop.mp4",
  },
  {
    id: "terjah",
    label: "Terjah",
    primary: true,
    // Media coming: interactive-style — drop terjah-loop.mp4 or terjah.png.
    bgVideo: "assets/backgrounds/terjah-loop.mp4",
    bgImage: "assets/backgrounds/terjah.png",
  },
  {
    id: "stadium",
    label: "Stadium",
    primary: true,
    bgVideo: "assets/backgrounds/stadium-loop.mp4",
  },

  // ---- SECONDARY scenarios (second row, smaller chips) ----------------------
  // Video-only: the engine composites the presenter over bgVideo/bgImage (else a
  // procedural painter in backgrounds.js). No prompt/mode/enhance needed.
  {
    id: "flood",
    label: "Flood",
    bgVideo: "assets/backgrounds/flood-loop.mp4",
  },
  {
    id: "festival",
    label: "Festival",
    bgVideo: "assets/backgrounds/festival-loop.mp4",
  },
  {
    id: "mountain",
    label: "Mountain",
    bgVideo: "assets/backgrounds/mountain-loop.mp4",
  },
  {
    id: "klcc",
    label: "KLCC",
    bgVideo: "assets/backgrounds/klcc-loop.mp4",
  },
  {
    id: "wartawan",
    label: "Malam Wartawan",
    bgVideo: "assets/backgrounds/wartawan-loop.mp4",
  },
  {
    id: "piala",
    label: "Piala Malaysia",
    bgImage: "assets/backgrounds/piala.png",
  },
  {
    id: "studio",
    label: "Baca Berita",
    bgImage: "assets/backgrounds/studio.png",
  },
];

export const DEFAULT_SCENARIO_ID = "flood";

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}
