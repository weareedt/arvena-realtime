// Pluggable cloud-storage adapter for the "scan-a-QR to download" flow.
//
// After a recording is saved locally, we ALSO upload the MP4 to public cloud
// storage and hand back a public URL, which the UI renders as a QR code for the
// person to scan and download on their phone.
//
// The browser uploads DIRECTLY to storage (not through a serverless function),
// because Vercel functions cap request bodies at ~4.5 MB and a portrait clip is
// bigger. Supabase's anon (publishable) key is designed to be client-side, so
// this is safe with a public bucket + an anon INSERT policy.
//
// Storage backend: Supabase Storage (public bucket + anon INSERT policy).

import { CONFIG } from "../config.js";

/** Whether a storage backend is configured well enough to attempt an upload. */
export function isConfigured() {
  const s = CONFIG.STORAGE;
  if (!s || !s.ENABLE_QR) return false;
  // Treat the shipped placeholders ("YOUR_…") as unconfigured so the QR flow
  // stays dormant (local download only) until real credentials are filled in.
  const set = (v) => !!v && !/YOUR_/.test(v);
  return set(s.SUPABASE_URL) && set(s.SUPABASE_ANON_KEY) && !!s.BUCKET;
}

/**
 * Upload a recorded blob and return its public URL.
 * @param {Blob} blob   the recorded MP4
 * @param {string} name base filename (no extension), e.g. "arvena-flood-2026-..."
 * @returns {Promise<{ url: string }>}
 * @throws if not configured or the upload fails (caller shows an error + retry)
 */
export async function uploadRecording(blob, name) {
  return uploadSupabase(blob, name);
}

// ---- Supabase Storage (direct browser upload) -------------------------------

async function uploadSupabase(blob, name) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } = CONFIG.STORAGE;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !BUCKET) {
    throw new Error("Supabase storage is not configured (URL / anon key / bucket).");
  }

  const base = SUPABASE_URL.replace(/\/+$/, "");
  // Group by month so the Storage console stays tidy; keep the descriptive name.
  const folder = new Date().toISOString().slice(0, 7); // YYYY-MM
  const path = `${folder}/${encodeURIComponent(name)}.mp4`;

  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": blob.type || "video/mp4",
      // No x-upsert: names are unique (timestamped), and upsert would require an
      // UPDATE policy too — a plain INSERT is all the anon policy grants.
      "cache-control": "3600",
    },
    body: blob,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const txt = await res.text(); // body can only be read once
      try { detail = JSON.parse(txt)?.message || txt; } catch { detail = txt; }
    } catch { /* ignore */ }
    throw new Error(`Upload failed (${res.status}). ${detail}`.trim());
  }

  // Public bucket → stable public URL for the object.
  const url = `${base}/storage/v1/object/public/${BUCKET}/${path}`;
  return { url };
}
