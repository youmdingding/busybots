// City theme: pixel-art props, skyline, ground and traffic.
import { S } from "./state.js";
import { bots, tileImgs } from "./state.js";
import { BASE_ELEV, CITY_DIR, TILE_W } from "./constants.js";
import { ctx } from "./dom.js";
import { key } from "./routes.js";
import { ART } from "./theme.js";
import { screenToGrid, toIso } from "./layout.js";
import { drawDecorItem } from "./decor.js";
import { drawOneZone, footprintTop } from "./zones.js";
import { advanceBot, drawBot } from "./bots.js";

export const cityHazeCache = new Map();

/** Integer upscale keeps pixels crisp: 22 sprite px ≈ one grid step (TILE_W/2). */
export function citySpriteScale() {
  return Math.max(1, Math.round((TILE_W * S.worldScale) / 44));
}

export function cityPlacement(name, gx, gy, elev) {
  const m = S.CITY_MANIFEST && S.CITY_MANIFEST[name];
  if (!m) return null;
  const img = tileImgs.get(`${CITY_DIR}${name}.png`);
  if (!img || !img.complete || !img.naturalWidth) return null;
  const s = citySpriteScale();
  const p = toIso(gx, gy);
  const x = Math.round(p.sx - m.ax * s);
  const y = Math.round(p.sy - elev - m.ay * s);
  const hull = (m.hull || [[0, 0], [m.w, 0], [m.w, m.h], [0, m.h]])
    .map(([hx, hy]) => ({ x: x + hx * s, y: y + hy * s }));
  return { img, name, x, y, w: m.w * s, h: m.h * s, hull };
}

export function convexHull2D(pts) {
  const P = pts.map((p) => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  if (P.length < 3) return P;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], hi = [];
  for (const p of P) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
    lo.push(p);
  }
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop();
    hi.push(p);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** Separating-axis test for two convex polygons. */
export function convexOverlap(A, B, margin) {
  const m = margin || 0;
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const nx = q.y - p.y, ny = p.x - q.x;
      const len = Math.hypot(nx, ny) || 1;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const v of A) { const d = (v.x * nx + v.y * ny) / len; aMin = Math.min(aMin, d); aMax = Math.max(aMax, d); }
      for (const v of B) { const d = (v.x * nx + v.y * ny) / len; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); }
      if (aMax + m < bMin || bMax + m < aMin) return false;
    }
  }
  return true;
}

/**
 * Screen-space keep-out for every agent zone: the room from its wall feet up
 * past the rim, plus head-room for agents standing at the back wall.
 * Agents/bubbles always draw after decor; this keeps props from cluttering
 * the floors and walls the agents stand on.
 */
export function cityKeepOutPolys() {
  const polys = [];
  for (const L of Object.values(S.runtimeLayout)) {
    const floor = BASE_ELEV + (L.elevOffset || 0);
    // From the floor up (props may tuck in front of a room's base slab, never over its floor)
    const lo = footprintTop(L, floor);
    const hi = footprintTop(L, floor + 11 + 34);
    polys.push(convexHull2D(lo.concat(hi)));
  }
  return polys;
}

export function cityBaseElev() {
  const y = S.activeTheme?.base?.yOffset;
  return -(y != null ? +y : 18);
}

/** Sprite pre-tinted toward the sky colour (distant skyline). */
export function cityHazed(img, name, col, alpha) {
  const k = `${name}|${col}|${alpha}`;
  if (cityHazeCache.has(k)) return cityHazeCache.get(k);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = "source-atop";
  g.globalAlpha = alpha;
  g.fillStyle = col;
  g.fillRect(0, 0, c.width, c.height);
  cityHazeCache.set(k, c);
  return c;
}

/** Background skyline on the base slab — painted before the island, so it can never cover a zone. */
export function drawCitySkyline() {
  if (!S.activeTheme || !Array.isArray(S.activeTheme.skyline)) return;
  const haze = S.activeTheme.skylineHaze || {};
  const col = haze.color || ART.skyMid || "#8a7aaa";
  const alpha = haze.alpha != null ? +haze.alpha : 0.18;
  const items = S.activeTheme.skyline.slice().sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const it of items) {
    const name = String(it.type || "").replace(/^city_/, "");
    const P = cityPlacement(name, it.gx, it.gy, cityBaseElev());
    if (!P) continue;
    ctx.drawImage(alpha > 0 ? cityHazed(P.img, name, col, alpha) : P.img, P.x, P.y, P.w, P.h);
  }
  ctx.restore();
}

