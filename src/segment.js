// OFFLINE engine — local background replacement with NO Decart cost.
//
// Pipeline (all in-browser, free):
//   webcam → matting/segmentation model → per-pixel person alpha
//   compose: person kept (soft alpha), everything else replaced by a procedural
//   scenario background (backgrounds.js) → output canvas → MediaStream
//
// The returned MediaStream is a drop-in for Decart's remote stream, so the rest
// of the app (output <video>, recorder, badge) works unchanged. Nothing is
// generated server-side → no per-second bill, no 20s cap.
//
// Two pluggable "matters" behind one interface:
//   - RVM (default): Robust Video Matting via TensorFlow.js (WebGL backend) — a
//     recurrent matting model → true soft alpha (hair detail) + temporal
//     coherence (no edge flicker). The WebGL backend keeps compute on the GPU
//     and stays async, so it does NOT freeze the page (unlike onnxruntime-web,
//     whose WebGPU EP silently runs unsupported ops on the CPU/main thread).
//   - MediaPipe (fallback): Tasks ImageSegmenter confidence mask. Used if WebGL /
//     TF.js can't load.
//
// All deps load lazily from pinned CDNs (model is same-origin). segment.js is
// itself dynamically imported by main.js and must NEVER be statically imported
// (heavy deps would block app boot).
import { createBackground } from "./backgrounds.js";
import { getScenario } from "./scenarios.js";

const TFJS_VERSION = "4.22.0";
const TFJS_CDN = `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@${TFJS_VERSION}/dist/tf.min.js`;
const TASKS_VERSION = "0.10.18";
const TASKS_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;
const DEFAULT_RVM_MODEL = "assets/models/rvm-tfjs/model.json";

// Alpha-matte edge choke (0–1): RVM alpha below this is forced to 0 and the
// remaining range is rescaled to 0..1. This trims the faint translucent rim that
// otherwise bleeds the real background through as a light halo. Higher = tighter
// edge / less halo but eats fine hair — dark hair against a dark background is
// exactly the low-contrast case where the model's real alpha confidence is
// already low, so a high choke clips it first. ~0.06–0.15 is the usable range;
// lower it (CONFIG.LOCAL.ALPHA_EDGE_LO) if hair is disappearing, raise it if you
// see background bleeding through as a halo around the presenter.
const ALPHA_EDGE_LO = 0.08;

// Alpha level (0-255) above which a pixel counts as "person" for connected-
// component purposes. RVM's choked alpha is exactly 0 below ALPHA_EDGE_LO, so
// 0 is the natural cut there; a small positive value also absorbs MediaPipe's
// near-zero background noise.
const BLOB_ALPHA_THRESHOLD = 8;

// Dilation radius (working-resolution px) used ONLY to decide connectivity for
// the largest-blob isolation below — bridges small gaps (e.g. a faint hair wisp
// whose alpha dips under BLOB_ALPHA_THRESHOLD for a pixel or two) so it stays
// grouped with the main body blob instead of being read as a separate island
// and dropped. The kept/dropped decision still only touches ORIGINAL alpha
// values, so this can't pull in a genuinely separate person a few px away.
const BLOB_DILATE_RADIUS = 2;

