// Camera, projection, room slots and image loading.
import { S } from "./state.js";
import { bots, icons, tileImgs } from "./state.js";
import { BASE_ELEV, CANVAS_H, CANVAS_W, TILE_H, TILE_W } from "./constants.js";
import { assignClaudeSlot } from "./agents.js";
import { key } from "./routes.js";

export function applyPalette(p) {
  if (!p) return;
  const root = document.documentElement.style;
  // Soften: keep page chrome matching sky island, not neon
  root.setProperty("--bg", p.bg || "#c5e4ec");
  root.setProperty("--accent", p.accent || "#3a7a5c");
  root.setProperty("--idle", p.idle || "#8aa8b0");
  root.setProperty("--bubble", p.bubble || "#fffef5");
}

export function toIso(gx, gy) {
  return {
    sx: S.ORIGIN_X + (gx - gy) * (TILE_W / 2) * S.worldScale,
    sy: S.ORIGIN_Y + (gx + gy) * (TILE_H / 2) * S.worldScale,
  };
}

/** Center island in the canvas and scale a bit larger while keeping margin. */
export function fitIslandCamera() {
  if (S.mini && fitRoomsCamera()) return;
  if (!S.islandTiles.length) return;
  S.worldScale = 1;
  S.ORIGIN_X = 0;
  S.ORIGIN_Y = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of S.islandTiles) {
    const elev = t.h != null ? t.h : BASE_ELEV;
    const corners = [
      [t.gx, t.gy],
      [t.gx + 1, t.gy],
      [t.gx, t.gy + 1],
      [t.gx + 1, t.gy + 1],
    ];
    for (const [gx, gy] of corners) {
      const p = toIso(gx, gy);
      const sx = p.sx;
      const sy = p.sy - elev;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy - 10);
      maxY = Math.max(maxY, sy + TILE_H + 28);
    }
  }
  // A ground sprite with tall walls (theme.ground.fitSprite) must fit too, not just the floor
  const g = S.activeTheme && S.activeTheme.ground;
  const m = g && g.fitSprite && S.CITY_MANIFEST && S.CITY_MANIFEST[g.sprite];
  if (m) {
    const s = TILE_W / (2 * (m.unitsPerGrid || 22));
    minY = Math.min(minY, toIso(m.gx0 || 0, m.gy0 || 0).sy - BASE_ELEV - m.ay * s + 12);
  }
  // Water pad + signs/bots above tiles
  minY -= 18;
  maxY += 48;
  minX -= 20;
  maxX += 20;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const marginX = 48;
  const marginY = 40;
  const fit = Math.min((CANVAS_W - 2 * marginX) / bw, (CANVAS_H - 2 * marginY) / bh);
  // Prefer a touch larger when room allows; never overflow
  S.worldScale = Math.max(0.95, Math.min(1.14, fit));
  const cx1 = (minX + maxX) / 2;
  const cy1 = (minY + maxY) / 2;
  S.ORIGIN_X = CANVAS_W / 2 - S.worldScale * cx1;
  S.ORIGIN_Y = CANVAS_H / 2 - S.worldScale * cy1;
}

/** Mini board: hug the rooms (walls and signs included) and zoom in as far as they fit. */
function fitRoomsCamera() {
  const zones = Object.values(S.runtimeLayout || {});
  if (!zones.length) return false;
  S.worldScale = 1;
  S.ORIGIN_X = 0;
  S.ORIGIN_Y = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const L of zones) {
    const elev = BASE_ELEV + (L.elevOffset || 0);
    for (const [gx, gy] of [[L.gx, L.gy], [L.gx + L.gw, L.gy], [L.gx, L.gy + L.gh], [L.gx + L.gw, L.gy + L.gh]]) {
      const p = toIso(gx, gy);
      minX = Math.min(minX, p.sx);
      maxX = Math.max(maxX, p.sx);
      minY = Math.min(minY, p.sy - elev - 70); // back walls and signs
      maxY = Math.max(maxY, p.sy - elev + 24);
    }
  }
  const fit = Math.min((CANVAS_W - 24) / Math.max(1, maxX - minX), (CANVAS_H - 24) / Math.max(1, maxY - minY));
  S.worldScale = Math.max(0.6, Math.min(2.6, fit));
  S.ORIGIN_X = CANVAS_W / 2 - S.worldScale * (minX + maxX) / 2;
  S.ORIGIN_Y = CANVAS_H / 2 - S.worldScale * (minY + maxY) / 2;
  return true;
}

