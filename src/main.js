// App orchestrator: idle → connecting → live → idle.
// Wires the SCENE.EXE controls to the Decart wrapper and enforces guardrails.
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
  scenarioId: CONFIG.DEFAULT_SCENARIO || DEFAULT_SCENARIO_ID,
  mode: "restyle",       // edit (lucy-2.1) | restyle (lucy-restyle-2)
  rt: null,              // active realtime handle
  guards: null,
  connectStartedAt: 0,
};

// ---- helpers ----------------------------------------------------------------

function modelIdForMode(mode) {
  return mode === "restyle" ? CONFIG.MODELS.restyle : CONFIG.MODELS.edit;
}

function currentPromptText() {
  const typed = ui.els.promptInput.value.trim();
  if (typed) return typed;
  return getScenario(state.scenarioId).prompt;
}

function bump() { state.guards?.bump(); }

// ---- session lifecycle ------------------------------------------------------

async function goLive() {
  if (state.status !== "idle") return;
  state.status = "connecting";
  ui.setStatus("Requesting credential…");
  ui.els.goLive.disabled = true;

  const scenario = getScenario(state.scenarioId);
  const modelId = modelIdForMode(state.mode);
  ui.setModelLabel(modelId);

  try {
    const credential = await fetchCredential();
    ui.setStatus("Connecting to Decart…");
    state.connectStartedAt = performance.now();

    let firstFrame = true;
    state.rt = await startRealtime({
      modelId,
      credential,
      prompt: currentPromptText(),
      enhance: scenario.enhance,
      onLocalStream: ui.showLocalStream,
      onRemoteStream: (stream) => {
        ui.showRemoteStream(stream);
        if (firstFrame) {
          firstFrame = false;
          // Time-to-first-frame is a real, honest latency figure to surface.
          ui.setLatency(performance.now() - state.connectStartedAt);
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
      onTick: (s) => { ui.setSessionTime(s); usage.recordTick(); },
      onIdleTimeout: () => endSession("Idle timeout — session ended to save cost"),
      onMaxReached: () => endSession("Session time cap reached"),
    });
    state.guards.start();
  } catch (err) {
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
  state.status = "idle";
  ui.setLive(false, CONFIG.SHOW_SIMULATED_BADGE);
  ui.setSessionTime(0);
  usage.endSession();
}

// ---- live controls ----------------------------------------------------------

async function applyScenario(id) {
  state.scenarioId = id;
  ui.setActiveScenario(id);
  bump();
  const scenario = getScenario(id);

  // Studio = panic/reset; also clear any custom prompt so it truly resets.
  if (id === "studio") ui.els.promptInput.value = "";

  if (state.status === "live" && state.rt) {
    // Switching mode requires a reconnect (different model); otherwise just
    // swap the prompt live — the operator's main control.
    if (scenario.mode !== state.mode) {
      state.mode = scenario.mode;
      ui.setActiveMode(state.mode);
      await reconnect();
    } else {
      ui.setStatus("● LIVE — " + scenario.label, "live");
      await state.rt.setPrompt(scenario.prompt, scenario.enhance);
    }
  }
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

async function toggleRecord() {
  if (state.status !== "live") return;
  bump();
  if (recorder.isRecording()) {
    await saveRecording();
  } else {
    if (!recorder.isSupported()) {
      ui.setStatus("Recording not supported in this browser", "error");
      return;
    }
    const ok = await recorder.start(ui.els.arvenaOut, {
      showBadge: CONFIG.SHOW_SIMULATED_BADGE,
      badgeText: "SIMULATED — AI GENERATED",
    });
    if (ok) {
      ui.setRecording(true);
      ui.setStatus(recorder.hasAudio() ? "● REC + LIVE" : "● REC (no mic) + LIVE", "live");
    } else {
      ui.setStatus("Could not start recording (no output yet?)", "error");
    }
  }
}

async function applyCustomPrompt() {
  const text = ui.els.promptInput.value.trim();
  if (!text) return;
  bump();
  if (state.status === "live" && state.rt) {
    ui.setStatus("● LIVE — custom prompt", "live");
    await state.rt.setPrompt(text, true);
  }
}

async function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  ui.setActiveMode(mode);
  bump();
  if (state.status === "live") await reconnect();
}

// Reconnect with current mode/scenario/prompt (used for model switches).
async function reconnect() {
  ui.setStatus("Switching model…");
  try { await state.rt?.stop(); } catch { /* ignore */ }
  state.rt = null;
  state.status = "idle";
  state.guards?.stop();
  await goLive();
}

// ---- boot -------------------------------------------------------------------

function init() {
  ui.renderScenarios(state.scenarioId, applyScenario);
  ui.setActiveMode(state.mode);
  ui.setModelLabel(modelIdForMode(state.mode));
  ui.setLive(false, CONFIG.SHOW_SIMULATED_BADGE);
  usage.init();

  ui.els.goLive.addEventListener("click", goLive);
  ui.els.recordBtn.addEventListener("click", toggleRecord);
  ui.els.endSession.addEventListener("click", () => endSession("Session ended"));
  ui.els.applyPrompt.addEventListener("click", applyCustomPrompt);
  ui.els.promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyCustomPrompt();
  });
  ui.els.modeToggles.forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode))
  );
  ui.els.devToggle.addEventListener("click", usage.toggle);

  // End the session cleanly if the tab closes (stop burning generated seconds).
  window.addEventListener("beforeunload", () => { state.rt?.stop?.(); });

  ui.setStatus("Idle — ready");
}

init();
