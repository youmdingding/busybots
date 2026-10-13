// User settings: where each agent keeps its sessions, personal classification rules,
// and board preferences. Stored in settings.json in the per-user state folder (see
// paths.js), edited from the admin page. Missing keys fall back to defaults(), so an
// empty or absent file works out of the box.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { settingsPath, expand, PACKAGE_ROOT, LEGACY_APP_NAMES, stateDirFor } from "./paths.js";

export const MAX_PATHS = 8;
export const MAX_PATH_LEN = 1024;
export const THEMES = ["island", "office", "city", "space"];
/** Agents read through a reader module (src/readers/<id>.js): folders + recent window. */
export const READER_SOURCES = ["codex", "gemini", "opencode", "cursor"];
export const FOLDER_SOURCES = ["claude", ...READER_SOURCES];

const env = (k) => process.env[k];

export function defaults() {
  return {
    version: 1,
    sources: {
      claude: { enabled: true, paths: [env("CLAUDE_CONFIG_DIR") || "~/.claude"] },
      codex: { enabled: true, paths: [env("CODEX_HOME") || "~/.codex"], recentMinutes: 30 },
      gemini: { enabled: true, paths: [env("GEMINI_CLI_HOME") ? `${env("GEMINI_CLI_HOME")}/.gemini` : "~/.gemini"], recentMinutes: 30 },
      opencode: { enabled: true, paths: [env("XDG_DATA_HOME") ? `${env("XDG_DATA_HOME")}/opencode` : "~/.local/share/opencode"], recentMinutes: 30 },
      cursor: { enabled: true, paths: ["~/.cursor"], recentMinutes: 30 },
      conductor: {
        enabled: "auto",
        db: "~/Library/Application Support/com.conductor.app/conductor.db",
        workspaces: "~/conductor/workspaces",
      },
    },
    // Personal additions to the classification rules in config.json (skills you use, etc.)
    rules: { skillAreas: {}, skillLabels: {}, phaseFiles: { plan: [], spec: [] }, testCommands: [] },
    board: { theme: "island", showIdleBubbles: false, pollSeconds: 2, privacy: false },
  };
}

/** Shown on the admin page. */
export const AGENT_TYPES = [
  { id: "claude", label: "Claude Code", kind: "folders", reader: true,
    hint: "Folder that contains sessions/ and projects/ (default ~/.claude, or $CLAUDE_CONFIG_DIR)." },
  { id: "codex", label: "Codex CLI", kind: "folders", reader: true,
    hint: "Folder that contains sessions/ (default ~/.codex, or $CODEX_HOME)." },
  { id: "gemini", label: "Gemini CLI", kind: "folders", reader: true,
    hint: "Gemini CLI's .gemini folder, which contains tmp/ (default ~/.gemini, or $GEMINI_CLI_HOME/.gemini)." },
  { id: "opencode", label: "OpenCode", kind: "folders", reader: true,
    hint: "OpenCode's data folder with opencode.db (default ~/.local/share/opencode, or $XDG_DATA_HOME/opencode)." },
  { id: "cursor", label: "Cursor CLI", kind: "folders", reader: true, beta: true,
    hint: "Cursor's .cursor folder, which contains chats/ (default ~/.cursor). Terminal agent only — not the IDE's chats." },
  { id: "conductor", label: "Conductor", kind: "database", reader: true,
    hint: "Conductor's app database (macOS). Auto turns it on when the file exists." },
];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Deep-merge known keys only (unknown keys are dropped, like the Python version). */
function merge(base, over) {
  const out = clone(base);
  if (!isObj(over)) return out;
  for (const [k, v] of Object.entries(over)) {
    if (!(k in out)) continue;
    out[k] = isObj(out[k]) && isObj(v) && !isFreeMap(k) ? merge(out[k], v) : v;
  }
  return out;
}
// Maps whose keys are user data (skill names), not schema keys
const isFreeMap = (k) => k === "skillAreas" || k === "skillLabels";

const cleanStr = (v) => typeof v === "string" && v.length <= MAX_PATH_LEN && !v.includes("\0");
const strList = (v, max = 200) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 200)).slice(0, max) : []);
const strMap = (v) => {
  const out = {};
  if (!isObj(v)) return out;
  for (const [k, val] of Object.entries(v).slice(0, 500)) {
    if (typeof k === "string" && k.trim() && typeof val === "string") out[k.trim().slice(0, 100)] = val.slice(0, 100);
  }
  return out;
};