export function layoutFor(zoneId) {
  return S.runtimeLayout[zoneId] || null;
}

export function elevAt(gx, gy) {
  const c = S.heightAt.get(key(Math.round(gx), Math.round(gy)));
  return c ? c.h : BASE_ELEV;
}

export function zoneSlots(zoneId) {
  const inZone = [...bots.values()].filter((b) => b.zone === zoneId);
  inZone.sort((a, b) => a.id.localeCompare(b.id));
  return inZone;
}

/**
 * Claude: pack bots on a SCREEN-SPACE grid, but ONLY accept slots whose
 * iso (gx,gy) lands inside the room floor (inset). Prevents grass spill from
 * diamond AABB while keeping even on-screen gaps for sprites + name pills.
 */
export function screenToGrid(sx, sy, elev) {
  const rx = (sx - S.ORIGIN_X) / ((TILE_W / 2) * S.worldScale);
  const ry = (sy + elev - S.ORIGIN_Y) / ((TILE_H / 2) * S.worldScale);
  return { gx: (rx + ry) / 2, gy: (ry - rx) / 2 };
}

export function claudeRoomInset(zoneId) {
  const area = S.claudeConfig && Array.isArray(S.claudeConfig.areas) && S.claudeConfig.areas.find((a) => a && a.key === zoneId);
  if (area && area.inset) return Object.assign({ n: 1.10, s: 1.45, w: 1.05, e: 1.05 }, area.inset);
  if (zoneId === "idle" || zoneId === "waiting") {
    return { n: 1.15, s: 1.70, w: 1.15, e: 1.15 };
  }
  return { n: 1.10, s: 1.45, w: 1.05, e: 1.05 };
}

export function claudeSlotTarget(bot) {
  const L = layoutFor(bot.zone);
  if (!L) return { x: CANVAS_W / 2, y: CANVAS_H / 2 };
  const elev = BASE_ELEV + (L.elevOffset || 0);
  const ins = claudeRoomInset(bot.zone);
  const zoneId = bot.zone;
  const slotIndex = assignClaudeSlot(bot, zoneId);

  // Fixed column count so growing occupancy never reshuffles existing slots
  const areaCfg = S.claudeConfig && Array.isArray(S.claudeConfig.areas) && S.claudeConfig.areas.find((a) => a && a.key === zoneId);
  const cols = areaCfg && areaCfg.slotCols ? Math.max(2, +areaCfg.slotCols) : Math.max(
    2,
    Math.min(
      zoneId === "idle" || zoneId === "waiting" ? 5 : 3,
      Math.round(S.claudeSlotCols) || (zoneId === "idle" || zoneId === "waiting" ? 4 : 3)
    )
  );
  const col = slotIndex % cols;
  const row = Math.floor(slotIndex / cols);

  const x0g = L.gx + ins.w;
  const y0g = L.gy + ins.n;
  const uw = Math.max(1.2, L.gw - ins.w - ins.e);
  const uh = Math.max(1.2, L.gh - ins.n - ins.s);
  const needRows = row + 1;
  const rows = Math.max(needRows, Math.ceil(uh / 1.55));
  const cellW = uw / cols;
  const cellH = uh / Math.max(rows, 1);
  const gx = x0g + (col + 0.5) * cellW;
  const gy = y0g + (row + 0.5) * cellH;
  const gxC = Math.min(L.gx + L.gw - ins.e - 0.05, Math.max(L.gx + ins.w + 0.05, gx));
  const gyC = Math.min(L.gy + L.gh - ins.s - 0.05, Math.max(L.gy + ins.n + 0.05, gy));
  const p = toIso(gxC, gyC);
  return {
    x: p.sx,
    y: p.sy - elev - 6,
    row,
    col,
    cols,
    rows,
    cellW,
    cellH,
    gx: gxC,
    gy: gyC,
    slotIndex,
  };
}

export function targetFor(bot) {
  return claudeSlotTarget(bot);
}


// Status files are untrusted: only allow bundled icons (no external URLs).
export function safeIconPath(path) {
  return typeof path === "string" && /^icons\/[A-Za-z0-9_.-]+\.png$/.test(path) ? path : null;
}

export function loadIcon(path) {
  path = safeIconPath(path);
  if (!path) return null;
  if (icons.has(path)) return icons.get(path);
  const img = new Image();
  img.src = path;
  icons.set(path, img);
  return img;
}

export function loadTile(path) {
  if (tileImgs.has(path)) return tileImgs.get(path);
  const img = new Image();
  img.src = path;
  tileImgs.set(path, img);
  return img;
}
