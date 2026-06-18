// Session helpers: (1) fetch a connection credential from OUR backend so the
// Decart key never touches the browser, and (2) enforce the cost / safety
// guardrails from plan §8 (hard time cap + idle auto-disconnect).
import { CONFIG } from "../config.js";

/**
 * Ask our serverless endpoint for a short-lived Decart connection credential.
 * The raw DECART_API_KEY stays server-side (plan §3 — the one rule).
 * @returns {Promise<string>} credential to hand to the SDK
 */
export async function fetchCredential() {
  const res = await fetch(CONFIG.SESSION_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestedAt: Date.now() }),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch { /* ignore */ }
    throw new Error(`Session service error (${res.status}). ${detail}`.trim());
  }
  const data = await res.json();
  // Server may return either a scoped token (preferred) or, in the interim,
  // the credential the SDK currently needs. Field name kept generic.
  const credential = data.credential || data.token || data.apiKey;
  if (!credential) throw new Error("Session service returned no credential.");
  return credential;
}

/**
 * Guardrail timers around a live session. Call `bump()` on any operator action
 * to defer the idle timeout. Call `stop()` when the session ends.
 */
export function createGuards({ onIdleTimeout, onMaxReached, onTick }) {
  const maxMs = (CONFIG.MAX_SESSION_SECONDS || 0) * 1000;
  const idleMs = (CONFIG.IDLE_TIMEOUT_SECONDS || 0) * 1000;

  let startedAt = 0;
  let idleTimer = null;
  let maxTimer = null;
  let tick = null;

  function bump() {
    if (!idleMs) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => onIdleTimeout?.(), idleMs);
  }

  function start() {
    startedAt = Date.now();
    bump();
    if (maxMs) maxTimer = setTimeout(() => onMaxReached?.(), maxMs);
    tick = setInterval(() => onTick?.(elapsedSeconds()), 1000);
  }

  function elapsedSeconds() {
    return startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  }

  function stop() {
    clearTimeout(idleTimer);
    clearTimeout(maxTimer);
    clearInterval(tick);
    idleTimer = maxTimer = tick = null;
    startedAt = 0;
  }

  return { start, stop, bump, elapsedSeconds };
}
