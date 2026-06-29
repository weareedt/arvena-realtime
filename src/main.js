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

async function goLive() {
  if (state.status !== "idle") return;
  // Offline is the only engine surfaced in the UI now. (goLiveDecart is retained
  // for future re-enablement but is no longer reachable from the controls.)
  return goLiveLocal();
}

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

// Offline engine: local segmentation + procedural background. No Decart, no
// per-second cost, no credential, no tight time cap.
async function goLiveLocal() {
  state.status = "connecting";
  ui.setStatus("Loading segmentation model…");
  ui.els.goLive.disabled = true;
  stopPreview(); // free the camera for the segmentation capture

  const scenario = getScenario(state.scenarioId);
  ui.setLoading(true, "LOADING SEGMENTATION MODEL");
  try {
    // Lazy-load the segmentation engine so its CDN deps can never break app boot.
    const { startSegmentation } = await import("./segment.js");
    state.local = await startSegmentation({
      width: CONFIG.LOCAL?.WIDTH,
      height: CONFIG.LOCAL?.HEIGHT,
      fps: CONFIG.LOCAL?.FPS,
      feather: CONFIG.LOCAL?.EDGE_FEATHER_PX,
      engine: CONFIG.LOCAL?.SEG_ENGINE,
      workingWidth: CONFIG.LOCAL?.RVM_WORKING_WIDTH,
      downsampleRatio: CONFIG.LOCAL?.RVM_DOWNSAMPLE,
      scenarioId: state.scenarioId,
      onLocalStream: ui.showLocalStream,
      onError: (err) => ui.setStatus("Error: " + (err?.message || err), "error"),
    });
    ui.setLoading(false);
    ui.showRemoteStream(state.local.stream);

    state.status = "live";
    ui.setLive(true, CONFIG.SHOW_SIMULATED_BADGE);
    const tag = state.local.engine === "rvm" ? "RVM" : "segmentation";
    ui.setStatus(`● LIVE (offline · free · ${tag}) — ` + scenario.label, "live");
    if (CONFIG.AUTO_RECORD) startAutoRecord();

    // No cost ticks — offline generation is free. Only enforce a cap if set.
    state.guards = createGuards({
      maxSeconds: CONFIG.LOCAL?.MAX_SESSION_SECONDS ?? 0,
      idleSeconds: 0,
      onMaxReached: () => endSession("Session time cap reached"),
    });
    state.guards.start();
  } catch (err) {
    ui.setLoading(false);
    ui.setStatus(err?.message || String(err), "error");
    teardown();
  }
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
  usage.endSession();
  startPreview(false); // restore the raw webcam without clobbering the end/saved message
}

// ---- live controls ----------------------------------------------------------

async function applyScenario(id) {
  state.scenarioId = id;
  ui.setActiveScenario(id);
  bump();
  const scenario = getScenario(id);
  if (state.status === "live" && state.rt) {
    ui.setStatus("● LIVE — " + scenario.label, "live");
    await state.rt.setPrompt(scenario.prompt, scenario.enhance);
  } else if (state.status === "live" && state.local) {
    ui.setStatus("● LIVE (offline · free) — " + scenario.label, "live");
    state.local.setBackground(id);
  }
}

// Warm up the offline matting model at boot so the first START is instant
// (downloads the model + compiles WebGL shaders while the operator gets ready).
function prewarmOffline() {
  if ((CONFIG.LOCAL?.SEG_ENGINE ?? "rvm") !== "rvm") return;
  import("./segment.js")
    .then((m) => m.prewarm({
      workingWidth: CONFIG.LOCAL?.RVM_WORKING_WIDTH,
      downsampleRatio: CONFIG.LOCAL?.RVM_DOWNSAMPLE,
    }))
    .catch(() => { /* prewarm is best-effort */ });
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
  try {
    ui.setStatus("Converting to MP4… 0%");
    const out = await mp4.toMp4(blob, (p) => ui.setStatus(`Converting to MP4… ${Math.round(p * 100)}%`));
    recorder.download(out, name);
    ui.setStatus("✓ MP4 saved to Downloads", "ok");
  } catch (err) {
    recorder.download(blob, name);
    ui.setStatus("Saved as WebM (MP4 conversion unavailable)", "error");
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
  ui.renderScenarios(state.scenarioId, applyScenario);
  ui.setLive(false, CONFIG.SHOW_SIMULATED_BADGE);
  usage.init();
  prewarmOffline(); // auto-load the offline model from start

  ui.els.goLive.addEventListener("click", goLive);
  ui.els.endSession.addEventListener("click", () => endSession("Session ended"));
  ui.els.devToggle.addEventListener("click", usage.toggle);
  ui.els.fullscreenBtn?.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreenLabel);
  ui.els.uiToggle?.addEventListener("click", toggleUI);
  // `H` toggles the clean view (ignore when typing in a field).
  window.addEventListener("keydown", (e) => {
    if ((e.key === "h" || e.key === "H") && !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName)) toggleUI();
  });
  ui.els.pipPlaceholder.addEventListener("click", startPreview);

  // End the session cleanly if the tab closes (stop burning generated seconds).
  window.addEventListener("beforeunload", () => { state.rt?.stop?.(); });

  startPreview(); // show the raw webcam straight away
}

init();
