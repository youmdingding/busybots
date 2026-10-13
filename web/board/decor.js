// Decor: props, walls and procedural details.
import { S } from "./state.js";
import { tileImgs } from "./state.js";
import { TILE_H, TILE_W, ZOOM } from "./constants.js";
import { ctx } from "./dom.js";
import { elevAt, toIso } from "./layout.js";
import { decorBox, depthSort, drawCityProp, trafficItems } from "./city.js";
import { fillPoly, strokePoly } from "./canvas.js";

// ---- Decor --------------------------------------------------------------
export function tileTopPoint(gx, gy) {
  const h = elevAt(gx, gy);
  const p = toIso(gx + 0.5, gy + 0.5);
  return { x: p.sx, y: p.sy - h };
}


/** Procedural isometric props — diamond footprint + vertical faces (matches TILE_W/H). */
export function drawProcDecor(d, p) {
  const gx = d.gx + 0.5;
  const gy = d.gy + 0.5;
  const baseH = elevAt(d.gx, d.gy);
  const tw = (TILE_W / 2) * S.worldScale;
  const th = (TILE_H / 2) * S.worldScale;
  const t = d.type;
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  /** Screen point for fractional grid, raised by elev (tile height) + extra px. */
  function ipt(fgx, fgy, elev) {
    const p2 = toIso(fgx, fgy);
    return { x: p2.sx, y: p2.sy - elev };
  }

  /** Iso box: footprint [x0,y0]→[x1,y1] in grid, bottom at elev0, top at elev0+zh (px elev). */
  function isoBox(x0, y0, x1, y1, elev0, zh, topCol, leftCol, rightCol, edgeCol) {
    const bot = [
      ipt(x0, y0, elev0),
      ipt(x1, y0, elev0),
      ipt(x1, y1, elev0),
      ipt(x0, y1, elev0),
    ];
    const top = bot.map((p) => ({ x: p.x, y: p.y - zh }));
    // left face (SW→SE→up): indices 3→2
    fillPoly([top[3], top[2], bot[2], bot[3]], leftCol);
    // right face (NE→SE): indices 1→2
    fillPoly([top[1], top[2], bot[2], bot[1]], rightCol);
    // top
    fillPoly(top, topCol);
    if (edgeCol) strokePoly(top, edgeCol, 1);
    return { top, bot, left: [top[3], top[2], bot[2], bot[3]], right: [top[1], top[2], bot[2], bot[1]] };
  }

  /**
   * Flat axis-aligned window rectangles painted onto a vertical wall face.
   * Face quad order: [topA, topB, botB, botA]. Windows are NOT iso diamonds.
   */
  /**
   * Windows painted IN the iso wall-face plane (parallelograms along face edges).
   * Flat on the face — not screen-aligned rects, not floating 3D iso boxes.
   * Face quad order: [topA, topB, botB, botA].
   */
  function paintFaceWindows(face, rows, cols, fill, opts) {
    if (!face || face.length < 4) return;
    opts = opts || {};
    const padU = opts.padU != null ? opts.padU : 0.10;
    const padV = opts.padV != null ? opts.padV : 0.12;
    const gapU = opts.gapU != null ? opts.gapU : 0.06;
    const gapV = opts.gapV != null ? opts.gapV : 0.08;
    const glass = fill || "#f0d060";
    const glassHi = opts.glassHi || "#fff0a8";
    const glassLo = opts.glassLo || "#d0a028";
    const frame = opts.frame || "#1a1e28";
    const recess = opts.recess || "#0c1018";
    const mullion = opts.mullion || "#2a3040";
    const sill = opts.sill || "#3a4250";
    const panesX = opts.panesX != null ? opts.panesX : 2;
    const panesY = opts.panesY != null ? opts.panesY : 2;
    const [tA, tB, bB, bA] = face;

    function lerp(a, b, t) {
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    /** Map face UV → screen point on the wall parallelogram. */
    function at(u, v) {
      const top = lerp(tA, tB, u);
      const bot = lerp(bA, bB, u);
      return lerp(top, bot, v);
    }
    /** Quad on the face as [tl, tr, br, bl] in UV. */
    function faceQuad(u0, u1, v0, v1) {
      return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
    }
    function fillFaceQuad(u0, u1, v0, v1, col) {
      if (u1 <= u0 || v1 <= v0) return;
      fillPoly(faceQuad(u0, u1, v0, v1), col);
    }
    /** Thin strip along U or V for mullions/sills (still face-aligned). */
    function fillFaceStripU(u0, u1, v, thicknessV, col) {
      fillFaceQuad(u0, u1, v, Math.min(1, v + thicknessV), col);
    }
    function fillFaceStripV(v0, v1, u, thicknessU, col) {
      fillFaceQuad(u, Math.min(1, u + thicknessU), v0, v1, col);
    }

    const cellU = (1 - 2 * padU) / cols;
    const cellV = (1 - 2 * padV) / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const u0 = padU + c * cellU + gapU * 0.5;
        const u1 = padU + (c + 1) * cellU - gapU * 0.5;
        const v0 = padV + r * cellV + gapV * 0.5;
        const v1 = padV + (r + 1) * cellV - gapV * 0.5;
        if (u1 - u0 < 0.04 || v1 - v0 < 0.05) continue;

        const du = u1 - u0;
        const dv = v1 - v0;
        // Frame thickness in UV (~12% of window)
        const fu = Math.min(du * 0.14, 0.035);
        const fv = Math.min(dv * 0.14, 0.04);
        const sillV = Math.min(dv * 0.16, 0.045);

        // 1) Outer frame (full window parallelogram)
        fillFaceQuad(u0, u1, v0, v1, frame);

        // 2) Recess inset
        const ru0 = u0 + fu, ru1 = u1 - fu;
        const rv0 = v0 + fv, rv1 = v1 - sillV;
        if (ru1 > ru0 && rv1 > rv0) {
          fillFaceQuad(ru0, ru1, rv0, rv1, recess);

          // 3) Lit panes in a panesX × panesY grid (each pane is a face parallelogram)
          const paneGapU = Math.min((ru1 - ru0) * 0.06, 0.012);
          const paneGapV = Math.min((rv1 - rv0) * 0.06, 0.012);
          const paneU = (ru1 - ru0 - paneGapU * (panesX - 1)) / panesX;
          const paneV = (rv1 - rv0 - paneGapV * (panesY - 1)) / panesY;
          for (let py = 0; py < panesY; py++) {
            for (let px = 0; px < panesX; px++) {
              const pu0 = ru0 + px * (paneU + paneGapU);
              const pu1 = pu0 + paneU;
              const pv0 = rv0 + py * (paneV + paneGapV);
              const pv1 = pv0 + paneV;
              fillFaceQuad(pu0, pu1, pv0, pv1, glass);
              // highlight (top-left of pane, still face-aligned)
              fillFaceQuad(pu0, pu0 + paneU * 0.45, pv0, pv0 + paneV * 0.28, glassHi);
              // bottom shade strip on pane
              fillFaceQuad(pu0, pu1, pv1 - paneV * 0.12, pv1, glassLo);
            }
          }

          // 4) Mullions (face-aligned strips between panes)
          for (let m = 1; m < panesX; m++) {
            const mu = ru0 + m * (paneU + paneGapU) - paneGapU;
            fillFaceQuad(mu, mu + Math.max(paneGapU, 0.008), rv0, rv1, mullion);
          }
          for (let m = 1; m < panesY; m++) {
            const mv = rv0 + m * (paneV + paneGapV) - paneGapV;
            fillFaceQuad(ru0, ru1, mv, mv + Math.max(paneGapV, 0.008), mullion);
          }
        }

        // 5) Sill — face-aligned strip under the window, slightly proud in V
        const sillV0 = v1 - sillV;
        fillFaceQuad(u0 - gapU * 0.15, u1 + gapU * 0.15, sillV0, v1, sill);
        fillFaceQuad(u0, u1, sillV0, sillV0 + sillV * 0.35, "#5a6470");
      }
    }
  }

  /** Solid flat door rect on a wall face (bottom centre). */
  function paintFaceDoor(face, fill, wFrac, hFrac) {
    if (!face || face.length < 4) return;
    const [tA, tB, bB, bA] = face;
    function lerp(a, b, t) {
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    function at(u, v) {
      const top = lerp(tA, tB, u);
      const bot = lerp(bA, bB, u);
      return lerp(top, bot, v);
    }
    const u0 = 0.5 - wFrac / 2, u1 = 0.5 + wFrac / 2;
    const v0 = 1 - hFrac, v1 = 0.98;
    fillPoly([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], fill || "#1a1018");
    // door frame edge
    strokePoly([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], "#0a080c", 1);
  }


  /** Dense skyline-style panes: simple dark/lit face parallelograms (no chunky frames). */
  function paintFaceWindowGrid(face, rows, cols, opts) {
    if (!face || face.length < 4) return;
    opts = opts || {};
    const padU = opts.padU != null ? opts.padU : 0.06;
    const padV = opts.padV != null ? opts.padV : 0.06;
    const gapU = opts.gapU != null ? opts.gapU : 0.018;
    const gapV = opts.gapV != null ? opts.gapV : 0.022;
    const dark = opts.dark || "#1a2230";
    const lit = opts.lit || "#e8d878";
    const lit2 = opts.lit2 || "#a8d0f0";
    const seed = opts.seed || 1;
    const [tA, tB, bB, bA] = face;
    function lerp(a, b, t) {
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    function at(u, v) {
      const top = lerp(tA, tB, u);
      const bot = lerp(bA, bB, u);
      return lerp(top, bot, v);
    }
    const cellU = (1 - 2 * padU) / cols;
    const cellV = (1 - 2 * padV) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const u0 = padU + c * cellU + gapU * 0.5;
        const u1 = padU + (c + 1) * cellU - gapU * 0.5;
        const v0 = padV + r * cellV + gapV * 0.5;
        const v1 = padV + (r + 1) * cellV - gapV * 0.5;
        if (u1 <= u0 || v1 <= v0) continue;
        const h = ((seed * 17 + r * 31 + c * 13) >>> 0) % 10;
        const col = h < 2 ? lit : (h < 3 ? lit2 : dark);
        fillPoly([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], col);
      }
    }
  }

  /** Flat iso diamond pad (no height). */
  function isoPad(x0, y0, x1, y1, elev0, col, edge) {
    const top = [
      ipt(x0, y0, elev0),
      ipt(x1, y0, elev0),
      ipt(x1, y1, elev0),
      ipt(x0, y1, elev0),
    ];
    fillPoly(top, col);
    if (edge) strokePoly(top, edge, 1);
    return top;
  }

  // Anchor footprint centred on cell; sizes in grid units
  const cx = gx;
  const cy = gy;
  const e0 = baseH;

  if (t === "proc_desk") {
    // Desk top ~1.1×0.7 tiles, legs via short box
    isoBox(cx - 0.55, cy - 0.35, cx + 0.55, cy + 0.35, e0, 10, "#c4a070", "#7a5838", "#9a7048", "#3a2410");
    isoBox(cx - 0.55, cy - 0.35, cx + 0.55, cy + 0.35, e0 + 10, 4, "#e0c090", "#8a6840", "#a87850", "#4a3018");
    // Chair tucked under south edge
    isoBox(cx - 0.22, cy + 0.15, cx + 0.22, cy + 0.55, e0, 7, "#4a6080", "#2a3848", "#3a4c60", "#101820");
    isoBox(cx - 0.18, cy + 0.18, cx + 0.18, cy + 0.35, e0 + 7, 9, "#5a7898", "#304050", "#405868", "#101820");
    // Monitor on desk
    isoBox(cx - 0.28, cy - 0.22, cx + 0.05, cy + 0.05, e0 + 14, 12, "#2a2a34", "#14141c", "#1e1e28", "#06060a");
    isoBox(cx - 0.24, cy - 0.18, cx + 0.0, cy + 0.0, e0 + 16, 8, "#6ec8ff", "#2a6a90", "#3a88b0", null);
    // Keyboard
    isoBox(cx + 0.08, cy - 0.08, cx + 0.42, cy + 0.18, e0 + 14, 2, "#d0d0d8", "#808088", "#a0a0a8", "#404048");
  } else if (t === "proc_chair") {
    isoBox(cx - 0.28, cy - 0.28, cx + 0.28, cy + 0.28, e0, 6, "#3a4a58", "#1a2834", "#2a3848", "#0a1018");
    isoBox(cx - 0.24, cy - 0.3, cx + 0.24, cy - 0.05, e0 + 6, 12, "#4a6a88", "#243848", "#345868", "#101820");
  } else if (t === "proc_monitor") {
    isoBox(cx - 0.15, cy - 0.1, cx + 0.15, cy + 0.15, e0, 5, "#404048", "#202028", "#303038", "#101014");
    isoBox(cx - 0.42, cy - 0.22, cx + 0.42, cy + 0.18, e0 + 5, 14, "#2a2a32", "#101018", "#1a1a22", "#06060a");
    isoBox(cx - 0.36, cy - 0.16, cx + 0.36, cy + 0.12, e0 + 7, 10, "#5ec8ff", "#2878a0", "#3a98c0", null);
  } else if (t === "proc_pc") {
    isoBox(cx - 0.28, cy - 0.2, cx + 0.05, cy + 0.25, e0, 18, "#4a4a58", "#222230", "#343444", "#101018");
    isoBox(cx - 0.22, cy - 0.12, cx - 0.08, cy - 0.02, e0 + 12, 2, "#3DDC97", "#1a6840", "#2a8850", null);
    isoBox(cx + 0.1, cy - 0.15, cx + 0.45, cy + 0.2, e0, 3, "#c8c8d0", "#707078", "#909098", "#404048");
  } else if (t === "proc_whiteboard") {
    isoBox(cx - 0.12, cy - 0.12, cx + 0.12, cy + 0.12, e0, 8, "#8a8a90", "#505058", "#606068", "#303038");
    isoBox(cx - 0.55, cy - 0.2, cx + 0.55, cy + 0.15, e0 + 8, 22, "#f4f8fc", "#b0b8c0", "#d0d8e0", "#2a3a48");
    // marker lines
    const topY = e0 + 20;
    ctx.strokeStyle = "#3a7ab0";
    ctx.lineWidth = 1.5;
    const a = ipt(cx - 0.35, cy - 0.05, topY);
    const b = ipt(cx + 0.3, cy + 0.05, topY);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  } else if (t === "proc_qa") {
    isoBox(cx - 0.5, cy - 0.3, cx + 0.5, cy + 0.3, e0, 10, "#9080b0", "#504068", "#706088", "#2a2040");
    isoBox(cx - 0.35, cy - 0.2, cx + 0.35, cy + 0.15, e0 + 10, 10, "#e8e0f0", "#a090b0", "#c0b0d0", "#403060");
    isoBox(cx - 0.2, cy - 0.08, cx - 0.05, cy + 0.05, e0 + 16, 3, "#3DDC97", null, null, null);
    isoBox(cx + 0.05, cy - 0.08, cx + 0.2, cy + 0.05, e0 + 16, 3, "#e85a5a", null, null, null);
  } else if (t === "proc_sofa") {
    isoBox(cx - 0.7, cy - 0.35, cx + 0.7, cy + 0.4, e0, 8, "#d08858", "#804828", "#a06838", "#4a2818");
    isoBox(cx - 0.7, cy - 0.4, cx - 0.35, cy + 0.05, e0 + 8, 10, "#c07850", "#704020", "#905830", "#4a2818");
    isoBox(cx + 0.35, cy - 0.4, cx + 0.7, cy + 0.05, e0 + 8, 10, "#c07850", "#704020", "#905830", "#4a2818");
    isoBox(cx - 0.55, cy - 0.25, cx + 0.55, cy + 0.25, e0 + 8, 4, "#e0a070", "#905828", "#b07840", null);
  } else if (t === "proc_plant") {
    isoBox(cx - 0.22, cy - 0.22, cx + 0.22, cy + 0.22, e0, 6, "#8a6040", "#5a3820", "#6a4830", "#3a2010");
    // foliage as stacked small iso blobs
    isoBox(cx - 0.35, cy - 0.35, cx + 0.35, cy + 0.35, e0 + 6, 8, "#48b068", "#1a6830", "#2a8840", "#0e4020");
    isoBox(cx - 0.25, cy - 0.25, cx + 0.25, cy + 0.25, e0 + 12, 8, "#58c878", "#228840", "#38a050", "#146028");
  } else if (t === "proc_cooler") {
    isoBox(cx - 0.32, cy - 0.28, cx + 0.32, cy + 0.32, e0, 22, "#d8e0e8", "#788090", "#98a0b0", "#404850");
    isoBox(cx - 0.22, cy - 0.18, cx + 0.22, cy + 0.18, e0 + 12, 8, "#70c0e8", "#2878a0", "#4098c0", "#185868");
  } else if (t === "proc_coffee") {
    isoBox(cx - 0.45, cy - 0.35, cx + 0.45, cy + 0.35, e0, 12, "#8a6a50", "#5a3a28", "#6a4a38", "#2a1810");
    isoBox(cx - 0.28, cy - 0.22, cx + 0.28, cy + 0.18, e0 + 12, 14, "#e0d8d0", "#908880", "#b0a8a0", "#504840");
    isoBox(cx - 0.18, cy - 0.12, cx + 0.18, cy + 0.08, e0 + 18, 6, "#4a3020", "#2a1810", "#3a2818", null);
  } else if (t === "proc_cabinet") {
    isoBox(cx - 0.4, cy - 0.3, cx + 0.4, cy + 0.35, e0, 24, "#a09078", "#605040", "#807060", "#3a3028");
    isoBox(cx - 0.32, cy - 0.2, cx - 0.02, cy + 0.15, e0 + 4, 8, "#b8a890", "#706050", "#908070", "#403830");
    isoBox(cx + 0.02, cy - 0.2, cx + 0.32, cy + 0.15, e0 + 4, 8, "#b8a890", "#706050", "#908070", "#403830");
  } else if (t === "proc_lamp") {
    // Double-globe street lamp
    isoBox(cx - 0.08, cy - 0.08, cx + 0.08, cy + 0.08, e0, 30, "#e8eef4", "#687078", "#889098", "#303840");
    isoBox(cx - 0.2, cy - 0.2, cx - 0.02, cy - 0.02, e0 + 28, 5, "#fff2a0", "#c0a040", "#e0c060", "#806020");
    isoBox(cx + 0.02, cy - 0.2, cx + 0.2, cy - 0.02, e0 + 28, 5, "#fff2a0", "#c0a040", "#e0c060", "#806020");
  } else if (t === "proc_building") {
    // Tall isometric skyscraper — dense dark/lit window grids on faces (skyline ref vibe)
    const v = (d.variant || 0) % 3;
    const palettes = [
      { top: "#d8dde8", left: "#6a7388", right: "#9aa3b8", roof: "#c0c8d4", edge: "#2a3040" },
      { top: "#e8d8c0", left: "#8a6848", right: "#b09068", roof: "#d0b890", edge: "#403020" },
      { top: "#c8d8e8", left: "#486888", right: "#6890b0", roof: "#a0b8d0", edge: "#183048" },
    ];
    const pal = palettes[v];
    const bw = 0.95 + (v === 0 ? 0.15 : 0);
    const bd = 0.8 + (v === 2 ? 0.1 : 0);
    const H = v === 0 ? 192 : (v === 1 ? 172 : 158);
    const body = isoBox(cx - bw, cy - bd, cx + bw, cy + bd, e0, H, pal.top, pal.left, pal.right, pal.edge);
    isoBox(cx - bw + 0.1, cy - bd + 0.1, cx + bw - 0.1, cy + bd - 0.1, e0 + H, 4, pal.roof, pal.left, pal.right, pal.edge);
    // Helipad hint on tallest
    if (v === 0) {
      isoPad(cx - 0.25, cy - 0.15, cx + 0.25, cy + 0.15, e0 + H + 4, "#f0f4f8", "#303848");
    }
    const rows = v === 0 ? 11 : (v === 1 ? 8 : 6);
    const colsL = v === 0 ? 5 : 4;
    const colsR = v === 0 ? 4 : 3;
    paintFaceWindowGrid(body.left, rows, colsL, { seed: 11 + v * 7, dark: "#152030", lit: "#f0d860", lit2: "#90c8f0" });
    paintFaceWindowGrid(body.right, rows, colsR, { seed: 29 + v * 5, dark: "#101828", lit: "#e8d050", lit2: "#88c0e8" });
    paintFaceDoor(body.left, "#1a1018", 0.22, 0.12);
  } else if (t === "proc_shop") {
    // Colourful storefront + striped awning
    const v = (d.variant || 0) % 4;
    const bodies = [
      { top: "#ff6b8a", left: "#a02848", right: "#d04068", roof: "#c02040" },
      { top: "#5ec8ff", left: "#186898", right: "#2890c0", roof: "#106080" },
      { top: "#ffc048", left: "#a06818", right: "#d08828", roof: "#905010" },
      { top: "#7ae070", left: "#288038", right: "#40a850", roof: "#186828" },
    ];
    const awn = [
      ["#fff0a0", "#e85858"],
      ["#ffffff", "#3a7ad0"],
      ["#fff8d0", "#f09030"],
      ["#e8ffe8", "#e04080"],
    ];
    const pal = bodies[v];
    const shop = isoBox(cx - 0.85, cy - 0.6, cx + 0.85, cy + 0.6, e0, 30, pal.top, pal.left, pal.right, "#280810");
    // Striped awning (alternating iso strips)
    const [a0, a1] = awn[v];
    for (let s = 0; s < 6; s++) {
      const t0 = -0.9 + s * 0.3;
      const col = s % 2 === 0 ? a0 : a1;
      isoBox(cx + t0, cy + 0.05, cx + t0 + 0.28, cy + 0.65, e0 + 14, 5, col, pal.left, pal.right, null);
    }
    // Big glass storefront panes
    paintFaceWindows(shop.left, 1, 2, "#c8f0ff", {
      padU: 0.08, padV: 0.32, gapU: 0.06, gapV: 0.05,
      panesX: 2, panesY: 1,
      glassHi: "#f0fbff", glassLo: "#4890b0",
      frame: "#2a1018", recess: "#100808", mullion: "#3a2028", sill: "#5a3038",
    });
    paintFaceWindows(shop.right, 1, 1, "#c8f0ff", {
      padU: 0.16, padV: 0.32, gapU: 0.06, gapV: 0.05,
      panesX: 2, panesY: 1,
      glassHi: "#f0fbff", glassLo: "#4890b0",
      frame: "#2a1018", recess: "#100808", mullion: "#3a2028", sill: "#5a3038",
    });
    paintFaceDoor(shop.left, "#2a1810", 0.2, 0.4);
    isoBox(cx - 0.8, cy - 0.55, cx + 0.8, cy + 0.55, e0 + 30, 5, pal.roof, pal.left, pal.right, "#200810");
  } else if (t === "proc_cafe") {
    // Cafe kiosk + striped umbrella
    const cafe = isoBox(cx - 0.55, cy - 0.45, cx + 0.55, cy + 0.45, e0, 18, "#f0e0c8", "#8a6848", "#b09068", "#403020");
    paintFaceDoor(cafe.left, "#3a2818", 0.35, 0.55);
    // Umbrella pole + canopy
    isoBox(cx - 0.06, cy - 0.06, cx + 0.06, cy + 0.06, e0 + 18, 16, "#d0d0d8", "#606068", "#808088", null);
    const stripes = ["#e84848", "#f8f8f8", "#e84848", "#f8f8f8"];
    for (let s = 0; s < 4; s++) {
      const a = -0.55 + s * 0.28;
      isoBox(cx + a, cy - 0.45, cx + a + 0.26, cy + 0.35, e0 + 32, 4, stripes[s], "#802020", "#a03030", null);
    }
  } else if (t === "proc_umbrella") {
    isoBox(cx - 0.06, cy - 0.06, cx + 0.06, cy + 0.06, e0, 18, "#c8c8d0", "#585860", "#787880", null);
    const cols = ["#3a7ad0", "#f0f4f8", "#3a7ad0", "#f0f4f8"];
    for (let s = 0; s < 4; s++) {
      const a = -0.5 + s * 0.26;
      isoBox(cx + a, cy - 0.4, cx + a + 0.24, cy + 0.3, e0 + 16, 4, cols[s], "#184878", "#2868a0", null);
    }
  } else if (t === "proc_tree_round") {
    isoBox(cx - 0.18, cy - 0.18, cx + 0.18, cy + 0.18, e0, 10, "#6a4830", "#3a2818", "#4a3820", "#201810");
    isoBox(cx - 0.55, cy - 0.5, cx + 0.55, cy + 0.5, e0 + 8, 10, "#48b060", "#1a6830", "#2a8840", "#0e4020");
    isoBox(cx - 0.4, cy - 0.38, cx + 0.4, cy + 0.38, e0 + 16, 10, "#58c870", "#228840", "#38a850", "#146028");
  } else if (t === "proc_kiosk") {

    isoBox(cx - 0.4, cy - 0.35, cx + 0.4, cy + 0.35, e0, 26, "#4a5a70", "#1e2838", "#2e3c50", "#101820");
    isoBox(cx - 0.3, cy - 0.15, cx + 0.3, cy + 0.25, e0 + 10, 10, "#60e0c0", "#208068", "#30a088", "#104838");
  } else if (t === "proc_crane") {
    isoBox(cx - 0.15, cy - 0.15, cx + 0.15, cy + 0.15, e0, 40, "#e09030", "#805018", "#a07028", "#603010");
    isoBox(cx - 0.1, cy - 0.1, cx + 0.9, cy + 0.15, e0 + 36, 5, "#e09030", "#805018", "#a07028", "#603010");
    isoBox(cx + 0.7, cy - 0.08, cx + 0.85, cy + 0.1, e0 + 20, 16, "#808890", "#404850", "#586068", "#202428");
  } else if (t === "proc_meter") {
    isoBox(cx - 0.4, cy - 0.3, cx + 0.4, cy + 0.3, e0, 16, "#685888", "#302848", "#483868", "#201030");
    isoBox(cx - 0.25, cy - 0.15, cx + 0.25, cy + 0.15, e0 + 10, 6, "#a0ff80", "#408040", "#60c060", "#204820");
  } else if (t === "proc_bench_city") {
    isoBox(cx - 0.6, cy - 0.25, cx + 0.6, cy + 0.3, e0, 7, "#7a8a58", "#3a4830", "#5a6840", "#2a3020");
    isoBox(cx - 0.55, cy + 0.15, cx - 0.4, cy + 0.3, e0, 5, "#4a5038", "#2a3020", "#3a4030", null);
    isoBox(cx + 0.4, cy + 0.15, cx + 0.55, cy + 0.3, e0, 5, "#4a5038", "#2a3020", "#3a4030", null);
  } else if (t === "proc_console") {
    isoBox(cx - 0.55, cy - 0.35, cx + 0.55, cy + 0.35, e0, 12, "#4a5568", "#1e2838", "#2e3c50", "#101820");
    isoBox(cx - 0.4, cy - 0.28, cx + 0.4, cy + 0.15, e0 + 12, 14, "#1a2838", "#60e0ff", "#2a4860", "#60e0ff");
    isoBox(cx - 0.25, cy - 0.12, cx - 0.05, cy + 0.0, e0 + 18, 3, "#60e0ff", null, null, null);
    isoBox(cx + 0.05, cy - 0.12, cx + 0.25, cy + 0.0, e0 + 18, 3, "#e09030", null, null, null);
  } else if (t === "proc_holo") {
    isoBox(cx - 0.4, cy - 0.3, cx + 0.4, cy + 0.3, e0, 6, "#2a3848", "#101820", "#1a2838", "#60e0ff");
    ctx.globalAlpha = 0.45;
    isoBox(cx - 0.25, cy - 0.2, cx + 0.25, cy + 0.15, e0 + 6, 18, "#60e0ff", "#2080a0", "#40a0c0", "#60e0ff");
    ctx.globalAlpha = 1;
  } else if (t === "proc_scanner") {
    isoBox(cx - 0.35, cy - 0.3, cx + 0.35, cy + 0.3, e0, 10, "#504070", "#281848", "#383060", "#a080ff");
    isoBox(cx - 0.15, cy - 0.15, cx + 0.15, cy + 0.15, e0 + 10, 16, "#c0a0ff", "#6040a0", "#8060c0", "#e080ff");
  } else if (t === "proc_dome") {
    // Stacked rings ≈ hemisphere module
    isoBox(cx - 0.7, cy - 0.55, cx + 0.7, cy + 0.55, e0, 6, "#1a2838", "#0a1018", "#121c28", "#60e0ff");
    ctx.globalAlpha = 0.55;
    isoBox(cx - 0.55, cy - 0.45, cx + 0.55, cy + 0.45, e0 + 6, 10, "#80d0ff", "#206080", "#4080a0", "#60e0ff");
    isoBox(cx - 0.35, cy - 0.3, cx + 0.35, cy + 0.3, e0 + 14, 10, "#a0e0ff", "#3080a0", "#50a0c0", "#60e0ff");
    ctx.globalAlpha = 1;
  } else if (t === "proc_antenna") {
    isoBox(cx - 0.12, cy - 0.12, cx + 0.12, cy + 0.12, e0, 32, "#7a8898", "#3a4858", "#5a6878", "#203040");
    isoBox(cx - 0.35, cy - 0.1, cx + 0.35, cy + 0.25, e0 + 28, 4, "#8a98a8", "#405060", "#607080", "#60e0ff");
    isoBox(cx - 0.08, cy - 0.08, cx + 0.08, cy + 0.08, e0 + 32, 4, "#e05050", "#802020", "#a03030", null);
  } else if (t === "proc_crate") {
    isoBox(cx - 0.4, cy - 0.35, cx + 0.4, cy + 0.35, e0, 14, "#5a6880", "#2a3848", "#3a4c60", "#60e0ff");
    isoBox(cx - 0.4, cy - 0.35, cx + 0.4, cy + 0.35, e0 + 12, 3, "#60e0ff", "#2080a0", "#40a0c0", null);
  } else if (t === "proc_satellite") {
    isoBox(cx - 0.38, cy - 0.3, cx + 0.38, cy + 0.3, e0 + 10, 14, "#b0c0d0", "#506070", "#708090", "#203040");
    isoBox(cx - 1.15, cy - 0.18, cx - 0.42, cy + 0.18, e0 + 14, 3, "#4a78b8", "#204060", "#306898", "#60e0ff");
    isoBox(cx + 0.42, cy - 0.18, cx + 1.15, cy + 0.18, e0 + 14, 3, "#4a78b8", "#204060", "#306898", "#60e0ff");
    isoBox(cx - 0.22, cy - 0.5, cx + 0.22, cy - 0.2, e0 + 16, 4, "#d0e0f0", "#608090", "#80a8c0", "#60e0ff");
    isoBox(cx - 0.08, cy - 0.08, cx + 0.08, cy + 0.08, e0 + 22, 3, "#e05050", "#801818", "#a02828", null);
  } else {
    // Unknown — small iso marker
    isoBox(cx - 0.2, cy - 0.2, cx + 0.2, cy + 0.2, e0, 8, "#888", "#444", "#666", "#222");
  }
  ctx.restore();
}

