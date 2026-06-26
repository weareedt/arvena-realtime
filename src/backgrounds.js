// Procedural scenario backgrounds for the OFFLINE (local segmentation) engine.
//
// Why procedural: the whole point of the offline mode is to NOT pay Decart per
// generated second. So instead of a neural restyle we draw the scene ourselves,
// on a canvas, for free. Each scenario maps to a lightweight animated painter
// (drifting embers, rain, overcast water…) that runs entirely in the browser.
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

function wildfire() {
  let embers = null;
  return (ctx, w, h, t) => {
    const flick = 0.5 + Math.sin(t * 0.006) * 0.5;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#3a1402");
    sky.addColorStop(0.5, `rgba(${150 + flick * 60 | 0}, ${50 + flick * 30 | 0}, 10, 1)`);
    sky.addColorStop(1, "#1a0a02");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // smoke haze
    ctx.save();
    ctx.globalAlpha = 0.10;
    for (let i = 0; i < 5; i++) {
      const cx = (w * (0.2 * i) + t * 0.05) % (w + 200) - 100;
      const g = ctx.createRadialGradient(cx, h * 0.4, 0, cx, h * 0.4, 260);
      g.addColorStop(0, "#a89a8a");
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();

    // glowing distant fire line
    ctx.save();
    ctx.globalAlpha = 0.5 + flick * 0.3;
    const fire = ctx.createLinearGradient(0, h * 0.78, 0, h);
    fire.addColorStop(0, "transparent");
    fire.addColorStop(1, "#ff7a18");
    ctx.fillStyle = fire;
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
    ctx.restore();

    // rising embers
    if (!embers) embers = makeParticles(90, () => ({ x: Math.random() * w, y: Math.random() * h, r: 1 + Math.random() * 2, s: 0.6 + Math.random() * 1.6, d: Math.random() * 6 }));
    for (const e of embers) {
      ctx.fillStyle = `rgba(255,${140 + Math.random() * 80 | 0},40,${0.5 + Math.random() * 0.5})`;
      ctx.fillRect(e.x, e.y, e.r, e.r);
      e.y -= e.s; e.x += Math.sin((e.y + e.d) * 0.05) * 0.8;
      if (e.y < -4) { e.y = h + 4; e.x = Math.random() * w; }
    }
  };
}

function storm() {
  let rain = null;
  let flash = 0;
  return (ctx, w, h, t) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#1b2330");
    sky.addColorStop(0.6, "#222a36");
    sky.addColorStop(1, "#10151c");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // occasional lightning
    if (flash <= 0 && Math.random() < 0.006) flash = 1;
    if (flash > 0) {
      ctx.fillStyle = `rgba(220,230,255,${flash * 0.5})`;
      ctx.fillRect(0, 0, w, h);
      flash -= 0.08;
    }

    // wet reflective ground band
    ctx.fillStyle = "rgba(120,140,160,0.10)";
    ctx.fillRect(0, h * 0.82, w, h * 0.18);

    // hard diagonal rain
    if (!rain) rain = makeParticles(320, () => ({ x: Math.random() * w, y: Math.random() * h, l: 14 + Math.random() * 18, s: 16 + Math.random() * 12 }));
    ctx.strokeStyle = "rgba(190,205,220,0.4)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const d of rain) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - 8, d.y + d.l);
      d.y += d.s; d.x -= 5;
      if (d.y > h) { d.y = -d.l; d.x = Math.random() * (w + 200); }
    }
    ctx.stroke();
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

const PAINTERS = { flood, wildfire, storm, studio };

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
