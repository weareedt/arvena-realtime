// Decart SDK wrapper — isolates every call into @decartai/sdk so the rest of
// the app deals in plain methods (start / setPrompt / stop).
//
// SDK shape confirmed against docs.platform.decart.ai (v0.1.6):
//   createDecartClient({ apiKey })
//   models.realtime(id)            → exposes .fps / .width / .height
//   client.realtime.connect(stream, { model, mirror, onRemoteStream, onError,
//                                     onDisconnect, initialState:{prompt:{text,enhance}} })
//   realtimeClient.setPrompt(text)
//
// We pull the SDK straight from a CDN to stay build-step-free (matches the
// other EDT static sites). Pin the version so a CDN bump can't break us.
import { createDecartClient, models } from "https://esm.sh/@decartai/sdk@0.1.6";

/**
 * Open a live realtime camera capture on `modelId`.
 *
 * @param {object} opts
 * @param {string} opts.modelId        e.g. "lucy-2.1" | "lucy-restyle-2"
 * @param {string} opts.credential     connection credential from /api/session
 * @param {string} opts.prompt         initial scene prompt
 * @param {boolean} opts.enhance       initial prompt enhance flag
 * @param {(s: MediaStream)=>void} opts.onLocalStream  raw webcam stream
 * @param {(s: MediaStream)=>void} opts.onRemoteStream edited Decart stream
 * @param {(e: Error)=>void} opts.onError
 * @param {(reason: any)=>void} opts.onDisconnect
 * @returns {Promise<{ setPrompt(t:string):Promise<void>, stop():Promise<void>,
 *                     model: object }>}
 */
export async function startRealtime(opts) {
  const {
    modelId,
    credential,
    prompt,
    enhance = true,
    onLocalStream,
    onRemoteStream,
    onError,
    onDisconnect,
  } = opts;

  const model = models.realtime(modelId);

  // Drive camera constraints off the model so we never request a resolution /
  // framerate it can't accept.
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { frameRate: model.fps, width: model.width, height: model.height },
      audio: false,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      throw new Error("Camera permission denied. Allow camera access and reload.");
    }
    throw new Error("Could not access camera: " + (err?.message || err));
  }
  onLocalStream?.(stream);

  const client = createDecartClient({ apiKey: credential });

  const realtimeClient = await client.realtime.connect(stream, {
    model,
    mirror: "auto",
    onRemoteStream: (remote) => onRemoteStream?.(remote),
    onError: (err) => onError?.(err),
    onDisconnect: (reason) => onDisconnect?.(reason),
    initialState: { prompt: { text: prompt, enhance } },
  });

  return {
    model,
    async setPrompt(text, enhanceFlag) {
      // Some SDK builds accept a string, others {text,enhance}; pass the string
      // form (documented) and fall back to the object form if needed.
      try {
        await realtimeClient.setPrompt(text);
      } catch {
        await realtimeClient.setPrompt({ text, enhance: enhanceFlag ?? true });
      }
    },
    async stop() {
      try {
        await realtimeClient.disconnect?.();
      } finally {
        stream.getTracks().forEach((t) => t.stop());
      }
    },
  };
}
