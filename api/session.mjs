// Serverless session endpoint (Vercel Node function).
// THE ONE RULE (plan §3): DECART_API_KEY lives here, server-side, and must
// never reach the browser. The browser POSTs here and gets back a connection
// credential for client.realtime.connect().
//
// ── Verify before public launch (plan open Q#1) ──────────────────────────────
// Confirm whether Decart supports minting a SHORT-LIVED, SCOPED session token
// from the API key. If it does, call that here and return ONLY the token — the
// raw key never leaves the server. Until that's confirmed, this returns the key
// itself, which is acceptable ONLY for a gated/local/demo deployment, NOT a
// public launch. Swapping to real tokens is a one-line change (see mintToken()).
//
// Interim hardening already applied here: method + origin gate, and a coarse
// in-memory per-IP rate limit. Add real auth + per-user usage caps for prod.

const WINDOW_MS = 60_000;     // rate-limit window
const MAX_PER_WINDOW = 12;    // requests/IP/window
const hits = new Map();       // ip -> { count, resetAt }  (resets on cold start)

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

function originAllowed(req) {
  // Allow same-origin (no Origin header on same-origin POST in some browsers)
  // and any host listed in ALLOWED_ORIGINS (comma-separated). Empty = allow all
  // (fine for local dev; set it in production).
  const allow = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  return allow.includes(origin);
}

/**
 * Mint the credential to hand the browser.
 * TODO(verify): replace with a real Decart ephemeral-token mint when available.
 *   e.g. const r = await fetch("https://api.decart.ai/v1/session-tokens", {
 *          method:"POST", headers:{ Authorization:`Bearer ${key}` } });
 *        return (await r.json()).token;
 */
async function mintCredential(key) {
  return key;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!originAllowed(req)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many session requests. Slow down." });
  }

  const key = process.env.DECART_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: "Server misconfigured: DECART_API_KEY is not set. " +
             "Set it as an env var (locally in .env for `vercel dev`).",
    });
  }

  try {
    const credential = await mintCredential(key);
    // No caching of credentials anywhere.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ credential });
  } catch (err) {
    return res.status(502).json({ error: "Failed to mint session credential." });
  }
}
