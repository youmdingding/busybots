// Walkable paths: hubs, door points and routes between rooms.
import { S } from "./state.js";
import { BASE_ELEV } from "./constants.js";
import { elevAt, toIso } from "./layout.js";

/** City theme can supply its own street-centre walking network. */
export function themeStreets() {
  if (!S.activeTheme || !S.activeTheme.streets || !S.activeTheme.ground) return null;
  return S.activeTheme.streets;
}
export function pathHubs() {
  const st = themeStreets();
  if (st && st.hubs) return st.hubs;
  return S.runtimePathHubs || {};
}
export function pathHubEdges() {
  const st = themeStreets();
  if (st && st.edges) return st.edges;
  return S.runtimePathEdges || [];
}

export function key(gx, gy) {
  return `${gx},${gy}`;
}

/** Which zone footprint owns a grid cell (tight — no fringe bleed onto shared grass). */
export function zoneAtCell(gx, gy) {
  let best = null;
  let bestDist = Infinity;
  for (const [zid, L] of Object.entries(S.runtimeLayout)) {
    const inside =
      gx >= L.gx - 0.05 && gx < L.gx + L.gw + 0.05 &&
      gy >= L.gy - 0.05 && gy < L.gy + L.gh + 0.05;
    if (inside) {
      const cx = L.gx + L.gw / 2;
      const cy = L.gy + L.gh / 2;
      const d = (gx + 0.5 - cx) ** 2 + (gy + 0.5 - cy) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = zid;
      }
    }
  }
  return best;
}

/** True if cell sits on the doorway gap of an enclosed room. */
export function isDoorCell(gx, gy, zid, L) {
  if (!L || !L.enclosed || !L.door) return false;
  const x0 = Math.floor(L.gx);
  const y0 = Math.floor(L.gy);
  const x1 = Math.ceil(L.gx + L.gw) - 1;
  const y1 = Math.ceil(L.gy + L.gh) - 1;
  const midX = Math.round((x0 + x1) / 2);
  const midY = Math.round((y0 + y1) / 2);
  const doorW = 1; // 1–2 cell gap
  if (L.door === "S") return gy === y1 && Math.abs(gx - midX) <= doorW;
  if (L.door === "N") return gy === y0 && Math.abs(gx - midX) <= doorW;
  if (L.door === "E") return gx === x1 && Math.abs(gy - midY) <= doorW;
  if (L.door === "W") return gx === x0 && Math.abs(gy - midY) <= doorW;
  return false;
}

/** Perimeter (rim) cell of a zone footprint, excluding doorway. */
export function isRimCell(gx, gy, zid, L) {
  if (!L || !L.enclosed) return false;
  const x0 = Math.floor(L.gx);
  const y0 = Math.floor(L.gy);
  const x1 = Math.ceil(L.gx + L.gw) - 1;
  const y1 = Math.ceil(L.gy + L.gh) - 1;
  if (gx < x0 || gx > x1 || gy < y0 || gy > y1) return false;
  const onEdge = gx === x0 || gx === x1 || gy === y0 || gy === y1;
  if (!onEdge) return false;
  return !isDoorCell(gx, gy, zid, L);
}

/** Door threshold (or open-zone approach) in fractional grid units. */
export function doorGridPoint(zid) {
  const L = S.runtimeLayout[zid];
  if (!L) return [10, 7];
  if (!L.door) {
    // Open courtyards: north fringe (aligns with south hub column)
    return [L.gx + L.gw * 0.5, L.gy + 0.12];
  }
  if (L.door === "N") return [L.gx + L.gw / 2, L.gy];
  if (L.door === "S") return [L.gx + L.gw / 2, L.gy + L.gh];
  if (L.door === "E") return [L.gx + L.gw, L.gy + L.gh / 2];
  if (L.door === "W") return [L.gx, L.gy + L.gh / 2];
  return [L.gx + L.gw / 2, L.gy + L.gh / 2];
}

/** Footprint-centred stand anchor in grid units. */
export function standGridPoint(zid) {
  const L = S.runtimeLayout[zid];
  if (!L) return [10, 7];
  return [L.gx + L.gw * 0.50, L.gy + L.gh * 0.55];
}

/** True if grid point sits inside an enclosed room (not on its door gap). */
export function gridInEnclosedInterior(gx, gy) {
  for (const [zid, L] of Object.entries(S.runtimeLayout)) {
    if (!L.enclosed) continue;
    if (gx < L.gx || gx > L.gx + L.gw || gy < L.gy || gy > L.gy + L.gh) continue;
    if (isDoorCell(Math.round(gx), Math.round(gy), zid, L)) continue;
    return true;
  }
  return false;
}

/**
 * Axis-aligned L-bend corner between two grid points.
 * Outdoors: prefer the corner that does not cut through a room interior.
 */
export function orthoCorner(a, b) {
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  if (dx < 0.08 || dy < 0.08) return null;
  const hFirst = [b[0], a[1]];
  const vFirst = [a[0], b[1]];
  const aIn = gridInEnclosedInterior(a[0], a[1]);
  const bIn = gridInEnclosedInterior(b[0], b[1]);
  if (!aIn && !bIn) {
    const hBad = gridInEnclosedInterior(hFirst[0], hFirst[1]);
    const vBad = gridInEnclosedInterior(vFirst[0], vFirst[1]);
    if (hBad && !vBad) return vFirst;
    if (vBad && !hBad) return hFirst;
  }
  // Longer cardinal leg first → hug painted corridor bands
  return dx >= dy ? hFirst : vFirst;
}

