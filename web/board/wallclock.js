// Wall clocks that show the local time (the Office's clock above the lifts). Painted onto
// the ground sprite's wall right after it is drawn, so everything in the room stays in front.
//
// theme.ground.clocks: [{ "at": [gx, gy], "face": "R", "z": 46, "r": 9 }]
//   at = the clock centre on the wall at floor level (grid), face = which way the wall faces
//   ("R" = toward +x, "L" = toward +y), z = centre height and r = radius, in sprite units.
import { S } from "./state.js";
import { BASE_ELEV, TILE_W } from "./constants.js";
import { ctx } from "./dom.js";
import { toIso } from "./layout.js";

const FACES = new Map(); // radius → { canvas, stamp }

function px(g, x, y, c) {
  g.fillStyle = c;
  g.fillRect(x, y, 1, 1);
}

function line(g, x0, y0, x1, y1, c) {
  // Bresenham, so the hands stay crisp pixels
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(g, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Pixel clock face for the current second (cached until the second changes). */
function face(r, date) {
  const stamp = Math.floor(date.getTime() / 1000);
  let f = FACES.get(r);
  if (f && f.stamp === stamp) return f.canvas;
  const n = 2 * r + 3, c = (n - 1) / 2;
  if (!f) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = n;
    f = { canvas, stamp: null };
    FACES.set(r, f);
  }
  f.stamp = stamp;
  const g = f.canvas.getContext("2d");
  g.clearRect(0, 0, n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d <= r - 0.6) px(g, x, y, y < c - r * 0.55 ? "#ffffff" : "#f4f5f0");
      else if (d <= r + 0.4) px(g, x, y, "#2d3238");
      else if (d <= r + 1.3) px(g, x, y, "#9aa3ab");
    }
  }
  const at = (a, len) => [Math.round(c + Math.sin(a) * len), Math.round(c - Math.cos(a) * len)];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    px(g, ...at(a, r - 1.6), "#2d3238");
    if (k % 3 === 0) px(g, ...at(a, r - 2.6), "#2d3238");
  }
  const h = date.getHours() % 12, m = date.getMinutes(), s = date.getSeconds();
  const ha = ((h + m / 60) / 12) * Math.PI * 2, ma = ((m + s / 60) / 60) * Math.PI * 2, sa = (s / 60) * Math.PI * 2;
  const [hx, hy] = at(ha, r * 0.5), [mx, my] = at(ma, r - 2.4), [sx, sy] = at(sa, r - 1.8);
  line(g, Math.round(c), Math.round(c), hx, hy, "#1d2126");
  line(g, Math.round(c) + (Math.abs(Math.cos(ha)) > 0.7 ? 1 : 0), Math.round(c) + (Math.abs(Math.cos(ha)) > 0.7 ? 0 : 1), hx, hy, "#1d2126");
  line(g, Math.round(c), Math.round(c), mx, my, "#2d3238");
  line(g, Math.round(c), Math.round(c), sx, sy, "#e0483c");
  px(g, Math.round(c), Math.round(c), "#e0483c");
  return f.canvas;
}

/** Paint the theme's wall clocks (call right after the ground sprite is drawn). */
export function drawWallClocks(spec, manifestEntry) {
  const clocks = Array.isArray(spec.clocks) ? spec.clocks : [];
  if (!clocks.length) return;
  const units = (manifestEntry && manifestEntry.unitsPerGrid) || 22;
  const s = (TILE_W * S.worldScale) / (2 * units);
  const now = new Date();
  for (const k of clocks) {
    if (!k || !Array.isArray(k.at)) continue;
    const r = Math.max(4, Math.min(30, Math.round(k.r || 8)));
    const img = face(r, now);
    const [gx, gy] = k.at;
    const o = toIso(gx, gy);
    // one unit along the wall, left to right as you look at it
    const e = k.face === "L" ? toIso(gx + 1 / units, gy) : toIso(gx, gy - 1 / units);
    const ux = e.sx - o.sx, uy = e.sy - o.sy;
    const cx = o.sx, cy = o.sy - BASE_ELEV - (k.z || 40) * s;
    const half = img.width / 2;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.transform(ux, uy, 0, s, cx - half * ux, cy - half * uy - half * s);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
}
