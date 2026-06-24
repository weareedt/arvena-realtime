// Local config — copied from config.sample.js. Holds NO secrets.
// (Gitignored so each operator can point at their own deployment.)

export const CONFIG = {
  SESSION_ENDPOINT: "/api/session",

  MODELS: {
    edit: "lucy-2.1",
    restyle: "lucy-restyle-2",
  },

  DEFAULT_SCENARIO: "flood",

  // Engine: "decart" = live AI restyle (per-second cost) | "local" = offline
  // background segmentation (free, runs in-browser). See src/segment.js.
  DEFAULT_ENGINE: "decart",

  // Offline (local segmentation) engine settings. No per-second cost, so no
  // tight time cap — set LOCAL.MAX_SESSION_SECONDS to 0 for unlimited.
  LOCAL: {
    WIDTH: 1280,
    HEIGHT: 720,
    FPS: 30,
    MAX_SESSION_SECONDS: 0,
    // Matting engine: "rvm" (Robust Video Matting via TensorFlow.js/WebGL — soft
    // hair-level edges + temporal coherence, best quality) | "mediapipe" (GPU
    // ImageSegmenter fallback). RVM auto-falls back to MediaPipe if WebGL is
    // unavailable, so it never freezes the page.
    SEG_ENGINE: "rvm",
    // RVM inference resolution (long side, px). Lower = faster, higher = sharper
    // matte. 512 is a good realtime default; drop to 384/256 on weak GPUs.
    RVM_WORKING_WIDTH: 512,
    // RVM internal downsample ratio (0.25–1). Higher = sharper matte (less
    // jagged) but more GPU cost. 1.0 = full working-res matte.
    RVM_DOWNSAMPLE: 0.75,
    // Edge feather in px. RVM's matte is already soft so 0 is ideal; undefined
    // lets the engine pick (0 for RVM, a touch for MediaPipe).
    EDGE_FEATHER_PX: undefined,
  },

  MAX_SESSION_SECONDS: 20,   // hard cap: each Decart session auto-ends after ~20s
  IDLE_TIMEOUT_SECONDS: 0,   // disabled — the short hard cap governs instead

  // Auto-start recording on GO LIVE (no separate Record click needed).
  AUTO_RECORD: true,

  SHOW_SIMULATED_BADGE: true,

  // Dev usage meter (visible only with ?dev=1). Estimate only — the real bill
  // lives in the Decart dashboard. Set the per-second rate from the Decart
  // pricing page to show an estimated cost; leave 0 to hide the cost line.
  PRICE_PER_SECOND_USD: 0.01,
  
};
