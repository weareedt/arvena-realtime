// In-browser WebM → MP4 conversion via ffmpeg.wasm.
//
// Why: browser MediaRecorder only emits WebM (VP8/VP9 + Opus) on Chrome/Edge,
// which Windows' built-in players reject. We transcode to H.264 + AAC MP4 so the
// download plays everywhere.
//
// The library (~30 MB) is loaded LAZILY on the first conversion, not at startup.
// We use the single-threaded core so it works without cross-origin-isolation
// (no COOP/COEP headers required).

const FFMPEG_VER = "0.12.10";
const UTIL_VER = "0.12.1";
const CORE_VER = "0.12.6";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VER}/dist/esm`;
const FFMPEG_BASE = `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VER}/dist/esm`;
const UTIL_BASE = `https://unpkg.com/@ffmpeg/util@${UTIL_VER}/dist/esm`;

let loadPromise = null; // resolves to a loaded FFmpeg instance
let utilMod = null;

async function util() {
  if (!utilMod) utilMod = await import(`${UTIL_BASE}/index.js`);
  return utilMod;
}

async function getFFmpeg() {
  if (!loadPromise) {
    loadPromise = (async () => {
      const { FFmpeg } = await import(`${FFMPEG_BASE}/index.js`);
      const { toBlobURL } = await util();
      const ff = new FFmpeg();
      // Load ffmpeg's own worker from a SAME-ORIGIN blob URL. Without this, the
      // FFmpeg class builds its worker from `import.meta.url` (the cross-origin
      // unpkg URL), which the browser blocks — load() throws and we silently fall
      // back to WebM. classWorkerURL as a blob makes the worker same-origin.
      await ff.load({
        classWorkerURL: await toBlobURL(`${FFMPEG_BASE}/worker.js`, "text/javascript"),
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      });
      return ff;
    })().catch((err) => {
      loadPromise = null; // allow a retry on the next recording
      throw err;
    });
  }
  return loadPromise;
}

/**
 * Convert a recorded blob to MP4. If it's already MP4 (e.g. Safari), returns it
 * unchanged. Throws if conversion fails so the caller can fall back to WebM.
 * @param {Blob} blob
 * @param {(progress01:number)=>void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function toMp4(blob, onProgress) {
  if (blob.type.includes("mp4")) return blob;

  const { fetchFile } = await util();
  const ff = await getFFmpeg();

  const onProg = onProgress ? ({ progress }) => onProgress(Math.max(0, Math.min(1, progress))) : null;
  if (onProg) ff.on("progress", onProg);

  try {
    await ff.writeFile("in.webm", await fetchFile(blob));
    // ultrafast preset keeps wasm transcode time sane; yuv420p for broad support.
    await ff.exec([
      "-i", "in.webm",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      "out.mp4",
    ]);
    const data = await ff.readFile("out.mp4");
    return new Blob([data], { type: "video/mp4" });
  } finally {
    if (onProg) ff.off?.("progress", onProg);
    try { await ff.deleteFile("in.webm"); } catch { /* ignore */ }
    try { await ff.deleteFile("out.mp4"); } catch { /* ignore */ }
  }
}
