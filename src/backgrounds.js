// Procedural scenario backgrounds for the OFFLINE (local segmentation) engine.
//
// Why procedural: the whole point of the offline mode is to NOT pay Decart per
// generated second. So instead of a neural restyle we draw the scene ourselves,
// on a canvas, for free. Each scenario maps to a lightweight animated painter
// (flood water + rain, stadium crowd + floodlights, festival beams + confetti,
// alpine peaks…) that runs entirely in the browser.
//
// Upgrade path: if a scenario carries `bgVideo` (a looping pre-rendered MP4 — you
// can render ONE per scenario with Decart once, offline, then reuse it forever)
// or `bgImage`, we use that media instead of the procedural painter. That keeps
// the per-session cost at zero while letting you swap in richer backplates later.

// ---- media-backed background (optional bgVideo / bgImage on a scenario) ------

function mediaBackground(src, isVideo, fallback) {
  let el;
  let ready = false;
  let failed = false;   // file missing / decode error → use the procedural fallback
  if (isVideo) {
    el = document.createElement("video");
    el.src = src;
    el.loop = true;
    el.muted = true;
    el.playsInline = true;
    el.addEventListener("canplay", () => { ready = true; el.play().catch(() => {}); });
    el.addEventListener("error", () => { failed = true; });
  } else {
    el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => { ready = true; };
    el.onerror = () => { failed = true; };
    el.src = src;
  }
  return {
    draw(ctx, w, h, t) {
      // Until the media is ready (or if it failed to load), draw the procedural
      // painter so the scene is never blank while you stage a clip.
      if (!ready || failed) {
        if (fallback) fallback(ctx, w, h, t);
        else { ctx.fillStyle = "#0A0A0A"; ctx.fillRect(0, 0, w, h); }
        return;
      }
      // cover-fit
      const mw = el.videoWidth || el.naturalWidth || w;
      const mh = el.videoHeight || el.naturalHeight || h;
      const scale = Math.max(w / mw, h / mh);
      const dw = mw * scale, dh = mh * scale;
      ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
    },
    stop() { if (isVideo) { el.pause(); el.src = ""; } },
  };
}

// ---- procedural painters -----------------------------------------------------

function makeParticles(n, init) {
  const p = new Array(n);
  for (let i = 0; i < n; i++) p[i] = init();
  return p;
}

function flood() {
  let rain = null;
  return (ctx, w, h, t) => {
    // overcast sky → murky water
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#6b6f73");
    sky.addColorStop(0.55, "#8a8579");
    sky.addColorStop(0.56, "#5b4a32");
    sky.addColorStop(1, "#3a2f1f");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // moving water sheen on the lower half
    const waterTop = h * 0.56;
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "#c8b89a";
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const y = waterTop + ((t * 0.03 + i * 40) % (h - waterTop));
      ctx.beginPath();
      for (let x = 0; x <= w; x += 24) {
        const yy = y + Math.sin((x + t * 0.12) * 0.02) * 3;
        x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();

    // rain
    if (!rain) rain = makeParticles(220, () => ({ x: Math.random() * w, y: Math.random() * h, l: 8 + Math.random() * 14, s: 9 + Math.random() * 7 }));
    ctx.strokeStyle = "rgba(200,210,220,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of rain) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 2, d.y + d.l);
      d.y += d.s; d.x -= 0.6;
      if (d.y > h) { d.y = -d.l; d.x = Math.random() * w; }
    }
    ctx.stroke();
  };
}