// ---- Largest-blob isolation --------------------------------------------------
// RVM/MediaPipe matte ANY person in frame, not just the presenter — if a crowd
// or bystanders are visible behind them, their alpha gets composited in too.
// The presenter is normally the closest (and so the largest) figure in frame,
// so keeping only the single largest connected alpha blob and zeroing every
// other one drops everyone else. Runs on the low-res working buffer (a few ms
// at most at the ~256-512px inference width), reusing typed-array scratch
// space across frames so it doesn't add per-frame GC pressure.
function createBlobIsolator() {
  let label = new Int32Array(0);
  let stack = new Int32Array(0);
  let fgA = new Uint8Array(0);
  let fgB = new Uint8Array(0);
  let cap = 0;
  return function isolateLargestBlob(data, w, h) {
    const n = w * h;
    if (cap !== n) {
      label = new Int32Array(n); stack = new Int32Array(n);
      fgA = new Uint8Array(n); fgB = new Uint8Array(n);
      cap = n;
    }
    for (let i = 0; i < n; i++) fgA[i] = data[i * 4 + 3] > BLOB_ALPHA_THRESHOLD ? 1 : 0;

    // Dilate the fg mask a few px so grouping tolerates small gaps. Only the
    // dilated mask is used to decide WHICH group a pixel belongs to — the
    // original (non-dilated) alpha values are what actually get kept/dropped.
    let src = fgA, dst = fgB;
    for (let it = 0; it < BLOB_DILATE_RADIUS; it++) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const i = row + x;
          let v = src[i];
          if (!v) {
            if ((x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1]) ||
                (y > 0 && src[i - w]) || (y < h - 1 && src[i + w])) v = 1;
          }
          dst[i] = v;
        }
      }
      const tmp = src; src = dst; dst = tmp;
    }
    const fgD = src; // dilated mask after the loop

    label.fill(-1);
    let numLabels = 0, bestLabel = -1, bestSize = 0;
    for (let start = 0; start < n; start++) {
      if (label[start] !== -1 || !fgD[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      label[start] = numLabels;
      let count = fgA[start]; // size = real (non-dilated) fg pixels only
      while (sp > 0) {
        const idx = stack[--sp];
        const x = idx % w, y = (idx / w) | 0;
        if (x > 0) { const ni = idx - 1; if (label[ni] === -1 && fgD[ni]) { label[ni] = numLabels; stack[sp++] = ni; count += fgA[ni]; } }
        if (x < w - 1) { const ni = idx + 1; if (label[ni] === -1 && fgD[ni]) { label[ni] = numLabels; stack[sp++] = ni; count += fgA[ni]; } }
        if (y > 0) { const ni = idx - w; if (label[ni] === -1 && fgD[ni]) { label[ni] = numLabels; stack[sp++] = ni; count += fgA[ni]; } }
        if (y < h - 1) { const ni = idx + w; if (label[ni] === -1 && fgD[ni]) { label[ni] = numLabels; stack[sp++] = ni; count += fgA[ni]; } }
      }
      if (count > bestSize) { bestSize = count; bestLabel = numLabels; }
      numLabels++;
    }
    if (numLabels <= 1) return; // nothing to isolate (0 or 1 blob already)
    for (let i = 0; i < n; i++) if (label[i] !== bestLabel) data[i * 4 + 3] = 0;
  };
}

// ---- Adaptive performance tier ----------------------------------------------
// The RVM model runs every frame of the live-preview-from-boot, so on a phone or
// an integrated-GPU laptop it pegs the GPU the whole time and the page becomes
// unusable. We auto-detect a coarse device tier and pick a lighter inference
// resolution / downsample / frame-rate for weaker hardware. Any of these can be
// overridden by an explicit NUMBER in CONFIG.LOCAL (RVM_WORKING_WIDTH /
// RVM_DOWNSAMPLE / INFERENCE_FPS); leave them "auto" (or null) to adapt.
//
// workingWidth   = RVM inference long-side px (dominant cost — ~quadratic).
// downsampleRatio= RVM internal downsample (lower = cheaper, coarser matte).
// inferenceFps   = cap on how often the model runs (display still animates at
//                  full rAF; only the person cutout refreshes at this rate).
const PERF_PRESETS = {
  low:  { workingWidth: 256, downsampleRatio: 0.4, inferenceFps: 15 }, // phones, weak tablets
  mid:  { workingWidth: 384, downsampleRatio: 0.5, inferenceFps: 24 }, // integrated-GPU laptops
  high: { workingWidth: 512, downsampleRatio: 0.6, inferenceFps: 30 }, // discrete-GPU desktops
};

