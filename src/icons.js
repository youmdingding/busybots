// Icons you can pick for one conversation from the agent panel, and the per-session
// choices (<state>/icons.json). A choice is kept for that session id only.
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { PACKAGE_ROOT, stateDir } from "./paths.js";

const KEEP_DAYS = 30; // forget choices for conversations not seen for a month
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Every icon the panel offers: the fun "pick" set first, then each agent type's own. */
export function iconChoices(root = PACKAGE_ROOT) {
  let files = [];
  try {
    files = readdirSync(join(root, "icons")).filter((f) => /^[a-z]+-[a-z0-9]+\.png$/.test(f)).sort();
  } catch {
    return [];
  }
  const picks = files.filter((f) => f.startsWith("pick-"));
  const agents = files.filter((f) => !f.startsWith("pick-"));
  const label = (f) => {
    const [kind, rest] = f.replace(/\.png$/, "").split("-");
    return kind === "pick" ? rest[0].toUpperCase() + rest.slice(1) : `${kind[0].toUpperCase()}${kind.slice(1)} ${Number(rest) + 1}`;
  };
  return [...picks, ...agents].map((f) => ({ id: `icons/${f}`, label: label(f), group: f.startsWith("pick-") ? "fun" : "agent" }));
}

export class IconChoices {
  constructor(path = join(stateDir(), "icons.json")) {
    this.path = path;
  }

  load() {
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8"));
      return isObj(raw) ? raw : {};
    } catch {
      return {};
    }
  }

  /** sessionId → icon path, for the watcher. */
  map() {
    const out = {};
    for (const [sid, v] of Object.entries(this.load())) if (isObj(v) && typeof v.icon === "string") out[sid] = v.icon;
    return out;
  }

  /** Set (icon) or clear (null) the choice for one session. Throws on an unknown icon. */
  set(sessionId, icon, valid = new Set(iconChoices().map((c) => c.id))) {
    if (icon !== null && !valid.has(icon)) throw new Error("Unknown icon");
    const all = this.load();
    const cutoff = Date.now() - KEEP_DAYS * 86400_000;
    for (const [sid, v] of Object.entries(all)) if (!isObj(v) || !(v.at > cutoff)) delete all[sid];
    if (icon === null) delete all[sessionId];
    else all[sessionId] = { icon, at: Date.now() };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 1));
    renameSync(tmp, this.path);
    return icon;
  }
}
