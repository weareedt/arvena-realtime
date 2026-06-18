// Copy this file to `config.js`. It holds ONLY non-secret, client-side config.
//
// The Decart API key is NEVER here. It lives server-side as the DECART_API_KEY
// env var, read by /api/session.js. The browser asks /api/session for a
// short-lived connection credential — see README "Key security".

export const CONFIG = {
  // Endpoint on YOUR backend that mints a Decart connection credential.
  // Default works under `vercel dev` and on a Vercel deployment.
  SESSION_ENDPOINT: "/api/session",

  // Realtime model IDs (verify current list at docs.platform.decart.ai/getting-started/models).
  // lucy-2.1     → photoreal edits + character reference in one model (our default).
  // lucy-restyle-2 → full-frame style transfer (the "stylized" mode).
  MODELS: {
    edit: "lucy-2.1",
    restyle: "lucy-restyle-2",
  },

  // Which scenario loads when the operator goes live.
  DEFAULT_SCENARIO: "flood",

  // Cost & responsible-use guardrails (plan §8). Tune freely.
  // Hard ceiling on a single live session, in seconds. 0 disables.
  MAX_SESSION_SECONDS: 10 * 60,
  // Auto-disconnect after this many seconds with no operator interaction. 0 disables.
  IDLE_TIMEOUT_SECONDS: 90,

  // Show the "SIMULATED — AI GENERATED" disclosure badge (plan §10). Keep true.
  SHOW_SIMULATED_BADGE: true,

  // Dev usage meter (visible only when the URL has ?dev=1). It's a LOCAL estimate
  // of generated seconds — the authoritative bill is in the Decart dashboard.
  // Set this to the per-second rate from the Decart pricing page to show an
  // estimated cost; leave 0 to hide the cost line.
  PRICE_PER_SECOND_USD: 0,
};