let cachedTier = null;
function detectPerfTier() {
  if (cachedTier) return cachedTier;
  let tier = "mid";
  try {
    const ua = navigator.userAgent || "";
    const isMobile =
      /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)); // iPadOS reports as Mac
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4; // GB (Chromium only; undefined elsewhere)

    // Sniff the GPU renderer string to catch integrated graphics.
    let renderer = "";
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || "");
    } catch { /* ignore */ }
    const integratedGpu = /Mali|Adreno|PowerVR|Apple GPU|Intel|UHD|HD Graphics|Iris|Microsoft Basic/i.test(renderer);
    const discreteGpu = /NVIDIA|GeForce|RTX|GTX|Radeon|RX \d|AMD/i.test(renderer);

    if (isMobile || cores <= 4 || mem <= 4) tier = "low";
    else if (discreteGpu && cores >= 8 && !integratedGpu) tier = "high";
    else tier = "mid"; // integrated-GPU laptops land here
  } catch { tier = "mid"; }
  cachedTier = tier;
  console.info(`[ARVENA] performance tier: ${tier}`, PERF_PRESETS[tier]);
  return cachedTier;
}

// Merge explicit numeric overrides over the auto-detected tier preset. Treats
// "auto", null, undefined and non-positive numbers as "use the preset".
function resolvePerf({ workingWidth, downsampleRatio, maxInferenceFps } = {}) {
  const p = PERF_PRESETS[detectPerfTier()];
  const num = (v, d) => (typeof v === "number" && v > 0 ? v : d);
  return {
    workingWidth: num(workingWidth, p.workingWidth),
    downsampleRatio: num(downsampleRatio, p.downsampleRatio),
    maxInferenceFps: num(maxInferenceFps, p.inferenceFps),
  };
}

export function isSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && HTMLCanvasElement.prototype.captureStream);
}

// ---- RVM matter (TensorFlow.js / WebGL) -------------------------------------

let tfLoading = null;
function loadTf() {
  if (window.tf) return Promise.resolve(window.tf);
  if (tfLoading) return tfLoading;
  tfLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TFJS_CDN;
    s.crossOrigin = "anonymous";
    s.onload = () => (window.tf ? resolve(window.tf) : reject(new Error("TF.js loaded but no global.")));
    s.onerror = () => { tfLoading = null; reject(new Error("Couldn't load TensorFlow.js (check your connection).")); };
    document.head.appendChild(s);
  });
  return tfLoading;
}

// Cache the loaded model for the lifetime of the page so the heavy
// download/parse/GPU-upload only happens on the FIRST start, not every session.
const rvmModelCache = new Map();
function getRvmModel(tf, modelUrl) {
  if (!rvmModelCache.has(modelUrl)) {
    const p = tf.loadGraphModel(modelUrl).catch((e) => { rvmModelCache.delete(modelUrl); throw e; });
    rvmModelCache.set(modelUrl, p);
  }
  return rvmModelCache.get(modelUrl);
}

// Get a WebGL-backed tf, or throw so the caller falls back to MediaPipe (the
// TF.js CPU backend is synchronous and would freeze the page).
async function ensureWebglTf() {
  const tf = await loadTf();
  await tf.ready();
  try { await tf.setBackend("webgl"); } catch { /* ignore */ }
  await tf.ready();
  if (tf.getBackend() !== "webgl") throw new Error("WebGL backend unavailable for RVM");
  // NOTE: do NOT enable WEBGL_USE_SHAPES_UNIFORMS — it speeds cold-start compile
  // but produces wrong matte output for this RVM model (returns all-foreground).
  return tf;
}

// Run one inference to force WebGL shader compilation up front (the slow part of
// the first start). Doing it here keeps the long stall inside the explicit
// loading state instead of a black screen after going live.
async function warmupRvm(tf, model, workingWidth, downsample) {
  const ww = workingWidth, wh = Math.round((workingWidth * 9) / 16);
  const src = tf.zeros([1, wh, ww, 3]);
  const r1 = tf.tensor(0.0), r2 = tf.tensor(0.0), r3 = tf.tensor(0.0), r4 = tf.tensor(0.0);
  const t0 = performance.now();
  const outs = await model.executeAsync(
    { src, r1i: r1, r2i: r2, r3i: r3, r4i: r4, downsample_ratio: downsample },
    ["pha", "r1o", "r2o", "r3o", "r4o"],
  );
  await outs[0].data(); // block until the GPU work (and shader compile) is done
  console.info("[ARVENA] RVM warm-up (shader compile):", Math.round(performance.now() - t0), "ms");
  tf.dispose([src, r1, r2, r3, r4, ...outs]);
}

