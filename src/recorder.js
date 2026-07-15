// Recorder — captures the ARVENA.OUT feed to a downloadable file.
//
// IMPORTANT (plan §10): we do NOT record the raw output stream, because the
// "SIMULATED — AI GENERATED" disclosure is a DOM overlay and wouldn't be in the
// file. Instead we draw each output frame onto a canvas, burn the label into the
// pixels, and record the canvas stream — so the notice is always in the export.
//
// This produces a local file (WebM where supported, MP4 on Safari). True C2PA
// content credentials are a separate Phase-3 step; noted in the README.

let recorder = null;
let chunks = [];
let rafId = 0;
let running = false;
let audioStream = null;

function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  // Prefer MP4 (H.264/AAC) so modern Chrome/Edge record a playable file DIRECTLY
  // — no slow in-browser ffmpeg transcode. Fall back to WebM (then converted) on
  // browsers that can't record MP4.
  const types = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

/** Whether the current/last recording captured a microphone track. */
export function hasAudio() {
  return !!audioStream;
}

export function isSupported() {
  return typeof MediaRecorder !== "undefined" && !!HTMLCanvasElement.prototype.captureStream;
}

export function isRecording() {
  return running;
}

/**
 * Start recording the given <video> element, compositing the disclosure badge
 * and mixing in the presenter's microphone (falls back to video-only if mic
 * permission is denied or unavailable).
 * @returns {Promise<boolean>} whether recording started
 */
export async function start(videoEl, { badgeText = "SIMULATED — AI GENERATED", showBadge = true, fps = 30, withAudio = true } = {}) {
  if (running || !videoEl || !videoEl.srcObject || !isSupported()) return false;

  // Don't start until the output feed has real frames — recording a 0×0 canvas
  // produces an empty/corrupt file. main.js shows a "no output yet" message.
  if (!videoEl.videoWidth || !videoEl.videoHeight) return false;

  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const fontPx = Math.round(h * 0.028);
  const padX = Math.round(h * 0.018);
  const padY = Math.round(h * 0.012);

  const draw = () => {
    ctx.drawImage(videoEl, 0, 0, w, h);
    if (showBadge) {
      ctx.font = `600 ${fontPx}px 'Space Grotesk', sans-serif`;
      ctx.textBaseline = "top";
      const tw = ctx.measureText(badgeText).width;
      const boxW = tw + padX * 2;
      const boxH = fontPx + padY * 2;
      const bx = Math.round(h * 0.02);
      const by = h - Math.round(h * 0.02) - boxH;
      ctx.fillStyle = "rgba(10,10,10,0.78)";
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, boxW, boxH);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(badgeText, bx + padX, by + padY);
    }
    rafId = requestAnimationFrame(draw);
  };
  draw();

  const canvasStream = canvas.captureStream(fps);
  const tracks = [...canvasStream.getVideoTracks()];

  // Mix in the presenter's mic. Separate permission from the camera; if it's
  // denied we still record video-only rather than failing the whole capture.
  audioStream = null;
  if (withAudio) {
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      tracks.push(...audioStream.getAudioTracks());
    } catch {
      audioStream = null;
    }
  }

  const mixed = new MediaStream(tracks);
  const mimeType = pickMime();
  chunks = [];
  recorder = new MediaRecorder(mixed, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.start(1000);
  running = true;
  return true;
}

/** Stop and return a Blob (or null if not recording). */
export function stop() {
  return new Promise((resolve) => {
    if (!recorder || !running) return resolve(null);
    recorder.onstop = () => {
      cancelAnimationFrame(rafId);
      rafId = 0;
      if (audioStream) {
        audioStream.getTracks().forEach((t) => t.stop());
        audioStream = null;
      }
      const type = recorder.mimeType || "video/webm";
      const blob = new Blob(chunks, { type });
      running = false;
      recorder = null;
      chunks = [];
      resolve(blob);
    };
    recorder.stop();
  });
}

/** Trigger a browser download for a recorded blob. */
export function download(blob, baseName) {
  const ext = blob.type.includes("mp4") ? "mp4" : "webm";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
