// App orchestrator: idle → connecting → live → idle.
// One preview box shows the raw webcam when idle, the Decart edited feed when live.
import { CONFIG } from "../config.js";
import { startRealtime } from "./decart.js";
import { fetchCredential, createGuards } from "./session.js";
import { getScenario, DEFAULT_SCENARIO_ID } from "./scenarios.js";
import * as ui from "./ui.js";
import * as usage from "./usage.js";
import * as recorder from "./recorder.js";
import * as mp4 from "./mp4.js";
import * as upload from "./upload.js";

const state = {
  status: "idle",        // idle | connecting | live
  engine: CONFIG.DEFAULT_ENGINE || "decart", // decart (paid live AI) | local (free)
  scenarioId: CONFIG.DEFAULT_SCENARIO || DEFAULT_SCENARIO_ID,
  mode: "restyle",       // restyle (lucy-restyle-2)
  rt: null,              // active Decart realtime handle
  local: null,           // active offline segmentation handle
  guards: null,
  previewStream: null,   // raw webcam shown while idle
  connectStartedAt: 0,
};

function modelIdForMode(mode) {
  return mode === "restyle" ? CONFIG.MODELS.restyle : CONFIG.MODELS.edit;
}

// ---- orientation ------------------------------------------------------------
// CONFIG.LOCAL.ORIENTATION: "portrait" | "landscape" forces that orientation;
// anything else (e.g. "auto") AUTO-DETECTS from the window and flips the whole
// pipeline (output/recording size, presenter fit, on-screen fill, which assets
// load) live when you cross portrait↔landscape. Explicit LOCAL.OUT_WIDTH/
// OUT_HEIGHT/PRESENTER_FIT still override the derived values.
const CAP_W = CONFIG.LOCAL?.WIDTH ?? 1920;
const CAP_H = CONFIG.LOCAL?.HEIGHT ?? 1080;
const PRESENTER_SCALE = CONFIG.LOCAL?.PRESENTER_SCALE ?? 1;

function detectPortrait() {
  const cfg = (CONFIG.LOCAL?.ORIENTATION ?? "auto").toLowerCase();
  if (cfg.startsWith("p")) return true;   // forced portrait ("portrait"/"potrait")
  if (cfg.startsWith("l")) return false;  // forced landscape
  return window.matchMedia("(orientation: portrait)").matches; // auto
}

// Output frame + presenter fit for the current orientation.
function orientationView() {
  const isPortrait = detectPortrait();
  const outW = CONFIG.LOCAL?.OUT_WIDTH ?? (isPortrait ? Math.min(CAP_W, CAP_H) : Math.max(CAP_W, CAP_H));
  const outH = CONFIG.LOCAL?.OUT_HEIGHT ?? (isPortrait ? Math.max(CAP_W, CAP_H) : Math.min(CAP_W, CAP_H));
  const presenterFit = CONFIG.LOCAL?.PRESENTER_FIT ?? (isPortrait ? "cover" : "contain");
  return { isPortrait, outW, outH, presenterFit };
}

let lastPortrait = null;      // to detect actual portrait↔landscape flips
let pendingReorient = false;  // orientation changed mid-recording → apply on stop

function applyOrientationClass() {
  const isPortrait = detectPortrait();
  document.body.classList.toggle("portrait", isPortrait);
  return isPortrait;
}

// Rebuild the scene at the new orientation's dimensions (skips during recording
// so a rotation can't interrupt a take — it's applied when recording stops).
async function onOrientationChange() {
  const isPortrait = applyOrientationClass();
  if (isPortrait === lastPortrait) return; // same orientation → nothing to rebuild
  lastPortrait = isPortrait;
  if (state.status === "recording") { pendingReorient = true; return; }
  if (state.local && state.status === "scene") await restartScene();
}

async function restartScene() {
  try { await state.local?.stop(); } catch { /* ignore */ }
  state.local = null;
  state.status = "idle";
  await startScene();
}