// Preload + compile the RVM model without opening the camera. Call this when the
// operator selects the offline engine so the wait overlaps with their UI use.
export async function prewarm({ workingWidth, downsampleRatio, modelUrl = DEFAULT_RVM_MODEL } = {}) {
  // Compile at the same resolution the live engine will actually run, so START
  // doesn't trigger a second shader compile.
  ({ workingWidth, downsampleRatio } = resolvePerf({ workingWidth, downsampleRatio }));
  try {
    const tf = await ensureWebglTf();
    const model = await getRvmModel(tf, modelUrl);
    const downsample = tf.tensor(downsampleRatio);
    await warmupRvm(tf, model, workingWidth, downsample);
    downsample.dispose();
  } catch (e) { console.warn("[ARVENA] RVM prewarm skipped:", e); }
}

async function createRvmMatter({ modelUrl, workingWidth, downsampleRatio, isolateLargest, alphaEdgeLo = ALPHA_EDGE_LO }) {
  const tf = await ensureWebglTf();
  const model = await getRvmModel(tf, modelUrl);
  const downsample = tf.tensor(downsampleRatio);
  await warmupRvm(tf, model, workingWidth, downsample); // precompile shaders now
  const isolateBlob = createBlobIsolator();

  // recurrent states — scalar zeros, recycled each frame (official RVM recipe)
  let r1i = tf.tensor(0.0), r2i = tf.tensor(0.0), r3i = tf.tensor(0.0), r4i = tf.tensor(0.0);

  // working canvas: video downscaled to ~workingWidth for realtime inference
  const work = document.createElement("canvas");
  const wctx = work.getContext("2d", { willReadFrequently: true });
  const matte = document.createElement("canvas");
  const mctx = matte.getContext("2d");
  // Full-res snapshot of the exact frame the matte is computed from, so the
  // person RGB and the matte stay time-aligned (no trailing edge on fast motion).
  const frame = document.createElement("canvas");
  const fctx = frame.getContext("2d");
  let ww = 0, wh = 0;
  function sizeFor(video) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.min(1, workingWidth / Math.max(vw, vh));
    const nw = Math.max(4, Math.round(vw * scale));
    const nh = Math.max(4, Math.round(vh * scale));
    if (nw !== ww || nh !== wh) {
      ww = nw; wh = nh;
      work.width = ww; work.height = wh;
      matte.width = ww; matte.height = wh;
    }
  }

  return {
    async toPersonCanvas(video, personCanvas, pctx, feather) {
      sizeFor(video);
      const pw = personCanvas.width, ph = personCanvas.height;
      wctx.drawImage(video, 0, 0, ww, wh);          // low-res copy for inference
      // Snapshot the SAME instant at full res; we composite against this (not the
      // live video) so the matte can't drift ahead of the RGB during fast motion.
      if (frame.width !== pw || frame.height !== ph) { frame.width = pw; frame.height = ph; }
      fctx.drawImage(video, 0, 0, pw, ph);

      const src = tf.tidy(() => tf.browser.fromPixels(work).expandDims(0).div(255));
      // Only the alpha matte (pha) comes from the model — the person's RGB is
      // taken from the full-res snapshot below, so the presenter stays sharp
      // instead of being upscaled from the low working resolution.
      const [pha, r1o, r2o, r3o, r4o] = await model.executeAsync(
        { src, r1i, r2i, r3i, r4i, downsample_ratio: downsample },
        ["pha", "r1o", "r2o", "r3o", "r4o"],
      );

      // pha (alpha) → white-RGB + alpha ImageData (a matte stencil only).
      // Choke the faint outer edge band: remap alpha so values below EDGE_LO go
      // to 0. That low-alpha band is where the real background bleeds through as
      // a light halo; dropping it removes the fringe while keeping hair detail
      // (the steeper gradient above EDGE_LO is preserved).
      const rgba = tf.tidy(() => {
        const a0 = pha.squeeze(0);                              // [h,w,1] 0..1
        const a = a0.sub(alphaEdgeLo).div(1 - alphaEdgeLo).clipByValue(0, 1);
        const aI = a.mul(255).cast("int32");
        const rgb = tf.fill([aI.shape[0], aI.shape[1], 3], 255, "int32");
        return tf.concat([rgb, aI], -1);
      });
      const [hh, wwx] = rgba.shape;
      const pixelData = new Uint8ClampedArray(await rgba.data());
      if (isolateLargest) isolateBlob(pixelData, wwx, hh);
      mctx.putImageData(new ImageData(pixelData, wwx, hh), 0, 0);

      // Scale the soft matte up, then paint the time-aligned full-res snapshot
      // through it (source-in) so the presenter keeps native webcam resolution.
      pctx.save();
      pctx.clearRect(0, 0, pw, ph);
      pctx.filter = feather > 0 ? `blur(${feather}px)` : "none";
      pctx.imageSmoothingEnabled = true;
      pctx.imageSmoothingQuality = "high";
      pctx.drawImage(matte, 0, 0, pw, ph);
      pctx.filter = "none";
      pctx.globalCompositeOperation = "source-in";
      pctx.drawImage(frame, 0, 0, pw, ph);
      pctx.restore();
      pctx.globalCompositeOperation = "source-over";

      // free this frame's tensors; recycle recurrent state for the next frame
      tf.dispose([src, pha, rgba, r1i, r2i, r3i, r4i]);
      r1i = r1o; r2i = r2o; r3i = r3o; r4i = r4o;
    },
    close() {
      // Only free this session's recurrent state — keep the cached model loaded
      // so the next START is instant (no reload / shader recompile).
      try { tf.dispose([r1i, r2i, r3i, r4i, downsample]); } catch { /* ignore */ }
    },
  };
}

