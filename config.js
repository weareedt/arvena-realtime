// Local config — copied from config.sample.js. Holds NO secrets.
// (Gitignored so each operator can point at their own deployment.)

export const CONFIG = {
  SESSION_ENDPOINT: "/api/session",

  MODELS: {
    edit: "lucy-2.1",
    restyle: "lucy-restyle-2",
  },

  DEFAULT_SCENARIO: "flood",

  // Engine: "local" = offline background segmentation (free, runs in-browser,
  // the only engine in the UI) | "decart" = live AI restyle (per-second cost;
  // code retained but no longer surfaced as a toggle). See src/segment.js.
  DEFAULT_ENGINE: "local",

  // Offline (local segmentation) engine settings. No per-second cost, so no
  // tight time cap — set LOCAL.MAX_SESSION_SECONDS to 0 for unlimited.
  LOCAL: {
    // Deployment orientation — the ONE switch. Everything else (output/recording
    // frame size, presenter framing, and the on-screen fill) is derived from it:
    //   "portrait"  → vertical output (short×long), fills the screen edge-to-edge,
    //                 presenter cover-cropped to fill the tall frame.
    //   "landscape" → classic 16:9 output, whole presenter letterboxed (uncropped).
    ORIENTATION: "potrait",
    // Camera CAPTURE size — keep FULL 1080p so the webcam uses its full sensor
    // (many cams center-crop / "zoom" at lower capture sizes). Matting runs on a
    // downscaled copy anyway, so this isn't the perf bottleneck.
    WIDTH: 1920,
    HEIGHT: 1080,
    // OUTPUT / recording frame size — undefined derives from ORIENTATION
    // (portrait → 1080×1920). Set explicit values to render/record smaller.
    OUT_WIDTH: undefined,
    OUT_HEIGHT: undefined,
    //   PRESENTER_FIT → "cover" (fill, crop sides) | "contain" (whole presenter)
    PRESENTER_FIT: undefined,
    // Extra zoom on the presenter: 1 = full fit (as before), lower pulls them
    // back (0.8 = 20% smaller). Back to 1 per request.
    PRESENTER_SCALE: 1,
    FPS: 30,
    // Recording auto-stops (saves + shows the QR) after this many seconds.
    // 0 = unlimited. 60 = each recording capped at 1 minute.
    MAX_SESSION_SECONDS: 60,
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

  // Scan-a-QR to download the recording. After STOP the MP4 is uploaded to public
  // cloud storage and its URL is shown as a QR for the person to scan. The anon
  // key is client-safe by design (public bucket + anon INSERT policy). Leave
  // ENABLE_QR false (or the fields blank) to skip the QR and only save locally.
  STORAGE: {
    ENABLE_QR: true,
    PROVIDER: "supabase",
    SUPABASE_URL: "https://ljntfottlgcdnmflhiop.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqbnRmb3R0bGdjZG5tZmxoaW9wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1OTM4NDEsImV4cCI6MjA5NzE2OTg0MX0.Fu_tluL9ebLe7012X2ffAsXdfRaHfjOfodHmri8Xf20",
    BUCKET: "ArvenaLapor",                 // PUBLIC bucket with an anon INSERT policy
  },

  // Dev usage meter (visible only with ?dev=1). Estimate only — the real bill
  // lives in the Decart dashboard. Set the per-second rate from the Decart
  // pricing page to show an estimated cost; leave 0 to hide the cost line.
  PRICE_PER_SECOND_USD: 0.01,
  
};