/**
 * Themed zone interiors (City theme): a single sprite per zone holding the
 * floor, the two back walls (N + W), furniture and the zone's name sign.
 * Front walls are omitted so agents stay in full view.
 */
export function zoneInterior(zid) {
  if (!S.activeTheme || !S.activeTheme.interiors) return null;
  const spec = S.activeTheme.interiors[zid];
  if (!spec || !spec.sprite) return null;
  return spec;
}

export function drawZoneInterior(zid, L, spec) {
  const m = S.CITY_MANIFEST && S.CITY_MANIFEST[spec.sprite];
  const img = tileImgs.get(`${CITY_DIR}${spec.sprite}.png`);
  if (!m || !img || !img.complete || !img.naturalWidth) return false;
  const upg = m.unitsPerGrid || 22;
  const s = (TILE_W * S.worldScale) / (2 * upg);   // one grid cell = upg sprite units
  const elev = BASE_ELEV + (L.elevOffset || 0);
  const p = toIso(L.gx, L.gy);                   // sprite origin = footprint NW corner at floor level
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, p.sx - m.ax * s, p.sy - elev - m.ay * s, m.w * s, m.h * s);
  ctx.restore();
  return true;
}

/** City ground sprite (streets, sidewalks, avenue) replacing island tiles + base slab. */
export function cityGround() {
  if (!S.activeTheme || !S.activeTheme.ground || !S.activeTheme.ground.sprite) return null;
  return S.activeTheme.ground;
}

export function drawCityGround() {
  const spec = cityGround();
  if (!spec) return false;
  const m = S.CITY_MANIFEST && S.CITY_MANIFEST[spec.sprite];
  const img = tileImgs.get(`${CITY_DIR}${spec.sprite}.png`);
  if (!m || !img || !img.complete || !img.naturalWidth) return false;
  const s = (TILE_W * S.worldScale) / (2 * (m.unitsPerGrid || 22));
  const p = toIso(m.gx0 || 0, m.gy0 || 0);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, p.sx - m.ax * s, p.sy - BASE_ELEV - m.ay * s, m.w * s, m.h * s);
  ctx.restore();
  return true;
}

// ---- City traffic ---------------------------------------------------------
// Lanes, signals and cars come from theme.traffic (themes/city.json). Cars follow
// the car ahead (no overlaps), stop at red lights, and side-street cars wait for
// walking agents. Pure presentation: nothing here touches agents or status.
export const TRAFFIC = { cars: [], key: null, last: 0, clock: 0 };

export function trafficSpec() {
  if (!cityGround() || !S.activeTheme.traffic || !S.CITY_MANIFEST) return null;
  return S.activeTheme.traffic;
}

export function carSprite(kind, lane) {
  const suf = lane.axis === "x" ? (lane.dir > 0 ? "x" : "xr") : (lane.dir > 0 ? "y" : "yr");
  return `${lane.prefix || "car"}_${kind}_${suf}`;
}

export function spriteUnits() {
  return (S.CITY_MANIFEST.city_ground && S.CITY_MANIFEST.city_ground.unitsPerGrid) || 23.45;
}

export function carHalfLen(sprite, lane) {
  const m = S.CITY_MANIFEST[sprite];
  if (!m || !m.fp) return 0.6;
  const len = lane.axis === "x" ? m.fp[2] - m.fp[0] : m.fp[3] - m.fp[1];
  return len / 2 / spriteUnits();
}

export function initTraffic(spec) {
  TRAFFIC.cars = [];
  for (const lane of spec.lanes || []) {
    const span = lane.to - lane.from;
    const n = (lane.cars || []).length;
    lane.cars.forEach((kind, i) => {
      const sprite = carSprite(kind, lane);
      const vmax = lane.speed * (0.78 + 0.44 * (((i * 7 + lane.cars.length * 3) % 10) / 10));
      TRAFFIC.cars.push({ lane, sprite, pos: lane.from + ((i + 0.5) * span) / n, v: vmax * 0.5, vmax,
                          half: carHalfLen(sprite, lane), phase: (i * 2.3 + span) % 6.28 });
    });
  }
}

