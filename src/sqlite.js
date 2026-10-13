// Read-only SQLite access through Node's built-in node:sqlite (Node 22.5+).
// Agents whose sessions live in SQLite (OpenCode, Cursor CLI, Conductor) need it;
// everything else works without. Never opens a database for writing.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
let sqlite = null;
let loadError = null;

function load() {
  if (sqlite || loadError) return sqlite;
  // node:sqlite prints an ExperimentalWarning on first use; keep other warnings.
  const original = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const text = typeof warning === "string" ? warning : warning?.message || "";
    if (/SQLite is an experimental feature/.test(text)) return;
    return original.call(process, warning, ...rest);
  };
  try {
    sqlite = require("node:sqlite");
  } catch (err) {
    loadError = err;
  } finally {
    process.emitWarning = original;
  }
  return sqlite;
}

/** True when this Node version can read SQLite databases. */
export function sqliteAvailable() {
  return Boolean(load());
}

/** Message for the settings page when SQLite isn't available. */
export const SQLITE_HINT = "Needs Node 22.5 or newer to read this agent's database";

/** Open a database read-only, run fn(db), always close. Returns fn's result. */
export function withReadOnly(path, fn) {
  const mod = load();
  if (!mod) throw new Error(SQLITE_HINT);
  // A WAL database opened read-only still creates -wal/-shm files next to it. When no
  // -wal file exists (the agent isn't running), open it immutable so nothing is written.
  const target = existsSync(`${path}-wal`) ? path : `${pathToFileURL(path).href}?immutable=1`;
  const db = new mod.DatabaseSync(target, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
