// Icons you can pick for one conversation from the agent panel, and the per-session
// choices (<state>/icons.json). A choice is kept for that session id only.
//
// Every character comes in the same 12 colours (tools/gen_icons.py, BRIGHT_PALETTE):
//   icons/<agent>-NN.png       the agents' own characters (claude, codex, …)
//   icons/pick-<name>-NN.png   characters anyone can pick (robot, cat, fox, …)
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { PACKAGE_ROOT, stateDir } from "./paths.js";

/** Same order as BRIGHT_PALETTE in tools/gen_icons.py: index NN in a file name. */
export const ICON_COLOURS = [
  "#FF781C", "#1CC3B0", "#A97EFE", "#2A92FE", "#E85D75", "#3DDC97",
  "#F4A261", "#7B68EE", "#2EC4B6", "#FF9F1C", "#5C7CFA", "#959595",
];
const KEEP_DAYS = 30; // forget choices for conversations not seen for a month
const FILE_RE = /^((?:pick-)?[a-z]+)-(\d{2})\.png$/;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const title = (s) => s[0].toUpperCase() + s.slice(1);

/**
 * { colours, characters: [{ key, label, group: "agent"|"fun", files: [path per colour] }] }
 * Agent characters first (the panel shows only the agent's own one), then the picks.
 */
export function iconSet(root = PACKAGE_ROOT) {
  let files = [];
  try {
    files = readdirSync(join(root, "icons"));
  } catch {
    return { colours: ICON_COLOURS, characters: [] };
  }
  const byKey = new Map();
  for (const f of files.sort()) {
    const m = FILE_RE.exec(f);
    if (!m) continue;
    const [, key, nn] = m;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)[Number(nn)] = `icons/${f}`;
  }
  const characters = [...byKey].map(([key, list]) => {
    const fun = key.startsWith("pick-");
    return { key, label: title(fun ? key.slice(5) : key), group: fun ? "fun" : "agent", files: list };
  });
  characters.sort((a, b) => (a.group === b.group ? 0 : a.group === "agent" ? -1 : 1));
  return { colours: ICON_COLOURS, characters };
}

/** Every icon path a choice may use. */
export function validIcons(root = PACKAGE_ROOT) {
  return new Set(iconSet(root).characters.flatMap((c) => c.files.filter(Boolean)));
}

export const MAX_NAME = 40;

/** A name someone typed for a conversation: trimmed, no control characters, ≤ 40 characters. */
export function cleanName(raw) {
  const s = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) throw new Error("Name is empty");
  if ([...s].length > MAX_NAME) throw new Error(`Name is longer than ${MAX_NAME} characters`);
  return s;
}

/**
 * What you chose for one conversation from the agent panel: an icon and/or a name.
 * Kept per session id in <state>/sessions.json (0.2–0.3 kept icons in icons.json; it is
 * still read until the first save).
 */
export class SessionPrefs {
  constructor(path = join(stateDir(), "sessions.json")) {
    this.path = path;
    this.legacy = join(dirname(path), "icons.json");
  }

  load() {
    for (const p of [this.path, this.legacy]) {
      try {
        const raw = JSON.parse(readFileSync(p, "utf8"));
        if (isObj(raw)) return raw;
      } catch { /* missing or broken: try the next one */ }
    }
    return {};
  }

  /** sessionId → { icon?, name? }, for the watcher (icons whose file no longer exists are skipped). */
  map(valid = validIcons()) {
    const out = {};
    for (const [sid, v] of Object.entries(this.load())) {
      if (!isObj(v)) continue;
      const p = {};
      if (typeof v.icon === "string" && valid.has(v.icon)) p.icon = v.icon;
      if (typeof v.name === "string" && v.name) p.name = v.name;
      if (p.icon || p.name) out[sid] = p;
    }
    return out;
  }

  update(sessionId, field, value) {
    const all = this.load();
    const cutoff = Date.now() - KEEP_DAYS * 86400_000;
    for (const [sid, v] of Object.entries(all)) if (!isObj(v) || !(v.at > cutoff)) delete all[sid];
    const cur = isObj(all[sessionId]) ? all[sessionId] : {};
    if (value === null) delete cur[field];
    else cur[field] = value;
    if (cur.icon || cur.name) all[sessionId] = { ...cur, at: Date.now() };
    else delete all[sessionId];
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 1));
    renameSync(tmp, this.path);
    return value;
  }

  /** Set (icon path) or clear (null) the icon. Throws on an unknown icon. */
  setIcon(sessionId, icon, valid = validIcons()) {
    if (icon !== null && !valid.has(icon)) throw new Error("Unknown icon");
    return this.update(sessionId, "icon", icon);
  }

  /** Set or clear (null) the name. Throws on an empty or too long name. */
  setName(sessionId, name) {
    return this.update(sessionId, "name", name === null ? null : cleanName(name));
  }
}