// ---- MediaPipe matter (fallback) --------------------------------------------

let visionLib = null;
async function loadVision() {
  if (visionLib) return visionLib;
  visionLib = await import(/* @vite-ignore */ TASKS_CDN);
  return visionLib;
}

async function createMediapipeMatter({ isolateLargest } = {}) {
  const isolateBlob = createBlobIsolator();
  const { ImageSegmenter, FilesetResolver } = await loadVision();
  const vision = await FilesetResolver.forVisionTasks(`${TASKS_CDN}/wasm`);
  const opts = {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  };
  let segmenter;
  try {
    segmenter = await ImageSegmenter.createFromOptions(vision, opts);
  } catch {
    opts.baseOptions.delegate = "CPU";
    segmenter = await ImageSegmenter.createFromOptions(vision, opts);
  }

  const maskCanvas = document.createElement("canvas");
  let maskCtx = null;
  let lastTs = -1;

  return {
    toPersonCanvas(video, personCanvas, pctx, feather) {
      return new Promise((resolve) => {
        let ts = performance.now();
        if (ts <= lastTs) ts = lastTs + 1;
        lastTs = ts;
        segmenter.segmentForVideo(video, ts, (result) => {
          const masks = result.confidenceMasks;
          const w = personCanvas.width, h = personCanvas.height;
          if (!masks || !masks.length) { result.close?.(); resolve(); return; }
          const mask = masks[0];
          const mw = mask.width, mh = mask.height;
          const data = mask.getAsFloat32Array();
          if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
            maskCanvas.width = mw; maskCanvas.height = mh;
            maskCtx = maskCanvas.getContext("2d");
          }
          const img = maskCtx.createImageData(mw, mh);
          const p = img.data;
          for (let i = 0; i < data.length; i++) {
            const j = i * 4;
            p[j] = 255; p[j + 1] = 255; p[j + 2] = 255; p[j + 3] = data[i] * 255;
          }
          if (isolateLargest) isolateBlob(p, mw, mh);
          maskCtx.putImageData(img, 0, 0);

          pctx.save();
          pctx.clearRect(0, 0, w, h);
          pctx.filter = feather > 0 ? `blur(${feather}px)` : "none";
          pctx.imageSmoothingEnabled = true;
          pctx.imageSmoothingQuality = "high";
          pctx.drawImage(maskCanvas, 0, 0, w, h);
          pctx.filter = "none";
          pctx.globalCompositeOperation = "source-in";
          pctx.drawImage(video, 0, 0, w, h);
          pctx.restore();
          pctx.globalCompositeOperation = "source-over";

          result.close?.();
          resolve();
        });
      });
    },
    close() { try { segmenter.close(); } catch { /* ignore */ } },
  };
}