function bump() { state.guards?.bump(); }

// ---- raw preview (idle) -----------------------------------------------------

async function startPreview(announce = true) {
  if (state.status !== "idle" || state.previewStream) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    ui.setStatus("Camera needs a secure context (https or localhost).", "error");
    return;
  }
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" }, audio: false,
    });
    if (state.status !== "idle") { s.getTracks().forEach((t) => t.stop()); return; }
    state.previewStream = s;
    ui.showLocalStream(s);
    if (announce) ui.setStatus("Camera ready — press START", "ok");
  } catch (err) {
    const denied = err?.name === "NotAllowedError";
    ui.setStatus(denied ? "Camera blocked — allow it, then click the preview" : "Camera error: " + (err?.message || err), "error");
  }
}

function stopPreview() {
  if (state.previewStream) {
    state.previewStream.getTracks().forEach((t) => t.stop());
    state.previewStream = null;
  }
}

// ---- session lifecycle ------------------------------------------------------

async function goLiveDecart() {
  state.status = "connecting";
  ui.setStatus("Requesting credential…");
  ui.els.goLive.disabled = true;
  stopPreview(); // free the camera for the realtime connection

  const scenario = getScenario(state.scenarioId);
  const modelId = modelIdForMode(state.mode);

  try {
    const credential = await fetchCredential();
    ui.setStatus("Connecting to Decart…");
    state.connectStartedAt = performance.now();

    let firstFrame = true;
    state.rt = await startRealtime({
      modelId,
      credential,
      prompt: scenario.prompt,
      enhance: scenario.enhance,
      onLocalStream: ui.showLocalStream,
      onRemoteStream: (stream) => {
        ui.showRemoteStream(stream);
        if (firstFrame) {
          firstFrame = false;
          if (CONFIG.AUTO_RECORD) startAutoRecord();
        }
      },
      onError: (err) => ui.setStatus("Error: " + (err?.message || err), "error"),
      onDisconnect: (reason) => {
        if (state.status === "live") {
          ui.setStatus("Disconnected: " + (reason || "unknown"), "error");
          teardown();
        }
      },
    });

    state.status = "live";
    ui.setLive(true, CONFIG.SHOW_SIMULATED_BADGE);
    ui.setStatus("● LIVE — " + scenario.label, "live");
    usage.startSession();

    state.guards = createGuards({
      onTick: () => usage.recordTick(),
      onIdleTimeout: () => endSession("Idle timeout — session ended to save cost"),
      onMaxReached: () => endSession("Session time cap reached"),
    });
    state.guards.start();
  } catch (err) {
    ui.setStatus(err?.message || String(err), "error");
    teardown();
  }
}

// Offline engine: local segmentation + procedural background runs as a LIVE
// PREVIEW from boot — the composited scene (default flood) is on screen straight
// away, no black "OUTPUT IDLE". Recording is a separate step (START). Free, no
// per-second cost, no credential, no tight time cap.
async function startScene() {
  if (state.local || state.status === "connecting") return;
  state.status = "connecting";
  ui.setStatus("Loading segmentation model…");
  stopPreview(); // hand the camera to the segmentation capture
  ui.setLoading(true, "LOADING SEGMENTATION MODEL");
  const view = orientationView();
  lastPortrait = view.isPortrait;
  try {
    // Lazy-load the segmentation engine so its CDN deps can never break app boot.
    const { startSegmentation } = await import("./segment.js");
    state.local = await startSegmentation({
      width: CONFIG.LOCAL?.WIDTH,
      height: CONFIG.LOCAL?.HEIGHT,
      outWidth: view.outW,
      outHeight: view.outH,
      presenterFit: view.presenterFit,
      presenterScale: PRESENTER_SCALE,
      fps: CONFIG.LOCAL?.FPS,
      feather: CONFIG.LOCAL?.EDGE_FEATHER_PX,
      engine: CONFIG.LOCAL?.SEG_ENGINE,
      workingWidth: CONFIG.LOCAL?.RVM_WORKING_WIDTH,
      downsampleRatio: CONFIG.LOCAL?.RVM_DOWNSAMPLE,
      maxInferenceFps: CONFIG.LOCAL?.INFERENCE_FPS,
      isolateLargestPerson: CONFIG.LOCAL?.ISOLATE_LARGEST_PERSON,
      scenarioId: state.scenarioId,
      onLocalStream: ui.showLocalStream,
      onError: (err) => ui.setStatus("Error: " + (err?.message || err), "error"),
    });
    ui.setLoading(false);
    ui.showRemoteStream(state.local.stream);
    state.status = "scene";
    ui.setSceneReady();
    ui.setStatus(`Ready — press START to record · ${getScenario(state.scenarioId).label}`, "ok");
  } catch (err) {
    ui.setLoading(false);
    state.status = "idle";
    ui.setStatus(err?.message || String(err), "error");
    startPreview(false); // fall back to the raw webcam so the screen isn't black
  }
}