export function drawDecorItem(d) {
  if (d.city) {
    drawCityProp(d);
    return;
  }
  const p = tileTopPoint(d.gx, d.gy);
  let path = null;
  let scale = 1.35 * ZOOM;
  let ox = 0, oy = 0;
  if (d.type === "pine") {
    path = `tiles/pine_${d.variant || 0}.png`;
    scale = 1.45 * ZOOM;
    oy = -2;
  } else if (d.type === "bush") {
    path = "tiles/bush.png";
    scale = 1.25 * ZOOM;
  } else if (d.type === "rock_grey") {
    path = "tiles/rock_grey.png";
    scale = 1.25 * ZOOM;
  } else if (d.type === "rock_brown") {
    path = "tiles/rock_brown.png";
    scale = 1.25 * ZOOM;
  } else if (d.type.startsWith("flower")) {
    path = `tiles/${d.type}.png`;
    scale = 1.15 * ZOOM;
  } else if (d.type && d.type.startsWith("prop_")) {
    path = `tiles/${d.type}.png`;
    scale = 1.55 * ZOOM;
    oy = -1;
  } else if (d.type && d.type.startsWith("proc_")) {
    drawProcDecor(d, p);
    return;
  }
  if (!path) return;
  const img = tileImgs.get(path);
  if (!img || !img.complete || !img.naturalWidth) return;
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, p.x - w / 2 + ox, p.y - h + 4 + oy, w, h);
}

export function drawDecor() {
  const movers = trafficItems("street");
  if (!movers.length) {
    for (const d of S.decor) drawDecorItem(d);
    return;
  }
  const items = S.decor.map((d) => ({ box: decorBox(d), draw: () => drawDecorItem(d) })).concat(movers);
  for (const it of depthSort(items)) it.draw();
}
