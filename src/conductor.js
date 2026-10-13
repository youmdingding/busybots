// Conductor (macOS app): in-progress workspace chats from its SQLite database.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { withReadOnly, sqliteAvailable } from "./sqlite.js";

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const trim = (v) => String(v || "").trim();

/** Workspace slug for the name tag (not Conductor's city-style folder names). */
export function displayName(row) {
  const sec = trim(row.secondary_directory_name);
  if (sec) return sec;
  const branch = trim(row.branch);
  if (branch) {
    const slug = branch.split("/").pop().trim();
    if (slug && !["main", "master", "develop", "development"].includes(slug.toLowerCase())) return slug;
  }
  const ws = trim(row.workspace_name);
  if (ws) {
    const slug = ws.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
    if (slug) return slug;
  }
  return trim(row.directory_name) || "workspace";
}

const QUERY = `
  SELECT w.directory_name, w.workspace_name, w.workspace_path,
         w.secondary_directory_name, w.branch, w.user_set_workspace_name,
         w.active_session_id, w.derived_status, w.manual_status, w.state,
         s.status AS session_status, s.title, s.claude_session_id, s.id AS sess_pk,
         s.agent_type AS agent_type
  FROM workspaces w
  LEFT JOIN sessions s ON s.id = w.active_session_id
  WHERE w.state = 'ready'
    AND (w.derived_status = 'in-progress' OR w.manual_status = 'in-progress'
         OR s.status IN ('working', 'waiting', 'busy', 'running', 'active'))`;

/** sessionId → session meta for Conductor chats that are in progress. */
export function discover(db, wsRoot, log = console.error) {
  const found = {};
  if (!sqliteAvailable()) return found;
  let rows;
  try {
    rows = withReadOnly(db, (con) => con.prepare(QUERY).all());
  } catch (err) {
    log(`conductor.db read error: ${err.message}`);
    return found;
  }
  for (const d of rows) {
    const sidRaw = d.claude_session_id || d.active_session_id || d.sess_pk;
    if (!sidRaw) continue;
    const sid = String(sidRaw);
    const directory = d.directory_name || "workspace";
    let cwd;
    if (d.workspace_path && isDir(d.workspace_path)) cwd = String(d.workspace_path);
    else {
      // Default layout: <workspaces>/<repo>/<directory>
      cwd = join(wsRoot, directory);
      if (isDir(wsRoot)) {
        for (const repo of readdirSync(wsRoot).sort()) {
          if (isDir(join(wsRoot, repo, directory))) {
            cwd = join(wsRoot, repo, directory);
            break;
          }
        }
      }
    }
    found[sid] = {
      pid: null, sessionId: sid, cwd, claude_status: "",
      conductor_status: String(d.session_status || "").toLowerCase(),
      name_hint: displayName(d), title: d.title || d.workspace_name || directory,
      entrypoint: "conductor", source: "conductor-db", directory_name: directory,
      secondary_directory_name: trim(d.secondary_directory_name) || null,
      agent_type: String(d.agent_type || "").toLowerCase(), cmdline: "",
    };
  }
  return found;
}

/** Prefer live process meta; keep Conductor's title/status/name; include DB-only chats. */
export function mergeSessions(live, conductor) {
  const merged = new Map();
  for (const [sid, c] of Object.entries(conductor)) merged.set(sid, { ...c });
  for (const [sid, l] of Object.entries(live)) {
    if (merged.has(sid)) {
      const prior = merged.get(sid);
      const m = { ...prior };
      for (const [k, v] of Object.entries(l)) {
        if (v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)) m[k] = v;
      }
      if (!m.title) m.title = prior.title;
      if (!m.conductor_status) m.conductor_status = prior.conductor_status || "";
      if (prior.name_hint) m.name_hint = prior.name_hint;
      if (prior.secondary_directory_name) m.secondary_directory_name = prior.secondary_directory_name;
      m.source = "both";
      merged.set(sid, m);
    } else {
      merged.set(sid, { conductor_status: "", title: null, ...l });
    }
  }
  return [...merged.values()];
}
