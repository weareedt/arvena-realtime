// Dev-only usage meter. Tracks GENERATED SECONDS (time a Decart session is
// actually live) and persists them in localStorage so the figure survives
// reloads. Visibility is controlled by a footer toggle button (state also
// persisted); ?dev=1 in the URL turns it on by default the first time.
//
// ⚠️ This is a LOCAL ESTIMATE for operators, not a bill. The authoritative
// usage/cost lives in the Decart dashboard (platform.decart.ai).
import { CONFIG } from "../config.js";

const KEY = "arvena_usage_v1";   // accumulated usage
const VIS_KEY = "arvena_dev_on"; // panel visibility

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { seconds: 0, sessions: 0 };
  } catch {
    return { seconds: 0, sessions: 0 };
  }
}
function save(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ }
}

let data = load();
let sessionSeconds = 0;
let visible = false;
let panelEl = null;

function initialVisible() {
  if (new URLSearchParams(location.search).has("dev")) return true;
  return localStorage.getItem(VIS_KEY) === "1";
}

function fmt(total) {
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function render() {
  if (!panelEl) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("du-session", fmt(sessionSeconds));
  set("du-total", fmt(data.seconds));
  set("du-sessions", String(data.sessions));
  const rate = CONFIG.PRICE_PER_SECOND_USD || 0;
  set("du-cost", rate > 0 ? "$" + (data.seconds * rate).toFixed(2) : "set rate in config");
}

function syncToggleBtn() {
  const btn = document.getElementById("dev-toggle");
  if (!btn) return;
  btn.classList.toggle("on", visible);
  btn.textContent = "USAGE METER · " + (visible ? "ON" : "OFF");
  btn.setAttribute("aria-pressed", String(visible));
}

function injectPanel() {
  const el = document.createElement("section");
  el.id = "dev-usage";
  el.className = "panel dev-usage";
  el.innerHTML = `
    <div class="titlebar blue">
      <span class="win-name">USAGE.DEV</span>
      <span class="dots"><i></i><i></i><i></i></span>
    </div>
    <div class="panel-body dev-body">
      <div class="dev-row"><span>This session</span><b id="du-session">0:00</b></div>
      <div class="dev-row"><span>Total generated</span><b id="du-total">0:00</b></div>
      <div class="dev-row"><span>Sessions</span><b id="du-sessions">0</b></div>
      <div class="dev-row"><span>Est. cost</span><b id="du-cost">—</b></div>
      <button id="du-reset" class="btn-secondary dev-reset">RESET METER</button>
      <p class="dev-note">Local estimate. Real bill: Decart dashboard.</p>
    </div>`;
  document.body.appendChild(el);
  el.querySelector("#du-reset").addEventListener("click", reset);
  return el;
}

// ---- public API -------------------------------------------------------------

export function setVisible(on) {
  visible = !!on;
  try { localStorage.setItem(VIS_KEY, visible ? "1" : "0"); } catch { /* ignore */ }
  if (panelEl) panelEl.style.display = visible ? "" : "none";
  syncToggleBtn();
  if (visible) render();
}

export function toggle() {
  setVisible(!visible);
}

// Called once per second while a session is live.
export function recordTick() {
  sessionSeconds += 1;
  data.seconds += 1;
  save(data);
  render();
}

export function startSession() {
  sessionSeconds = 0;
  data.sessions += 1;
  save(data);
  render();
}

export function endSession() {
  sessionSeconds = 0;
  render();
}

export function reset() {
  data = { seconds: 0, sessions: 0 };
  sessionSeconds = 0;
  save(data);
  render();
}

// Build the panel (hidden unless toggled on) and sync the footer button.
export function init() {
  panelEl = injectPanel();
  visible = initialVisible();
  panelEl.style.display = visible ? "" : "none";
  syncToggleBtn();
  render();
}
