// Thin DOM helpers. Keeps main.js focused on flow, not element fiddling.
import { SCENARIOS } from "./scenarios.js";

export const els = {
  // One preview box: raw webcam before Start, Decart edited feed after.
  preview: document.getElementById("preview"),
  previewPlaceholder: document.getElementById("preview-placeholder"),
  simulatedBadge: document.getElementById("simulated-badge"),
  recIndicator: document.getElementById("rec-indicator"),

  scenarioButtons: document.getElementById("scenario-buttons"),
  goLive: document.getElementById("go-live"),
  recordBtn: document.getElementById("record-btn"), // removed from DOM → null
  endSession: document.getElementById("end-session"),
  statusLine: document.getElementById("status-line"),
  devToggle: document.getElementById("dev-toggle"),
};

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
  if (!isLive) setRecording(false);
  // Note: the raw preview is restored by main.js on idle (don't blank here).
}

// Recording is automatic now; this only updates the (optional) record button.
export function setRecording(on) {
  if (!els.recordBtn) return;
  els.recordBtn.classList.toggle("recording", on);
  els.recordBtn.textContent = on ? "■ STOP REC" : "● RECORD";
}

// Raw webcam → mirror it like a viewfinder.
export function showLocalStream(stream) {
  els.preview.srcObject = stream;
  els.preview.classList.add("mirror");
  els.previewPlaceholder.style.display = "none";
}

// Decart edited feed → not mirrored.
export function showRemoteStream(stream) {
  els.preview.srcObject = stream;
  els.preview.classList.remove("mirror");
  els.previewPlaceholder.style.display = "none";
}
