// Video-database dashboard for ARVENA.
//
// The "video database" is Supabase Storage only (bucket ArvenaLapor, public) —
// there is no Postgres table. Every clip lives at  YYYY-MM/arvena-{scenario}-{ts}.mp4
// (see recBaseName() in main.js + uploadSupabase() in upload.js), so the filename
// IS the metadata. This page lists every object grouped by month, previews it,
// offers download / QR / copy-URL, sums storage used, and — for an admin who
// enters the password — prunes clips via the /api/videos-delete serverless fn.
//
// Browse/preview/download/stats use the client-safe anon key (needs a SELECT list
// policy on the bucket). Delete NEVER uses a client key: it POSTs to the server,
// which holds the service-role key.

import { CONFIG } from "../config.js";
import { SCENARIOS } from "./scenarios.js";
import { renderQR } from "./qr.js";

const S = CONFIG.STORAGE || {};
const BASE = (S.SUPABASE_URL || "").replace(/\/+$/, "");
const BUCKET = S.BUCKET;
const ANON = S.SUPABASE_ANON_KEY;

const FREE_TIER_BYTES = 1024 * 1024 * 1024; // ~1GB Supabase free tier
const LABELS = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.label]));

// ---- DOM refs ---------------------------------------------------------------
const els = {
  summary: document.getElementById("summary"),
  months: document.getElementById("months"),
  status: document.getElementById("status"),
  adminBtn: document.getElementById("admin-btn"),
  refreshBtn: document.getElementById("refresh-btn"),
  bulkbar: document.getElementById("bulkbar"),
  bulkCount: document.getElementById("bulk-count"),
  bulkDelete: document.getElementById("bulk-delete"),
  qrModal: document.getElementById("qr-modal"),
  qrCanvas: document.getElementById("qr-canvas"),
  qrUrl: document.getElementById("qr-url"),
  qrClose: document.getElementById("qr-close"),
};

let adminPassword = sessionStorage.getItem("arvena_admin_pw") || "";
let allClips = []; // flat list: { path, name, size, updatedAt, scenario, when }
const selected = new Set();

// ---- Supabase Storage list --------------------------------------------------