export function signalState(id) {
  const spec = trafficSpec();
  const sig = spec && (spec.signals || []).find((g) => g.id === id);
  if (!sig) return "r";
  const cyc = spec.cycle || 15, green = spec.green || 8, amber = spec.amber || 1.6;
  const ph = (((TRAFFIC.clock + (sig.offset || 0)) % cyc) + cyc) % cyc;
  return ph < green ? "g" : ph < green + amber ? "a" : "r";
}

export function walkingAgentsGrid() {
  const out = [];
  for (const b of bots.values()) {
    if (!b.walking) continue;
    out.push(screenToGrid(b.x, b.y + 6, BASE_ELEV));
  }
  return out;
}

export function stepTraffic(now) {
  const spec = trafficSpec();
  if (!spec) return;
  const key = S.activeTheme.id + ":" + (spec.lanes || []).length;
  if (TRAFFIC.key !== key) {
    initTraffic(spec);
    TRAFFIC.key = key;
    TRAFFIC.last = now;
  }
  const dt = Math.max(0, Math.min(0.1, (now - TRAFFIC.last) / 1000));
  TRAFFIC.last = now;
  TRAFFIC.clock += dt;
  const agents = walkingAgentsGrid();
  const byLane = new Map();
  for (const c of TRAFFIC.cars) {
    if (!byLane.has(c.lane)) byLane.set(c.lane, []);
    byLane.get(c.lane).push(c);
  }
  for (const [lane, cars] of byLane) {
    const span = lane.to - lane.from;
    const dir = lane.dir;
    const order = cars.slice().sort((a, b) => (a.pos - b.pos) * dir); // rear → front
    order.forEach((car, i) => {
      let gap = Infinity;
      if (order.length > 1) {
        const lead = order[(i + 1) % order.length];
        let d = (lead.pos - car.pos) * dir;
        if (d <= 0) d += span;
        gap = d - car.half - lead.half;
      }
      const front = car.pos + dir * car.half;
      // traffic lights
      if (lane.signals) {
        for (const sig of spec.signals || []) {
          if (sig.axis !== lane.axis) continue;
          const stop = dir > 0 ? sig.at[0] - 0.1 : sig.at[1] + 0.1;
          const dist = (stop - front) * dir;
          const st = signalState(sig.id);
          if (st === "g" || dist < -0.02 || dist > 3) continue;
          if (st === "a" && dist < 0.45) continue; // too close to stop: clear the junction
          gap = Math.min(gap, dist);
        }
      }
      // yield to agents walking across the road ahead
      if (lane.yieldToAgents) {
        for (const g of agents) {
          const along = (lane.axis === "x" ? g.gx : g.gy) - front;
          const perp = (lane.axis === "x" ? g.gy : g.gx) - lane.at;
          if (Math.abs(perp) < 0.7 && along * dir > -0.2 && along * dir < 1.6) gap = Math.min(gap, along * dir - 0.4);
        }
      }
      const vt = Math.max(0, Math.min(car.vmax, (gap - 0.15) / 0.7));
      const acc = vt > car.v ? 0.9 : 3.2;
      car.v += Math.max(-acc * dt, Math.min(acc * dt, vt - car.v));
      car.pos += dir * car.v * dt;
      if (car.pos > lane.to) car.pos -= span;
      if (car.pos < lane.from) car.pos += span;
    });
  }
}

/** Draw items for cars on lanes of one layer ("street" = decor pass, "zones" = with the rooms). */
export function trafficItems(layer) {
  const spec = trafficSpec();
  if (!spec) return [];
  const upg = spriteUnits();
  const out = [];
  for (const car of TRAFFIC.cars) {
    if ((car.lane.layer || "street") !== layer) continue;
    const gx = car.lane.axis === "x" ? car.pos : car.lane.at;
    const gy = car.lane.axis === "x" ? car.lane.at : car.pos;
    const m = S.CITY_MANIFEST[car.sprite];
    const fp = (m && m.fp) || [-14, -7, 14, 7];
    const edge = Math.min(car.pos - car.lane.from, car.lane.to - car.pos);
    const alpha = Math.max(0, Math.min(1, edge / (car.lane.fade || 0.8)));
    const lane = car.lane;
    const elev = BASE_ELEV + (lane.z || 0);
    // Boats bob gently on the swell (whole screen pixels so the sprite stays crisp)
    const bob = lane.bob ? Math.round(Math.sin(TRAFFIC.clock * 1.9 + (car.phase || 0)) * 1.2 * S.worldScale) : 0;
    out.push({
      box: [gx + fp[0] / upg, gy + fp[1] / upg, gx + fp[2] / upg, gy + fp[3] / upg],
      draw: () => {
        if (alpha <= 0.02) return;
        if (lane.wake && car.v > 0.05) drawWake(car, gx, gy, elev, alpha);
        const P = cityPlacement(car.sprite, gx, gy, elev - bob);
        if (!P) return;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = alpha;
        ctx.drawImage(P.img, P.x, P.y, P.w, P.h);
        ctx.restore();
      },
    });
  }
  return out;
}

