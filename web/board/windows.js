// The view through a theme's glass walls (the Office curtain wall): sky that follows the
// local time of day, drifting clouds, a city skyline whose windows light up in the evening,
// stars at night and the odd plane. The ground sprite leaves its glass transparent; this
// paints each wall's view just before the sprite is drawn, so mullions and columns frame it.
//
// theme.ground.windows: [{ "from": [gx, gy], "to": [gx, gy], "z": [bottom, top], "seed": 7 }]
//   from/to = the glass along the floor (grid), z = glass height in sprite units.
// ?hour=19.5 in the page URL previews another time of day.
import { S } from "./state.js";
import { BASE_ELEV, TILE_W } from "./constants.js";
import { ctx } from "./dom.js";
import { toIso } from "./layout.js";

const HOUR_OVERRIDE = (() => {
  const h = parseFloat(new URLSearchParams(location.search).get("hour"));
  return Number.isFinite(h) ? ((h % 24) + 24) % 24 : null;
})();

// Colours through the day; lerped between keyframes by local hour.
const KEYS = [
  { h: 0, top: "#0b1430", bot: "#1f2b4d", cloud: "#38425f", cloudLo: "#262e48", far: "#1c2540", near: "#121a2e", night: 1 },
  { h: 5, top: "#0b1430", bot: "#1f2b4d", cloud: "#38425f", cloudLo: "#262e48", far: "#1c2540", near: "#121a2e", night: 1 },
  { h: 6.2, top: "#4d6aa8", bot: "#f2a97c", cloud: "#ffd9bf", cloudLo: "#c9909a", far: "#7d7a9c", near: "#5c5a7c", night: 0.5 },
  { h: 7.5, top: "#5fa8dc", bot: "#cfe8f4", cloud: "#ffffff", cloudLo: "#d5e2ec", far: "#a3b7c9", near: "#7f95aa", night: 0 },
  { h: 17, top: "#5fa8dc", bot: "#cfe8f4", cloud: "#ffffff", cloudLo: "#d5e2ec", far: "#a3b7c9", near: "#7f95aa", night: 0 },
  { h: 18.6, top: "#4b5a99", bot: "#f08a5d", cloud: "#ffc9a8", cloudLo: "#b97c8c", far: "#867b9b", near: "#625d80", night: 0.4 },
  { h: 19.8, top: "#16204a", bot: "#3a3f6e", cloud: "#4a4c72", cloudLo: "#30345a", far: "#262c4c", near: "#181f38", night: 0.85 },
  { h: 21, top: "#0b1430", bot: "#1f2b4d", cloud: "#38425f", cloudLo: "#262e48", far: "#1c2540", near: "#121a2e", night: 1 },
  { h: 24, top: "#0b1430", bot: "#1f2b4d", cloud: "#38425f", cloudLo: "#262e48", far: "#1c2540", near: "#121a2e", night: 1 },
];

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const rgbStr = (a) => `rgb(${a.map((v) => Math.round(v)).join(",")})`;
const lerpC = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Integer hash → [0, 1). */
function rnd(a, b = 0, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function localHour() {
  if (HOUR_OVERRIDE != null) return HOUR_OVERRIDE;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

/** Palette for an hour (quantised to 5 minutes so caches can key on it). */
function paletteAt(hour) {
  const h = Math.round(hour * 12) / 12;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.max(0, Math.min(1, (h - a.h) / (b.h - a.h || 1)));
  const out = { key: h.toFixed(3), night: a.night + (b.night - a.night) * t };
  for (const k of ["top", "bot", "cloud", "cloudLo", "far", "near"]) out[k] = lerpC(hex(a[k]), hex(b[k]), t);
  return out;
}

const VIEWS = new Map(); // wall key → { canvas, sky, skyline, clouds, key }

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Sky gradient + stars, one pixel row at a time (banded like the rest of the art). */
function paintSky(view, pal) {
  const { w, h } = view;
  const g = view.sky.getContext("2d");
  for (let y = 0; y < h; y++) {
    const t = Math.min(1, Math.floor((y / (h * 0.82)) * 10) / 10);
    g.fillStyle = rgbStr(lerpC(pal.top, pal.bot, t));
    g.fillRect(0, y, w, 1);
  }
  if (pal.night > 0.45) {
    g.globalAlpha = Math.min(1, (pal.night - 0.45) * 2);
    for (let i = 0; i < w / 6; i++) {
      const x = Math.floor(rnd(i, 1, view.seed) * w), y = Math.floor(rnd(i, 2, view.seed) * h * 0.55);
      g.fillStyle = rnd(i, 3, view.seed) > 0.85 ? "#ffffff" : "#aab8d8";
      g.fillRect(x, y, 1, 1);
    }
    g.globalAlpha = 1;
  }
}

/** Towers along the bottom: far row (hazier) then near row, windows lit after dark. */
function paintSkyline(view, pal) {
  const { w, h, seed } = view;
  const g = view.skyline.getContext("2d");
  g.clearRect(0, 0, w, h);
  for (const [row, base, hmin, hvar, col] of [[0, 0, 16, 22, pal.far], [1, 0, 8, 18, pal.near]]) {
    let x = -4 + Math.floor(rnd(row, 9, seed) * 6);
    let k = 0;
    while (x < w + 4) {
      const bw = 6 + Math.floor(rnd(k, row * 7 + 1, seed) * 10);
      let bh = hmin + Math.floor(rnd(k, row * 7 + 2, seed) * hvar);
      if (rnd(k, row * 7 + 3, seed) > 0.86) bh += 12;
      const top = h - base - bh;
      g.fillStyle = rgbStr(col);
      g.fillRect(x, top, bw, bh);
      g.fillStyle = rgbStr(col.map((v) => v * 0.86));
      g.fillRect(x + bw - 1, top, 1, bh); // shaded edge
      if (bh > 16 && rnd(k, row * 7 + 4, seed) > 0.6) { // antenna
        g.fillStyle = rgbStr(col);
        g.fillRect(x + (bw >> 1), top - 4, 1, 4);
        view.beacons.push([x + (bw >> 1), top - 5, rnd(k, 5, seed) * 6]);
      }
      // windows: a dot every 2 px, every 3rd row
      for (let wy = top + 2; wy < h - base - 1; wy += 3) {
        for (let wx = x + 1; wx < x + bw - 2; wx += 2) {
          const r = rnd(wx * 31 + wy, row, seed);
          let c = null;
          if (pal.night > 0.3 && r < 0.15 + pal.night * 0.4) c = r < 0.06 ? "#cfe4ff" : "#ffd98a";
          else if (pal.night < 0.6 && r > 0.8) c = rgbStr(col.map((v) => Math.min(255, v * 1.18)));
          if (c) {
            g.fillStyle = c;
            g.fillRect(wx, wy, 1, 1);
          }
        }
      }
      x += bw + (rnd(k, row * 7 + 6, seed) > 0.7 ? 2 : 0);
      k++;
    }
  }
}

/** Pixel cloud shape: a few overlapping puffs, light on top and shaded underneath. */
function cloudShape(i, seed) {
  const n = 3 + Math.floor(rnd(i, 11, seed) * 3);
  const puffs = [];
  let x = 0;
  for (let p = 0; p < n; p++) {
    const r = 4 + rnd(i, 20 + p, seed) * 5 * (p === 0 || p === n - 1 ? 0.7 : 1);
    puffs.push([x + r, r]);
    x += r * (0.9 + rnd(i, 30 + p, seed) * 0.5);
  }
  const w = Math.ceil(x + 10), hgt = 16;
  const px = [];
  for (let yy = 0; yy < hgt; yy++) {
    for (let xx = 0; xx < w; xx++) {
      let inside = false;
      for (const [cx, r] of puffs) {
        const dy = hgt - 1 - yy; // puffs sit on a flat base
        if ((xx - cx) ** 2 + ((dy - r * 0.55) * 1.6) ** 2 < r * r && dy >= 0) inside = true;
      }
      if (inside) px.push([xx, yy]);
    }
  }
  return { w, h: hgt, px };
}

function paintCloud(shape, pal) {
  const c = makeCanvas(shape.w, shape.h);
  const g = c.getContext("2d");
  const hi = rgbStr(pal.cloud), lo = rgbStr(pal.cloudLo);
  for (const [x, y] of shape.px) {
    g.fillStyle = y >= shape.h - 4 ? lo : hi;
    g.fillRect(x, y, 1, 1);
  }
  return c;
}

function initView(key, spec, w, h) {
  const seed = spec.seed || 1;
  const clouds = [];
  const n = Math.max(3, Math.round(w / 55));
  for (let i = 0; i < n; i++) {
    const shape = cloudShape(i, seed);
    clouds.push({ shape, img: null, u: rnd(i, 40, seed) * (w + 60) - 30,
                  v: Math.floor(1 + rnd(i, 41, seed) * (h * 0.4)), speed: 0.8 + rnd(i, 42, seed) * 1.6 });
  }
  clouds.sort((a, b) => a.speed - b.speed); // slow (far) ones first
  const view = { key: null, w, h, seed, canvas: makeCanvas(w, h), sky: makeCanvas(w, h), skyline: makeCanvas(w, h),
                 clouds, beacons: [], last: null };
  VIEWS.set(key, view);
  return view;
}

/** Wall geometry on screen: origin of the glass top-left and per-unit axes. */
function wallFrame(spec, units, s) {
  const [z0, z1] = spec.z;
  const a = toIso(spec.from[0], spec.from[1]), b = toIso(spec.to[0], spec.to[1]);
  const len = Math.hypot(spec.to[0] - spec.from[0], spec.to[1] - spec.from[1]) * units;
  return { len, hgt: z1 - z0, ox: a.sx, oy: a.sy - BASE_ELEV - z1 * s, ux: (b.sx - a.sx) / len, uy: (b.sy - a.sy) / len };
}

function drawPlane(g, view, t, pal) {
  const period = 47 + (view.seed % 5) * 6;
  const cyc = (t + view.seed * 13) % period;
  const dur = (view.w + 60) / 16;
  if (cyc > dur) return;
  const k = Math.floor((t + view.seed * 13) / period);
  const dir = rnd(k, 50, view.seed) > 0.5 ? 1 : -1;
  const x = Math.round(dir > 0 ? cyc * 16 - 30 : view.w + 30 - cyc * 16);
  const y = Math.round(5 + rnd(k, 51, view.seed) * view.h * 0.3);
  const night = pal.night > 0.6;
  if (!night) { // contrail
    for (let i = 4; i < 46; i++) {
      g.globalAlpha = 0.55 * (1 - i / 46);
      g.fillStyle = "#ffffff";
      g.fillRect(x - dir * i, y, 1, 1);
    }
    g.globalAlpha = 1;
  }
  g.fillStyle = night ? "#2a3048" : "#eef2f6";
  g.fillRect(x - 3, y, 7, 1);           // fuselage
  g.fillRect(x - dir * 1, y + 1, 2, 1);  // wing
  g.fillRect(x - dir * 3, y - 1, 1, 1);  // tail
  if (night) {
    const blink = Math.floor(t * 2.2) % 2 === 0;
    g.fillStyle = blink ? "#ff4a4a" : "#ffffff";
    g.fillRect(x - dir * 1, y + 1, 1, 1);
  }
}

/** Paint every glass wall's view (call right before drawing the ground sprite). */
export function drawWindowViews(spec, manifestEntry) {
  const walls = Array.isArray(spec.windows) ? spec.windows : [];
  if (!walls.length) return;
  const units = (manifestEntry && manifestEntry.unitsPerGrid) || 22;
  const s = (TILE_W * S.worldScale) / (2 * units);
  const t = performance.now() / 1000;
  const pal = paletteAt(localHour());
  walls.forEach((w, idx) => {
    if (!w || !Array.isArray(w.from) || !Array.isArray(w.to) || !Array.isArray(w.z)) return;
    const F = wallFrame(w, units, s);
    const vw = Math.max(1, Math.round(F.len)), vh = Math.max(1, Math.round(F.hgt));
    const key = `${S.activeTheme.id}:${idx}:${vw}x${vh}`;
    const view = VIEWS.get(key) || initView(key, w, vw, vh);
    if (view.key !== pal.key) { // time of day moved on: repaint the cached layers
      view.key = pal.key;
      view.beacons = [];
      paintSky(view, pal);
      paintSkyline(view, pal);
      for (const c of view.clouds) c.img = paintCloud(c.shape, pal);
    }
    const dt = view.last == null ? 0 : Math.max(0, Math.min(0.5, t - view.last));
    view.last = t;
    const g = view.canvas.getContext("2d");
    g.drawImage(view.sky, 0, 0);
    for (const c of view.clouds) {
      c.u += c.speed * dt;
      if (c.u > vw + 4) c.u = -c.shape.w - 4;
      g.globalAlpha = pal.night > 0.6 ? 0.75 : 1;
      g.drawImage(c.img, Math.round(c.u), c.v);
    }
    g.globalAlpha = 1;
    drawPlane(g, view, t, pal);
    g.drawImage(view.skyline, 0, 0);
    if (pal.night > 0.5) { // aircraft warning lights on the towers
      for (const [bx, by, ph] of view.beacons) {
        if (Math.floor(t * 1.1 + ph) % 2) continue;
        g.fillStyle = "#ff5040";
        g.fillRect(bx, by, 1, 1);
      }
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.transform(F.ux, F.uy, 0, s, F.ox, F.oy);
    ctx.drawImage(view.canvas, 0, 0);
    ctx.restore();
  });
}