/** POST to the Storage list endpoint for one prefix (folder). */
async function listPrefix(prefix, limit = 100, offset = 0) {
  const r = await fetch(`${BASE}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prefix,
      limit,
      offset,
      sortBy: { column: "name", order: "desc" },
    }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`List failed (${r.status}). ${txt}`.trim());
  }
  return r.json();
}

/** List every clip: discover YYYY-MM folders at the root, then page each one. */
async function listAllClips() {
  const root = await listPrefix("", 1000, 0);
  // Folders come back as entries with a null `id` (no metadata); files have metadata.
  const months = root
    .filter((e) => e && e.name && !e.metadata)
    .map((e) => e.name)
    .filter((n) => /^\d{4}-\d{2}$/.test(n))
    .sort()
    .reverse();

  const clips = [];
  for (const month of months) {
    let offset = 0;
    // Page through the month in case it holds more than one list page.
    for (;;) {
      const page = await listPrefix(`${month}/`, 100, offset);
      const files = page.filter((e) => e && e.metadata && e.name.endsWith(".mp4"));
      for (const f of files) {
        const path = `${month}/${f.name}`;
        clips.push({
          path,
          name: f.name,
          size: Number(f.metadata?.size ?? 0),
          updatedAt: f.updated_at || f.created_at || null,
          ...parseName(f.name),
          month,
        });
      }
      if (page.length < 100) break;
      offset += 100;
    }
  }
  return clips;
}

// ---- Filename parsing (arvena-{scenario}-{YYYY-MM-DD-HH-MM-SS}.mp4) ----------

function parseName(filename) {
  const stem = filename.replace(/\.mp4$/i, "");
  const m = stem.match(/^arvena-(.+)-(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})$/);
  if (!m) return { scenario: null, when: null };
  const [, scenario, ts] = m;
  // ts = YYYY-MM-DD-HH-MM-SS in UTC (recBaseName() uses Date.toISOString()).
  // Parse as UTC so fmtWhen()'s toLocaleString shows the viewer's local time.
  const [Y, Mo, D, h, mi, s] = ts.split("-").map(Number);
  const when = new Date(Date.UTC(Y, Mo - 1, D, h, mi, s));
  return { scenario, when: isNaN(when) ? null : when };
}

// ---- URL / formatting helpers ----------------------------------------------

const publicUrl = (path) =>
  `${BASE}/storage/v1/object/public/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;

function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function fmtWhen(d) {
  if (!d) return "";
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ---- Rendering --------------------------------------------------------------

function renderSummary() {
  // Storage usage is admin-only — hidden until the admin password is entered.
  if (!adminPassword) {
    els.summary.style.display = "none";
    els.summary.innerHTML = "";
    return;
  }
  els.summary.style.display = "flex";
  const count = allClips.length;
  const total = allClips.reduce((sum, c) => sum + c.size, 0);
  const pct = Math.min(100, (total / FREE_TIER_BYTES) * 100);
  const near = pct >= 80;
  els.summary.innerHTML = `
    <div class="stat"><span class="stat-num">${count}</span><span class="stat-lbl">clips</span></div>
    <div class="stat"><span class="stat-num">${fmtBytes(total)}</span><span class="stat-lbl">used</span></div>
    <div class="usage">
      <div class="usage-track"><div class="usage-fill${near ? " warn" : ""}" style="width:${pct.toFixed(1)}%"></div></div>
      <span class="usage-lbl">${pct.toFixed(1)}% of ~1&nbsp;GB free tier</span>
    </div>`;
}

function renderMonths() {
  els.months.innerHTML = "";
  if (!allClips.length) {
    els.months.innerHTML = `<p class="empty">No clips found in the bucket yet.</p>`;
    return;
  }
  // Group by month (allClips is already newest-first per month).
  const byMonth = new Map();
  for (const c of allClips) {
    if (!byMonth.has(c.month)) byMonth.set(c.month, []);
    byMonth.get(c.month).push(c);
  }
  for (const [month, clips] of byMonth) {
    const section = document.createElement("section");
    section.className = "month";
    const monthBytes = clips.reduce((s, c) => s + c.size, 0);
    section.innerHTML = `
      <h2 class="month-title">${month}
        <span class="month-meta">${clips.length} clips · ${fmtBytes(monthBytes)}</span>
      </h2>
      <div class="grid"></div>`;
    const grid = section.querySelector(".grid");
    clips.forEach((c) => grid.appendChild(renderCard(c)));
    els.months.appendChild(section);
  }
  observeLazyVideos();
}

function renderCard(clip) {
  const url = publicUrl(clip.path);
  const label = clip.scenario ? (LABELS[clip.scenario] || clip.scenario) : "—";
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.path = clip.path;
  // Admin-only controls (select checkbox + DELETE) are omitted entirely — not
  // just hidden — until the admin password is entered.
  const pick = adminPassword
    ? `<label class="pick"><input type="checkbox" class="pick-box" ${selected.has(clip.path) ? "checked" : ""}></label>`
    : "";
  const del = adminPassword
    ? `<button class="btn del-btn" data-path="${clip.path}">DELETE</button>`
    : "";
  card.innerHTML = `
    ${pick}
    <div class="thumb">
      <video preload="none" muted playsinline data-src="${url}#t=0.1"></video>
    </div>
    <div class="card-body">
      <div class="card-meta">
        <span class="chip">${label}</span>
        <span class="when">${fmtWhen(clip.when)}</span>
      </div>
      <div class="card-size">${fmtBytes(clip.size)}</div>
      <div class="card-actions">
        <button class="btn dl dl-btn" data-url="${url}" data-name="${clip.name}">DOWNLOAD</button>
        <button class="btn qr-btn" data-url="${url}">QR</button>
        <button class="btn copy-btn" data-url="${url}">COPY URL</button>
        ${del}
      </div>
    </div>`;
  return card;
}

// Load a clip's video (and enable controls) only once it scrolls into view.
let io = null;
function observeLazyVideos() {
  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const v = e.target;
      if (v.dataset.src && !v.src) {
        v.src = v.dataset.src;
        v.preload = "metadata";
        v.controls = true;
      }
      io.unobserve(v);
    }
  }, { rootMargin: "200px" });
  document.querySelectorAll(".thumb video").forEach((v) => io.observe(v));
}

// ---- QR modal ---------------------------------------------------------------

async function openQr(url) {
  els.qrUrl.textContent = url;
  els.qrModal.hidden = false;
  await renderQR(els.qrCanvas, url, 240);
}
function closeQr() { els.qrModal.hidden = true; }

// ---- Admin / delete ---------------------------------------------------------

function refreshAdminUi() {
  const on = !!adminPassword;
  els.adminBtn.textContent = on ? "ADMIN: ON" : "ADMIN";
  els.adminBtn.classList.toggle("on", on);
  document.body.classList.toggle("admin", on);
  els.bulkbar.hidden = !on || selected.size === 0;
}