/** Foam V trailing a boat's stern plus a little bow spray (pixel dashes on the water). */
export function drawWake(car, gx, gy, elev, alpha) {
  const lane = car.lane, dir = lane.dir, ax = lane.axis === "x";
  const sternX = ax ? gx - dir * car.half : gx, sternY = ax ? gy : gy - dir * car.half;
  const len = (1.2 + car.half * 1.6) * Math.min(1, car.v / Math.max(0.2, car.vmax)), px = Math.max(1, Math.round(S.worldScale));
  ctx.save();
  // Spacecraft (lane.trail = colour) leave a thin straight engine trail instead of a foam V
  const trail = lane.trail || null;
  ctx.fillStyle = trail || "#ffffff";
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const back = t * len;
    const spread = trail ? 0.015 : 0.1 + t * 0.45;
    const flick = (Math.floor(TRAFFIC.clock * 6 + i * 1.7 + (car.phase || 0) * 3) % 3) === 0;
    ctx.globalAlpha = alpha * (1 - t * 0.85) * (flick ? 0.5 : 0.9);
    for (const side of [-1, 1]) {
      const wx = ax ? sternX - dir * back : sternX + side * spread;
      const wy = ax ? sternY + side * spread : sternY - dir * back;
      const p = toIso(wx, wy);
      ctx.fillRect(Math.round(p.sx) - 2 * px, Math.round(p.sy - elev), 3 * px, px);
    }
    if (!trail && i > 0 && i < 6) {             // churned water right behind the stern
      const cx = ax ? sternX - dir * back * 0.7 : sternX;
      const cy = ax ? sternY : sternY - dir * back * 0.7;
      const p = toIso(cx, cy);
      ctx.globalAlpha = alpha * 0.7 * (1 - t);
      ctx.fillRect(Math.round(p.sx) - 2 * px, Math.round(p.sy - elev) - px, 4 * px, 2 * px);
    }
  }
  if (trail) { ctx.restore(); return; }
  // bow spray
  const bowX = ax ? gx + dir * car.half : gx, bowY = ax ? gy : gy + dir * car.half;
  for (const side of [-1, 1]) {
    const p = toIso(ax ? bowX : bowX + side * 0.12, ax ? bowY + side * 0.12 : bowY);
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillRect(Math.round(p.sx) - px, Math.round(p.sy - elev), 2 * px, px);
  }
  ctx.restore();
}

/** World footprint of a decor item (grid units) for depth sorting. */
export function decorBox(d) {
  if (d.city && S.CITY_MANIFEST) {
    let name = d.type.slice(5);
    if (d.signal != null) name = "traffic_light";
    const m = S.CITY_MANIFEST[name];
    if (m && m.fp) {
      const u = spriteUnits();
      return [d.gx + m.fp[0] / u, d.gy + m.fp[1] / u, d.gx + m.fp[2] / u, d.gy + m.fp[3] / u];
    }
  }
  return [d.gx + 0.2, d.gy + 0.2, d.gx + 0.8, d.gy + 0.8];
}

/**
 * Painter's order for footprint boxes: A before B if A lies wholly behind B on
 * x or y and their screen columns overlap (Kahn's algorithm; depth fallback).
 */