// ---- scaffold ---------------------------------------------------------------

/**
 * Start local matting/segmentation + background compositing.
 *
 * @param {object} opts
 * @param {number} [opts.width]   requested camera width
 * @param {number} [opts.height]  requested camera height
 * @param {number} [opts.fps]     output framerate
 * @param {number} [opts.feather] mask edge feather in px (0 = none)
 * @param {"rvm"|"mediapipe"} [opts.engine]  matting engine (default rvm)
 * @param {number} [opts.workingWidth]    RVM inference resolution (long side)
 * @param {number} [opts.downsampleRatio] RVM internal downsample ratio
 * @param {string} [opts.modelUrl]        RVM tfjs model.json URL
 * @param {number} [opts.alphaEdgeLo]     RVM edge choke (0-1, default 0.08) —
 *   lower keeps more faint hair detail at the cost of a bit more edge halo.
 * @param {boolean} [opts.isolateLargestPerson] Keep only the single largest
 *   connected "person" blob (drops bystanders/a crowd behind the presenter
 *   that the matting model would otherwise composite in too). Default true.
 * @param {string} opts.scenarioId        initial background scenario
 * @param {(s: MediaStream)=>void} [opts.onLocalStream]  raw webcam (for the PiP)
 * @param {(e: Error)=>void} [opts.onError]
 * @returns {Promise<{ stream: MediaStream, engine: string, setBackground(id:string):void, stop():Promise<void> }>}
 */