// START: begin recording the already-live composited scene and hide the chrome.
async function beginRecording() {
  if (state.status === "recording") return;
  if (!state.local) await startScene();
  if (!state.local) return; // scene failed to start (e.g. camera denied)
  state.status = "recording";
  ui.setRecordingLive(true, CONFIG.SHOW_SIMULATED_BADGE);
  ui.setCleanView(true); // hide all chrome except STOP while recording
  startRecTimer();
  if (CONFIG.AUTO_RECORD) await startAutoRecord();

  // No cost ticks — offline generation is free. Only enforce a cap if set.
  state.guards = createGuards({
    maxSeconds: CONFIG.LOCAL?.MAX_SESSION_SECONDS ?? 0,
    idleSeconds: 0,
    onMaxReached: () => stopRecording("Session time cap reached"),
  });
  state.guards.start();
}

// STOP: finish + save the recording and restore the UI, but keep the scene
// running so the operator returns to the live preview (never a black screen).
async function stopRecording(reason) {
  if (state.status !== "recording") return;
  state.guards?.stop();
  state.guards = null;
  stopRecTimer();
  state.status = "scene";
  // Restore the UI *first* so the "Converting to MP4… %" progress is visible —
  // otherwise the long transcode makes STOP look like it did nothing.
  ui.setCleanView(false);
  ui.setRecordingLive(false, CONFIG.SHOW_SIMULATED_BADGE);
  const wasRecording = recorder.isRecording();
  if (wasRecording) await saveRecording(); // sets its own "Converting…/✓ saved" status
  if (reason) ui.setStatus(reason, "ok");
  else if (!wasRecording)
    ui.setStatus(`Ready — press START to record · ${getScenario(state.scenarioId).label}`, "ok");

  // Apply an orientation flip that happened mid-recording.
  if (pendingReorient) { pendingReorient = false; await restartScene(); }
}

async function endSession(reason) {
  if (state.status === "idle") return;
  await teardown();
  ui.setStatus(reason || "Session ended", reason ? "ok" : "");
}

async function teardown() {
  // Auto-save a recording in progress so the operator never loses footage.
  if (recorder.isRecording()) {
    await saveRecording();
  }
  state.guards?.stop();
  state.guards = null;
  try { await state.rt?.stop(); } catch { /* ignore */ }
  state.rt = null;
  try { await state.local?.stop(); } catch { /* ignore */ }
  state.local = null;
  state.status = "idle";
  ui.setLive(false, CONFIG.SHOW_SIMULATED_BADGE);
  ui.setCleanView(false); // restore the full UI after STOP
  usage.endSession();
  startPreview(false); // restore the raw webcam without clobbering the end/saved message
}

// ---- live controls ----------------------------------------------------------

