// Building the world grid (tiles, rooms, height) for the active theme.
import { S } from "./state.js";
import { ZONE_PROPS } from "./state.js";
import { BASE_ELEV, ISLAND_MAX_GX, ISLAND_MAX_GY } from "./constants.js";
import { doorGridPoint, isDoorCell, isRimCell, key, orthoCorner, pathHubEdges, pathHubs, zoneAtCell, zoneHubId } from "./routes.js";
import { zoneInterior } from "./city.js";

export function buildIsland() {

  S.islandTiles = [];
  S.heightAt = new Map();
  S.decor = [];

  // Organic island footprint — ellipse from config (falls back to a full oval)
  const tiles = [];
  const isl = (S.claudeConfig && S.claudeConfig.island)
    ? S.claudeConfig.island
    : { cx: 10.0, cy: 7.3, rx: 11.2, ry: 8.5 };
  const iCx = +isl.cx || 10.0;
  const iCy = +isl.cy || 7.3;
  const iRx = +isl.rx || 11.2;
  const iRy = +isl.ry || 8.5;
  for (let gy = 0; gy <= ISLAND_MAX_GY; gy++) {
    for (let gx = 0; gx <= ISLAND_MAX_GX; gx++) {
      const dx = (gx - iCx) / iRx;
      const dy = (gy - iCy) / iRy;
      const wobble = 0.08 * Math.sin(gx * 1.7 + gy * 0.9) + 0.06 * Math.cos(gx * 0.5 - gy * 1.3);
      if (dx * dx + dy * dy > 1.02 + wobble) continue;
      tiles.push({ gx, gy });
    }
  }

  // Elevations + room floors from zone footprints
  const RIM_EXTRA = 11; // raised wall/lip above room floor
  for (const t of tiles) {
    let h = BASE_ELEV;
    let kind = "grass";
    const zid = zoneAtCell(t.gx, t.gy);
    if (zid && S.runtimeLayout[zid]) {
      const L = S.runtimeLayout[zid];
      const elev = L.elevOffset || 0;
      const inCore =
        t.gx >= L.gx + 0.15 && t.gx < L.gx + L.gw - 0.15 &&
        t.gy >= L.gy + 0.15 && t.gy < L.gy + L.gh - 0.15;
      if (L.enclosed) {
        // Distinct interior floor (not grass wash) with raised rim walls
        if (isRimCell(t.gx, t.gy, zid, L)) {
          h = BASE_ELEV + elev + RIM_EXTRA;
          kind = "rim";
        } else if (isDoorCell(t.gx, t.gy, zid, L)) {
          h = BASE_ELEV + elev; // threshold flush with floor
          kind = "path";
        } else if (inCore) {
          h = BASE_ELEV + elev;
          kind = "floor";
        } else {
          h = BASE_ELEV + elev;
          kind = "floor";
        }
      } else if (zid === "idle") {
        // Open courtyard — grey-sage floor, barely raised, no walls
        h = BASE_ELEV + elev;
        kind = inCore ? "floor" : "grass";
      } else {
        // other open zone: raised terrace
        h = BASE_ELEV + (inCore ? elev : Math.round(elev * 0.7));
        kind = "floor";
      }
    }
    S.heightAt.set(key(t.gx, t.gy), { h, kind, zone: zid || undefined });
  }

  // Pond recessed into central lawn (Island / nature only)
  const wantPond = !S.activeTheme || S.activeTheme.pond !== false;
  const pondCells = wantPond ? [[9, 7], [10, 7]] : []; // small puddle on the path corridor
  for (const [gx, gy] of pondCells) {
    if (!S.heightAt.has(key(gx, gy))) continue;
    // Keep pond on shared grass — strip zone ownership so it stays island water
    S.heightAt.set(key(gx, gy), { h: Math.max(BASE_ELEV - 6, BASE_ELEV - 10), kind: "water", zone: undefined });
  }

  // Stone paths = outdoor corridors between rooms (doorway + hub graph)
  const pathPts = [];
  function addPathLine(x0, y0, x1, y1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pathPts.push([Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t)]);
    }
  }
  /** Paint axis-aligned L segments (matches walk routing). */
  function addPathOrtho(x0, y0, x1, y1) {
    const c = orthoCorner([x0, y0], [x1, y1]);
    if (!c) {
      addPathLine(x0, y0, x1, y1);
      return;
    }
    addPathLine(x0, y0, c[0], c[1]);
    addPathLine(c[0], c[1], x1, y1);
  }
  // Hub-to-hub corridors
  for (const [a, b] of pathHubEdges()) {
    const A = pathHubs()[a], B = pathHubs()[b];
    if (A && B) addPathOrtho(A[0], A[1], B[0], B[1]);
  }
  // Door thresholds → preferred zone hub
  for (const zid of Object.keys(S.runtimeLayout)) {
    const door = doorGridPoint(zid);
    const hub = zoneHubId(zid);
    if (!hub || !pathHubs()[hub]) continue;
    const H = pathHubs()[hub];
    addPathOrtho(door[0], door[1], H[0], H[1]);
  }
  // Paint corridor cells as a road ribbon (wider on City theme)
  const pathSet = new Set();
  const cityWide = S.activeTheme?.id === "city";
  const roadW = cityWide ? (S.activeTheme?.roads?.pathWidth || 3) : 2;
  const neigh = roadW >= 3
    ? [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1],[2,0],[-2,0],[0,2],[0,-2]]
    : [[0,0],[1,0],[0,1],[-1,0],[0,-1]];
  for (const [gx, gy] of pathPts) {
    for (const [ox, oy] of neigh) {
        pathSet.add(`${gx + ox},${gy + oy}`);
    }
  }
  for (const k of pathSet) {
    if (!S.heightAt.has(k)) continue;
    const cur = S.heightAt.get(k);
    if (cur.kind === "water" || cur.kind === "rim" || cur.kind === "floor") continue;
    S.heightAt.set(k, { h: cur.h, kind: "path", zone: cur.zone });
  }
  // City: force asphalt street belts between the five districts
  if (S.activeTheme?.id === "city") {
    for (const [k, cur] of S.heightAt) {
      if (cur.kind === "water" || cur.kind === "rim" || cur.kind === "floor") continue;
      const [gx, gy] = k.split(",").map(Number);
      const avenue = gy >= 5 && gy <= 6 && gx >= 1 && gx <= 12;
      const northSouth = gx >= 5.5 && gx <= 6.5 && gy >= 1 && gy <= 11;
      const toIdle = gx >= 12 && gx <= 13 && gy >= 2 && gy <= 11;
      if (avenue || northSouth || toIdle) {
        S.heightAt.set(k, { h: BASE_ELEV, kind: "path", zone: undefined });
      }
    }
  }

  // Ensure room floors stay solid + rims stay raised after path pass
  for (const [zid, L] of Object.entries(S.runtimeLayout)) {
    const elev = L.elevOffset || 0;
    const x0 = Math.floor(L.gx);
    const y0 = Math.floor(L.gy);
    const x1 = Math.ceil(L.gx + L.gw) - 1;
    const y1 = Math.ceil(L.gy + L.gh) - 1;
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const k = key(gx, gy);
        if (!S.heightAt.has(k)) continue;
        const cur = S.heightAt.get(k);
        if (cur.kind === "water") continue;
        if (L.enclosed) {
          if (isRimCell(gx, gy, zid, L)) {
            S.heightAt.set(k, { h: BASE_ELEV + elev + RIM_EXTRA, kind: "rim", zone: zid });
          } else if (isDoorCell(gx, gy, zid, L)) {
            S.heightAt.set(k, { h: BASE_ELEV + elev, kind: "path", zone: zid });
          } else {
            S.heightAt.set(k, { h: BASE_ELEV + elev, kind: "floor", zone: zid });
          }
        } else if (zid !== "idle" && zid !== "waiting") {
          S.heightAt.set(k, { h: Math.max(cur.h, BASE_ELEV + elev), kind: "floor", zone: zid });
        } else if (zid === "idle" || zid === "waiting") {
          // open courtyard: tinted floor, soft grass fringe, no walls
          const onEdge = gx === x0 || gx === x1 || gy === y0 || gy === y1;
          if (!onEdge) S.heightAt.set(k, { h: BASE_ELEV + elev, kind: "floor", zone: zid });
          else S.heightAt.set(k, { h: BASE_ELEV + elev, kind: "grass", zone: undefined });
        }
      }
    }
  }

  // Moat: strip zone ownership on cells touching enclosed rooms → shared grass gap
  for (const [zid, L] of Object.entries(S.runtimeLayout)) {
    if (!L.enclosed) continue;
    const x0 = Math.floor(L.gx) - 1;
    const y0 = Math.floor(L.gy) - 1;
    const x1 = Math.ceil(L.gx + L.gw);
    const y1 = Math.ceil(L.gy + L.gh);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const inside =
          gx >= Math.floor(L.gx) && gx <= Math.ceil(L.gx + L.gw) - 1 &&
          gy >= Math.floor(L.gy) && gy <= Math.ceil(L.gy + L.gh) - 1;
        if (inside) continue;
        const k = key(gx, gy);
        if (!S.heightAt.has(k)) continue;
        const cur = S.heightAt.get(k);
        if (cur.kind === "water") continue;
        // Keep corridor paths; clear zone tint on grass ring
        if (cur.kind === "path") {
          S.heightAt.set(k, { h: BASE_ELEV, kind: "path", zone: undefined });
        } else if (cur.zone === zid || !cur.zone) {
          S.heightAt.set(k, { h: BASE_ELEV, kind: "grass", zone: undefined });
        }
      }
    }
  }

  // Raise stand patches to room floor height (bots stand inside rooms)
  for (const [zid, L] of Object.entries(S.runtimeLayout)) {
    const cgx = Math.round(L.gx + L.gw / 2);
    const cgy = Math.round(L.gy + L.gh / 2);
    const elev = L.elevOffset || 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = key(cgx + dx, cgy + dy);
        if (!S.heightAt.has(k)) continue;
        const cur = S.heightAt.get(k);
        if (cur.kind === "water" || cur.kind === "rim") continue;
        const nh = Math.max(cur.h, BASE_ELEV + elev);
        const nk = L.enclosed || zid === "idle" ? "floor" : (cur.kind === "path" ? "path" : "floor");
        S.heightAt.set(k, { h: nh, kind: nk, zone: zid });
      }
    }
  }

  // Themed interiors draw their own raised floor at the exact footprint, so
  // grid cells whose centre lies outside it become street (roads between zones).
  for (const [zid, L] of Object.entries(S.runtimeLayout)) {
    if (!zoneInterior(zid)) continue;
    const x0 = Math.floor(L.gx), y0 = Math.floor(L.gy);
    const x1 = Math.ceil(L.gx + L.gw) - 1, y1 = Math.ceil(L.gy + L.gh) - 1;
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const k = key(gx, gy);
        const cur = S.heightAt.get(k);
        if (!cur || cur.kind === "water") continue;
        const cx = gx + 0.5, cy = gy + 0.5;
        const inside = cx > L.gx && cx < L.gx + L.gw && cy > L.gy && cy < L.gy + L.gh;
        if (!inside) S.heightAt.set(k, { h: BASE_ELEV, kind: "path", zone: undefined });
        // Cells under the room keep their height (agents walk at floor level) but are
        // painted as street: the interior sprite draws the raised floor itself.
        else S.heightAt.set(k, { ...cur, drawAsRoad: true });
      }
    }
  }

  for (const [k, v] of S.heightAt) {
    const [gx, gy] = k.split(",").map(Number);
    if (v.drawAsRoad) S.islandTiles.push({ gx, gy, h: BASE_ELEV, kind: "path", zone: null });
    else S.islandTiles.push({ gx, gy, h: v.h, kind: v.kind, zone: v.zone });
  }
  S.islandTiles.sort((a, b) => a.gx + a.gy - (b.gx + b.gy) || a.gx - b.gx);

  // Decor around zone edges — avoid stand centres
  const standKeys = new Set();
  const signKeys = new Set();
  for (const L of Object.values(S.runtimeLayout)) {
    const cgx = Math.round(L.gx + L.gw / 2);
    const cgy = Math.round(L.gy + L.gh * 0.55);
    // Keep-out: sprite stand + name pills below + bubble above (leave room fringes free)
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        standKeys.add(key(cgx + dx, cgy + dy));
      }
    }
    // NW wooden/holo sign + zone chip keep-out
    const sgx = Math.floor(L.gx);
    const sgy = Math.floor(L.gy);
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 2; dx++) signKeys.add(key(sgx + dx, sgy + dy));
    }
  }
  function decorBlocked(gx, gy) {
    return standKeys.has(key(gx, gy)) || signKeys.has(key(gx, gy));
  }

  const ambient = (S.activeTheme?.ambient) || "nature";
  if (ambient === "nature") {
    const pineSpots = [
      [1, 1, 0], [0, 4, 1], [2, 0, 2], [7, 0, 0],
      [12, 0, 1], [18, 1, 2], [19, 3, 0], [19, 8, 1],
      [0, 8, 2], [1, 12, 0], [18, 12, 1], [4, 14, 2],
      [10, 14, 0], [15, 14, 1], [8, 0, 2], [16, 0, 0],
      [20, 6, 1], [0, 6, 0],
      [3, 13, 1], [17, 13, 2], [9, 1, 0], [14, 13, 1],
    ];
    for (const [gx, gy, v] of pineSpots) {
      if (!S.heightAt.has(key(gx, gy))) continue;
      if (S.heightAt.get(key(gx, gy)).kind === "water") continue;
      if (decorBlocked(gx, gy)) continue;
      S.decor.push({ gx, gy, type: "pine", variant: v });
    }

    const bushSpots = [
      [3, 7], [7, 5], [11, 7], [6, 10], [12, 10], [16, 7],
      [5, 4], [13, 4], [17, 5], [8, 12], [14, 12],
    ];
    for (const [gx, gy] of bushSpots) {
      if (!S.heightAt.has(key(gx, gy))) continue;
      if (S.heightAt.get(key(gx, gy)).kind === "water") continue;
      if (decorBlocked(gx, gy)) continue;
      S.decor.push({ gx, gy, type: "bush" });
    }

    const rockSpots = [
      [1, 3, 0], [2, 10, 1], [17, 2, 0], [18, 7, 1], [11, 13, 0], [6, 1, 1],
      [13, 13, 0], [4, 2, 1],
    ];
    for (const [gx, gy, v] of rockSpots) {
      if (!S.heightAt.has(key(gx, gy))) continue;
      if (decorBlocked(gx, gy)) continue;
      S.decor.push({ gx, gy, type: v ? "rock_brown" : "rock_grey" });
    }

    const flowerSpots = [
      [5, 5, "flower_red"], [6, 7, "flower_orange"], [12, 5, "flower_purple"],
      [8, 2, "flower_red"], [11, 2, "flower_orange"], [3, 6, "flower_purple"],
      [15, 7, "flower_red"], [7, 11, "flower_orange"], [13, 11, "flower_purple"],
    ];
    for (const [gx, gy, type] of flowerSpots) {
      if (!S.heightAt.has(key(gx, gy))) continue;
      if (S.heightAt.get(key(gx, gy)).kind === "water") continue;
      if (decorBlocked(gx, gy)) continue;
      S.decor.push({ gx, gy, type });
    }
  } else if (S.activeTheme && Array.isArray(S.activeTheme.ambientSpots)) {
    for (const spot of S.activeTheme.ambientSpots) {
      if (typeof spot.type === "string" && spot.type.startsWith("city_")) {
        // Fractional grid coords allowed; zone keep-out is enforced at draw time
        S.decor.push({ gx: +spot.gx, gy: +spot.gy, type: spot.type, city: true, base: !!spot.base,
                     signal: spot.signal != null ? +spot.signal : null, z: +spot.z || 0 });
        continue;
      }
      const gx = spot.gx, gy = spot.gy;
      if (!S.heightAt.has(key(gx, gy))) continue;
      const cell = S.heightAt.get(key(gx, gy));
      if (cell.kind === "water") continue;
      // Cars/lamps may sit on asphalt even if a room keep-out overlaps the curb
      const roadProp = cell.kind === "path" && (spot.type === "proc_car" || spot.type === "proc_lamp");
      if (decorBlocked(gx, gy) && !roadProp) continue;
      S.decor.push({ gx, gy, type: spot.type, variant: spot.variant || 0 });
    }
  }

  // Task-mode props: SW-ish inside each footprint (clear of NW signs + SE stands)
  for (const [zid, L] of Object.entries(S.runtimeLayout)) {
    const zp = ZONE_PROPS[zid];
    if (!zp || !zp.prop || zoneInterior(zid)) continue;
    // SW fringe of room — clear of NW signs and SE/center sprite stands
    const pgx = Math.round(L.gx + L.gw * 0.22);
    const pgy = Math.round(L.gy + L.gh * 0.78);
    if (!S.heightAt.has(key(pgx, pgy))) continue;
    if (S.heightAt.get(key(pgx, pgy)).kind === "water") continue;
    S.decor.push({ gx: pgx, gy: pgy, type: zp.prop, zoneProp: true });
  }

  S.decor.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
}
