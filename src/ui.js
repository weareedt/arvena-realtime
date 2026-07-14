// Thin DOM helpers. Keeps main.js focused on flow, not element fiddling.
import { SCENARIOS } from "./scenarios.js";
import { renderQR } from "./qr.js";

export const els = {
  // Picture-in-picture: big = Decart output, small inset = raw camera.
  output: document.getElementById("output"),
  outputPlaceholder: document.getElementById("output-placeholder"),
  pipCam: document.getElementById("pip-cam"),
  pipPlaceholder: document.getElementById("pip-placeholder"),
  simulatedBadge: document.getElementById("simulated-badge"),
  recIndicator: document.getElementById("rec-indicator"),

  scenarioButtons: document.getElementById("scenario-buttons"),
  goLive: document.getElementById("go-live"),
  recordBtn: document.getElementById("record-btn"), // removed from DOM → null
  endSession: document.getElementById("end-session"),
  statusLine: document.getElementById("status-line"),
  devToggle: document.getElementById("dev-toggle"),
  fullscreenBtn: document.getElementById("fullscreen-btn"),
  uiToggle: document.getElementById("ui-toggle"),
  loadingOverlay: document.getElementById("loading-overlay"),
  loadingText: document.querySelector("#loading-overlay .loading-text"),
  recTimer: document.getElementById("rec-timer"),
  recTime: document.getElementById("rec-time"),

  // QR download modal
  qrModal: document.getElementById("qr-modal"),
  qrUploading: document.getElementById("qr-uploading"),
  qrReady: document.getElementById("qr-ready"),
  qrError: document.getElementById("qr-error"),
  qrCanvas: document.getElementById("qr-canvas"),
  qrClose: document.getElementById("qr-close"),
  qrDone: document.getElementById("qr-done"),
  qrRetry: document.getElementById("qr-retry"),
  qrDismiss: document.getElementById("qr-dismiss"),
};

// ---- QR download modal ------------------------------------------------------

function qrShowState(which) {
  if (!els.qrModal) return;
  els.qrModal.hidden = false;
  els.qrUploading.hidden = which !== "uploading";
  els.qrReady.hidden = which !== "ready";
  els.qrError.hidden = which !== "error";
}

/** Modal visible with an "Uploading…" spinner. */
export function showQrUploading() {
  qrShowState("uploading");
}

/** Modal showing the QR for `url` (scan-only — no link text). */
export async function showQrReady(url) {
  qrShowState("ready");
  try {
    if (els.qrCanvas) await renderQR(els.qrCanvas, url, 240);
  } catch (err) {
    console.error("[ARVENA] QR render failed:", err);
  }
}

/** Modal showing an upload error (the local copy is still saved). */
export function showQrError() {
  qrShowState("error");
}

export function hideQrModal() {
  if (els.qrModal) els.qrModal.hidden = true;
}

/** Clean recording view: hide all chrome except STOP (applied on START). */
export function setCleanView(on) {
  document.body.classList.toggle("live-recording", on);
}

/** Recording timer (top-center). */
export function setRecTimer(text) { if (els.recTime) els.recTime.textContent = text; }
export function showRecTimer(on) { if (els.recTimer) els.recTimer.hidden = !on; }

/** Full-screen darken + spinner shown while a heavy model loads. */
export function setLoading(visible, text) {
  if (!els.loadingOverlay) return;
  if (text && els.loadingText) els.loadingText.textContent = text;
  els.loadingOverlay.hidden = !visible;
}

/** Render scenario chips: `primary` scenarios in a larger top row, the rest in
 *  a smaller second row. */
export function renderScenarios(activeId, onPick) {
  els.scenarioButtons.innerHTML = "";
  const mainRow = document.createElement("div");
  mainRow.className = "scenario-row scenario-row-main";
  const secondaryRow = document.createElement("div");
  secondaryRow.className = "scenario-row scenario-row-secondary";

  for (const s of SCENARIOS) {
    const btn = document.createElement("button");
    btn.className = "btn-chip" + (s.id === activeId ? " active" : "");
    btn.dataset.id = s.id;
    btn.textContent = s.label.toUpperCase();
    btn.addEventListener("click", () => onPick(s.id));
    (s.primary ? mainRow : secondaryRow).appendChild(btn);
  }

  els.scenarioButtons.appendChild(mainRow);
  if (secondaryRow.childElementCount) els.scenarioButtons.appendChild(secondaryRow);
}

export function setActiveScenario(id) {
  els.scenarioButtons.querySelectorAll(".btn-chip").forEach((b) => {
    b.classList.toggle("active", b.dataset.id === id);
  });
}

export function setStatus(text, kind = "") {
  els.statusLine.textContent = text;
  els.statusLine.className = "status-line" + (kind ? " " + kind : "");
}

export function setLive(isLive, showBadge) {
  els.recIndicator.hidden = !isLive;
  els.simulatedBadge.hidden = !(isLive && showBadge);
  els.goLive.disabled = isLive;
  els.endSession.disabled = !isLive;
  if (els.recordBtn) els.recordBtn.disabled = !isLive;
  if (!isLive) {
    setRecording(false);
    // Clear the big output back to its placeholder; the raw-camera PiP stays on.
    els.output.srcObject = null;
    els.outputPlaceholder.style.display = "";
  }
}

// Scene preview is live (composited output visible) but not yet recording:
// START is armed, STOP idle, no ON-AIR indicator. Never touches the stream.
export function setSceneReady() {
  els.outputPlaceholder.style.display = "none";
  els.recIndicator.hidden = true;
  els.simulatedBadge.hidden = true;
  els.goLive.disabled = false;
  els.endSession.disabled = true;
}

// Toggle the recording (ON-AIR) state on top of a running scene, without
// clearing the composited output — STOP returns to the live preview, not black.
export function setRecordingLive(on, showBadge) {
  els.recIndicator.hidden = !on;
  els.simulatedBadge.hidden = !(on && showBadge);
  els.goLive.disabled = on;
  els.endSession.disabled = !on;
  if (!on) setRecording(false);
}

// Recording is automatic now; this only updates the (optional) record button.
export function setRecording(on) {
  if (!els.recordBtn) return;
  els.recordBtn.classList.toggle("recording", on);
  els.recordBtn.textContent = on ? "■ STOP REC" : "● RECORD";
}

// Raw webcam → the small PiP inset, mirrored like a viewfinder.
export function showLocalStream(stream) {
  els.pipCam.srcObject = stream;
  els.pipCam.classList.add("mirror");
  els.pipPlaceholder.style.display = "none";
}

// Decart edited feed → the big output, not mirrored.
export function showRemoteStream(stream) {
  els.output.srcObject = stream;
  els.outputPlaceholder.style.display = "none";
}