/** Returns [clean settings, errors]. Bad values reset to defaults; errors block saving. */
export function validate(raw) {
  const errors = [];
  const d = defaults();
  const s = merge(d, isObj(raw) ? raw : {});
  const src = s.sources;
  for (const sid of FOLDER_SOURCES) {
    const node = src[sid];
    node.enabled = Boolean(node.enabled);
    const paths = Array.isArray(node.paths) ? node.paths : d.sources[sid].paths;
    const clean = [];
    for (const p of paths.slice(0, MAX_PATHS)) {
      if (typeof p === "string" && p.trim()) {
        if (!cleanStr(p)) {
          errors.push(`${sid}: path too long or invalid`);
          continue;
        }
        clean.push(p.trim());
      }
    }
    if (node.enabled && clean.length === 0) errors.push(`${sid}: add at least one folder or turn it off`);
    node.paths = clean;
  }
  for (const sid of READER_SOURCES) {
    const rm = Number.parseInt(src[sid].recentMinutes, 10);
    src[sid].recentMinutes = Math.max(1, Math.min(Number.isFinite(rm) && rm > 0 ? rm : 30, 24 * 60));
  }
  const c = src.conductor;
  if (![true, false, "auto"].includes(c.enabled)) c.enabled = "auto";
  for (const k of ["db", "workspaces"]) {
    if (!cleanStr(c[k])) {
      errors.push(`conductor: invalid ${k}`);
      c[k] = d.sources.conductor[k];
    }
  }
  const r = isObj(s.rules) ? s.rules : d.rules;
  s.rules = {
    skillAreas: strMap(r.skillAreas),
    skillLabels: strMap(r.skillLabels),
    phaseFiles: { plan: strList(r.phaseFiles?.plan), spec: strList(r.phaseFiles?.spec) },
    testCommands: strList(r.testCommands),
  };
  const b = s.board;
  if (!THEMES.includes(b.theme)) b.theme = "island";
  b.showIdleBubbles = Boolean(b.showIdleBubbles);
  b.privacy = Boolean(b.privacy);
  let ps = Number(b.pollSeconds);
  if (!Number.isFinite(ps) || ps <= 0) ps = 2;
  b.pollSeconds = Math.max(1, Math.min(ps, 30));
  return [s, errors];
}

/** Effective settings (file merged over defaults). Never throws. */
export function load(path = settingsPath()) {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    raw = {};
  }
  return validate(raw)[0];
}

export function exists(path = settingsPath()) {
  return existsSync(path);
}

/** Validate and write atomically. Throws Error(message) when invalid. */
export function save(settings, path = settingsPath()) {
  const [clean, errors] = validate(settings);
  if (errors.length) throw new Error(errors.join("; "));
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.settings.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(clean, null, 2) + "\n", "utf8");
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw err;
  }
  return clean;
}

/** Where older versions kept settings.json: the board's own folder, then the pre-name state folder. */
export const LEGACY_SETTINGS = [
  join(PACKAGE_ROOT, "settings.json"),
  ...LEGACY_APP_NAMES.map((n) => join(stateDirFor(n), "settings.json")),
];

/**
 * If the per-user settings file doesn't exist yet but an older one does, copy it over
 * once (the old file is left in place). Returns the old path when it migrated, else null.
 */
export function migrateLegacy(from = LEGACY_SETTINGS, to = settingsPath()) {
  if (Array.isArray(from)) {
    for (const f of from) {
      const moved = migrateLegacy(f, to);
      if (moved) return moved;
    }
    return null;
  }
  if (existsSync(to) || !existsSync(from)) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(from, "utf8"));
  } catch {
    return null;
  }
  const [clean] = validate(raw);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, JSON.stringify(clean, null, 2) + "\n", "utf8");
  return from;
}

// ---- helpers used by the watcher -------------------------------------------------

/** Expanded folders for a source ([] when it's switched off). */
export function dirs(s, source) {
  const node = s.sources[source];
  return node && node.enabled ? node.paths.map(expand) : [];
}

/** [enabled, database, workspaces root] for Conductor. */
export function conductor(s) {
  const c = s.sources.conductor;
  const db = expand(c.db);
  const ws = expand(c.workspaces);
  const on = (c.enabled === "auto" || c.enabled === true) && existsSync(db);
  return [on, db, ws];
}
