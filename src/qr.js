// Render a URL into a QR code, drawn onto a <canvas>. Lazy-loads the `qrcode`
// library from esm.sh on first use (matching the app's CDN/ESM convention) so it
// never blocks app boot. QR generation itself is pure client-side (no network).

let qrLib = null;

async function lib() {
  if (!qrLib) qrLib = await import("https://esm.sh/qrcode@1.5.4");
  return qrLib.default ?? qrLib;
}

/**
 * Draw `text` as a QR code onto `canvasEl`. QR must be dark-on-light to scan.
 * @param {HTMLCanvasElement} canvasEl
 * @param {string} text
 * @param {number} [size] pixel size of the QR (square)
 */
export async function renderQR(canvasEl, text, size = 240) {
  const QRCode = await lib();
  await QRCode.toCanvas(canvasEl, text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0A0A0A", light: "#FFFFFF" },
  });
}
