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

  // Which engine runs by default:
  //   "decart" → live AI restyle (per-second cost, capped by MAX_SESSION_SECONDS)
  //   "local"  → offline background segmentation (free, runs entirely in-browser)
  // The operator can switch engines in the UI while idle.
  DEFAULT_ENGINE: "decart",

  // Offline (local segmentation) engine. No per-second cost, so MAX_SESSION_SECONDS
  // here can be 0 (unlimited). WIDTH/HEIGHT/FPS drive the local camera capture.
  LOCAL: {
    WIDTH: 1280,
    HEIGHT: 720,
    FPS: 30,
    MAX_SESSION_SECONDS: 0,
    // Matting engine: "rvm" (Robust Video Matting via TensorFlow.js/WebGL — soft
    // edges + temporal coherence, best quality) | "mediapipe" (GPU fallback).
    // RVM auto-falls back to MediaPipe if WebGL is unavailable.
    SEG_ENGINE: "rvm",
    // RVM inference resolution (long side, px). Lower = faster, higher = sharper.
    RVM_WORKING_WIDTH: 512,
    // RVM internal downsample ratio (0.25–1). Higher = sharper matte (less jagged),
    // more GPU cost. 1.0 = full working-res matte.
    RVM_DOWNSAMPLE: 1.0,
    // Edge feather in px. RVM's matte is already soft (0 ideal). undefined lets
    // the engine pick (0 for RVM, a touch for MediaPipe).
    EDGE_FEATHER_PX: undefined,
  },

  // Cost & responsible-use guardrails (plan §8). Tune freely.
  // Hard ceiling on a single live session, in seconds. 0 disables.
  MAX_SESSION_SECONDS: 20,
  // Auto-disconnect after this many seconds with no operator interaction. 0 disables.
  IDLE_TIMEOUT_SECONDS: 0,

  // Auto-start recording when the operator clicks GO LIVE (no separate Record
  // click needed). The clip auto-saves as MP4 when the session ends.
  AUTO_RECORD: true,

  // Show the "SIMULATED — AI GENERATED" disclosure badge (plan §10). Keep true.
  SHOW_SIMULATED_BADGE: true,

  // Scan-a-QR to download the recording. After STOP the MP4 is uploaded to public
  // cloud storage and its public URL is shown as a QR the person scans on their
  // phone. The browser uploads DIRECTLY to storage (Vercel functions cap bodies
  // at ~4.5 MB); the Supabase anon key is client-safe by design (public bucket +
  // an anon INSERT policy). Set ENABLE_QR false to only save locally.
  STORAGE: {
    ENABLE_QR: true,
    PROVIDER: "supabase",
    SUPABASE_URL: "https://ljntfottlgcdnmflhiop.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqbnRmb3R0bGdjZG5tZmxoaW9wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1OTM4NDEsImV4cCI6MjA5NzE2OTg0MX0.Fu_tluL9ebLe7012X2ffAsXdfRaHfjOfodHmri8Xf20",
    BUCKET: "ArvenaLapor",                 // a PUBLIC bucket with anon INSERT + SELECT(list) policies
  },

  // Dev usage meter (visible only when the URL has ?dev=1). It's a LOCAL estimate
  // of generated seconds — the authoritative bill is in the Decart dashboard.
  // Set this to the per-second rate from the Decart pricing page to show an
  // estimated cost; leave 0 to hide the cost line.
  PRICE_PER_SECOND_USD: 0,
};