/** Expand a waypoint list so every segment is axis-aligned. */
export function expandOrthoWaypoints(pts) {
  if (!pts || pts.length < 2) return pts || [];
  const out = [];
  const pushUnique = (p) => {
    if (!out.length) {
      out.push(p);
      return;
    }
    const last = out[out.length - 1];
    if (Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.05) return;
    out.push(p);
  };
  pushUnique(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = orthoCorner(a, b);
    if (c) pushUnique(c);
    pushUnique(b);
  }
  return out;
}

export function nearestHubId(gx, gy) {
  let best = null;
  let bestD = Infinity;
  for (const [id, p] of Object.entries(pathHubs())) {
    const d = (p[0] - gx) ** 2 + (p[1] - gy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/** Preferred hub for a zone door (stable routing). */
export function zoneHubId(zid) {
  const st = themeStreets();
  const map = (st && st.zoneHubs) || S.runtimeZoneHubMap || {};
  if (map[zid]) return map[zid];
  const door = doorGridPoint(zid);
  return nearestHubId(door[0], door[1]);
}

/** BFS hub path between two hub ids. */
export function hubRoute(fromHub, toHub) {
  if (!fromHub || !toHub) return [];
  if (fromHub === toHub) return [fromHub];
  const adj = new Map();
  for (const id of Object.keys(pathHubs())) adj.set(id, []);
  for (const [a, b] of pathHubEdges()) {
    if (!adj.has(a) || !adj.has(b)) continue;
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const q = [fromHub];
  const prev = new Map([[fromHub, null]]);
  while (q.length) {
    const cur = q.shift();
    if (cur === toHub) break;
    for (const n of adj.get(cur) || []) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      q.push(n);
    }
  }
  if (!prev.has(toHub)) return [fromHub, toHub];
  const path = [];
  for (let c = toHub; c; c = prev.get(c)) path.push(c);
  path.reverse();
  return path;
}

/** Grid waypoints for zone→zone walk (stand → door → hubs → door → stand). */
export function routeGridWaypoints(fromZone, toZone) {
  if (fromZone === toZone) return [standGridPoint(toZone)];
  const pts = [];
  const pushUnique = (p) => {
    if (!pts.length) {
      pts.push(p);
      return;
    }
    const last = pts[pts.length - 1];
    if (Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.05) return;
    pts.push(p);
  };
  const streets = !!themeStreets();
  pushUnique(standGridPoint(fromZone));
  if (streets) pushUnique(doorInsidePoint(fromZone)); // walk to the doorway first
  pushUnique(doorGridPoint(fromZone));
  if (streets) pushUnique(doorOutsidePoint(fromZone)); // bottom of the entrance steps
  const hubs = hubRoute(zoneHubId(fromZone), zoneHubId(toZone));
  for (const hid of hubs) {
    const H = pathHubs()[hid];
    if (H) pushUnique([H[0], H[1]]);
  }
  if (streets) pushUnique(doorOutsidePoint(toZone));
  pushUnique(doorGridPoint(toZone));
  if (streets) pushUnique(doorInsidePoint(toZone));
  pushUnique(standGridPoint(toZone));
  // No diagonal lawn/wall shortcuts — only axis-aligned corridor segments
  return expandOrthoWaypoints(pts);
}

/** Door point nudged into / out of the room along the door's normal. */
export function doorNormal(zid) {
  const L = S.runtimeLayout[zid];
  return { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[L && L.door] || [0, 1];
}
export function doorInsidePoint(zid) {
  const d = doorGridPoint(zid), n = doorNormal(zid);
  return [d[0] - n[0] * 0.45, d[1] - n[1] * 0.45];
}
export function doorOutsidePoint(zid) {
  const d = doorGridPoint(zid), n = doorNormal(zid);
  return [d[0] + n[0] * 0.22, d[1] + n[1] * 0.22];
}

/** City theme: floor height comes from the zone footprints, street level elsewhere. */
export function routeElevAt(gx, gy) {
  if (!themeStreets()) return elevAt(gx, gy);
  for (const L of Object.values(S.runtimeLayout)) {
    if (gx > L.gx + 0.02 && gx < L.gx + L.gw - 0.02 && gy > L.gy + 0.02 && gy < L.gy + L.gh - 0.02) {
      return BASE_ELEV + (L.elevOffset || 0);
    }
  }
  return BASE_ELEV;
}

/** Screen-space polyline from grid waypoints (accounts for elevation). */
export function routeScreenWaypoints(fromZone, toZone) {
  const grids = routeGridWaypoints(fromZone, toZone);
  return grids.map(([gx, gy]) => {
    const p = toIso(gx, gy);
    const elev = routeElevAt(gx, gy);
    return { x: p.sx, y: p.sy - elev - 6, gx, gy };
  });
}

export function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

/** Point at distance `dist` along polyline (clamped). */
export function pointAlongPolyline(pts, dist) {
  if (!pts.length) return { x: 0, y: 0 };
  if (pts.length === 1 || dist <= 0) return { x: pts[0].x, y: pts[0].y };
  let left = dist;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (left <= seg || i === pts.length - 1) {
      const t = seg < 1e-6 ? 1 : Math.min(1, left / seg);
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
      };
    }
    left -= seg;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y };
}
