// Scenario catalog — the product is really a tuned prompt library (plan §6).
//
// Each scenario is DATA, not UI, so a non-engineer can edit prompts without
// touching the app. Prompt rules baked in here:
//   • concrete about placement + scale ("knee-height", "background only")
//   • every prompt PINS the presenter ("keep the presenter sharp and
//     photorealistic, unchanged") so the edit happens AROUND them
//   • "studio" is the panic/reset button → instant neutral via setPrompt()
//
// `mode` selects which model the scenario wants:
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
    prompt:
      "Heavy urban flood news scene: brown turbid floodwater up to knee height across " +
      "the ground, heavy rain, overcast storm sky, half-submerged cars and floating " +
      "debris in the background, sandbags along a wall. " + KEEP_PRESENTER,
  },
  {
    id: "wildfire",
    label: "Wildfire",
    mode: "restyle",
    enhance: true,
    prompt:
      "Wildfire evacuation scene: thick orange smoke haze, glowing embers drifting in " +
      "the air, distant flames and burnt trees, flashing emergency-vehicle lights in the " +
      "background, hazy low-visibility daylight. " + KEEP_PRESENTER,
  },
  {
    id: "storm",
    label: "Storm",
    mode: "restyle",
    enhance: true,
    prompt:
      "Hurricane / severe storm scene: violent wind bending palm trees, sideways rain, " +
      "dark churning sky with lightning, flying debris and torn signage in the " +
      "background, wet reflective pavement. " + KEEP_PRESENTER,
  },
  {
    id: "studio",
    label: "Studio (reset)",
    mode: "restyle",
    enhance: false,
    // Panic button: returns the presenter to a clean, neutral broadcast set.
    prompt:
      "Clean neutral broadcast news studio: plain dark grey seamless background, even " +
      "soft studio lighting, no weather, no debris, no effects. " + KEEP_PRESENTER,
  },
];

export const DEFAULT_SCENARIO_ID = "flood";

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}
