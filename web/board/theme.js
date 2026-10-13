// Themes: loading, switching and per-theme visuals.
import { S } from "./state.js";
import { ZONE_ART, ZONE_PROPS } from "./state.js";
import { LS_THEME_KEY, THEME_IDS } from "./constants.js";
import { buildIsland } from "./island.js";
import { fitIslandCamera } from "./layout.js";
import { artFromTint } from "./status.js";

// Soft Mockup_1 palette (overrides neon status palette for terrain)
export const ART = {
  skyTop: "#b8e4f0",
  skyMid: "#d4eef5",
  skyBot: "#e8f4f0",
  waterTop: "#8ec8d8",
  waterLit: "#b8e0ec",
  waterRipple: "#dff4fa",
  waterSide: "#3a4a78",
  waterSideDark: "#2a3560",
  grassA: "#6db06a",
  grassB: "#5a9a58",
  grassC: "#7ec478",
  grassD: "#4e864c",
  grassSpeck: "#3d703c",
  grassHi: "#9ad890",
  pathA: "#b8a078",
  pathB: "#9a8460",
  pathC: "#cbb892",
  dirtLeft: "#5a3d2a",
  dirtLeftMid: "#6e4a32",
  dirtRight: "#8a6540",
  dirtRightLit: "#a07850",
  dirtEdge: "#3d2818",
  stoneLeft: "#4a4e55",
  stoneRight: "#7a8088",
  labelWood: "#5c3d22",
  labelText: "#2a1a0c",
};

/** Immutable Island defaults — themes mutate ART / ZONE_ART / ZONE_PROPS at runtime. */
export const ART_DEFAULTS = JSON.parse(JSON.stringify(ART));
export function normalizeThemeId(raw) {
  const s = String(raw || "").toLowerCase().replace(/\s+/g, "-");
  if (s === "space-station" || s === "spacestation" || s === "station") return "space";
  return THEME_IDS.has(s) ? s : "island";
}
export function resolveInitialTheme() {
  const fromUrl = normalizeThemeId(new URLSearchParams(location.search).get("theme"));
  if (new URLSearchParams(location.search).get("theme")) return fromUrl;
  try { return normalizeThemeId(localStorage.getItem(LS_THEME_KEY)); } catch (_) { return "island"; }
}
/** @type {Record<string, any>} */
export const themeCache = {};

export async function loadThemeManifest() {
  if (S.themeManifest) return S.themeManifest;
  try {
    const res = await fetch(`themes/manifest.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    S.themeManifest = await res.json();
  } catch (err) {
    console.warn("theme manifest failed", err);
    S.themeManifest = { default: "island", themes: [
      { id: "island", label: "Island", file: "island.json" },
      { id: "office", label: "Office", file: "office.json" },
      { id: "city", label: "City", file: "city.json" },
      { id: "space", label: "Space", file: "space.json" },
    ]};
  }
  return S.themeManifest;
}

export async function loadTheme(id) {
  const tid = normalizeThemeId(id);
  if (themeCache[tid]) return themeCache[tid];
  const man = await loadThemeManifest();
  const entry = (man.themes || []).find((t) => t.id === tid) || { id: tid, file: `${tid}.json` };
  try {
    const res = await fetch(`themes/${entry.file}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    themeCache[tid] = data;
    return data;
  } catch (err) {
    console.warn("theme load failed", tid, err);
    const fallback = { id: "island", ambient: "nature", sky: { style: "clouds" }, base: { style: "water" }, sign: { style: "wood" }, pond: true, art: {}, zones: {}, props: {} };
    return fallback; // not cached, so a later attempt can still load the real theme
  }
}

export function restoreIslandVisualDefaults() {
  Object.keys(ART).forEach((k) => delete ART[k]);
  Object.assign(ART, JSON.parse(JSON.stringify(ART_DEFAULTS)));
  for (const k of Object.keys(ZONE_ART)) delete ZONE_ART[k];
  for (const k of Object.keys(ZONE_PROPS)) delete ZONE_PROPS[k];
}

/** Apply theme visuals. Island = baked defaults (+ Claude area tints from config). */
export function applyThemeVisuals(theme) {
  S.activeTheme = theme || S.activeTheme || { id: "island" };
  restoreIslandVisualDefaults();

  // Re-apply Claude area tints/props from config (Agents rooms)
  if (S.claudeConfig && Array.isArray(S.claudeConfig.areas)) {
    for (const a of S.claudeConfig.areas) {
      if (!a || !a.key) continue;
      ZONE_ART[a.key] = artFromTint(a.tint || "#6db06a");
      ZONE_PROPS[a.key] = {
        prop: a.prop || "prop_bench",
        motif: a.motif || "motif_moon",
      };
    }
  }

  if (!S.activeTheme || S.activeTheme.id === "island") {
    syncThemeChips();
    applyThemePageChrome();
    return;
  }

  if (S.activeTheme.art) Object.assign(ART, S.activeTheme.art);
  if (S.activeTheme.zones) {
    for (const [zid, za] of Object.entries(S.activeTheme.zones)) {
      ZONE_ART[zid] = { ...(ZONE_ART[zid] || artFromTint("#888888")), ...za };
    }
  }
  if (S.activeTheme.props) {
    for (const [zid, zp] of Object.entries(S.activeTheme.props)) {
      ZONE_PROPS[zid] = { ...(ZONE_PROPS[zid] || {}), ...zp };
    }
  }
  syncThemeChips();
  applyThemePageChrome();
}

export function applyThemePageChrome() {
  const root = document.documentElement.style;
  if (S.activeTheme && S.activeTheme.page) {
    if (S.activeTheme.page.bg) root.setProperty("--bg", S.activeTheme.page.bg);
    if (S.activeTheme.page.accent) root.setProperty("--accent", S.activeTheme.page.accent);
  }
}

export function syncThemeChips() {
  const wrap = document.getElementById("theme-chips");
  if (!wrap) return;
  wrap.classList.remove("hidden");
  wrap.setAttribute("aria-hidden", "false");
  for (const btn of wrap.querySelectorAll(".chip[data-theme]")) {
    const id = btn.getAttribute("data-theme");
    btn.setAttribute("aria-pressed", id === S.themeId ? "true" : "false");
  }
}

export async function setTheme(next, { pushUrl = true, rebuild = true } = {}) {
  S.themeId = normalizeThemeId(next);
  try { localStorage.setItem(LS_THEME_KEY, S.themeId); } catch (_) {}
  if (pushUrl) {
    const params = new URLSearchParams(location.search);
    params.set("theme", S.themeId);
    params.delete("source");
    history.replaceState(null, "", "?" + params.toString());
  }
  const theme = await loadTheme(S.themeId);
  applyThemeVisuals(theme);
  if (rebuild) {
    buildIsland();
    fitIslandCamera();
  }
}
