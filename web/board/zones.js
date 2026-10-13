// Rooms, signs and floating room chips.
import { S } from "./state.js";
import { ZONE_ART, ZONE_PROPS, tileImgs } from "./state.js";
import { BASE_ELEV, SIGN_SRC_H, SIGN_SRC_W, UI_FONT, ZOOM } from "./constants.js";
import { ctx } from "./dom.js";
import { elevAt, layoutFor, toIso } from "./layout.js";
import { depthSort, drawZoneInterior, trafficItems, zoneInterior } from "./city.js";
import { fillPoly } from "./canvas.js";

// ---- Zone rooms / plateaus ----------------------------------------------
/** Iso diamond for a footprint rectangle at a given elev. */
export function footprintTop(L, elev) {
  const nw = toIso(L.gx, L.gy);
  const ne = toIso(L.gx + L.gw, L.gy);
  const se = toIso(L.gx + L.gw, L.gy + L.gh);
  const sw = toIso(L.gx, L.gy + L.gh);
  return [
    { x: nw.sx, y: nw.sy - elev },
    { x: ne.sx, y: ne.sy - elev },
    { x: se.sx, y: se.sy - elev },
    { x: sw.sx, y: sw.sy - elev },
  ];
}

/** Draw a low wall / parapet along one edge (skip doorway for entrance gap). */
export function drawRoomWallEdge(L, elev, edge, za, wallH) {
  // edge: 0=NW→NE (N), 1=NE→SE (E), 2=SE→SW (S), 3=SW→NW (W)
  const door = L.door;
  const hasDoor =
    (edge === 0 && door === "N") ||
    (edge === 1 && door === "E") ||
    (edge === 2 && door === "S") ||
    (edge === 3 && door === "W");

  const corners = [
    [L.gx, L.gy],
    [L.gx + L.gw, L.gy],
    [L.gx + L.gw, L.gy + L.gh],
    [L.gx, L.gy + L.gh],
  ];
  const a = corners[edge];
  const b = corners[(edge + 1) % 4];
  // If doorway: draw two side pillars, leave centre gap
  const segs = hasDoor ? [[0, 0.28], [0.72, 1]] : [[0, 1]];
  const thickness = 0.14; // inward wall thickness in grid units

  for (const [t0, t1] of segs) {
    const ax = a[0] + (b[0] - a[0]) * t0;
    const ay = a[1] + (b[1] - a[1]) * t0;
    const bx = a[0] + (b[0] - a[0]) * t1;
    const by = a[1] + (b[1] - a[1]) * t1;
    // Inward normal (toward room centre)
    const cx = L.gx + L.gw / 2;
    const cy = L.gy + L.gh / 2;
    const midx = (ax + bx) / 2;
    const midy = (ay + by) / 2;
    let nx = cx - midx;
    let ny = cy - midy;
    const nlen = Math.hypot(nx, ny) || 1;
    nx = (nx / nlen) * thickness;
    ny = (ny / nlen) * thickness;

    const o0 = toIso(ax, ay);
    const o1 = toIso(bx, by);
    const i0 = toIso(ax + nx, ay + ny);
    const i1 = toIso(bx + nx, by + ny);

    const oTop0 = { x: o0.sx, y: o0.sy - elev - wallH };
    const oTop1 = { x: o1.sx, y: o1.sy - elev - wallH };
    const iTop0 = { x: i0.sx, y: i0.sy - elev - wallH };
    const iTop1 = { x: i1.sx, y: i1.sy - elev - wallH };
    const oBot0 = { x: o0.sx, y: o0.sy - elev };
    const oBot1 = { x: o1.sx, y: o1.sy - elev };

    // Outer vertical face
    fillPoly([oTop0, oTop1, oBot1, oBot0], za.wall || za.d);
    // Top cap (parapet walk)
    fillPoly([oTop0, oTop1, iTop1, iTop0], za.wallLit || za.b);
    // Inner face hint
    fillPoly(
      [iTop0, iTop1, { x: i1.sx, y: i1.sy - elev }, { x: i0.sx, y: i0.sy - elev }],
      za.wall || za.d
    );
    // Cap edge highlight
    ctx.save();
    ctx.strokeStyle = za.floorHi || za.c;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(oTop0.x, oTop0.y);
    ctx.lineTo(oTop1.x, oTop1.y);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawZonePlateaus() {
  // Draw in depth order (gx+gy); City side-street traffic is interleaved by footprint
  const entries = Object.entries(S.runtimeLayout).sort(
    (a, b) => (a[1].gx + a[1].gy) - (b[1].gx + b[1].gy)
  );
  const movers = trafficItems("zones");
  if (!movers.length) {
    for (const [zid, L] of entries) drawOneZone(zid, L);
    return;
  }
  const items = entries.map(([zid, L]) => ({
    box: [L.gx, L.gy, L.gx + L.gw, L.gy + L.gh],
    draw: () => drawOneZone(zid, L),
  })).concat(movers);
  for (const it of depthSort(items)) it.draw();
}

export function drawOneZone(zid, L) {
    const za = ZONE_ART[zid];
    if (!za) return;
    const elev = BASE_ELEV + (L.elevOffset || 0);
    const top = footprintTop(L, elev);
    const interior = zoneInterior(zid);
    if (interior && drawZoneInterior(zid, L, interior)) return;
    ctx.save();

    // Drop shadow under room — separates from shared island grass
    if (zid !== "idle") {
      const shadow = footprintTop(L, elev - 8);
      ctx.globalAlpha = 0.32;
      fillPoly(
        shadow.map((p, i) => ({ x: p.x + 6, y: top[i].y + 14 })),
        "#121816"
      );
      ctx.globalAlpha = 1;
    }

    if (L.enclosed) {
      // Solid room floor wash (reads as interior, not grass tint)
      ctx.globalAlpha = 0.55;
      fillPoly(top, za.floor || za.a);
      ctx.globalAlpha = 0.22;
      fillPoly(top, za.floorHi || za.c);
      ctx.globalAlpha = 1;

      // Low walls / raised rim on three+ sides (doorway gap left open)
      const wallH = 15;
      for (let e = 0; e < 4; e++) drawRoomWallEdge(L, elev, e, za, wallH);

      // Outer plateau edge
      ctx.strokeStyle = za.edge;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(top[0].x, top[0].y);
      for (let i = 1; i < top.length; i++) ctx.lineTo(top[i].x, top[i].y);
      ctx.closePath();
      ctx.stroke();

      // Inner floor inset ring (being-inside feel)
      const inset = 0.22;
      const inner = footprintTop(
        { gx: L.gx + inset, gy: L.gy + inset, gw: L.gw - inset * 2, gh: L.gh - inset * 2 },
        elev
      );
      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = za.ring;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(inner[0].x, inner[0].y);
      for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i].x, inner[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Doorway threshold tick marks on the open edge
      if (L.door) {
        const mid = {
          N: [L.gx + L.gw / 2, L.gy],
          S: [L.gx + L.gw / 2, L.gy + L.gh],
          E: [L.gx + L.gw, L.gy + L.gh / 2],
          W: [L.gx, L.gy + L.gh / 2],
        }[L.door];
        if (mid) {
          const p = toIso(mid[0], mid[1]);
          ctx.fillStyle = za.floorHi || za.c;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(Math.round(p.sx - 5), Math.round(p.sy - elev - 2), 10, 3);
          ctx.globalAlpha = 1;
        }
      }
    } else {
      // Idle: open courtyard — soft path ring only
      ctx.globalAlpha = 0.14;
      fillPoly(top, za.a);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = za.edge;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(top[0].x, top[0].y);
      for (let i = 1; i < top.length; i++) ctx.lineTo(top[i].x, top[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
}

// ---- Zone markers + floating UI chips -----------------------------------
export function roundRectPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Compact wooden sign — decorative marker only (no plaque text). */
export function drawZoneSigns() {
  const zones = S.status?.zones || [];
  for (const z of zones) {
    const L = layoutFor(z.id);
    if (!L) continue;
    if (zoneInterior(z.id)) continue; // name is painted inside the room
    // NW corner of footprint — small footprint so tiles stay readable
    const sgx = L.gx + 0.4;
    const sgy = L.gy + 0.35;
    const elev = elevAt(sgx, sgy);
    const p = toIso(sgx, sgy);
    const groundX = p.sx;
    const groundY = p.sy - elev;

    const signStyle = (S.activeTheme?.sign?.style) || "wood";
    const sign = tileImgs.get("tiles/sign.png");
    const signScale = 0.68 * ZOOM; // compact marker; labels live on UI chips
    let signTop = groundY - 28;
    let sw = 28;
    if (signStyle === "wood" && sign && sign.complete && sign.naturalWidth) {
      const srcW = sign.naturalWidth || SIGN_SRC_W;
      const srcH = sign.naturalHeight || SIGN_SRC_H;
      sw = srcW * signScale;
      const sh = srcH * signScale;
      const signLeft = groundX - sw / 2;
      signTop = groundY - sh + 4;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sign, signLeft, signTop, sw, sh);
    } else if (signStyle === "plaque") {
      sw = 30;
      signTop = groundY - 26;
      ctx.fillStyle = "#c8d0d8";
      ctx.fillRect(groundX - 15, signTop, 30, 16);
      ctx.strokeStyle = "#3a4a58";
      ctx.strokeRect(groundX - 14.5, signTop + 0.5, 29, 15);
      ctx.fillStyle = "#6a7078";
      ctx.fillRect(groundX - 2, groundY - 10, 4, 10);
    } else if (signStyle === "street") {
      sw = 22;
      signTop = groundY - 36;
      ctx.fillStyle = "#3a3e46";
      ctx.fillRect(groundX - 2, groundY - 34, 4, 30);
      ctx.fillStyle = "#2a6a40";
      ctx.fillRect(groundX - 14, signTop, 28, 14);
      ctx.strokeStyle = "#e8f0e8";
      ctx.strokeRect(groundX - 13.5, signTop + 0.5, 27, 13);
    } else if (signStyle === "holo") {
      sw = 28;
      signTop = groundY - 30;
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#1a3048";
      ctx.fillRect(groundX - 14, signTop, 28, 16);
      ctx.strokeStyle = "#60e0ff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(groundX - 13.5, signTop + 0.5, 27, 15);
      ctx.restore();
      ctx.fillStyle = "#60e0ff";
      ctx.fillRect(groundX - 1, groundY - 14, 2, 12);
    } else {
      ctx.fillStyle = "#c6a06a";
      ctx.fillRect(groundX - 14, groundY - 28, 28, 16);
      ctx.fillStyle = "#8a6238";
      ctx.fillRect(groundX - 2, groundY - 12, 4, 14);
    }

    // Small motif sprite just to the right of the wooden sign
    const zp = ZONE_PROPS[z.id];
    if (zp) {
      const motif = tileImgs.get(`tiles/${zp.motif}.png`);
      if (motif && motif.complete && motif.naturalWidth) {
        const ms = 1.35 * ZOOM;
        const mw = motif.naturalWidth * ms;
        const mh = motif.naturalHeight * ms;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(motif, groundX + sw * 0.42, signTop + 2, mw, mh);
      }
    }
  }
}

/** Readable floating UI chips for zone labels (sans-serif) + motif icon. */
export function drawZoneChips() {
  const zones = S.status?.zones || [];
  for (const z of zones) {
    const L = layoutFor(z.id);
    if (!L) continue;
    if (zoneInterior(z.id)) continue; // name is painted inside the room
    const elev = BASE_ELEV + (L.elevOffset || 0);
    // NW of footprint (near wooden marker) — keeps chips clear of bot stands/bubbles
    const cgx = L.gx + 0.75;
    const cgy = L.gy + 0.15;
    const p = toIso(cgx, cgy);
    const label = z.label || z.id;
    const cx = p.sx;
    const cy = p.sy - elev - 34;

    ctx.save();
    ctx.font = `600 12px ${UI_FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width;
    const padL = 26; // room for motif sprite
    const padR = 10;
    const bw = Math.ceil(tw + padL + padR);
    const bh = 24;
    const bx = Math.round(cx - bw / 2);
    const by = Math.round(cy - bh / 2);

    // soft shadow
    ctx.fillStyle = "rgba(30, 50, 45, 0.18)";
    roundRectPath(bx + 1, by + 2, bw, bh, 8);
    ctx.fill();

    // chip body
    const za = ZONE_ART[z.id];
    ctx.fillStyle = "rgba(255, 252, 245, 0.94)";
    roundRectPath(bx, by, bw, bh, 8);
    ctx.fill();
    ctx.strokeStyle = za ? za.edge : "rgba(40, 70, 60, 0.45)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // motif icon (fallback: accent dot)
    const zp = ZONE_PROPS[z.id];
    const motif = zp ? tileImgs.get(`tiles/${zp.motif}.png`) : null;
    if (motif && motif.complete && motif.naturalWidth) {
      const ms = 1.05;
      const mw = motif.naturalWidth * ms;
      const mh = motif.naturalHeight * ms;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(motif, bx + 5, by + (bh - mh) / 2, mw, mh);
    } else {
      ctx.beginPath();
      ctx.fillStyle = za ? za.a : "#6db06a";
      ctx.arc(bx + 11, by + bh / 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#1e2a28";
    ctx.font = `600 12px ${UI_FONT}`;
    ctx.fillText(label, bx + padL, by + bh / 2 + 0.5);
    ctx.restore();
  }
}