function stadium() {
  let crowd = null;
  return (ctx, w, h, t) => {
    const standTop = h * 0.16, standBot = h * 0.55, pitchTop = h * 0.55;

    // night sky over the bowl
    const sky = ctx.createLinearGradient(0, 0, 0, standTop);
    sky.addColorStop(0, "#0a1430");
    sky.addColorStop(1, "#16315e");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, standTop);

    // dark stand structure
    ctx.fillStyle = "#11151c";
    ctx.fillRect(0, standTop, w, standBot - standTop);

    // crowd speckle (fixed dots, slight twinkle)
    if (!crowd) crowd = makeParticles(1100, () => ({
      x: Math.random() * w,
      y: standTop + Math.random() * (standBot - standTop),
      c: ["#d9a14a", "#4aa6d9", "#e05555", "#5dd05d", "#dddddd", "#dddd5d"][Math.floor(Math.random() * 6)],
    }));
    const tw = 0.7 + Math.sin(t * 0.004) * 0.3;
    ctx.globalAlpha = tw;
    for (const c of crowd) { ctx.fillStyle = c.c; ctx.fillRect(c.x, c.y, 2, 2); }
    ctx.globalAlpha = 1;

    // floodlight glows
    const glow = 0.6 + Math.sin(t * 0.003) * 0.1;
    for (const fx of [w * 0.2, w * 0.8]) {
      const g = ctx.createRadialGradient(fx, h * 0.1, 0, fx, h * 0.1, h * 0.45);
      g.addColorStop(0, `rgba(255,255,235,${0.22 * glow})`);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // pitch
    const grass = ctx.createLinearGradient(0, pitchTop, 0, h);
    grass.addColorStop(0, "#2f7d34");
    grass.addColorStop(1, "#1c5a22");
    ctx.fillStyle = grass;
    ctx.fillRect(0, pitchTop, w, h - pitchTop);
    // mowing stripes
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 10; i += 2) ctx.fillRect((i * w) / 10, pitchTop, w / 10, h - pitchTop);
    ctx.restore();
    // halfway line
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, pitchTop + 10);
    ctx.lineTo(w, pitchTop + 10);
    ctx.stroke();
  };
}

