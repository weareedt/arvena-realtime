// Local config — copied from config.sample.js. Holds NO secrets.
// (Gitignored so each operator can point at their own deployment.)

export const CONFIG = {
  SESSION_ENDPOINT: "/api/session",

  MODELS: {
    edit: "lucy-2.1",
    restyle: "lucy-restyle-2",
  },

  DEFAULT_SCENARIO: "flood",

  MAX_SESSION_SECONDS: 20,   // hard cap: each session auto-ends after ~20s
  IDLE_TIMEOUT_SECONDS: 0,   // disabled — the short hard cap governs instead

  // Auto-start recording on GO LIVE (no separate Record click needed).
  AUTO_RECORD: true,

  SHOW_SIMULATED_BADGE: true,

  // Dev usage meter (visible only with ?dev=1). Estimate only — the real bill
  // lives in the Decart dashboard. Set the per-second rate from the Decart
  // pricing page to show an estimated cost; leave 0 to hide the cost line.
  PRICE_PER_SECOND_USD: 0.01,
  
};
