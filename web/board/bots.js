// Speech bubbles and bot sprites.
import { S } from "./state.js";
import { icons } from "./state.js";
import { CANVAS_H, CANVAS_W, SCALE, SPRITE, UI_FONT, WALK_MS } from "./constants.js";
import { ctx } from "./dom.js";
import { pointAlongPolyline, polylineLength } from "./routes.js";
import { targetFor, zoneSlots } from "./layout.js";
import { easeInOut, drawSubagentOrbit } from "./status.js";
import { wrapText } from "./canvas.js";
import { roundRectPath } from "./zones.js";

// ---- Bubbles ------------------------------------------------------------
/** Chat bubble centred above the sprite, stacked within its zone. */
export function drawBubble(b, drawX, drawY) {
  if (!b.bubble) return;
  const wrapCols = 28;
  const lines = wrapText(b.bubble, wrapCols);
  if (!lines.length) return;
  const pad = 7;
  const lineH = 13;
  const bubbleColor = S.status.project?.palette?.bubble || "#fffef5";
  const size = SPRITE * SCALE * (S.claudeConfig?.spriteScale || 0.82);
  ctx.font = `500 11px ${UI_FONT}`;
  let maxW = 0;
  for (const ln of lines) {
    maxW = Math.max(maxW, ctx.measureText(ln).width);
  }
  const bw = Math.ceil(maxW + pad * 2);
  const bh = lines.length * lineH + pad * 2 - 4;
  const margin = 6;

  // Centered ABOVE the sprite; bubbles in the same zone stack vertically
  const bubblers = zoneSlots(b.zone).filter((x) => x.bubble);
  const bubbleStack = Math.max(0, bubblers.findIndex((x) => x.id === b.id));
  let by = Math.round(drawY - size / 2 - bh - 14 - bubbleStack * (bh + 20));
  if (by < margin) by = margin;
  if (by + bh > CANVAS_H - margin) by = CANVAS_H - margin - bh;

  let bx = Math.round(drawX - bw / 2);
  if (bx < margin) bx = margin;
  if (bx + bw > CANVAS_W - margin) bx = CANVAS_W - margin - bw;

  ctx.save();
  // soft rounded balloon
  ctx.fillStyle = "rgba(30,40,50,0.14)";
  roundRectPath(bx + 1, by + 2, bw, bh, 8);
  ctx.fill();
  ctx.fillStyle = bubbleColor;
  roundRectPath(bx, by, bw, bh, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(42,52,58,0.45)";
  ctx.lineWidth = 1.25;
  ctx.stroke();

  // Tail: downward caret pointing at the sprite head
  ctx.fillStyle = bubbleColor;
  ctx.strokeStyle = "rgba(42,52,58,0.45)";
  ctx.lineWidth = 1.25;
  // Downward ▼ caret aimed at sprite head (on bubble bottom edge)
  const tipX = Math.max(bx + 12, Math.min(bx + bw - 12, Math.round(drawX)));
  const baseY = by + bh;
  const tipY = baseY + 11;
  ctx.fillStyle = bubbleColor;
  ctx.fillRect(tipX - 10, baseY - 3, 20, 5);
  // Dark outline triangle
  ctx.fillStyle = "rgba(42,52,58,0.55)";
  ctx.beginPath();
  ctx.moveTo(tipX - 11, baseY - 1);
  ctx.lineTo(tipX, tipY + 1);
  ctx.lineTo(tipX + 11, baseY - 1);
  ctx.closePath();
  ctx.fill();
  // Inner cream triangle
  ctx.fillStyle = bubbleColor;
  ctx.beginPath();
  ctx.moveTo(tipX - 9, baseY - 1);
  ctx.lineTo(tipX, tipY - 1);
  ctx.lineTo(tipX + 9, baseY - 1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1e2a28";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `500 11px ${UI_FONT}`;
  lines.forEach((ln, i) => {
    ctx.fillText(ln, bx + pad, by + pad + i * lineH);
  });
  ctx.restore();
}

// ---- Bots ---------------------------------------------------------------
/** Advance a bot along its walk (and snap parked bots); keeps a ground-plan position for depth sorting. */
export function advanceBot(b, now) {
  if (b.walking) {
    const dur = b.walkMs || WALK_MS;
    const t = Math.min(1, (now - b.walkStart) / dur);
    const e = easeInOut(t);
    if (b.walkPts && b.walkPts.length >= 2) {
      const plen = polylineLength(b.walkPts);
      const pos = pointAlongPolyline(b.walkPts, e * plen);
      b.x = pos.x;
      b.y = pos.y;
      const g = gridAlongPolyline(b.walkPts, e * plen);
      if (g) { b.gx = g.gx; b.gy = g.gy; }
    } else {
      b.x = b.fromX + (b.toX - b.fromX) * e;
      b.y = b.fromY + (b.toY - b.fromY) * e;
      b.gx = null;
    }
    if (t >= 1) {
      b.walking = false;
      b.walkPts = null;
      b.x = b.toX;
      b.y = b.toY;
    }
  }
  const still = b.zone === "idle" || b.zone === "waiting" || b.state === "idle";
  if (!b.walking) {
    const t = targetFor(b);
    if (still) {
      b.x = b.toX = t.x;
      b.y = b.toY = t.y;
    }
    if (t.gx != null) { b.gx = t.gx; b.gy = t.gy; }
  }
}

/** Grid position along a walk polyline whose points carry gx/gy. */
export function gridAlongPolyline(pts, dist) {
  if (!pts.every((p) => p.gx != null)) return null;
  let left = dist;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (left <= seg || i === pts.length - 1) {
      const t = seg < 1e-6 ? 1 : Math.max(0, Math.min(1, left / seg));
      return { gx: pts[i - 1].gx + (pts[i].gx - pts[i - 1].gx) * t, gy: pts[i - 1].gy + (pts[i].gy - pts[i - 1].gy) * t };
    }
    left -= seg;
  }
  const last = pts[pts.length - 1];
  return { gx: last.gx, gy: last.gy };
}

export function drawBot(b, now, part) {
  part = part || "all";
  if (part === "all") advanceBot(b, now);

  // Waiting / idle: fully still (no bob). Thinking/active keep a light bob.
  const still =
    b.zone === "idle" ||
    b.zone === "waiting" ||
    b.state === "idle";
  const bob = still
    ? 0
    : b.state === "active"
      ? Math.sin(now / 280 + b.bobPhase) * 2.5
      : Math.sin(now / 900 + b.bobPhase) * 0.5;

  const drawX = b.x;
  const drawY = b.y + bob;
  const dense = zoneSlots(b.zone).length >= 8;
  const sprMul = (S.claudeConfig?.spriteScale || 0.82) * (dense ? 0.92 : 1);
  const size = SPRITE * SCALE * sprMul;
  const img = icons.get(b.icon);

  if (part !== "overlay") {
  // soft elliptical ground shadow
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(
    drawX,
    drawY + size / 2 - bob + 3,
    size * 0.32,
    size * 0.12,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.restore();

  // Selected sprite (side panel open for this bot)
  if (S.panelSessionId && b.id === S.panelSessionId) {
    const pulse = 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(now / 320 + b.bobPhase));
    const ry = Math.max(9, size * 0.28);
    const rx = Math.max(20, size * 0.60);
    const cy = drawY + size / 2 - bob + 4;
    ctx.save();
    ctx.globalAlpha = 0.50 * pulse;
    ctx.fillStyle = "#5ef0c0";
    ctx.beginPath();
    ctx.ellipse(drawX, cy, rx * 1.1, ry * 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.40 * pulse;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(drawX, cy, rx * 0.7, ry * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#0d3d32";
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.ellipse(drawX, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#3DDC97";
    ctx.lineWidth = 2.75;
    ctx.beginPath();
    ctx.ellipse(drawX, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#e8fff6";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.ellipse(drawX, cy, rx - 2, ry - 1.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Bouncing caret above head (clears labels) — large + high contrast
    const bounce = Math.abs(Math.sin(now / 260 + b.bobPhase)) * 7;
    const ax = drawX;
    const ay = drawY - size / 2 - 14 - bounce;
    ctx.fillStyle = "#0d3d32";
    ctx.beginPath();
    ctx.moveTo(ax, ay + 14);
    ctx.lineTo(ax - 11, ay - 2);
    ctx.lineTo(ax + 11, ay - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#3DDC97";
    ctx.beginPath();
    ctx.moveTo(ax, ay + 11);
    ctx.lineTo(ax - 8.5, ay);
    ctx.lineTo(ax + 8.5, ay);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#e8fff6";
    ctx.beginPath();
    ctx.moveTo(ax, ay + 8);
    ctx.lineTo(ax - 5, ay + 1);
    ctx.lineTo(ax + 5, ay + 1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  }

  ctx.save();
  if (b.state === "idle") ctx.globalAlpha = 0.6;
  else ctx.globalAlpha = 1;

  if (part !== "overlay") {
  // Sub-agent dots passing behind the bot (same size and bob as the badges pass in render.js)
  drawSubagentOrbit(b, drawX, b.y + (still ? 0 : b.state === "active" ? Math.sin(now / 280 + b.bobPhase) * 2.5 : 0),
    SPRITE * SCALE * (S.claudeConfig?.spriteScale || 0.82), now, "back");
  if (img && img.complete && img.naturalWidth) {
    // Soft rounded clip so sidebar avatars read as pills on the island
    const ax = drawX - size / 2;
    const ay = drawY - size / 2;
    ctx.save();
    roundRectPath(ax, ay, size, size, size * 0.28);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, ax, ay, size, size);
    ctx.restore();
    // Picked icon: the agent's own character as a small badge, so you can still tell its type
    const own = b.iconDefault && icons.get(b.iconDefault);
    if (own && own.complete && own.naturalWidth) {
      const bs = size * 0.42;
      const bx = drawX + size * 0.5 - bs * 0.75, by = drawY + size * 0.5 - bs * 0.85;
      ctx.save();
      ctx.beginPath();
      ctx.arc(bx + bs / 2, by + bs / 2, bs * 0.58, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fill();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(own, bx, by, bs, bs);
      ctx.restore();
    }
  } else {
    ctx.fillStyle = "#6db06a";
    roundRectPath(drawX - size / 2, drawY - size / 2, size, size, size * 0.28);
    ctx.fill();
  }
  }
  if (part === "sprite") {
    ctx.restore();
    return;
  }

  // Name — under sprite; slight SE bias, clamped so pills stay on-canvas
  ctx.globalAlpha = b.state === "idle" ? 0.78 : 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const fullName = String(b.name || b.id || "agent");
  let short = fullName;
  const maxName =
    (b.zone === "idle" || b.zone === "waiting") ? 11 : 13;
  if (fullName.length > maxName) short = fullName.slice(0, maxName - 1) + "…";
  ctx.font = `600 10px ${UI_FONT}`;
  const maxPill = (b.zone === "idle" || b.zone === "waiting") ? 100 : 110;
  while (ctx.measureText(short).width > maxPill && short.length > 5) {
    short = short.replace(/…$/, "").slice(0, -2) + "…";
  }
  const tw = ctx.measureText(short).width;
  const padX = 6;
  const ny = drawY + size / 2 + 3;
  const pw = Math.max(tw + padX * 2, 30);
  const ph = dense ? 14 : 16;
  let nx = drawX;
  if (nx + pw / 2 > CANVAS_W - 6) nx = CANVAS_W - 6 - pw / 2;
  if (nx - pw / 2 < 6) nx = 6 + pw / 2;
  ctx.fillStyle = "rgba(255,252,245,0.92)";
  roundRectPath(Math.round(nx - pw / 2), Math.round(ny), Math.round(pw), ph, 6);
  ctx.fill();
  if (S.panelSessionId && b.id === S.panelSessionId) {
    // Selected (panel open): bright accent border on name pill
    ctx.strokeStyle = "#1a5c4a";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = "#3DDC97";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    ctx.strokeStyle = "rgba(42,52,58,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = "#1e2a28";
  ctx.font = `600 12px ${UI_FONT}`;
  ctx.fillText(short, nx, ny + 3);

  ctx.restore();

  drawBubble(b, drawX, drawY);
}
