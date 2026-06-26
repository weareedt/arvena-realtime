// Thin DOM helpers. Keeps main.js focused on flow, not element fiddling.
import { SCENARIOS } from "./scenarios.js";

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
  loadingOverlay: document.getElementById("loading-overlay"),
  loadingText: document.querySelector("#loading-overlay .loading-text"),
};

/** Full-screen darken + spinner shown while a heavy model loads. */
export function setLoading(visible, text) {
  if (!els.loadingOverlay) return;
  if (text && els.loadingText) els.loadingText.textContent = text;
  els.loadingOverlay.hidden = !visible;
}

/** Render scenario chips from the catalog. */
export function renderScenarios(activeId, onPick) {
  els.scenarioButtons.innerHTML = "";
  for (const s of SCENARIOS) {
    const btn = document.createElement("button");
    btn.className = "btn-chip" + (s.id === activeId ? " active" : "");
    btn.dataset.id = s.id;
    btn.textContent = s.label.toUpperCase();
    btn.addEventListener("click", () => onPick(s.id));
    els.scenarioButtons.appendChild(btn);
  }
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
