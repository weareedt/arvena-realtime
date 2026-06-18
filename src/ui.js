// Thin DOM helpers. Keeps main.js focused on flow, not element fiddling.
import { SCENARIOS } from "./scenarios.js";

export const els = {
  camIn: document.getElementById("cam-in"),
  camPlaceholder: document.getElementById("cam-placeholder"),
  arvenaOut: document.getElementById("arvena-out"),
  outPlaceholder: document.getElementById("out-placeholder"),
  simulatedBadge: document.getElementById("simulated-badge"),
  recIndicator: document.getElementById("rec-indicator"),

  statLatency: document.getElementById("stat-latency"),
  statSession: document.getElementById("stat-session"),
  statModel: document.getElementById("stat-model"),

  scenarioButtons: document.getElementById("scenario-buttons"),
  modeToggles: document.querySelectorAll(".btn-toggle"),
  promptInput: document.getElementById("prompt-input"),
  applyPrompt: document.getElementById("apply-prompt"),
  goLive: document.getElementById("go-live"),
  recordBtn: document.getElementById("record-btn"),
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

export function setActiveMode(mode) {
  els.modeToggles.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
}

export function setStatus(text, kind = "") {
  els.statusLine.textContent = text;
  els.statusLine.className = "status-line" + (kind ? " " + kind : "");
}

export function setLive(isLive, showBadge) {
  els.recIndicator.hidden = !isLive;
  els.simulatedBadge.hidden = !(isLive && showBadge);
  els.outPlaceholder.style.display = isLive ? "none" : "";
  els.goLive.disabled = isLive;
  els.endSession.disabled = !isLive;
  if (els.recordBtn) els.recordBtn.disabled = !isLive;
  if (!isLive) {
    setRecording(false);
    els.arvenaOut.srcObject = null;
    els.statLatency.textContent = "—";
  }
}

// Recording is automatic now; this only updates the (optional) record button.
export function setRecording(on) {
  if (!els.recordBtn) return;
  els.recordBtn.classList.toggle("recording", on);
  els.recordBtn.textContent = on ? "■ STOP REC" : "● RECORD";
}

export function showLocalStream(stream) {
  els.camIn.srcObject = stream;
  els.camPlaceholder.style.display = "none";
}

export function showRemoteStream(stream) {
  els.arvenaOut.srcObject = stream;
  els.outPlaceholder.style.display = "none";
}

export function setModelLabel(modelId) {
  els.statModel.textContent = modelId;
}

export function setLatency(ms) {
  els.statLatency.textContent = ms == null ? "—" : Math.round(ms);
}

export function setSessionTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, "0");
  els.statSession.textContent = `${m}:${s}`;
}