export async function startSegmentation(opts) {
  const {
    width = 1280, height = 720, fps = 30, scenarioId, onLocalStream, onError,
    engine = "rvm", modelUrl = DEFAULT_RVM_MODEL,
    // Output frame size (the composited canvas / recording). Defaults to the
    // capture size, but can differ — e.g. a PORTRAIT 1080×1920 output composited
    // from a landscape webcam capture. presenterFit: "contain" = fit the whole
    // presenter (letterbox, never cropped) | "cover" = fill the frame (crop sides).
    // presenterScale: extra zoom on the presenter — 1 = as fit, <1 pulls back
    // (e.g. 0.8 = 20% smaller, less zoomed, shows more of them + background).
    outWidth, outHeight, presenterFit = "contain", presenterScale = 1,
    isolateLargestPerson = true, alphaEdgeLo,
  } = opts;
  if (!isSupported()) throw new Error("This browser can't run local segmentation.");

  // Resolve inference resolution / downsample / rate from the device tier, unless
  // config passed explicit numeric overrides. This is what keeps weak GPUs usable.
  const { workingWidth, downsampleRatio, maxInferenceFps } = resolvePerf({
    workingWidth: opts.workingWidth,
    downsampleRatio: opts.downsampleRatio,
    maxInferenceFps: opts.maxInferenceFps,
  });

  // 1) camera
  let camStream;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      // `ideal` (not exact) so the browser hands back the camera's best mode at
      // or near this size instead of failing on webcams that can't hit it.
      video: {
        width: { ideal: width }, height: { ideal: height },
        frameRate: { ideal: fps }, facingMode: "user",
      },
      audio: false,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      throw new Error("Camera permission denied. Allow camera access and reload.");
    }
    throw new Error("Could not access camera: " + (err?.message || err));
  }
  onLocalStream?.(camStream);

  const video = document.createElement("video");
  video.srcObject = camStream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  // Camera native size (often 4:3) vs. output frame size (configured 16:9). The
  // background fills the full output frame so it's full-bleed (no black bars on a
  // matching display); the presenter is composited *fit* inside, preserving the
  // camera aspect ratio so they're never stretched or cropped.
  const camW = video.videoWidth || width;
  const camH = video.videoHeight || height;
  const outW = outWidth || width;
  const outH = outHeight || height;
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");

  // RVM's matte is already soft; the alpha choke (ALPHA_EDGE_LO) handles the
  // edge, so no feather by default (feather would re-widen the translucent rim
  // and bring the halo back). MediaPipe's hard mask still wants a touch.
  const feather = opts.feather ?? (engine === "rvm" ? 0 : Math.max(1, Math.round(camH * 0.004)));

  const personCanvas = document.createElement("canvas");
  personCanvas.width = camW;
  personCanvas.height = camH;
  const pctx = personCanvas.getContext("2d");

  // Fit the presenter inside the output frame (centered). "contain" = letterbox
  // (whole presenter, never cropped); "cover" = fill the frame (crop overflow —
  // useful in portrait so a landscape webcam capture fills the tall frame).
  const fitFn = presenterFit === "cover" ? Math.max : Math.min;
  const fitScale = fitFn(outW / camW, outH / camH) * (presenterScale || 1);
  const fitW = Math.round(camW * fitScale);
  const fitH = Math.round(camH * fitScale);
  const fitX = Math.round((outW - fitW) / 2);
  const fitY = Math.round((outH - fitH) / 2);

  // 2) background painter
  let bg = createBackground(getScenario(scenarioId));

  // 3) matter — RVM with automatic MediaPipe fallback
  let matter;
  let activeEngine = engine;
  if (engine === "rvm") {
    try {
      console.info("[ARVENA] starting RVM (TF.js / WebGL) matting engine…");
      matter = await createRvmMatter({ modelUrl, workingWidth, downsampleRatio, isolateLargest: isolateLargestPerson, alphaEdgeLo: typeof alphaEdgeLo === "number" ? alphaEdgeLo : undefined });
      console.info("[ARVENA] RVM ready (TF.js / WebGL).");
    } catch (err) {
      console.warn("[ARVENA] RVM unavailable, falling back to MediaPipe:", err);
      activeEngine = "mediapipe";
      matter = await createMediapipeMatter({ isolateLargest: isolateLargestPerson });
      console.info("[ARVENA] MediaPipe segmenter ready.");
    }
  } else {
    matter = await createMediapipeMatter({ isolateLargest: isolateLargestPerson });
  }

  // 4) frame pump
  // Inference (the GPU-heavy matte) is capped to maxInferenceFps; the background
  // still animates and composites every rAF, and the LAST person cutout is reused
  // between inferences. This decouples display smoothness from model cost, so a
  // weak GPU runs the model far less often instead of pegging at 100%.
  const minInferenceMs = maxInferenceFps > 0 ? 1000 / maxInferenceFps : 0;
  const start = performance.now();
  let running = true;
  let raf = 0;
  let lastInference = -Infinity;
  let haveMatte = false;
  let inferring = false;
  async function pump() {
    if (!running) return;
    if (video.readyState >= 2) {
      try {
        const now = performance.now();
        // Run the model only when it's time AND a previous inference isn't still
        // in flight (each inference is async; never queue a second one).
        if (!inferring && (!haveMatte || now - lastInference >= minInferenceMs)) {
          inferring = true;
          lastInference = now; // measure period start-to-start = true fps cap
          matter.toPersonCanvas(video, personCanvas, pctx, feather)
            .then(() => { haveMatte = true; })
            .catch((err) => onError?.(err))
            .finally(() => { inferring = false; });
        }
        if (!running) return;
        ctx.clearRect(0, 0, outW, outH);
        bg.draw(ctx, outW, outH, performance.now() - start);   // full-bleed background
        if (haveMatte) ctx.drawImage(personCanvas, fitX, fitY, fitW, fitH); // last presenter cutout
      } catch (err) { onError?.(err); }
    }
    raf = requestAnimationFrame(pump);
  }
  pump();

  const outStream = canvas.captureStream(fps);

  return {
    stream: outStream,
    engine: activeEngine,
    setBackground(id) { bg.stop?.(); bg = createBackground(getScenario(id)); },
    async stop() {
      running = false;
      cancelAnimationFrame(raf);
      bg.stop?.();
      try { matter.close(); } catch { /* ignore */ }
      camStream.getTracks().forEach((t) => t.stop());
      outStream.getTracks().forEach((t) => t.stop());
    },
  };
}
