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
// edge / less halo but eats fine hair; ~0.1–0.2 is a good range.
const ALPHA_EDGE_LO = 0.12;

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
export async function prewarm({ workingWidth = 512, downsampleRatio = 1.0, modelUrl = DEFAULT_RVM_MODEL } = {}) {
  try {
    const tf = await ensureWebglTf();
    const model = await getRvmModel(tf, modelUrl);
    const downsample = tf.tensor(downsampleRatio);
    await warmupRvm(tf, model, workingWidth, downsample);
    downsample.dispose();
  } catch (e) { console.warn("[ARVENA] RVM prewarm skipped:", e); }
}

async function createRvmMatter({ modelUrl, workingWidth, downsampleRatio }) {
  const tf = await ensureWebglTf();
  const model = await getRvmModel(tf, modelUrl);
  const downsample = tf.tensor(downsampleRatio);
  await warmupRvm(tf, model, workingWidth, downsample); // precompile shaders now

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
        const a = a0.sub(ALPHA_EDGE_LO).div(1 - ALPHA_EDGE_LO).clipByValue(0, 1);
        const aI = a.mul(255).cast("int32");
        const rgb = tf.fill([aI.shape[0], aI.shape[1], 3], 255, "int32");
        return tf.concat([rgb, aI], -1);
      });
      const [hh, wwx] = rgba.shape;
      const pixelData = new Uint8ClampedArray(await rgba.data());
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

async function createMediapipeMatter() {
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
 * @param {string} opts.scenarioId        initial background scenario
 * @param {(s: MediaStream)=>void} [opts.onLocalStream]  raw webcam (for the PiP)
 * @param {(e: Error)=>void} [opts.onError]
 * @returns {Promise<{ stream: MediaStream, engine: string, setBackground(id:string):void, stop():Promise<void> }>}
 */
export async function startSegmentation(opts) {
  const {
    width = 1280, height = 720, fps = 30, scenarioId, onLocalStream, onError,
    engine = "rvm", workingWidth = 512, downsampleRatio = 0.5, modelUrl = DEFAULT_RVM_MODEL,
    // Output frame size (the composited canvas / recording). Defaults to the
    // capture size, but can differ — e.g. a PORTRAIT 1080×1920 output composited
    // from a landscape webcam capture. presenterFit: "contain" = fit the whole
    // presenter (letterbox, never cropped) | "cover" = fill the frame (crop sides).
    // presenterScale: extra zoom on the presenter — 1 = as fit, <1 pulls back
    // (e.g. 0.8 = 20% smaller, less zoomed, shows more of them + background).
    outWidth, outHeight, presenterFit = "contain", presenterScale = 1,
  } = opts;
  if (!isSupported()) throw new Error("This browser can't run local segmentation.");

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
      matter = await createRvmMatter({ modelUrl, workingWidth, downsampleRatio });
      console.info("[ARVENA] RVM ready (TF.js / WebGL).");
    } catch (err) {
      console.warn("[ARVENA] RVM unavailable, falling back to MediaPipe:", err);
      activeEngine = "mediapipe";
      matter = await createMediapipeMatter();
      console.info("[ARVENA] MediaPipe segmenter ready.");
    }
  } else {
    matter = await createMediapipeMatter();
  }

  // 4) frame pump
  const start = performance.now();
  let running = true;
  let raf = 0;
  async function pump() {
    if (!running) return;
    if (video.readyState >= 2) {
      try {
        await matter.toPersonCanvas(video, personCanvas, pctx, feather);
        if (!running) return;
        ctx.clearRect(0, 0, outW, outH);
        bg.draw(ctx, outW, outH, performance.now() - start);   // full-bleed background
        ctx.drawImage(personCanvas, fitX, fitY, fitW, fitH);   // presenter, fit + centered

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
