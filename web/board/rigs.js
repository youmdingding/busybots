// Moving machinery in a room: the City building site's tower crane. While an agent works in
// the room it swings to one spot, lowers its load to the floor, lifts it, swings to the next
// spot and lowers it there; when the room goes quiet it goes back to rest.
//
// The art generator (tools/city_props/interiors.py crane_rig) leaves only the mast in the
// room sprite, renders the slewing head and the hook load at `frames` headings and records
// the rig on the room's manifest entry:
//   rig: { kind: "crane", mast: [x, y], height, frames, rest (jib heading, degrees),
//          trolley (radius), stops: [deg, deg], hook: { low, high, rest, load },
//          head: "<sprite prefix>", load: "<sprite prefix>", beacon (z) }
// Headings are degrees counter-clockwise from +x toward +y in the room's sprite units.
import { S, tileImgs } from "./state.js";
import { BASE_ELEV, CITY_DIR, TILE_W } from "./constants.js";
import { ctx } from "./dom.js";
import { toIso } from "./layout.js";
import { roomBusy } from "./livescreens.js";

const TURN = 28;  // degrees per second at full speed
const HOIST = 11; // sprite units per second at full speed
const RIGS = new Map(); // room sprite → crane state

const pad2 = (k) => String(k).padStart(2, "0");
const angleTo = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

function plan(st, rig, busy) {
  const h = rig.hook;
  if (busy) {
    const [a, b] = rig.stops;
    return [{ rot: a }, { z: h.low }, { wait: 1.2 }, { z: h.high }, { rot: b }, { z: h.low }, { wait: 1.2 }, { z: h.high }];
  }
  const q = [];
  if (st.z < h.rest - 0.1) q.push({ z: h.rest });
  q.push({ rot: rig.rest }, { z: h.rest });
  return q;
}

/** Advance one crane: work through its queue of moves (eased at both ends). */
function step(st, rig, busy, dt) {
  if (busy !== st.busy) {
    st.busy = busy;
    st.queue = plan(st, rig, busy);
  }
  if (!st.queue.length) {
    if (!busy) return;
    st.queue = plan(st, rig, true);
  }
  const task = st.queue[0];
  if (task.wait != null) {
    task.wait -= dt;
    if (task.wait <= 0) st.queue.shift();
    return;
  }
  if (task.rot != null) {
    const d = angleTo(st.phi, task.rot);
    const v = Math.min(TURN, Math.abs(d) * 1.8 + 3);
    if (Math.abs(d) <= v * dt) { st.phi = task.rot; st.queue.shift(); } else st.phi += Math.sign(d) * v * dt;
    return;
  }
  const d = task.z - st.z;
  const v = Math.min(HOIST, Math.abs(d) * 1.6 + 1.5);
  if (Math.abs(d) <= v * dt) { st.z = task.z; st.queue.shift(); } else st.z += Math.sign(d) * v * dt;
}

function spritePlace(name, origin, elev, s, ox = 0, oy = 0) {
  const m = S.CITY_MANIFEST[name];
  const img = tileImgs.get(`${CITY_DIR}${name}.png`);
  if (!m || !img || !img.complete || !img.naturalWidth) return null;
  return { img, x: origin.sx + ox - m.ax * s, y: origin.sy - elev + oy - m.ay * s, w: m.w * s, h: m.h * s };
}

function blit(P) {
  if (!P) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(P.img, P.x, P.y, P.w, P.h);
  ctx.restore();
}

/**
 * Depth-sorted items (the hook load and its cable) plus draws that go on top of the scene
 * (the crane head, high above everything) for every room with a rig.
 */
export function rigItems(now, interiorOf) {
  const out = { items: [], after: [] };
  if (!S.CITY_MANIFEST) return out;
  const t = (now || performance.now()) / 1000;
  for (const [zid, L] of Object.entries(S.runtimeLayout)) {
    const spec = interiorOf(zid);
    const m = spec && S.CITY_MANIFEST[spec.sprite];
    const rig = m && m.rig;
    if (!rig || rig.kind !== "crane" || !Array.isArray(rig.mast)) continue;
    let st = RIGS.get(spec.sprite);
    if (!st) {
      st = { phi: rig.rest, z: rig.hook.rest, queue: [], busy: false, last: t };
      RIGS.set(spec.sprite, st);
    }
    const dt = Math.max(0, Math.min(0.1, t - st.last));
    st.last = t;
    const busy = roomBusy(zid);
    step(st, rig, busy, dt);

    const upg = m.unitsPerGrid || 22;
    const s = (TILE_W * S.worldScale) / (2 * upg);
    const elev = BASE_ELEV + (L.elevOffset || 0);
    const at = (x, y) => toIso(L.gx + x / upg, L.gy + y / upg);
    const origin = at(0, 0);
    const n = rig.frames || 32;
    const k = ((Math.round(((st.phi - rig.rest) % 360 + 360) % 360 / (360 / n)) % n) + n) % n;
    const [mx, my] = rig.mast;
    const a = (st.phi * Math.PI) / 180;
    const tx = mx + rig.trolley * Math.cos(a), ty = my + rig.trolley * Math.sin(a);
    const tp = at(tx, ty);
    const gx = L.gx + tx / upg, gy = L.gy + ty / upg;
    const z = st.z, H = rig.height;

    out.items.push({
      name: "crane-load",
      box: [gx - 0.25, gy - 0.25, gx + 0.25, gy + 0.25],
      draw: () => {
        const top = tp.sy - elev - (H + 1.6) * s, bot = tp.sy - elev - (z + 1.2) * s;
        ctx.fillStyle = "#2d3238";
        ctx.fillRect(Math.round(tp.sx - s * 0.2), Math.round(top), Math.max(1, Math.round(s * 0.4)), Math.max(0, Math.round(bot - top)));
        blit(spritePlace(`${rig.load}${pad2(k)}`, tp, elev, s, 0, -z * s));
      },
    });
    out.after.push(() => {
      blit(spritePlace(`${rig.head}${pad2(k)}`, origin, elev, s));
      // aircraft-warning beacon on the apex: steady at rest, blinking while it works
      if (!busy || Math.floor(t * 1.6) % 2 === 0) {
        const bp = at(mx, my);
        const w = Math.max(1, Math.round(s * 0.7));
        ctx.fillStyle = "#ff4a3d";
        ctx.fillRect(Math.round(bp.sx - w / 2), Math.round(bp.sy - elev - (rig.beacon + 1) * s), w, Math.max(1, Math.round(s)));
      }
    });
  }
  return out;
}
