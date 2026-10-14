// Little robots that roam a fixed route on the floor (the Office robot vacuum).
// Route, dock and timings come from theme.roamers (themes/office.json):
//
//   { "sprite": "office_vacuum",               // + _x / _xr / _y / _yr, one per heading
//     "dock": { "sprite": "office_vacuum_dock", "at": [gx, gy] },
//     "loop": [[gx, gy], …],                   // closed route, straight legs along x or y
//     "speed": 0.5, "turn": 0.8, "laps": 2, "rest": 20, "firstRest": 3 }
//
// It leaves the dock, drives the loop `laps` times, pausing to turn at each corner,
// goes back to charge for `rest` seconds and starts again. It stops while an agent is
// in its way. Pure decoration: nothing here touches agents or status.
import { S } from "./state.js";
import { BASE_ELEV } from "./constants.js";
import { ctx } from "./dom.js";
import { cityGround, cityPlacement, spriteUnits } from "./city.js";

export const ROAMERS = { list: [], key: null, last: 0 };

const LOOK_AHEAD = 0.95; // grid units in front of it that must be clear of agents
const LANE_HALF = 0.45;  // how far to the side an agent still counts as in the way

export function roamerSpecs() {
  if (!cityGround() || !S.CITY_MANIFEST) return [];
  const list = S.activeTheme && S.activeTheme.roamers;
  return Array.isArray(list) ? list.filter((r) => r && r.sprite && Array.isArray(r.loop) && r.loop.length >= 2) : [];
}

function heading(dx, dy) {
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "x" : "xr") : (dy >= 0 ? "y" : "yr");
}

/** Every point of one outing: the loop `laps` times, back to its start, then the dock. */
function outing(spec) {
  const pts = [];
  const laps = Math.max(1, spec.laps || 1);
  for (let i = 0; i < laps; i++) pts.push(...spec.loop);
  pts.push(spec.loop[0]);
  if (spec.dock && spec.dock.at) pts.push(spec.dock.at);
  return pts;
}

function initRoamer(spec) {
  const home = (spec.dock && spec.dock.at) || spec.loop[0];
  const route = outing(spec);
  return { spec, route, i: 0, gx: home[0], gy: home[1], face: heading(home[0] - route[0][0], home[1] - route[0][1]),
           next: null, mode: "rest", t: spec.firstRest != null ? spec.firstRest : spec.rest || 10, v: 0 };
}

/** Start the turn toward route[i], or drive straight on if it is already ahead. */
function aim(r) {
  const p = r.route[r.i];
  const want = heading(p[0] - r.gx, p[1] - r.gy);
  if (want === r.face) { r.mode = "drive"; return; }
  r.next = want;
  r.mode = "turn";
  r.t = r.spec.turn != null ? r.spec.turn : 0.8;
}

function agentAhead(r, agents) {
  const p = r.route[r.i];
  const len = Math.hypot(p[0] - r.gx, p[1] - r.gy) || 1;
  const ux = (p[0] - r.gx) / len, uy = (p[1] - r.gy) / len;
  for (const g of agents) {
    const dx = g.gx - r.gx, dy = g.gy - r.gy;
    const along = dx * ux + dy * uy;
    if (along > 0 && along < LOOK_AHEAD && Math.abs(dx * uy - dy * ux) < LANE_HALF) return true;
  }
  return false;
}

/** Advance every roamer; `agents` = grid positions of the agents on the board. */
export function stepRoamers(now, agents) {
  const specs = roamerSpecs();
  const key = specs.length ? S.activeTheme.id + ":" + specs.length : null;
  if (ROAMERS.key !== key) {
    ROAMERS.list = specs.map(initRoamer);
    ROAMERS.key = key;
    ROAMERS.last = now;
  }
  const dt = Math.max(0, Math.min(0.1, (now - ROAMERS.last) / 1000));
  ROAMERS.last = now;
  for (const r of ROAMERS.list) {
    if (r.mode === "rest" || r.mode === "turn") {
      const half = r.mode === "turn" && r.t > (r.spec.turn || 0.8) / 2;
      r.t -= dt;
      if (r.mode === "turn" && half && r.t <= (r.spec.turn || 0.8) / 2) r.face = r.next; // swivel halfway
      if (r.t > 0) continue;
      if (r.mode === "turn") { r.face = r.next; r.mode = "drive"; continue; }
      r.i = 0;
      aim(r);
      continue;
    }
    const p = r.route[r.i];
    const dist = Math.hypot(p[0] - r.gx, p[1] - r.gy);
    const vmax = r.spec.speed || 0.5;
    const vt = agentAhead(r, agents) ? 0 : Math.min(vmax, dist / 0.35 + 0.08);
    r.v += Math.max(-2.5 * dt, Math.min(1.2 * dt, vt - r.v));
    const step = Math.min(dist, r.v * dt);
    if (dist > 1e-6) {
      r.gx += ((p[0] - r.gx) / dist) * step;
      r.gy += ((p[1] - r.gy) / dist) * step;
    }
    if (dist - step > 0.005) continue;
    r.gx = p[0];
    r.gy = p[1];
    r.v = 0;
    if (r.i >= r.route.length - 1) { // home: charge
      r.mode = "rest";
      r.t = r.spec.rest || 10;
      continue;
    }
    r.i++;
    aim(r);
  }
}

/** Depth-sorted draw items for drawCityScene: each roamer and its dock. */
export function roamerItems() {
  if (!ROAMERS.list.length) return [];
  const u = spriteUnits();
  const out = [];
  const place = (name, gx, gy, alpha = 1) => {
    const m = S.CITY_MANIFEST[name];
    const fp = (m && m.fp) || [-5, -5, 5, 5];
    out.push({
      name,
      box: [gx + fp[0] / u, gy + fp[1] / u, gx + fp[2] / u, gy + fp[3] / u],
      draw: () => {
        const P = cityPlacement(name, gx, gy, BASE_ELEV);
        if (!P) return;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = alpha;
        ctx.drawImage(P.img, P.x, P.y, P.w, P.h);
        ctx.restore();
      },
    });
  };
  for (const r of ROAMERS.list) {
    const d = r.spec.dock;
    if (d && d.sprite && d.at) place(d.sprite, d.at[0], d.at[1]);
    place(`${r.spec.sprite}_${r.face}`, r.gx, r.gy);
  }
  return out;
}
