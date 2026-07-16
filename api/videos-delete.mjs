// Serverless delete endpoint (Vercel Node function) for the video dashboard.
//
// THE ONE RULE (mirrors api/session.mjs): the Supabase SERVICE-ROLE key lives
// here, server-side, and must never reach the browser. The dashboard is a public
// gallery (browse/preview/download use the client-safe anon key), but DELETE is
// destructive, so it is gated behind an admin password and executed here with the
// service-role key — visitors can look, only an admin can prune.
//
// Env vars (set in Vercel → Settings → Environment Variables; locally in .env):
//   SUPABASE_URL               e.g. https://ljntfottlgcdnmflhiop.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  server-side secret (Supabase → Settings → API)
//   DASHBOARD_ADMIN_PASSWORD   passphrase that authorizes a delete
//   SUPABASE_BUCKET            optional; defaults to "ArvenaLapor"

import { timingSafeEqual } from "node:crypto";

const WINDOW_MS = 60_000;   // rate-limit window
const MAX_PER_WINDOW = 20;  // delete requests/IP/window
const hits = new Map();     // ip -> { count, resetAt }  (resets on cold start)

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_PER_WINDOW;
}

function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

/** Constant-time string compare that doesn't leak length via early return. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // Still run a comparison to keep timing roughly uniform, then fail.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

// Only allow deleting objects that look like our clips: "YYYY-MM/....mp4".
// Defense in depth so a stray/hostile path can't target something unexpected.
const CLIP_PATH = /^\d{4}-\d{2}\/[^/]+\.mp4$/;

async function readJsonBody(req) {
  // Vercel usually parses JSON into req.body; fall back to reading the stream.
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.length) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many delete requests. Slow down." });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminPassword = process.env.DASHBOARD_ADMIN_PASSWORD;
  const bucket = process.env.SUPABASE_BUCKET || "ArvenaLapor";

  if (!url || !serviceKey || !adminPassword) {
    return res.status(500).json({
      error: "Server misconfigured: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY " +
             "and DASHBOARD_ADMIN_PASSWORD env vars.",
    });
  }

  const body = await readJsonBody(req);
  const { password, paths } = body || {};

  if (!password || !safeEqual(password, adminPassword)) {
    return res.status(401).json({ error: "Invalid admin password." });
  }

  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: "No paths provided." });
  }
  const bad = paths.filter((p) => typeof p !== "string" || !CLIP_PATH.test(p));
  if (bad.length) {
    return res.status(400).json({ error: `Invalid clip path(s): ${bad.join(", ")}` });
  }

  const base = url.replace(/\/+$/, "");
  try {
    const r = await fetch(`${base}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: paths }),
    });

    if (!r.ok) {
      let detail = "";
      try {
        const txt = await r.text();
        try { detail = JSON.parse(txt)?.message || txt; } catch { detail = txt; }
      } catch { /* ignore */ }
      return res.status(502).json({ error: `Delete failed (${r.status}). ${detail}`.trim() });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ deleted: paths });
  } catch (err) {
    return res.status(502).json({ error: "Delete request to storage failed." });
  }
}