async function applyScenario(id) {
  state.scenarioId = id;
  ui.setActiveScenario(id);
  bump();
  const scenario = getScenario(id);
  if (state.rt) {
    // dormant Decart path
    ui.setStatus("● LIVE — " + scenario.label, "live");
    await state.rt.setPrompt(scenario.prompt, scenario.enhance);
  } else if (state.local) {
    // offline scene running (preview or recording) — swap the backplate live
    state.local.setBackground(id);
    if (state.status === "scene")
      ui.setStatus(`Ready — press START to record · ${scenario.label}`, "ok");
  }
}

// ---- recording timer (top-center) -------------------------------------------
// Counts DOWN the session cap while recording (or up if uncapped). Stops/hides
// when recording ends.
let recTimerId = 0;
function startRecTimer() {
  const cap = CONFIG.LOCAL?.MAX_SESSION_SECONDS ?? 0;
  const t0 = performance.now();
  const tick = () => {
    const elapsed = Math.floor((performance.now() - t0) / 1000);
    const s = cap > 0 ? Math.max(0, cap - elapsed) : elapsed;
    ui.setRecTimer(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
  };
  tick();
  ui.showRecTimer(true);
  recTimerId = setInterval(tick, 250);
}
function stopRecTimer() {
  if (recTimerId) { clearInterval(recTimerId); recTimerId = 0; }
  ui.showRecTimer(false);
}

// ---- recording --------------------------------------------------------------

function recBaseName() {
  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  return `arvena-${state.scenarioId}-${ts}`;
}

// Stop recording, convert to MP4, and download. Falls back to the original
// WebM if conversion fails (e.g. library can't load offline).
async function saveRecording() {
  const blob = await recorder.stop();
  ui.setRecording(false);
  if (!blob) return;
  const name = recBaseName();

  // Produce a final MP4 blob: direct MP4 (modern Chrome/Edge) needs no transcode;
  // otherwise WebM → MP4 via ffmpeg.wasm (indeterminate — WebM has no duration).
  let mp4Blob = blob;
  if (!blob.type.includes("mp4")) {
    try {
      ui.setStatus("Converting to MP4… (a few seconds)");
      mp4Blob = await mp4.toMp4(blob);
    } catch (err) {
      console.error("[ARVENA] MP4 conversion failed, saving WebM instead:", err);
      recorder.download(blob, name);
      ui.setStatus("Saved as WebM (MP4 conversion unavailable)", "error");
      return; // don't upload a mislabeled file
    }
  }

  // Keep a local copy on the kiosk machine, then offer the scan-to-download QR.
  recorder.download(mp4Blob, name);
  ui.setStatus("✓ MP4 saved to Downloads", "ok");
  await offerQrDownload(mp4Blob, name);
}

// Save the recorded clip to the user's device WITHOUT navigating the page. A
// cross-origin download link would unload the tab and kill the live camera/scene,
// so instead: on a touch device use the native share sheet (Save Video →
// Photos/Files), else a same-origin blob download (recorder.download). Both keep
// the tab alive.
async function saveClip(blob, name) {
  const preferShare = (navigator.maxTouchPoints || 0) > 0; // phones/tablets
  try {
    const file = new File([blob], `${name}.mp4`, { type: blob.type || "video/mp4" });
    if (preferShare && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") return; // user dismissed the share sheet
    // any other share failure → fall through to the blob download
  }
  recorder.download(blob, name); // same-origin blob: URL, no navigation
}

// Upload the recording to cloud storage and show a scan-to-download QR. Skipped
// entirely when storage isn't configured — the app just keeps the local copy.
let lastUpload = null; // { blob, name } for the Retry / Download buttons
async function offerQrDownload(blob, name) {
  if (!upload.isConfigured()) return;
  lastUpload = { blob, name };
  ui.showQrUploading();
  try {
    const { url } = await upload.uploadRecording(blob, name);
    await ui.showQrReady(url);
  } catch (err) {
    console.error("[ARVENA] video upload failed:", err);
    ui.showQrError();
  }
}

// Auto-start recording once the output feed has real frames (used on START).
async function startAutoRecord() {
  if (recorder.isRecording() || !recorder.isSupported()) return;
  // wait briefly for the output <video> to report real dimensions
  for (let i = 0; i < 20 && !ui.els.output.videoWidth; i++) {
    await new Promise((r) => setTimeout(r, 150));
  }
  const ok = await recorder.start(ui.els.output, {
    showBadge: CONFIG.SHOW_SIMULATED_BADGE,
    badgeText: "SIMULATED — AI GENERATED",
  });
  if (ok) {
    ui.setRecording(true);
    ui.setStatus(recorder.hasAudio() ? "● REC + LIVE" : "● REC (no mic) + LIVE", "live");
  }
}

// ---- fullscreen -------------------------------------------------------------

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    document.documentElement.requestFullscreen?.().catch((err) => {
      ui.setStatus("Fullscreen unavailable: " + (err?.message || err), "error");
    });
  }
}

