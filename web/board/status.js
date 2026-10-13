// Status polling: bots, header, filters and attention badges.
import { S } from "./state.js";
import { ZONE_ART, ZONE_PROPS, bots } from "./state.js";
import { LS_AGENT_FILTER_KEY, STALE_MS, STATUS_FILE, UI_FONT, WALK_MS } from "./constants.js";
import { ctx, elDot, elProject, elStale, elUpdated } from "./dom.js";
import { assignClaudeSlot, botBrandKey, botPassesAgentFilter, normalizeAgentFilter, releaseClaudeSlot } from "./agents.js";
import { polylineLength, routeScreenWaypoints } from "./routes.js";
import { applyThemeVisuals, loadTheme, syncThemeChips } from "./theme.js";
import { buildIsland } from "./island.js";
import { applyPalette, fitIslandCamera, loadIcon, targetFor } from "./layout.js";
import { closeAgentPanel } from "./panel.js";

export function ensureBot(raw) {
  let b = bots.get(raw.id);
  if (!b) {
    b = {
      id: raw.id,
      name: raw.name,
      icon: raw.icon,
      zone: raw.zone,
      state: raw.state,
      bubble: raw.bubble,
      task: raw.task,
      phase: raw.phase || null,
      attention: raw.attention || null,
      origin: raw.origin || null,
      brand: raw.brand || null,
      cwd: raw.cwd || null,
      livePid: raw.livePid || null,
      open: !!raw.open,
      x: 0,
      y: 0,
      fromX: 0,
      fromY: 0,
      toX: 0,
      toY: 0,
      walkStart: 0,
      walkMs: WALK_MS,
      walking: false,
      walkPts: null,
      bobPhase: Math.random() * Math.PI * 2,
      slotZone: null,
      slotIndex: null,
    };
    bots.set(raw.id, b);
    b.zone = raw.zone;
    assignClaudeSlot(b, raw.zone);
    const t2 = targetFor(b);
    b.x = b.fromX = b.toX = t2.x;
    b.y = b.fromY = b.toY = t2.y;
  }
  loadIcon(raw.icon);
  return b;
}

export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function artFromTint(hex) {
  const h = String(hex || "#6db06a").replace("#", "");
  const n = h.length === 3
    ? h.split("").map((c) => c + c).join("")
    : h.padEnd(6, "0").slice(0, 6);
  const r = parseInt(n.slice(0, 2), 16) || 100;
  const g = parseInt(n.slice(2, 4), 16) || 160;
  const b = parseInt(n.slice(4, 6), 16) || 100;
  const adj = (rr, gg, bb) =>
    "#" + [rr, gg, bb].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("");
  const floor = adj(r, g, b);
  const floorHi = adj(r + 28, g + 28, b + 20);
  const wall = adj(r - 40, g - 40, b - 30);
  const wallLit = adj(r - 10, g - 10, b - 8);
  return {
    a: floorHi, b: floor, c: adj(r + 40, g + 36, b + 24), d: adj(r - 20, g - 20, b - 16),
    floor, floorHi, wall, wallLit,
    edge: `rgba(${Math.max(0,r-60)},${Math.max(0,g-60)},${Math.max(0,b-50)},0.88)`,
    ring: `rgba(${r},${g},${b},0.5)`,
  };
}

export function applyClaudeLayoutFromConfig(cfg) {
  S.claudeConfig = cfg || {};
  const areas = Array.isArray(cfg.areas) ? cfg.areas : [];
  const layout = {};
  const hubMap = {};
  for (const a of areas) {
    if (!a || !a.key) continue;
    layout[a.key] = {
      gx: +a.gx, gy: +a.gy, gw: +a.gw, gh: +a.gh,
      elevOffset: a.elevOffset != null ? +a.elevOffset : 8,
      door: a.door == null ? null : a.door,
      enclosed: !!a.enclosed,
    };
    if (a.hub) hubMap[a.key] = a.hub;
    ZONE_ART[a.key] = artFromTint(a.tint || "#6db06a");
    ZONE_PROPS[a.key] = {
      prop: a.prop || "prop_bench",
      motif: a.motif || "motif_moon",
    };
  }
  S.runtimeLayout = layout;
  S.runtimePathHubs = cfg.pathHubs || {};
  S.runtimePathEdges = cfg.pathHubEdges || [];
  S.runtimeZoneHubMap = hubMap;
  S.claudeSlotCols = Math.max(3, +cfg.slotColumns || 5);
  S.claudeConfig = cfg;
  applyThemeVisuals(S.activeTheme);
  buildIsland();
  fitIslandCamera();
}

