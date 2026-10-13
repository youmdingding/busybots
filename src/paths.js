// Where things live: the package's own files (read-only) and per-user state.
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const APP_NAME = "busybots";
/** Folder name used before the project was named (settings there are migrated once). */
export const LEGACY_APP_NAMES = ["agent-board"];

/** Home folder, honouring $HOME so tests and odd setups can point elsewhere. */
export function home() {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

/** Per-user folder for settings.json, status.json, the API token and logs. */
export function stateDir() {
  if (process.env.BUSYBOTS_STATE) return process.env.BUSYBOTS_STATE;
  return stateDirFor(APP_NAME);
}

/** The default per-user folder for an app name (used for migrations too). */
export function stateDirFor(name) {
  const h = home();
  if (process.platform === "darwin") return join(h, "Library", "Application Support", name);
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(h, "AppData", "Local"), name);
  return join(process.env.XDG_STATE_HOME || join(h, ".local", "state"), name);
}

export function settingsPath() {
  return process.env.BUSYBOTS_SETTINGS || join(stateDir(), "settings.json");
}

/** Expand ~ and $VARS in a user-supplied path. */
export function expand(p) {
  let s = String(p ?? "").trim();
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) s = join(home(), s.slice(1));
  s = s.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, name) => (process.env[name] !== undefined ? process.env[name] : m));
  return s;
}

/** Like Python's Path.resolve(): follow symlinks when the path exists. */
export function realpathOr(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}