function syncFullscreenLabel() {
  if (!ui.els.fullscreenBtn) return;
  ui.els.fullscreenBtn.textContent = document.fullscreenElement ? "⛶ EXIT FULL" : "⛶ FULLSCREEN";
}

// ---- clean-view toggle ------------------------------------------------------

// Hide/show the chrome (top-left text, bottom controls, camera PiP) for a clean
// simulation view. The top-right buttons stay so it can be toggled back; `H` too.
function toggleUI() {
  const hidden = document.body.classList.toggle("ui-hidden");
  if (ui.els.uiToggle) ui.els.uiToggle.textContent = hidden ? "▣ SHOW UI" : "▢ HIDE UI";
}

// ---- boot -------------------------------------------------------------------

function init() {
  lastPortrait = applyOrientationClass(); // set the initial on-screen fill
  // Auto-detect: re-evaluate orientation when the window flips or resizes.
  window.matchMedia("(orientation: portrait)").addEventListener("change", onOrientationChange);
  window.addEventListener("resize", onOrientationChange);
  ui.renderScenarios(state.scenarioId, applyScenario);
  ui.setLive(false, CONFIG.SHOW_SIMULATED_BADGE);
  ui.els.goLive.disabled = true; // armed once the scene preview is ready
  usage.init();

  ui.els.goLive.addEventListener("click", beginRecording);
  ui.els.endSession.addEventListener("click", () => stopRecording());
  ui.els.devToggle.addEventListener("click", usage.toggle);
  ui.els.fullscreenBtn?.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreenLabel);
  ui.els.uiToggle?.addEventListener("click", toggleUI);
  // `H` toggles the clean view (ignore when typing in a field).
  window.addEventListener("keydown", (e) => {
    if ((e.key === "h" || e.key === "H") && !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName)) toggleUI();
  });
  ui.els.pipPlaceholder.addEventListener("click", startPreview);

  // QR download modal controls.
  ui.els.qrClose?.addEventListener("click", ui.hideQrModal);
  ui.els.qrDownload?.addEventListener("click", () => {
    if (lastUpload) saveClip(lastUpload.blob, lastUpload.name);
  });
  ui.els.qrDone?.addEventListener("click", ui.hideQrModal);
  ui.els.qrDismiss?.addEventListener("click", ui.hideQrModal);
  ui.els.qrRetry?.addEventListener("click", () => {
    if (lastUpload) offerQrDownload(lastUpload.blob, lastUpload.name);
  });

  // Stop the camera + any recording cleanly if the tab closes.
  window.addEventListener("beforeunload", () => {
    state.rt?.stop?.();
    state.local?.stop?.();
  });

  // Boot straight into the live composited preview (default scenario = flood),
  // loading the segmentation model up front so START only has to record.
  startScene();
}

init();