export function depthSort(items) {
  const n = items.length;
  const indeg = new Array(n).fill(0);
  const adj = Array.from({ length: n }, () => []);
  const sx = items.map((it) => [it.box[0] - it.box[3], it.box[2] - it.box[1]]);
  for (let i = 0; i < n; i++) {
    const a = items[i].box;
    for (let j = i + 1; j < n; j++) {
      if (sx[i][1] <= sx[j][0] || sx[j][1] <= sx[i][0]) continue;
      const b = items[j].box;
      const aHoldsB = a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
      const bHoldsA = b[0] <= a[0] && b[1] <= a[1] && b[2] >= a[2] && b[3] >= a[3];
      if (aHoldsB !== bHoldsA) {
        if (aHoldsB) { adj[i].push(j); indeg[j]++; } else { adj[j].push(i); indeg[i]++; }
        continue;
      }
      const aBehind = a[2] <= b[0] + 1e-3 || a[3] <= b[1] + 1e-3;
      const bBehind = b[2] <= a[0] + 1e-3 || b[3] <= a[1] + 1e-3;
      if (aBehind && !bBehind) { adj[i].push(j); indeg[j]++; }
      else if (bBehind && !aBehind) { adj[j].push(i); indeg[i]++; }
      else {
        const da = a[0] + a[1] + a[2] + a[3], db = b[0] + b[1] + b[2] + b[3];
        if (da <= db) { adj[i].push(j); indeg[j]++; } else { adj[j].push(i); indeg[i]++; }
      }
    }
  }
  const key = (i) => items[i].box[0] + items[i].box[1] + items[i].box[2] + items[i].box[3];
  const ready = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
  const out = [];
  const done = new Array(n).fill(false);
  while (ready.length) {
    ready.sort((p, q) => key(q) - key(p));
    const i = ready.pop();
    out.push(items[i]);
    done[i] = true;
    for (const j of adj[i]) if (--indeg[j] === 0) ready.push(j);
  }
  if (out.length < n) {
    const rest = [];
    for (let i = 0; i < n; i++) if (!done[i]) rest.push(i);
    rest.sort((p, q) => key(p) - key(q));
    for (const i of rest) out.push(items[i]);
  }
  return out;
}

/** Ground-plan position of a bot (tracked while walking; inverted from screen as a fallback). */
export function botGrid(b) {
  if (b.gx != null && b.gy != null) return { gx: b.gx, gy: b.gy };
  for (const L of Object.values(S.runtimeLayout)) {
    const g = screenToGrid(b.x, b.y + 6, BASE_ELEV + (L.elevOffset || 0));
    if (g.gx > L.gx && g.gx < L.gx + L.gw && g.gy > L.gy && g.gy < L.gy + L.gh) return g;
  }
  return screenToGrid(b.x, b.y + 6, BASE_ELEV);
}

/**
 * City theme: rooms, street props, cars and agent sprites in one painter's
 * order, so an agent walking behind a room is hidden by its walls. Names and
 * bubbles are drawn afterwards (always on top).
 */
export function drawCityScene(now, list) {
  const items = Object.entries(S.runtimeLayout).map(([zid, L]) => ({
    name: "zone:" + zid,
    box: [L.gx, L.gy, L.gx + L.gw, L.gy + L.gh],
    draw: () => drawOneZone(zid, L),
  }));
  for (const d of S.decor) items.push({ name: d.type, box: decorBox(d), draw: () => drawDecorItem(d) });
  for (const it of trafficItems("street")) items.push(it);
  for (const it of trafficItems("zones")) items.push(it);
  for (const b of list) {
    advanceBot(b, now);
    const g = botGrid(b);
    const r = 0.12;
    items.push({ name: "bot", box: [g.gx - r, g.gy - r, g.gx + r, g.gy + r], draw: () => drawBot(b, now, "sprite") });
  }
  const ordered = depthSort(items);
  if (window.__sceneDebug) window.__sceneOrder = ordered.map((it) => [it.name || "car", it.box.map((v) => +v.toFixed(2))]);
  for (const it of ordered) it.draw();
}

/** On-island / base-slab city prop. Skipped if its silhouette would touch an agent zone. */
export function drawCityProp(d) {
  let name = d.type.slice(5);
  if (d.signal != null && trafficSpec()) name = `traffic_light_${signalState(d.signal)}`;
  let elev;
  if (d.base) {
    elev = cityBaseElev();
  } else if (cityGround()) {
    elev = BASE_ELEV + (d.z || 0); // ground sprite: per-spot height offset (beach, sea level…)
  } else {
    const c = S.heightAt.get(key(Math.floor(d.gx), Math.floor(d.gy)));
    if (!c || c.kind === "water") return;
    elev = c.h;
  }
  const P = cityPlacement(name, d.gx, d.gy, elev);
  if (!P) return;
  const polys = cityKeepOutPolys();
  d.blocked = polys.some((z) => convexOverlap(P.hull, z, 2));
  if (d.blocked) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(P.img, P.x, P.y, P.w, P.h);
  ctx.restore();
}
