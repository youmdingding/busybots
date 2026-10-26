// Board entry point: boot sequence and frame loop. Statements here run in their original order.
import { S } from "./state.js";
import { bots } from "./state.js";
import { CANVAS_H, CANVAS_W, CITY_DIR, LS_AGENT_FILTER_KEY, LS_THEME_KEY, POLL_MS } from "./constants.js";
import { bootPanelId, bootParams, canvas, ctx } from "./dom.js";
import { normalizeAgentFilter } from "./agents.js";
import { routeGridWaypoints } from "./routes.js";
import { loadThemeManifest, normalizeThemeId, resolveInitialTheme, setTheme } from "./theme.js";
import { buildIsland } from "./island.js";
import { fitIslandCamera, loadTile } from "./layout.js";
import { TRAFFIC, signalState, trafficSpec } from "./city.js";
import { ROAMERS } from "./roamers.js";
import { initBoard, poll, setAgentFilter } from "./status.js";
import { frame } from "./render.js";
import { focusMainBoard, initMini } from "./mini.js";
import { apiPost, closeAgentPanel, elPanelClose, elPanelJump, elPanelNote, elPanelPrompt, elPanelSend, hitTestBot, openAgentPanel, pickCharacter, pickColour, pickOwnIcon, refreshPanel, saveIcon, saveName, toggleIconPicker, toggleRename } from "./panel.js";

S.agentFilter = normalizeAgentFilter((() => {
  try { return localStorage.getItem(LS_AGENT_FILTER_KEY); } catch (_) { return "all"; }
})());
S.ORIGIN_X = 800;
S.ORIGIN_Y = 88;
/** Uniform world scale — set by fitIslandCamera to center/enlarge island. */
S.worldScale = 1;

/** Zone layout (grid units) — built from config.json `areas` at load. */
S.runtimeLayout = {};
S.runtimePathHubs = null;
S.runtimePathEdges = null;
S.runtimeZoneHubMap = null;
S.claudeConfig = null;
S.claudeSlotCols = 5;
S.themeId = resolveInitialTheme();
/** @type {any} */
S.activeTheme = { id: "island", ambient: "nature", sky: { style: "clouds" }, base: { style: "water" }, sign: { style: "wood" }, pond: true };
S.themeManifest = null;
ctx.imageSmoothingEnabled = false;
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;

/** @type {any} */
S.status = null;

/**
 * @typedef {{
 *  id: string, name: string, icon: string, zone: string, state: string,
 *  bubble: string|null, task: string|null,
 *  x: number, y: number,
 *  fromX: number, fromY: number, toX: number, toY: number,
 *  walkStart: number, walkMs: number, walking: boolean,
 *  walkPts: {x:number,y:number}[]|null,
 *  bobPhase: number
 * }} BotView
 */

// ---- Island heightmap (integer grid) ------------------------------------
/** @type {{gx:number,gy:number,h:number,kind:string}[]} */
S.islandTiles = [];
/** @type {Map<string, {h:number,kind:string,zone?:string}>} */
S.heightAt = new Map();
/** @type {{gx:number,gy:number,type:string,variant?:number}[]} */
S.decor = [];

buildIsland();
fitIslandCamera();

// Preload decor + zone props/motifs
[
  "tiles/pine_0.png", "tiles/pine_1.png", "tiles/pine_2.png",
  "tiles/bush.png", "tiles/rock_grey.png", "tiles/rock_brown.png",
  "tiles/flower_red.png", "tiles/flower_orange.png", "tiles/flower_purple.png",
  "tiles/sign.png", "tiles/plaque.png", "tiles/grass_speckle.png",
  "tiles/prop_podium.png", "tiles/prop_easel.png", "tiles/prop_desk.png",
  "tiles/prop_laptop.png", "tiles/prop_checklist.png", "tiles/prop_bench.png",
  "tiles/prop_lookout.png",
  "tiles/motif_megaphone.png", "tiles/motif_eyedropper.png", "tiles/motif_quill.png",
  "tiles/motif_gear.png", "tiles/motif_tick.png", "tiles/motif_moon.png",
  "tiles/motif_compass.png",
].forEach(loadTile);
S.CITY_MANIFEST = null;
fetch(`${CITY_DIR}manifest.json?t=${Date.now()}`, { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : null))
  .then((m) => {
    S.CITY_MANIFEST = m;
    if (m) Object.keys(m).forEach((n) => loadTile(`${CITY_DIR}${n}.png`));
    if (m && S.activeTheme && S.activeTheme.ground && S.activeTheme.ground.fitSprite) fitIslandCamera();
  })
  .catch(() => {});

S.pollInFlight = false;

/** One bad bot or theme value must never stop the animation for good. */
S.lastFrameError = -Infinity; // log the first failure immediately, then at most every 5s
S.frameErrorCount = 0;


// ---- Claude agent panel / local API ------------------------------------
S.boardApiToken = null;
S.panelSessionId = null;
S.panelTimer = null;

canvas.addEventListener("click", (ev) => {
  const b = hitTestBot(ev.clientX, ev.clientY);
  if (!b) return;
  if (S.miniOpenAgent && S.miniOpenAgent(b)) return; // separate mini window: shown in the main board
  openAgentPanel(b);
  focusMainBoard(); // clicked in the floating window: the panel opens in the main one
});
S.openAgentFromMini = (b) => openAgentPanel(b);
canvas.style.cursor = "default";
canvas.addEventListener("mousemove", (ev) => {
  canvas.style.cursor = hitTestBot(ev.clientX, ev.clientY) ? "pointer" : "default";
});