function festival() {
  let confetti = null;
  return (ctx, w, h, t) => {
    // deep dusk sky
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#180a2e");
    sky.addColorStop(0.55, "#43205a");
    sky.addColorStop(0.85, "#7a2f57");
    sky.addColorStop(1, "#1f0f2a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // sweeping coloured stage beams
    const beams = [[255, 59, 107], [45, 225, 255], [255, 210, 59], [155, 92, 255]];
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < beams.length; i++) {
      const [r, g, b] = beams[i];
      const sweep = Math.sin(t * 0.0007 + i * 1.7) * 0.6;
      ctx.save();
      ctx.translate(w * (0.25 + 0.17 * i), h * 0.66);
      ctx.rotate(sweep);
      const grad = ctx.createLinearGradient(0, 0, 0, -h * 0.9);
      grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
      grad.addColorStop(0.12, `rgba(${r},${g},${b},0.22)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-w * 0.12, -h * 0.9);
      ctx.lineTo(w * 0.12, -h * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // warm stage glow
    const glow = ctx.createRadialGradient(w * 0.5, h * 0.68, 0, w * 0.5, h * 0.68, w * 0.5);
    glow.addColorStop(0, "rgba(255,180,80,0.22)");
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // crowd silhouette with bobbing heads
    const crowdTop = h * 0.72;
    ctx.fillStyle = "#0c0610";
    ctx.fillRect(0, crowdTop, w, h - crowdTop);
    ctx.beginPath();
    for (let x = 0; x <= w; x += 20) {
      const hy = crowdTop - 6 - Math.abs(Math.sin(x * 0.05 + t * 0.004)) * 10;
      ctx.moveTo(x, crowdTop);
      ctx.arc(x, hy, 7, 0, Math.PI * 2);
    }
    ctx.fill();

    // falling confetti
    if (!confetti) confetti = makeParticles(130, () => ({
      x: Math.random() * w, y: Math.random() * crowdTop, s: 0.8 + Math.random() * 1.6,
      r: 2 + Math.random() * 3, c: `hsl(${(Math.random() * 360) | 0},90%,60%)`, sw: Math.random() * Math.PI * 2,
    }));
    for (const c of confetti) {
      ctx.fillStyle = c.c;
      ctx.fillRect(c.x, c.y, c.r, c.r);
      c.y += c.s; c.x += Math.sin(c.y * 0.03 + c.sw) * 0.6;
      if (c.y > crowdTop) { c.y = -4; c.x = Math.random() * w; }
    }
  };
}

function mountain() {
  let ranges = null;
  return (ctx, w, h, t) => {
    // daylight sky
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#bfe3ff");
    sky.addColorStop(0.5, "#7fb6e6");
    sky.addColorStop(1, "#dfeef7");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // sun
    const sun = ctx.createRadialGradient(w * 0.78, h * 0.22, 0, w * 0.78, h * 0.22, h * 0.28);
    sun.addColorStop(0, "rgba(255,250,230,0.9)");
    sun.addColorStop(1, "transparent");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);

    // drifting clouds (behind the peaks)
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 3; i++) {
      const cx = ((t * 0.012 * (i + 1)) + i * w * 0.4) % (w + 360) - 180;
      const cy = h * (0.14 + 0.08 * i);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 130);
      g.addColorStop(0, "rgba(255,255,255,0.85)");
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(cx - 170, cy - 90, 340, 180);
    }
    ctx.restore();

    // layered ridgelines (generated once, deterministic, then redrawn)
    if (!ranges) {
      const layers = [
        { base: 0.56, amp: 0.16, col: "#6b7e96", snow: false, n: 14 },
        { base: 0.64, amp: 0.24, col: "#465b73", snow: true, n: 12 },
        { base: 0.74, amp: 0.30, col: "#2b3a4d", snow: true, n: 10 },
      ];
      ranges = layers.map((L, li) => {
        const pts = [];
        for (let i = 0; i <= L.n; i++) {
          const rnd = (Math.sin((i + 1) * (12.9898 + li)) * 43758.5453) % 1; // deterministic jitter
          const y = L.base - Math.abs(Math.sin(i * 1.3 + rnd * 3)) * L.amp;
          pts.push([i / L.n, y]);
        }
        return { pts, col: L.col, snow: L.snow };
      });
    }
    for (const R of ranges) {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (const [x, y] of R.pts) ctx.lineTo(x * w, y * h);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = R.col;
      ctx.fill();
      // snow caps: a white band near the peaks, clipped to the silhouette
      if (R.snow) {
        ctx.save();
        ctx.clip();
        const minY = Math.min(...R.pts.map((p) => p[1])) * h;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(0, minY, w, h * 0.09);
        ctx.restore();
      }
    }
  };
}

function studio() {
  return (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.1, w / 2, h * 0.5, h * 0.9);
    g.addColorStop(0, "#3a3a3f");
    g.addColorStop(1, "#141416");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // subtle EDT-blue floor glow
    const floor = ctx.createLinearGradient(0, h * 0.7, 0, h);
    floor.addColorStop(0, "transparent");
    floor.addColorStop(1, "rgba(45,45,255,0.18)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
  };
}

const PAINTERS = { flood, stadium, festival, mountain };

/**
 * Build a background for a scenario. Prefers `bgVideo`/`bgImage` media if the
 * scenario provides it, otherwise falls back to the procedural painter (and a
 * neutral studio painter for unknown ids).
 * @param {object} scenario  a scenario object from scenarios.js
 * @returns {{ draw(ctx,w,h,t):void, stop?():void }}
 */
export function createBackground(scenario) {
  // The procedural painter doubles as the fallback for media-backed scenarios
  // (shown while a clip loads, or permanently if the file is missing).
  const painter = (PAINTERS[scenario?.id] || studio)();
  if (scenario?.bgVideo) return mediaBackground(scenario.bgVideo, true, painter);
  if (scenario?.bgImage) return mediaBackground(scenario.bgImage, false, painter);
  return { draw: painter };
}
