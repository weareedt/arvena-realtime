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
  DEFAULT_SCENARIO: "stadium",

  // Which engine runs by default:
  //   "decart" → live AI restyle (per-second cost, capped by MAX_SESSION_SECONDS)
  //   "local"  → offline background segmentation (free, runs entirely in-browser)
  // The operator can switch engines in the UI while idle.
  DEFAULT_ENGINE: "decart",

  // Offline (local segmentation) engine. No per-second cost, so MAX_SESSION_SECONDS
  // here is a UX/length cap, not a billing guard (0 = unlimited). WIDTH/HEIGHT/FPS
  // drive the local camera capture.
  LOCAL: {
    // Camera capture size (also drives the output/recording size — see
    // orientationView() in main.js, which derives OUT_WIDTH/HEIGHT from
    // these unless set explicitly). Was bumped to 1920x1080 to fix
    // pixelation, but that combined with the RVM bump below to enough
    // sustained GPU/encode load that the live preview would stall near the
    // end of a ~60s recording — reverted to the known-stable 720p. Re-test
    // higher resolutions deliberately (ideally with profiling) rather than
    // stacking quality bumps blind.
    WIDTH: 1280,
    HEIGHT: 720,
    FPS: 30,
    // "auto" (default) detects portrait/landscape from the window and flips
    // live on resize/rotate (see detectPortrait() in main.js). Forced to
    // "landscape" per client request — always renders/records 16:9 regardless
    // of window shape or device rotation. Set back to "auto" to restore the
    // live-flip behavior, or "portrait" to force the tall frame instead.
    ORIENTATION: "landscape",
    MAX_SESSION_SECONDS: 60, // auto-stop + save each recording at 1 min (0 = no cap)
    // Matting engine: "rvm" (Robust Video Matting via TensorFlow.js/WebGL — soft
    // edges + temporal coherence, best quality) | "mediapipe" (GPU fallback).
    // RVM auto-falls back to MediaPipe if WebGL is unavailable.
    SEG_ENGINE: "rvm",
    // Performance auto-tunes to the device by default: "auto" lets the engine
    // pick RVM working width / downsample / inference rate from a detected tier
    // (phones + integrated-GPU laptops get much lighter settings so the page
    // stays usable; discrete-GPU desktops keep full quality). Set any of these to
    // an explicit NUMBER to override the auto value.
    //
    // RVM inference resolution (long side, px). Lower = faster, higher = sharper.
    // Was forced to 512 (the "high" tier's own ceiling, up from an even
    // higher 640 before that) to fight blocky hair edges on a tight headshot
    // — but combined with the 1080p capture bump above, sustained load was
    // enough to stall the live preview near the end of a ~60s recording.
    // Reverted to "auto" so weak/mid devices get a lighter setting again.
    RVM_WORKING_WIDTH: "auto", // auto: low 256 / mid 384 / high 512
    // RVM internal downsample ratio (0.25–1). Higher = sharper matte (less jagged),
    // more GPU cost.
    RVM_DOWNSAMPLE: "auto",    // auto: low 0.4 / mid 0.5 / high 0.6
    // Cap on how often the matting model runs (frames/sec). The background still
    // animates + composites at full frame-rate; only the person cutout refreshes
    // at this rate. Lower = far less sustained GPU load on weak hardware.
    INFERENCE_FPS: "auto",     // auto: low 15 / mid 24 / high 30
    // Edge feather in px. RVM's matte is already soft (0 ideal). undefined lets
    // the engine pick (0 for RVM, a touch for MediaPipe).
    EDGE_FEATHER_PX: undefined,
    // Keep only the single largest connected "person" blob in the matte and
    // drop everything else — stops bystanders/a crowd behind the presenter
    // from being composited in too (the presenter, being closest to camera,
    // is normally the largest figure in frame). Set false to matte in everyone.
    ISOLATE_LARGEST_PERSON: true,
    // RVM edge choke (0-1, default 0.08 in segment.js): alpha below this is
    // dropped to remove background-bleed halo. Dark hair against a dark
    // background is a low-contrast case where the model's real alpha
    // confidence is already low, so a high choke clips hair first — lower
    // this (e.g. 0.05) if hair is disappearing; raise it (e.g. 0.12) if you
    // see a light halo/fringe around the presenter instead. undefined = use
    // the segment.js default.
    ALPHA_EDGE_LO: undefined,
    // Finer control over ISOLATE_LARGEST_PERSON above (both undefined = use
    // segment.js defaults of 8 / 2):
    // - BLOB_ALPHA_THRESHOLD: alpha level (0-255) a pixel must exceed to count
    //   as "person" for grouping. Lower it if part of the presenter (e.g. a
    //   raised arm) is being read as a separate blob and dropped.
    // - BLOB_DILATE_RADIUS: gap-bridging radius (working-res px) used only to
    //   decide grouping, so thin hair wisps aren't read as a separate island.
    //   Raise it if that's still happening; lower it if a bystander who gets
    //   close to the presenter occasionally merges into their blob.
    BLOB_ALPHA_THRESHOLD: undefined,
    BLOB_DILATE_RADIUS: undefined,
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