elPanelClose?.addEventListener("click", closeAgentPanel);
document.getElementById("panel-icon")?.addEventListener("click", () => toggleIconPicker());
document.getElementById("panel-rename")?.addEventListener("click", () => toggleRename(true));
document.getElementById("panel-name-cancel")?.addEventListener("click", () => toggleRename(false));
document.getElementById("panel-name-reset")?.addEventListener("click", () => saveName(null));
document.getElementById("panel-name-form")?.addEventListener("submit", (ev) => {
  ev.preventDefault();
  saveName(document.getElementById("panel-name-input").value);
});
document.getElementById("panel-name-input")?.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    ev.stopPropagation(); // cancel the rename, keep the panel open
    toggleRename(false);
  }
});
document.getElementById("panel-icon-cancel")?.addEventListener("click", () => toggleIconPicker(false));
document.getElementById("panel-icon-save")?.addEventListener("click", () => saveIcon());
document.getElementById("panel-icon-reset")?.addEventListener("click", () => pickOwnIcon());
document.getElementById("panel-icon-chars")?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-key]");
  if (btn) pickCharacter(btn.dataset.key);
});
document.getElementById("panel-icon-colours")?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-colour]");
  if (btn) pickColour(Number(btn.dataset.colour));
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeAgentPanel();
});

elPanelJump?.addEventListener("click", async () => {
  if (!S.panelSessionId) return;
  elPanelJump.disabled = true;
  try {
    const data = await apiPost(`/api/session/${encodeURIComponent(S.panelSessionId)}/jump`, {});
    if (elPanelNote) elPanelNote.textContent = data.ok ? `Jump: ${data.method || "ok"}` : (data.error || "Jump failed");
  } catch (err) {
    if (elPanelNote) elPanelNote.textContent = String(err);
  } finally {
    elPanelJump.disabled = false;
  }
});

elPanelSend?.addEventListener("click", async () => {
  if (!S.panelSessionId || !elPanelPrompt) return;
  const prompt = elPanelPrompt.value.trim();
  if (!prompt) return;
  if (!confirm("Send this prompt to the idle session?\n\n" + prompt.slice(0, 200))) return;
  elPanelSend.disabled = true;
  try {
    const data = await apiPost(`/api/session/${encodeURIComponent(S.panelSessionId)}/prompt`, { prompt });
    if (data.ok) {
      if (elPanelNote) elPanelNote.textContent = "Sent";
      elPanelPrompt.value = "";
      setTimeout(refreshPanel, 1500);
    } else {
      if (elPanelNote) elPanelNote.textContent = data.error || "Send failed";
    }
  } catch (err) {
    if (elPanelNote) elPanelNote.textContent = String(err);
  } finally {
    elPanelSend.disabled = false;
  }
});


document.getElementById("agent-filter-chips")?.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".chip[data-filter]");
  if (!btn) return;
  const f = btn.getAttribute("data-filter");
  if (!f || f === S.agentFilter) return;
  setAgentFilter(f);
});

document.getElementById("theme-chips")?.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".chip[data-theme]");
  if (!btn) return;
  const id = btn.getAttribute("data-theme");
  if (!id || id === S.themeId) return;
  setTheme(id);
});

// Debug/test hook (screenshots + layout checks) — only with ?debug
if (bootParams.has("debug")) window.__boardDebug = {
  openFirstClaude() {
    const b = [...bots.values()][0];
    if (b) return openAgentPanel(b);
  },
  camera() {
    return { ORIGIN_X: S.ORIGIN_X, ORIGIN_Y: S.ORIGIN_Y, worldScale: S.worldScale, tiles: S.islandTiles.length };
  },
  roamers() {
    return ROAMERS.list.map((r) => ({ gx: r.gx, gy: r.gy, face: r.face, mode: r.mode, i: r.i, v: r.v }));
  },
  traffic() {
    const spec = trafficSpec();
    return {
      clock: TRAFFIC.clock,
      signals: spec ? (spec.signals || []).map((g) => signalState(g.id)) : [],
      cars: TRAFFIC.cars.map((c) => ({ lane: spec ? (spec.lanes || []).indexOf(c.lane) : -1, pos: c.pos, v: c.v, half: c.half })),
    };
  },
  route(from, to) {
    return routeGridWaypoints(from, to);
  },
  layout() {
    return {
      zones: S.runtimeLayout,
      tiles: S.islandTiles.map((t) => [t.gx, t.gy, t.kind, t.zone || ""]),
      decor: S.decor,
      cityBlocked: S.decor.filter((d) => d.city && d.blocked).map((d) => `${d.type}@${d.gx},${d.gy}`),
    };
  },
  panelOpen() {
    return document.getElementById("board-row")?.classList.contains("panel-open");
  },
  filter() {
    return S.agentFilter;
  },
  frameErrors() {
    return S.frameErrorCount;
  },
  theme() {
    return { themeId: S.themeId, active: S.activeTheme && S.activeTheme.id, decor: S.decor.length };
  },
};

(async () => {
  await loadThemeManifest();
  // No theme in the URL or remembered in this browser → use the default from Settings
  let rememberedTheme = null;
  try { rememberedTheme = localStorage.getItem(LS_THEME_KEY); } catch (_) {}
  if (!bootParams.get("theme") && !rememberedTheme) {
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      if (r.ok) S.themeId = normalizeThemeId((await r.json()).settings?.board?.theme);
    } catch (_) { /* static hosting / older server: keep island */ }
  }
  await initBoard();
  if (bootPanelId) {
    await new Promise((r) => setTimeout(r, 800));
    const bot = bots.get(bootPanelId) || { id: bootPanelId, name: bootPanelId.slice(0, 8) };
    await openAgentPanel(bot);
  }
})();

initMini({ draw: frame, poll, pollMs: POLL_MS, standalone: bootParams.get("mini") === "1" });
