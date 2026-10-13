// Sky, water and terrain tiles.
import { S } from "./state.js";
import { ZONE_ART } from "./state.js";
import { BASE_ELEV, CANVAS_H, CANVAS_W, ISLAND_MAX_GX, ISLAND_MAX_GY } from "./constants.js";
import { ctx } from "./dom.js";
import { key, pathHubs } from "./routes.js";
import { ART } from "./theme.js";
import { toIso } from "./layout.js";
import { cityGround, drawCityGround, drawCitySkyline } from "./city.js";
import { fillPoly, hash2, strokePoly } from "./canvas.js";

// ---- Sky ----------------------------------------------------------------
export function drawSky() {
  const skyStyle = (S.activeTheme?.sky?.style) || "clouds";
  const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  g.addColorStop(0, ART.skyTop);
  g.addColorStop(0.45, ART.skyMid);
  g.addColorStop(1, ART.skyBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (skyStyle === "stars") {
    ctx.save();
    for (let i = 0; i < 120; i++) {
      const t = hash2(i, 91);
      const x = (t % CANVAS_W);
      const y = ((t >> 10) % Math.floor(CANVAS_H * 0.72));
      const a = 0.35 + ((t >> 3) & 7) / 14;
      ctx.globalAlpha = a;
      ctx.fillStyle = (t & 3) === 0 ? "#a8e8ff" : "#ffffff";
      const s = 1 + (t & 1);
      ctx.fillRect(x, y, s, s);
    }
    // distant nebula smudge
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#4060c0";
    ctx.beginPath();
    ctx.ellipse(1200, 160, 220, 70, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // Larger planet / moon (theme.sky.planet*)
    const px = S.activeTheme?.sky?.planetX ?? 1180;
    const py = S.activeTheme?.sky?.planetY ?? 150;
    const pr = S.activeTheme?.sky?.planetR ?? 88;
    ctx.globalAlpha = 0.92;
    const pg = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.15, px, py, pr);
    pg.addColorStop(0, "#8a9ab8");
    pg.addColorStop(0.55, "#3a4a68");
    pg.addColorStop(1, "#121820");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#c0d0e8";
    ctx.beginPath();
    ctx.arc(px - pr * 0.35, py - pr * 0.3, pr * 0.28, 0, Math.PI * 2);
    ctx.fill();
    // small companion moon
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#b0b8c8";
    ctx.beginPath();
    ctx.arc(px - pr * 1.35, py + pr * 0.4, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (skyStyle === "dusk") {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#ffd0a0";
    ctx.beginPath();
    ctx.ellipse(1280, 820, 260, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    // silhouette buildings on horizon (themes with a pixel skyline draw their own)
    if (!Array.isArray(S.activeTheme?.skyline)) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#1a2238";
      const blocks = [[40, 700, 50, 120], [110, 720, 40, 100], [200, 690, 60, 140], [900, 710, 55, 110], [1000, 680, 70, 150], [1200, 705, 45, 100], [1400, 715, 80, 120]];
      for (const [x, y, w, h] of blocks) ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
    return;
  }

  if (skyStyle === "office") {
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = "#ffffff";
    // window grid suggestion
    for (let i = 0; i < 8; i++) {
      const x = 80 + i * 190;
      ctx.fillRect(x, 40, 70, 90);
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = "#88a0b8";
      ctx.fillRect(x + 6, 48, 24, 30);
      ctx.fillRect(x + 38, 48, 24, 30);
      ctx.fillRect(x + 6, 86, 24, 30);
      ctx.fillRect(x + 38, 86, 24, 30);
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = "#ffffff";
    }
    ctx.restore();
    return;
  }

  // default: soft distant haze clouds
  ctx.save();
  ctx.globalAlpha = S.activeTheme?.sky?.alpha ?? 0.18;
  ctx.fillStyle = "#ffffff";
  const clouds = [
    [120, 80, 180, 28], [700, 60, 220, 32], [400, 100, 160, 22],
    [980, 90, 160, 24], [50, 160, 100, 18], [1280, 70, 180, 26],
  ];
  for (const [x, y, w, h] of clouds) {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---- Water ring under island --------------------------------------------
export function drawWaterBase() {
  if (cityGround() && S.CITY_MANIFEST && S.CITY_MANIFEST[cityGround().sprite]) {
    drawCitySkyline(); // the ground sprite brings its own slab
    return;
  }
  // Bounding iso diamond of island + margin — surface sits just under cliff feet
  const pad = 1.85;
  const minG = -pad, maxGx = ISLAND_MAX_GX + pad, maxGy = ISLAND_MAX_GY + pad;
  const elev = 14; // water slab thickness visual
  const baseStyle = (S.activeTheme?.base?.style) || "water";
  const WATER_Y = (S.activeTheme?.base?.yOffset != null)
    ? +S.activeTheme.base.yOffset
    : 18;
  const corners = [
    toIso(minG, minG),
    toIso(maxGx, minG),
    toIso(maxGx, maxGy),
    toIso(minG, maxGy),
  ];
  const top = corners.map((c) => ({ x: c.sx, y: c.sy + WATER_Y }));
  // water top
  fillPoly(top, ART.waterTop);
  // ripple speckles
  ctx.save();
  ctx.fillStyle = ART.waterRipple;
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 48; i++) {
    const t = hash2(i, 17);
    const gx = minG + ((t % 1000) / 1000) * (maxGx - minG);
    const gy = minG + (((t >> 10) % 1000) / 1000) * (maxGy - minG);
    const p = toIso(gx, gy);
    const px = p.sx + ((t >> 3) & 7) - 3;
    const py = p.sy + WATER_Y + ((t >> 6) & 5) - 2;
    ctx.fillRect(Math.round(px), Math.round(py), 3 + (t & 1), 1);
  }
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = ART.waterLit;
  for (let i = 0; i < 30; i++) {
    const t = hash2(i + 90, 41);
    const gx = minG + ((t % 1000) / 1000) * (maxGx - minG);
    const gy = minG + (((t >> 10) % 1000) / 1000) * (maxGy - minG);
    const p = toIso(gx, gy);
    ctx.fillRect(Math.round(p.sx), Math.round(p.sy + WATER_Y), 5, 1);
  }
  ctx.restore();

  // water sides (drop down)
  const drop = elev + 8;
  const left = [
    top[3], top[2],
    { x: top[2].x, y: top[2].y + drop },
    { x: top[3].x, y: top[3].y + drop },
  ];
  const right = [
    top[1], top[2],
    { x: top[2].x, y: top[2].y + drop },
    { x: top[1].x, y: top[1].y + drop },
  ];
  fillPoly(left, ART.waterSideDark);
  fillPoly(right, ART.waterSide);
  if (baseStyle === "void") {
    strokePoly(top, "rgba(80,200,255,0.45)", 2);
    // glow rim
    ctx.save();
    ctx.globalAlpha = 0.2;
    strokePoly(top, "#60e0ff", 5);
    ctx.restore();
  } else if (baseStyle === "street") {
    strokePoly(top, "rgba(20,20,28,0.5)", 1);
    // dashed road markings across base diamond
    ctx.save();
    ctx.strokeStyle = "#d8d060";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    ctx.lineTo(top[2].x, top[2].y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  } else if (baseStyle === "slab") {
    strokePoly(top, "rgba(60,70,85,0.4)", 1);
  } else {
    strokePoly(top, "rgba(40,60,100,0.35)", 1);
  }
  drawCitySkyline();
}

// ---- Single terrain tile ------------------------------------------------
export function grassColor(gx, gy, zone) {
  // Shared island grass only — zones use floor/rim (no soft fringe tint)
  const h = hash2(gx, gy);
  const picks = [ART.grassA, ART.grassA, ART.grassB, ART.grassC, ART.grassA, ART.grassD];
  return picks[h % picks.length];
}

export function floorColor(gx, gy, zone) {
  const h = hash2(gx, gy);
  const za = zone && ZONE_ART[zone];
  if (!za) return grassColor(gx, gy, null);
  const picks = [za.a, za.a, za.b, za.c, za.a, za.d, za.floor || za.a, za.floorHi || za.c];
  return picks[h % picks.length];
}

export function rimColor(gx, gy, zone) {
  const za = zone && ZONE_ART[zone];
  if (!za) return ART.dirtLeftMid;
  const h = hash2(gx * 5, gy * 3);
  return (h & 1) ? (za.wallLit || za.b) : (za.wall || za.d);
}

export function pathColor(gx, gy) {
  const h = hash2(gx * 3, gy * 5);
  const picks = [ART.pathA, ART.pathB, ART.pathC];
  return picks[h % picks.length];
}

export function drawTile(tile) {
  const { gx, gy, h, kind } = tile;
  const nw = toIso(gx, gy);
  const ne = toIso(gx + 1, gy);
  const se = toIso(gx + 1, gy + 1);
  const sw = toIso(gx, gy + 1);

  const top = [
    { x: nw.sx, y: nw.sy - h },
    { x: ne.sx, y: ne.sy - h },
    { x: se.sx, y: se.sy - h },
    { x: sw.sx, y: sw.sy - h },
  ];

  // Neighbor heights for visible faces (on a ground sprite, missing cells = ground level)
  const flat = { h: BASE_ELEV };
  const onGround = !!cityGround();
  const hS = S.heightAt.get(key(gx, gy + 1)) || (onGround ? flat : undefined);
  const hE = S.heightAt.get(key(gx + 1, gy)) || (onGround ? flat : undefined);
  const showLeft = !hS || hS.h < h;  // SW face visible if south lower/missing
  const showRight = !hE || hE.h < h;

  const leftDepth = showLeft ? h - (hS ? hS.h : 0) : 0;
  const rightDepth = showRight ? h - (hE ? hE.h : 0) : 0;

  // Left face (darker — light from top-left)
  if (showLeft && leftDepth > 0) {
    const drop = leftDepth;
    // Actually draw full drop to ground for outer edge, or to neighbor
    const leftFace = [
      { x: sw.sx, y: sw.sy - h },
      { x: se.sx, y: se.sy - h },
      { x: se.sx, y: se.sy - h + drop },
      { x: sw.sx, y: sw.sy - h + drop },
    ];
    // For outer perimeter where no neighbor, drop full h
    if (!hS) {
      leftFace[2].y = se.sy + 18;
      leftFace[3].y = sw.sy + 18;
    }
    {
      let sideCol = ART.dirtLeft;
      if (kind === "path") sideCol = ART.stoneLeft;
      else if (kind === "rim" || kind === "floor") {
        const z = tile.zone || S.heightAt.get(key(gx, gy))?.zone;
        const za = z && ZONE_ART[z];
        sideCol = za ? (za.wall || ART.dirtLeft) : ART.dirtLeft;
      }
      fillPoly(leftFace, sideCol);
    }
    // rock striations
    ctx.save();
    ctx.strokeStyle = kind === "path" ? "rgba(30,30,35,0.25)" : "rgba(40,25,15,0.35)";
    ctx.lineWidth = 1;
    const stripes = Math.max(2, Math.floor(((!hS ? h : drop) / 6)));
    for (let i = 1; i < stripes; i++) {
      const t = i / stripes;
      ctx.beginPath();
      ctx.moveTo(
        sw.sx,
        (sw.sy - h) + t * (leftFace[3].y - (sw.sy - h))
      );
      ctx.lineTo(
        se.sx,
        (se.sy - h) + t * (leftFace[2].y - (se.sy - h))
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // Right face (lighter)
  if (showRight && rightDepth > 0) {
    const drop = rightDepth;
    const rightFace = [
      { x: ne.sx, y: ne.sy - h },
      { x: se.sx, y: se.sy - h },
      { x: se.sx, y: se.sy - h + drop },
      { x: ne.sx, y: ne.sy - h + drop },
    ];
    if (!hE) {
      rightFace[2].y = se.sy + 18;
      rightFace[3].y = ne.sy + 18;
    }
    {
      let sideCol = ART.dirtRight;
      if (kind === "path") sideCol = ART.stoneRight;
      else if (kind === "rim" || kind === "floor") {
        const z = tile.zone || S.heightAt.get(key(gx, gy))?.zone;
        const za = z && ZONE_ART[z];
        sideCol = za ? (za.wallLit || za.wall || ART.dirtRight) : ART.dirtRight;
      }
      fillPoly(rightFace, sideCol);
    }
    ctx.save();
    ctx.strokeStyle = kind === "path" ? "rgba(255,255,255,0.12)" : "rgba(60,40,25,0.3)";
    ctx.lineWidth = 1;
    const stripes = Math.max(2, Math.floor(((!hE ? h : drop) / 6)));
    for (let i = 1; i < stripes; i++) {
      const t = i / stripes;
      ctx.beginPath();
      ctx.moveTo(
        ne.sx,
        (ne.sy - h) + t * (rightFace[3].y - (ne.sy - h))
      );
      ctx.lineTo(
        se.sx,
        (se.sy - h) + t * (rightFace[2].y - (se.sy - h))
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // Top face
  const zone = tile.zone === null ? null : (tile.zone || S.heightAt.get(key(gx, gy))?.zone);
  if (kind === "water") {
    fillPoly(top, ART.waterLit);
    ctx.save();
    ctx.fillStyle = ART.waterRipple;
    ctx.globalAlpha = 0.5;
    const c = toIso(gx + 0.5, gy + 0.5);
    ctx.fillRect(Math.round(c.sx - 6), Math.round(c.sy - h - 1), 8, 1);
    ctx.fillRect(Math.round(c.sx - 2), Math.round(c.sy - h + 3), 6, 1);
    ctx.restore();
  } else if (kind === "path") {
    fillPoly(top, pathColor(gx, gy));
    strokePoly(top, "rgba(70,55,35,0.35)", 1);
    // doorway threshold: light zone accent
    if (zone && ZONE_ART[zone] && S.runtimeLayout[zone]?.enclosed) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      fillPoly(top, ZONE_ART[zone].floorHi || ZONE_ART[zone].c);
      ctx.restore();
    }
  } else if (kind === "rim") {
    fillPoly(top, rimColor(gx, gy, zone));
    strokePoly(top, zone && ZONE_ART[zone] ? ZONE_ART[zone].edge : ART.dirtEdge, 1.6);
    // slight highlight lip
    ctx.save();
    ctx.globalAlpha = 0.35;
    fillPoly(top, zone && ZONE_ART[zone] ? (ZONE_ART[zone].wallLit || ZONE_ART[zone].c) : ART.dirtRightLit);
    ctx.restore();
  } else if (kind === "floor") {
    fillPoly(top, floorColor(gx, gy, zone));
    // interior tile grid (reads as flooring, not grass)
    strokePoly(top, zone && ZONE_ART[zone] ? ZONE_ART[zone].edge : "rgba(40,40,40,0.3)", 1);
    ctx.save();
    const c = toIso(gx + 0.5, gy + 0.5);
    const za = zone && ZONE_ART[zone];
    for (let i = 0; i < 3; i++) {
      const t = hash2(gx * 13 + i, gy * 19 + i);
      const ox = ((t % 15) - 7);
      const oy = (((t >> 4) % 9) - 4);
      ctx.fillStyle = za ? ((t & 1) ? (za.floorHi || za.c) : (za.d || za.b)) : ART.grassHi;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(Math.round(c.sx + ox - 1), Math.round(c.sy - h + oy), 2, 1);
    }
    ctx.restore();
  } else {
    // Shared island grass
    fillPoly(top, grassColor(gx, gy, null));
    ctx.save();
    const c = toIso(gx + 0.5, gy + 0.5);
    for (let i = 0; i < 5; i++) {
      const t = hash2(gx * 11 + i, gy * 17 + i);
      const ox = ((t % 17) - 8);
      const oy = (((t >> 4) % 11) - 5);
      ctx.fillStyle = (t & 1) ? ART.grassSpeck : ART.grassHi;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(Math.round(c.sx + ox - 1), Math.round(c.sy - h + oy), 2, 1);
    }
    ctx.globalAlpha = 0.22;
    strokePoly(top, ART.dirtEdge, 1);
    ctx.restore();
  }
}


/** City theme: dashed lane lines + crosswalks on asphalt path tiles between districts. */
/** City theme: dashed lane lines + crosswalks on asphalt path tiles between districts. */
export function drawCityRoadMarkings() {
  if (S.activeTheme?.id !== "city") return;
  if (cityGround()) return; // markings are painted into the ground sprite
  if (S.activeTheme?.roads?.laneMarkings === false) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // Continuous yellow dashes along horizontal avenue (gy 5–6) and vertical (gx 6)
  function dashAlong(points) {
    if (points.length < 2) return;
    ctx.strokeStyle = "#f2e060";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "butt";
    const dash = 7, gap = 5;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      let d = 0;
      while (d < len) {
        const x0 = a.x + ux * d, y0 = a.y + uy * d;
        const d1 = Math.min(d + dash, len);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(a.x + ux * d1, a.y + uy * d1);
        ctx.stroke();
        d += dash + gap;
      }
    }
  }
  const elevFor = (gx, gy) => {
    const c = S.heightAt.get(key(gx, gy));
    return c ? c.h : BASE_ELEV;
  };
  // Horizontal avenue centre-line
  const hPts = [];
  for (let gx = 1; gx <= 12; gx++) {
    const gy = 5.5;
    if (!S.heightAt.has(key(Math.floor(gx), 5)) && !S.heightAt.has(key(Math.floor(gx), 6))) continue;
    const elev = elevFor(Math.floor(gx), 5);
    const p = toIso(gx, gy);
    hPts.push({ x: p.sx, y: p.sy - elev });
  }
  dashAlong(hPts);
  // Vertical street between west/east districts
  const vPts = [];
  for (let gy = 1; gy <= 11; gy++) {
    if (!S.heightAt.has(key(6, Math.floor(gy)))) continue;
    const elev = elevFor(6, Math.floor(gy));
    const p = toIso(6.5, gy);
    vPts.push({ x: p.sx, y: p.sy - elev });
  }
  dashAlong(vPts);
  // Spur toward Idle
  const iPts = [];
  for (let gx = 12; gx <= 13.5; gx += 0.5) {
    for (const gy of [5.5, 6.5, 7.5]) {
      if (!S.heightAt.has(key(Math.floor(gx), Math.floor(gy)))) continue;
      const elev = elevFor(Math.floor(gx), Math.floor(gy));
      const p = toIso(gx, gy);
      iPts.push({ x: p.sx, y: p.sy - elev });
    }
  }
  // Crosswalks at gates
  if (S.activeTheme?.roads?.crosswalks !== false) {
    const hubs = pathHubs() || {};
    ctx.fillStyle = "rgba(250,250,255,0.95)";
    for (const keyName of Object.keys(hubs)) {
      const h = hubs[keyName];
      if (!h) continue;
      const hgx = Math.round(h[0]), hgy = Math.round(h[1]);
      for (let i = -1; i <= 1; i++) {
        const gx = hgx + i, gy = hgy;
        const cell = S.heightAt.get(key(gx, gy));
        if (!cell || cell.kind !== "path") continue;
        const elev = cell.h;
        for (let b = 0; b < 4; b++) {
          const t0 = 0.12 + b * 0.22;
          const a = toIso(gx + t0, gy + 0.12);
          const c = toIso(gx + t0 + 0.1, gy + 0.88);
          const pts = [
            { x: a.sx, y: a.sy - elev },
            { x: toIso(gx + t0 + 0.1, gy + 0.12).sx, y: toIso(gx + t0 + 0.1, gy + 0.12).sy - elev },
            { x: c.sx, y: c.sy - elev },
            { x: toIso(gx + t0, gy + 0.88).sx, y: toIso(gx + t0, gy + 0.88).sy - elev },
          ];
          fillPoly(pts, "rgba(250,250,255,0.95)");
        }
      }
    }
  }
  ctx.restore();
}

export function drawAllTiles() {
  if (drawCityGround()) {
    // Island-style grounds keep the zones' own raised tiles on top of the sprite
    if (cityGround().keepZoneTiles) {
      for (const t of S.islandTiles) {
        for (const L of Object.values(S.runtimeLayout)) {
          const x0 = Math.floor(L.gx), y0 = Math.floor(L.gy);
          const x1 = Math.ceil(L.gx + L.gw) - 1, y1 = Math.ceil(L.gy + L.gh) - 1;
          if (t.gx >= x0 && t.gx <= x1 && t.gy >= y0 && t.gy <= y1) { drawTile(t); break; }
        }
      }
    }
    return;
  }
  for (const t of S.islandTiles) drawTile(t);
}
