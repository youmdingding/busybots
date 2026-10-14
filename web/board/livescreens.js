// Room props that come alive while an agent works in the room: code scrolls on the
// monitors, the CI board runs its pipeline, rack LEDs blink, the roadmap's "today" line
// moves, the review diff scrolls, test devices switch screens.
//
// The art generator tags each screen it draws (tools/city_props/isopix.py live()) and saves
// <sprite>_live.png beside the room sprite: per visible screen pixel R = screen id,
// G/B = position on that screen (u from the left, v from the top, in sprite units). The
// manifest entry's `live` maps ids to { kind, w, h }. Pixels hidden behind other props were
// never tagged, so animating them can't paint over anything in front.
import { S, bots, tileImgs } from "./state.js";
import { CITY_DIR } from "./constants.js";
import { ctx } from "./dom.js";
import { loadTile } from "./layout.js";
import { botPassesAgentFilter } from "./agents.js";

const FPS = 12;
const ROOMS = new Map(); // sprite name → { pixels, bx, by, bw, bh, canvas, img, frame } | { failed }

/** Is an agent working (active, arrived, not waiting for you) in this room? */
export function roomBusy(zid) {
  for (const b of bots.values()) {
    if (b.zone !== zid || b.state !== "active" || b.walking) continue;
    if (b.attention && b.attention.needsYou) continue;
    if (!botPassesAgentFilter(b)) continue;
    return true;
  }
  return false;
}

/** Decode a room's live map once both PNGs are loaded (null while still loading). */
function roomData(name, meta) {
  let r = ROOMS.get(name);
  if (r) return r.failed ? null : r;
  const liveImg = tileImgs.get(`${CITY_DIR}${name}_live.png`) || loadTile(`${CITY_DIR}${name}_live.png`);
  const base = tileImgs.get(`${CITY_DIR}${name}.png`);
  if (!liveImg || !liveImg.complete || !base || !base.complete || !base.naturalWidth) return null;
  if (!liveImg.naturalWidth) { ROOMS.set(name, { failed: true }); return null; }
  try {
    const w = liveImg.naturalWidth, h = liveImg.naturalHeight;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(liveImg, 0, 0);
    const L = g.getImageData(0, 0, w, h).data;
    g.clearRect(0, 0, w, h);
    g.drawImage(base, 0, 0);
    const B = g.getImageData(0, 0, w, h).data;
    const pixels = [];
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (!L[i + 3] || !meta[L[i]]) continue;
        pixels.push({ x, y, sid: L[i], u: L[i + 1], v: L[i + 2], orig: [B[i], B[i + 1], B[i + 2]] });
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    if (!pixels.length) { ROOMS.set(name, { failed: true }); return null; }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const canvas = document.createElement("canvas");
    canvas.width = bw;
    canvas.height = bh;
    const cg = canvas.getContext("2d");
    r = { pixels, bx: x0, by: y0, bw, bh, canvas, cg, img: cg.createImageData(bw, bh), frame: -1 };
    ROOMS.set(name, r);
    return r;
  } catch (e) {
    console.warn("live screens:", name, e);
    ROOMS.set(name, { failed: true });
    return null;
  }
}