function toggleAdmin() {
  if (adminPassword) {
    adminPassword = "";
    sessionStorage.removeItem("arvena_admin_pw");
    selected.clear();
  } else {
    const pw = window.prompt("Enter admin password to enable delete:");
    if (!pw) return;
    adminPassword = pw;
    sessionStorage.setItem("arvena_admin_pw", pw);
  }
  refreshAdminUi();
  renderSummary();  // show/hide storage usage with admin state
  renderMonths();   // re-render to show/hide delete controls
}

async function deletePaths(paths) {
  const r = await fetch("/api/videos-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword, paths }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) {
      // Bad password — drop it so the operator is re-prompted next time.
      adminPassword = "";
      sessionStorage.removeItem("arvena_admin_pw");
      refreshAdminUi();
    }
    throw new Error(data.error || `Delete failed (${r.status}).`);
  }
  return data.deleted || paths;
}

function removeFromState(paths) {
  const gone = new Set(paths);
  allClips = allClips.filter((c) => !gone.has(c.path));
  paths.forEach((p) => selected.delete(p));
}

async function onDeleteOne(path) {
  const clip = allClips.find((c) => c.path === path);
  if (!window.confirm(`Delete this clip?\n\n${clip?.name || path}\n\nThis cannot be undone.`)) return;
  setStatus("Deleting…");
  try {
    await deletePaths([path]);
    removeFromState([path]);
    renderSummary();
    renderMonths();
    setStatus("Deleted 1 clip.");
  } catch (e) {
    setStatus(e.message, true);
  }
}

async function onBulkDelete() {
  const paths = [...selected];
  if (!paths.length) return;
  if (!window.confirm(`Delete ${paths.length} selected clip(s)? This cannot be undone.`)) return;
  setStatus(`Deleting ${paths.length}…`);
  try {
    const deleted = await deletePaths(paths);
    removeFromState(deleted);
    refreshAdminUi();
    renderSummary();
    renderMonths();
    setStatus(`Deleted ${deleted.length} clip(s).`);
  } catch (e) {
    setStatus(e.message, true);
  }
}

// ---- Status + events --------------------------------------------------------

function setStatus(msg, isError = false) {
  els.status.textContent = msg || "";
  els.status.classList.toggle("error", isError);
}

// Fetch the object as a blob and save it — the `download` attribute is ignored
// for cross-origin URLs (Supabase is a different origin), so a plain link would
// just open the MP4 instead of downloading it.
async function downloadClip(btn) {
  const { url, name } = btn.dataset;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
  } catch (e) {
    // Fall back to opening the public URL in a new tab.
    window.open(url, "_blank", "noopener");
    setStatus(`Download fell back to opening in a tab (${e.message}).`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// Event delegation for the (re-rendered) card grid.
els.months.addEventListener("click", (e) => {
  const dl = e.target.closest(".dl-btn");
  if (dl) return void downloadClip(dl);

  const qr = e.target.closest(".qr-btn");
  if (qr) return void openQr(qr.dataset.url);

  const copy = e.target.closest(".copy-btn");
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.url).then(
      () => { copy.textContent = "COPIED"; setTimeout(() => (copy.textContent = "COPY URL"), 1200); },
      () => setStatus("Clipboard blocked by browser.", true),
    );
    return;
  }

  const del = e.target.closest(".del-btn");
  if (del) return void onDeleteOne(del.dataset.path);
});

els.months.addEventListener("change", (e) => {
  const box = e.target.closest(".pick-box");
  if (!box) return;
  const path = box.closest(".card")?.dataset.path;
  if (!path) return;
  if (box.checked) selected.add(path);
  else selected.delete(path);
  els.bulkCount.textContent = String(selected.size);
  els.bulkbar.hidden = selected.size === 0;
});

els.adminBtn.addEventListener("click", toggleAdmin);
els.refreshBtn.addEventListener("click", load);
els.bulkDelete.addEventListener("click", onBulkDelete);
els.qrClose.addEventListener("click", closeQr);
els.qrModal.addEventListener("click", (e) => { if (e.target === els.qrModal) closeQr(); });

// ---- Boot -------------------------------------------------------------------

function configured() {
  const set = (v) => !!v && !/YOUR_/.test(v);
  return set(BASE) && set(ANON) && !!BUCKET;
}

async function load() {
  if (!configured()) {
    setStatus("Storage is not configured — set CONFIG.STORAGE (SUPABASE_URL / anon key / bucket) in config.js.", true);
    return;
  }
  setStatus("Loading clips…");
  els.refreshBtn.disabled = true;
  try {
    allClips = await listAllClips();
    renderSummary();
    renderMonths();
    setStatus("");
  } catch (e) {
    setStatus(`${e.message} — a SELECT (list) policy on the bucket may be missing.`, true);
  } finally {
    els.refreshBtn.disabled = false;
  }
}

refreshAdminUi();
load();
