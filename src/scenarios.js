// Scenario catalog — the product is really a tuned prompt library (plan §6).
//
// Each scenario is DATA, not UI, so a non-engineer can edit prompts without
// touching the app. Prompt rules baked in here:
//   • concrete about placement + scale ("knee-height", "background only")
//   • every prompt PINS the presenter ("keep the presenter sharp and
//     photorealistic, unchanged") so the edit happens AROUND them
//
// Each scenario id also maps to a procedural backplate in backgrounds.js (used
// by the offline engine) and may carry an optional bgVideo/bgImage.
//
// `mode` selects which model the scenario wants (Decart path, currently unused):
//   "edit"    → lucy-2.1      (photoreal, edits around the real person)
//   "restyle" → lucy-restyle-2 (full-frame stylization)

const KEEP_PRESENTER =
  "Keep the presenter sharp, photorealistic and unchanged in the foreground; " +
  "apply all changes to the environment around them only.";

export const SCENARIOS = [
  {
    id: "flood",
    label: "Flood",
    mode: "restyle",
    enhance: true,
    // OFFLINE engine: if this looping clip exists it's used as the backplate;
    // otherwise it falls back to the procedural flood painter (backgrounds.js).
    // Drop a 1080p MP4 (H.264, no audio, seamless loop) at this path to enable it.
    bgVideo: "assets/backgrounds/flood-loop.mp4",
    prompt:
      "Heavy urban flood news scene: brown turbid floodwater up to knee height across " +
      "the ground, heavy rain, overcast storm sky, half-submerged cars and floating " +
      "debris in the background, sandbags along a wall. " + KEEP_PRESENTER,
  },
  {
    id: "stadium",
    label: "Stadium Pitch",
    mode: "restyle",
    enhance: true,
    bgVideo: "assets/backgrounds/stadium-loop.mp4",
    prompt:
      "Inside a packed football stadium at night: floodlit green pitch with painted " +
      "side lines, tiered stands full of cheering fans, bright stadium floodlights and a " +
      "glowing scoreboard in the background. " + KEEP_PRESENTER,
  },
  {
    id: "festival",
    label: "Festival",
    mode: "restyle",
    enhance: true,
    bgVideo: "assets/backgrounds/festival-loop.mp4",
    prompt:
      "Outdoor night music festival: large illuminated main stage, sweeping coloured " +
      "spotlights and laser beams, dense crowd silhouettes with raised hands, confetti " +
      "in the air, deep dusk sky. " + KEEP_PRESENTER,
  },
  {
    id: "mountain",
    label: "Mountain",
    mode: "restyle",
    enhance: true,
    bgVideo: "assets/backgrounds/mountain-loop.mp4",
    prompt:
      "High alpine mountain landscape: layered snow-capped peaks, clear blue sky with " +
      "drifting clouds, bright sun and crisp daylight, distant ridgelines. " + KEEP_PRESENTER,
  },

  // ---- OFFLINE video-only scenarios -----------------------------------------
  // The current engine composites the presenter over `bgVideo` (falling back to
  // the matching painter in backgrounds.js). It does NOT restyle, so these carry
  // no prompt/mode/enhance — only id, label and the backplate matter.
  // Drop the matching MP4 in assets/backgrounds/ to replace the painter.
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
    id: "concert",
    label: "Concert",
    bgVideo: "assets/backgrounds/concert-loop.mp4",
  },
  {
    id: "piala",
    label: "Piala Malaysia",
    bgVideo: "assets/backgrounds/piala-loop.mp4",
  },
  {
    id: "studio",
    label: "Baca Berita",
    bgVideo: "assets/backgrounds/studio-loop.mp4",
  },
];

export const DEFAULT_SCENARIO_ID = "flood";

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}