// ---- what each kind of screen shows ---------------------------------------
function hash(a, b = 0, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const hexRgb = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const C = Object.fromEntries(Object.entries({
  codeBg: "#1c2a33", codeA: "#7fd1c7", codeB: "#f2c14e", codeC: "#e88a7a", codeD: "#a9b8ff",
  docBg: "#f2f7fa", docInk: "#8fa3b3", docHead: "#5c7080", cursor: "#ffffff",
  dark: "#26313b", pend: "#3c4a57", ok: "#3ddc97", run: "#ffb347", bar: "#4a8fd6", pass: "#2fbf71",
  red: "#ff5a5a", delBg: "#3b2328", addBg: "#1f3a2c", neuBg: "#22272e", del: "#ff8a8a", add: "#7ee2a8",
  neu: "#aab4bf", gutter: "#3a414a", sel: "#3a3f6e",
  sky: "#6fa8dc", mint: "#7bc6a4", mustard: "#e0b04a", coral: "#e07a5f", gold: "#c9a227", white: "#e9eef2",
}).map(([k, v]) => [k, hexRgb(v)]));
const brighten = (c, f) => c.map((x) => Math.min(255, x * f + 10));
const sameish = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 60;

const KINDS = {
  /** Code scrolling up, a blinking cursor on the newest line. */
  code(p, m, t) {
    if (p.v < 2) return p.orig;                     // title bar
    const rows = Math.max(1, Math.floor(m.h) - 2);
    const scroll = Math.floor(t * 1.7 + p.sid * 5);
    const line = p.v - 2 + scroll;
    const blank = hash(line, 1, p.sid) < 0.18;
    const indent = 1 + Math.floor(hash(line, 2, p.sid) * 3);
    const len = indent + 1 + Math.floor(hash(line, 3, p.sid) * (m.w - indent - 1));
    if (p.v - 2 === rows - 1 && p.u === Math.min(len, Math.floor(m.w) - 2) && Math.floor(t * 2.5) % 2) return C.cursor;
    if (blank || p.u < indent || p.u > len) return C.codeBg;
    return [C.codeA, C.codeB, C.codeC, C.codeD][Math.floor(hash(line, 4, p.sid) * 4)];
  },
  /** A document being written: lines appear one by one, the last one typing. */
  doc(p, m, t) {
    if (p.v < 2) return p.orig;
    const rows = Math.max(1, Math.floor(m.h) - 2);
    const cyc = (t * 0.9 + p.sid * 2.3) % (rows + 3);
    const row = p.v - 2;
    if (row > cyc) return C.docBg;
    const len = 1 + Math.floor(hash(row, 5, p.sid + Math.floor((t * 0.9 + p.sid * 2.3) / (rows + 3))) * (m.w - 2));
    const shown = row < Math.floor(cyc) ? len : Math.floor((cyc % 1) * len);
    if (row === Math.floor(cyc) && p.u === shown + 1 && Math.floor(t * 2.5) % 2) return C.docHead;
    return p.u >= 1 && p.u <= shown ? C.docInk : C.docBg;
  },
  /** CI board: four stages go green one after another, the progress bar fills, PASS flashes. */
  ci(p, m, t) {
    const cyc = (t + p.sid) % 18, stage = Math.min(4, Math.floor(cyc / 3.6));
    const u = p.u + 0.5, v = p.v + 0.5;
    if (v > 1.4 && v < 3.1) {                       // stage pills
      const k = Math.floor((u - 0.7) / 3.15);
      if ((u - 0.7) % 3.15 >= 2.5 || k < 0 || k > 3) return C.dark;
      if (k < stage) return C.ok;
      if (k === stage) return Math.floor(t * 3) % 2 ? C.run : C.pend;
      return C.pend;
    }
    if (v > 4.4 && v < 7.6 && u > 1.4 && u < 12.6) { // progress bar
      if (stage >= 4) return Math.floor(t * 2) % 2 ? C.pass : brighten(C.pass, 1.2);
      return (u - 1.4) / 11.2 < cyc / 14.4 ? C.bar : C.dark;
    }
    return p.orig;
  },
  /** Rack status LEDs flicker with traffic. */
  leds(p, m, t) {
    const slot = Math.floor(t * (4 + hash(p.v, 7, p.sid) * 8));
    return hash(p.v, slot, p.sid) > 0.3 ? brighten(p.orig, 1.1) : p.orig.map((x) => x * 0.25);
  },
  /** Roadmap: the "today" line walks across, a highlight sweeps the bars. */
  roadmap(p, m, t) {
    if (p.v < 3) return p.orig;                     // quarter header
    const today = 2 + ((t * 0.9) % (m.w - 4));
    const o = sameish(p.orig, C.red) ? C.dark : p.orig;
    if (Math.abs(p.u + 0.5 - today) < 0.6) return C.red;
    const sweep = (t * 7) % (m.w + 20) - 10;
    if (!sameish(o, C.dark) && !sameish(o, C.pend) && Math.abs(p.u - sweep) < 2) return brighten(o, 1.25);
    return o;
  },
  /** Review diff scrolling past, one line selected. */
  diff(p, m, t) {
    if (p.v < 10) return p.orig;                    // header with the room name
    const vv = p.v - 10 + 0.5;
    const line = Math.floor(vv / 1.4) + Math.floor(t * 1.3);
    const k = hash(line, 1, 41);
    const sel = Math.floor(vv / 1.4) === Math.floor(((t * 0.5) % ((m.h - 10) / 1.4)));
    if (p.u < 2) return C.gutter;
    const bg = sel ? C.sel : k < 0.25 ? C.delBg : k > 0.7 ? C.addBg : C.neuBg;
    if (vv % 1.4 < 0.7 && p.u > 2 && p.u < m.w - 2 - hash(line, 2, 41) * (m.w * 0.4)) return k < 0.25 ? C.del : k > 0.7 ? C.add : C.neu;
    return bg;
  },
  /** Data dashboard: bars rise and fall, the line chart scrolls. */
  dash(p, m, t) {
    const u = p.u + 0.5, vb = m.h - p.v - 0.5;     // from the bottom
    if (u < m.w * 0.45) {
      const k = Math.floor((u - 2) / 3);
      const hgt = 2 + 10 * (0.5 + 0.5 * Math.sin(t * 0.9 + k * 1.7)) * (0.5 + hash(k, 1, 51) * 0.5);
      if (u > 2 && (u - 2) % 3 < 2 && vb > 0.8 && vb < hgt) return [C.sky, C.mint, C.mustard, C.coral][k % 4];
      return C.dark;
    }
    const x = u + t * 5;
    const yv = m.h * 0.45 + Math.sin(x * 0.35) * 3 + Math.sin(x * 0.11) * 2;
    if (Math.abs(vb - yv) < 0.7) return C.gold;
    if (hash(Math.floor(x * 0.8), p.v, 52) > 0.97) return C.sky;
    return C.dark;
  },
  /** Test phones and tablets switching screens as tests run. */
  devices(p, m, t) {
    const dev = Math.floor(p.u / 2.6), lvl = Math.floor(p.v / 3.7);
    const slot = Math.floor(t / (1.2 + hash(dev, lvl, 3) * 2) + hash(dev, lvl, 4) * 10);
    const pick = hash(dev * 7 + lvl, slot, 5);
    const c = pick > 0.45 ? C.sky : pick > 0.2 ? C.mint : pick > 0.08 ? C.white : C.coral;
    return (p.v % 4 === 2 && hash(dev, slot, 6) > 0.5) ? brighten(c, 1.2) : c;
  },
  /** Anything else with a picture: a soft light sweep, as if someone is scrolling. */
  glint(p, m, t) {
    const span = m.w + m.h + 10;
    const d = p.u + p.v * 0.6 - (((t * 5 + p.sid * 7) % span) - 5);
    return Math.abs(d) < 1.2 ? brighten(p.orig, 1.3) : p.orig;
  },
};

/** Overlay the animated screens of one room sprite drawn at (x, y) with scale s. */
export function drawLiveScreens(spriteName, x, y, s, now) {
  const m = S.CITY_MANIFEST && S.CITY_MANIFEST[spriteName];
  if (!m || !m.live) return;
  const r = roomData(spriteName, m.live);
  if (!r) return;
  const t = (now || performance.now()) / 1000;
  const frame = Math.floor(t * FPS);
  if (frame !== r.frame) {
    r.frame = frame;
    const d = r.img.data;
    for (const p of r.pixels) {
      const meta = m.live[p.sid];
      const fn = KINDS[meta.kind] || KINDS.glint;
      const c = fn(p, meta, t);
      const i = ((p.y - r.by) * r.bw + (p.x - r.bx)) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    r.cg.putImageData(r.img, 0, 0);
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(r.canvas, x + r.bx * s, y + r.by * s, r.bw * s, r.bh * s);
  ctx.restore();
}