export async function ensureClaudeConfig() {
  if (S.claudeConfig && S.claudeConfig.areas) return S.claudeConfig;
  try {
    const res = await fetch(`config.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    S.claudeConfig = await res.json();
    return S.claudeConfig;
  } catch (err) {
    console.warn("config.json load failed", err);
    S.claudeConfig = { areas: [] };
    return S.claudeConfig;
  }
}


export function syncChrome() {
  const elTitle = document.getElementById("board-title") || document.querySelector("#header h1");
  if (elTitle) elTitle.textContent = "Busybots";
  const elFooter = document.getElementById("footer");
  if (elFooter) {
    const labels = (S.claudeConfig?.areas || []).map((a) => a && (a.label || a.key)).filter(Boolean);
    elFooter.textContent = ["Updates every ~2s", labels.join(" · ")]
      .filter(Boolean).join("  ·  ");
  }
  syncAgentFilterChips();
  syncThemeChips();
}

export function syncAgentFilterChips() {
  const wrap = document.getElementById("agent-filter-chips");
  if (!wrap) return;
  wrap.classList.remove("hidden");
  wrap.setAttribute("aria-hidden", "false");
  // Only show chips for agent types that are on the board (plus All and the active one)
  const present = new Set([...bots.values()].map(botBrandKey));
  for (const btn of wrap.querySelectorAll(".chip[data-filter]")) {
    const f = btn.getAttribute("data-filter");
    btn.setAttribute("aria-pressed", f === S.agentFilter ? "true" : "false");
    btn.classList.toggle("hidden", f !== "all" && f !== S.agentFilter && !present.has(f));
  }
}

export function setAgentFilter(next) {
  S.agentFilter = normalizeAgentFilter(next);
  try { localStorage.setItem(LS_AGENT_FILTER_KEY, S.agentFilter); } catch (_) {}
  syncAgentFilterChips();
  // Close panel if selected bot no longer visible
  if (S.panelSessionId) {
    const b = bots.get(S.panelSessionId);
    if (b && !botPassesAgentFilter(b) && typeof closeAgentPanel === "function") {
      closeAgentPanel();
    }
  }
}

export async function initBoard() {
  const theme = await loadTheme(S.themeId);
  S.activeTheme = theme;
  const cfg = await ensureClaudeConfig();
  applyClaudeLayoutFromConfig(cfg);
  syncChrome();
  await poll();
}

export function applyStatus(data) {

  S.status = data;
  applyPalette(data.project?.palette);
  elProject.textContent = data.project?.name || "";
  updateHeaderTime(data.project?.updatedAt);
  updateAttentionSummary(data.bots || []);

  const seen = new Set();
  for (const raw of data.bots || []) {
    seen.add(raw.id);
    const b = ensureBot(raw);
    const prevZone = b.zone;
    const zoneChanged = prevZone !== raw.zone;
    b.name = raw.name;
    b.icon = raw.icon;
    b.state = raw.state || "idle";
    b.bubble = raw.bubble;
    b.task = raw.task;
    b.phase = raw.phase || null;
    b.attention = raw.attention || null;
    b.origin = raw.origin || null;
    b.brand = raw.brand || null;
    b.cwd = raw.cwd || null;
    b.livePid = raw.livePid || null;
    b.open = !!raw.open;
    b.zone = raw.zone;
    assignClaudeSlot(b, raw.zone);

    const t = targetFor(b);
    if (zoneChanged) {
      // Polyline along path graph (stand→door→hubs→door→stand)
      const pts = routeScreenWaypoints(prevZone, raw.zone);
      if (pts.length) {
        const g0 = b.gx != null ? { gx: b.gx, gy: b.gy } : { gx: pts[0].gx, gy: pts[0].gy };
        pts[0] = { x: b.x, y: b.y, gx: g0.gx, gy: g0.gy }; // start from current screen pos
        pts[pts.length - 1] = { x: t.x, y: t.y, gx: t.gx != null ? t.gx : pts[pts.length - 1].gx,
                                gy: t.gy != null ? t.gy : pts[pts.length - 1].gy };
      }
      b.walkPts = pts.length >= 2 ? pts : [{ x: b.x, y: b.y }, { x: t.x, y: t.y }];
      const plen = polylineLength(b.walkPts);
      b.walkMs = Math.max(WALK_MS, Math.min(4200, WALK_MS * (0.55 + plen / 280)));
      b.fromX = b.x;
      b.fromY = b.y;
      b.toX = t.x;
      b.toY = t.y;
      b.walkStart = performance.now();
      b.walking = true;
    } else if (!b.walking) {
      b.walkPts = null;
      b.toX = t.x;
      b.toY = t.y;
      b.x = t.x;
      b.y = t.y;
    } else {
      // Keep walking; retarget final waypoint if stand slots shuffled
      b.toX = t.x;
      b.toY = t.y;
      if (b.walkPts && b.walkPts.length) {
        b.walkPts[b.walkPts.length - 1] = { x: t.x, y: t.y, gx: t.gx, gy: t.gy };
      }
    }
  }
  for (const b of bots.values()) {
    if (!seen.has(b.id)) continue;
    if (b.walking) continue;
    const t = targetFor(b);
    b.x = b.toX = t.x;
    b.y = b.toY = t.y;
  }
  for (const id of [...bots.keys()]) {
    if (!seen.has(id)) {
      releaseClaudeSlot(bots.get(id));
      bots.delete(id);
    }
  }
  syncAgentFilterChips();
}

/** Header pill: "2 need you · 1 done" (Claude agents board only). */
export function updateAttentionSummary(list) {
  let el = document.getElementById("attention-summary");
  if (!el && elUpdated && elUpdated.parentNode) {
    el = document.createElement("span");
    el.id = "attention-summary";
    el.className = "attention-summary hidden";
    elUpdated.parentNode.insertBefore(el, elUpdated);
  }
  if (!el) return;
  const need = list.filter((r) => r.attention && r.attention.needsYou).length;
  const done = list.filter((r) => r.attention && r.attention.done).length;
  const stuck = list.filter((r) => r.attention && r.attention.stuck).length;
  const parts = [];
  if (need) parts.push(`<b class="need">${need} need${need === 1 ? "s" : ""} you</b>`);
  if (stuck) parts.push(`<b class="stuck">${stuck} stuck</b>`);
  if (done) parts.push(`<b class="done">${done} done</b>`);
  el.innerHTML = parts.join(" · ");
  el.classList.toggle("hidden", !parts.length);
}

/**
 * Status badges on an agent: "!" needs you (pulsing), ✓ done, ⚠ stuck, and little
 * satellites for live sub-agents. Drawn in the overlay pass so walls never hide them.
 */
export function drawAttentionBadges(b, drawX, drawY, size, now) {
  const a = b.attention;
  if (!a) return;
  const bx = drawX + size * 0.42, by = drawY - size * 0.42;
  const disc = (x, y, r, fill, ring) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = ring || "#ffffff";
    ctx.stroke();
  };
  ctx.save();
  ctx.globalAlpha = 1;
  if (a.needsYou) {
    const t = (now / 900 + b.bobPhase) % 1;
    // expanding pulse rings + a soft glow on the ground
    for (const k of [0, 0.5]) {
      const p = (t + k) % 1;
      ctx.beginPath();
      ctx.arc(bx, by, 9 + p * 14, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,140,40,${0.75 * (1 - p)})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    ctx.save();
    ctx.globalAlpha = 0.28 + 0.18 * Math.sin(now / 260 + b.bobPhase);
    ctx.fillStyle = "#ff8c28";
    ctx.beginPath();
    ctx.ellipse(drawX, drawY + size / 2 + 3, size * 0.55, size * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    disc(bx, by, 9, "#ff7a1a");
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 13px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", bx, by + 0.5);
  } else if (a.done) {
    disc(bx, by, 8, "#2fbf71");
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bx - 3.6, by + 0.2);
    ctx.lineTo(bx - 1.0, by + 2.8);
    ctx.lineTo(bx + 3.8, by - 2.6);
    ctx.stroke();
  }
  if (a.stuck) {
    const sx = drawX - size * 0.42, sy = drawY - size * 0.42;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 9);
    ctx.lineTo(sx + 9, sy + 7);
    ctx.lineTo(sx - 9, sy + 7);
    ctx.closePath();
    ctx.fillStyle = "#e5484d";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 11px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", sx, sy + 2);
  }
  const n = Math.min(4, a.subagents || 0);
  if (n > 0) {
    const R = size * 0.72;
    for (let i = 0; i < n; i++) {
      const ang = now / 700 + (i * Math.PI * 2) / n + b.bobPhase;
      const ox = drawX + Math.cos(ang) * R;
      const oy = drawY + Math.sin(ang) * R * 0.45;
      disc(ox, oy, 4.2, "#3ec8e0", "#0b3a44");
    }
    if ((a.subagents || 0) > 4) {
      ctx.fillStyle = "#0b3a44";
      ctx.font = `700 10px ${UI_FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(`×${a.subagents}`, drawX + R + 4, drawY);
    }
  }
  ctx.restore();
}

export function updateHeaderTime(iso) {
  if (!iso) {
    elUpdated.textContent = "updated —";
    elStale.classList.add("hidden");
    return;
  }
  try {
    const d = new Date(iso);
    // Viewer's own locale and time zone
    const fmt = d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    elUpdated.textContent = `updated ${fmt}`;
    const age = Date.now() - d.getTime();
    if (age > STALE_MS) elStale.classList.remove("hidden");
    else elStale.classList.add("hidden");
  } catch {
    elUpdated.textContent = `updated ${iso}`;
  }
}
export async function poll() {
  if (S.pollInFlight) return; // a slow response must not race the next poll
  S.pollInFlight = true;
  try {
    const res = await fetch(`${STATUS_FILE}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    applyStatus(data);
    elDot.classList.add("flash");
    setTimeout(() => elDot.classList.remove("flash"), 200);
  } catch (err) {
    console.warn("poll failed", err);
  } finally {
    S.pollInFlight = false;
  }
}
