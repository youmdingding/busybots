// Local board server: the board's own files plus a small JSON API, on 127.0.0.1 only.
//
// Security:
//   - binds 127.0.0.1 (never 0.0.0.0) and rejects any Host / Origin that isn't this server
//   - serves only allow-listed board files (STATIC_ALLOW); never dotfiles, settings or the token
//   - mutating routes need the X-Board-Token header and cap the request size
// tests/server.contract.test.mjs pins its behaviour.
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, chmodSync, statSync, existsSync, openSync, readdirSync, closeSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { PACKAGE_ROOT, stateDir, settingsPath, expand } from "./paths.js";
import * as S from "./settings.js";
import { READERS } from "./readers/index.js";
import { lastMessages, TRANSCRIPT_MESSAGES } from "./events.js";
import { jsonlPathFor, tailJsonl } from "./claude.js";
import { pidAlive, ttyForPid } from "./proc.js";
import { withReadOnly, sqliteAvailable, SQLITE_HINT } from "./sqlite.js";
import { CONFIG_PATH } from "./watcher.js";
import { SessionPrefs, iconSet, MAX_NAME } from "./icons.js";

export const DEFAULT_PORT = 8765;
const MAX_BODY = 256_000;
const TRANSCRIPT_BYTES = 400_000;
const SID_RE = /^[0-9A-Za-z_-]{8,80}$/;
export const STATIC_ALLOW = new RegExp(
  "^/(?:index\\.html|board/[a-z0-9-]+\\.js|style\\.css|favicon\\.ico|admin\\.html|admin\\.js"
  + "|config\\.json|status\\.json"
  + "|themes/[A-Za-z0-9_-]+\\.json"
  + "|tiles/(?:[A-Za-z0-9_-]+/)?[A-Za-z0-9_.-]+\\.(?:png|json)"
  + "|icons/[A-Za-z0-9_.-]+\\.png)?$",
);
// Page files live in web/; sprites, themes and config at the package root.
const WEB_DIR = join(PACKAGE_ROOT, "web");
const fileFor = (path) => (/^\/(?:themes|tiles|icons)\//.test(path) ? join(PACKAGE_ROOT, path.slice(1)) : join(WEB_DIR, path.slice(1)));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon",
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const agentLabel = (id) => S.AGENT_TYPES.find((a) => a.id === id)?.label || id;

/** The API token, created on first run (readable only by this user). */
export function ensureToken(dir = stateDir()) {
  const path = join(dir, "api-token");
  try {
    const tok = readFileSync(path, "utf8").trim();
    if (tok.length >= 16) return tok;
  } catch { /* create it */ }
  const tok = randomBytes(24).toString("base64url");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, tok + "\n", { encoding: "utf8", mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* Windows */ }
  return tok;
}

// ---- checks for the settings page -------------------------------------------------------

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

function countLiveClaude(home) {
  let n = 0;
  let names = [];
  try {
    names = readdirSync(join(home, "sessions")).filter((x) => x.endsWith(".json"));
  } catch {
    return 0;
  }
  for (const name of names) {
    try {
      const meta = JSON.parse(readFileSync(join(home, "sessions", name), "utf8"));
      if (pidAlive(Number.parseInt(meta.pid || basename(name, ".json"), 10))) n++;
    } catch { /* unreadable */ }
  }
  return n;
}

/** What the watcher would find with these (possibly unsaved) settings. */
export function checkSources(raw) {
  const [s, errors] = S.validate(raw);
  const out = { errors, sources: {} };
  const src = s.sources;
  out.sources.claude = src.claude.paths.map((p) => {
    const h = expand(p);
    if (!existsSync(h)) return { path: p, ok: false, message: "Folder not found" };
    if (!isDir(join(h, "projects")) && !isDir(join(h, "sessions"))) {
      return { path: p, ok: false, message: "No sessions/ or projects/ inside — is this a Claude Code folder?" };
    }
    return { path: p, ok: true, message: `Found — ${countLiveClaude(h)} live session(s)` };
  });
  for (const [source, reader] of Object.entries(READERS)) {
    const label = agentLabel(source);
    out.sources[source] = src[source].paths.map((p) => {
      let row;
      try {
        row = { path: p, ...reader.check(expand(p), src[source].recentMinutes) };
      } catch (err) { // a reader bug shouldn't break the settings page
        row = { path: p, ok: false, message: `Could not read: ${err.message}` };
      }
      // optional agents: a missing folder just means "not installed"
      if (row.ok === false && row.message === "Folder not found") Object.assign(row, { ok: null, message: `Not found — fine if you don't use ${label}` });
      return row;
    });
  }
  const c = src.conductor;
  const db = expand(c.db);
  let crow;
  if (c.enabled === false) crow = { ok: null, message: "Off" };
  else if (existsSync(db)) crow = sqliteAvailable() ? { ok: true, message: "Database found" } : { ok: false, message: SQLITE_HINT };
  else crow = c.enabled === "auto" ? { ok: null, message: "Not installed — Auto keeps it off" } : { ok: false, message: "Database not found" };
  out.sources.conductor = [{ path: c.db, ...crow }];
  return out;
}

// ---- agent panel ----------------------------------------------------------------------------

function clip(text, n) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
}

function cleanText(raw, n = 160) {
  let s = String(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/#{1,6}\s*/g, "");
  s = s.replaceAll("**", "").replaceAll("__", "").replaceAll("*", "").replaceAll("`", "");
  s = s.replace(/^\s*[-*•]\s+/gm, "");
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? clip(lines[0], n) : "";
}

/** Claude Code transcript → panel items (user turns, assistant text, tool steps). */
function claudeTranscript(homes, cwd, sid, limit = TRANSCRIPT_MESSAGES) {
  if (!cwd) return [];
  let path = null;
  for (const h of homes) {
    path = jsonlPathFor(h, cwd, sid);
    if (path) break;
  }
  if (!path) return [];
  const items = [];
  for (const o of tailJsonl(path, TRANSCRIPT_BYTES, Infinity)) {
    const ts = o.timestamp;
    const content = o.message?.content;
    if (o.type === "assistant") {
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (!isObj(b)) continue;
        if (b.type === "text") {
          const text = cleanText(String(b.text || ""), 180);
          if (text) items.push({ kind: "assistant", text, ts });
        } else if (b.type === "tool_use") {
          const name = b.name || "tool";
          const inp = isObj(b.input) ? b.input : {};
          let detail = "";
          if (["Edit", "Write", "MultiEdit", "Read"].includes(name)) {
            const fp = inp.file_path || inp.path || "";
            detail = fp ? String(fp).split(/[\\/]/).pop() : "";
          } else if (name === "Bash") detail = String(inp.description || "").slice(0, 60);
          else if (name === "Grep" || name === "Glob") detail = name;
          items.push({ kind: "tool", text: clip(name + (detail ? ` · ${detail}` : ""), 100), ts });
        }
      }
    } else if (o.type === "user") {
      if ("toolUseResult" in o) continue;
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        if (!content.some((c) => isObj(c) && c.type === "tool_result")) {
          text = content.filter((c) => isObj(c) && c.type === "text").map((c) => String(c.text || "")).join(" ");
        }
      }
      text = cleanText(text, 120);
      if (text) items.push({ kind: "user", text, ts });
    }
  }
  return lastMessages(items, limit);
}

const CONDUCTOR_LOOKUP = `
  SELECT s.title, s.status, s.claude_session_id, w.directory_name, w.workspace_path, w.local_id, w.id AS wid
  FROM sessions s LEFT JOIN workspaces w ON w.active_session_id = s.id
  WHERE s.id = ? OR s.claude_session_id = ? LIMIT 1`;

// ---- the server -------------------------------------------------------------------------------

/**
 * createBoardServer({ port, getStatus, token, log })
 * getStatus() returns the watcher's latest status object (served as /status.json).
 */
export function createBoardServer({ port = DEFAULT_PORT, getStatus = () => null, token = ensureToken(), prefs = new SessionPrefs(), log = (m) => console.error(m) } = {}) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));
  const tokenBuf = Buffer.from(token);
  const prompts = [];

  const settings = () => S.load();
  const claudeHomes = () => S.dirs(settings(), "claude");

  function statusBot(sid) {
    const st = getStatus();
    return (st?.bots || []).find((b) => String(b.id) === sid) || null;
  }

  function lookupSession(sid) {
    const out = { id: sid, name: sid.slice(0, 8), cwd: null, origin: null, state: null, zone: null, livePid: null,
      entrypoint: null, tty: null, promptAllowed: false, promptDisabledReason: null, jump: null };
    const bot = statusBot(sid);
    if (bot) {
      Object.assign(out, { name: bot.name || out.name, cwd: bot.cwd ?? null, origin: bot.origin ?? null, state: bot.state ?? null,
        zone: bot.zone ?? null, livePid: bot.livePid ?? null, entrypoint: bot.entrypoint ?? null, bubble: bot.bubble ?? null, brand: bot.brand ?? null,
        icon: bot.icon ?? null, iconDefault: bot.iconDefault ?? bot.icon ?? null,
        nameDefault: bot.nameDefault ?? bot.name ?? null, nameCustom: Boolean(bot.nameDefault), nameMax: MAX_NAME });
    }
    if (out.brand in READERS) {
      const label = agentLabel(out.brand);
      return { ...out, promptAllowed: false, promptDisabledReason: `${label} session — reply in ${label}` };
    }
    // Live session file
    outer: for (const h of claudeHomes()) {
      let names = [];
      try { names = readdirSync(join(h, "sessions")).filter((x) => x.endsWith(".json")).sort(); } catch { continue; }
      for (const n of names) {
        let meta;
        try { meta = JSON.parse(readFileSync(join(h, "sessions", n), "utf8")); } catch { continue; }
        if (String(meta?.sessionId) !== sid) continue;
        out.cwd = out.cwd || meta.cwd || null;
        out.entrypoint = out.entrypoint || meta.entrypoint || null;
        if (meta.pid && pidAlive(meta.pid)) {
          out.livePid = Number(meta.pid);
          out.claudeStatus = meta.status;
        }
        break outer;
      }
    }
    // Conductor title / workspace
    const [condOn, condDb] = S.conductor(settings());
    if (condOn && sqliteAvailable()) {
      try {
        const d = withReadOnly(condDb, (db) => db.prepare(CONDUCTOR_LOOKUP).get(sid, sid));
        if (d) {
          if (d.title) out.title = d.title;
          if (d.workspace_path && isDir(d.workspace_path)) out.cwd = d.workspace_path;
          out.conductorSessionStatus = d.status;
          out.conductorWorkspaceId = d.local_id || d.wid;
          if (!out.origin) out.origin = "conductor";
        }
      } catch { /* database busy or changed shape */ }
    }
    if (out.livePid) out.tty = ttyForPid(out.livePid) || null;
    // Jump / prompt policy
    const origin = String(out.origin || "").toLowerCase();
    const live = Boolean(out.livePid);
    if (live && origin === "terminal") {
      Object.assign(out, { jump: { kind: "terminal", tty: out.tty, pid: out.livePid }, promptAllowed: false, promptDisabledReason: "Open in its window to reply" });
    } else if (origin === "conductor") {
      Object.assign(out, { jump: { kind: "conductor", workspaceId: out.conductorWorkspaceId ?? null }, promptAllowed: false,
        promptDisabledReason: "Conductor owns this session (sdk-ts / agent binary) — reply in Conductor" });
    } else if (!live && origin === "terminal") {
      Object.assign(out, { jump: null, promptAllowed: true, promptDisabledReason: null });
    } else if (out.conductorWorkspaceId) {
      Object.assign(out, { jump: { kind: "conductor", workspaceId: out.conductorWorkspaceId }, promptAllowed: false,
        promptDisabledReason: "Conductor session — open Conductor to continue" });
    } else {
      Object.assign(out, { promptAllowed: !live, promptDisabledReason: live ? "Open in its window to reply" : null });
    }
    return out;
  }

  function sessionTranscript(meta, sid) {
    if (meta.brand in READERS) {
      try {
        return READERS[meta.brand].transcript(sid, S.dirs(settings(), meta.brand));
      } catch {
        return [];
      }
    }
    return claudeTranscript(claudeHomes(), meta.cwd, sid);
  }

  function findClaudeBin() {
    const exts = process.platform === "win32" ? [".cmd", ".exe", ""] : [""];
    for (const dir of String(process.env.PATH || "").split(process.platform === "win32" ? ";" : ":")) {
      for (const e of exts) {
        const p = join(dir, `claude${e}`);
        try { if (statSync(p).isFile()) return p; } catch { /* next */ }
      }
    }
    return process.platform === "darwin" && existsSync("/opt/homebrew/bin/claude") ? "/opt/homebrew/bin/claude" : null;
  }

  function startPrompt(sid, prompt, cwd) {
    const meta = lookupSession(sid);
    if (!meta.promptAllowed) return { ok: false, error: meta.promptDisabledReason || "Prompting not allowed" };
    if (meta.livePid) return { ok: false, error: "Session has a live process — use its window" };
    if (!isDir(cwd)) return { ok: false, error: `cwd not found: ${cwd}` };
    const bin = findClaudeBin();
    if (!bin) return { ok: false, error: "claude command not found on PATH" };
    const logDir = join(stateDir(), "logs");
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `prompt-${sid.slice(0, 8)}.log`);
    let fd;
    try {
      fd = openSync(logPath, "a");
      // argv only — never a shell
      const child = spawn(bin, ["--resume", sid, "-p", prompt], { cwd, stdio: ["ignore", fd, fd], detached: true });
      child.on("error", (err) => log(`prompt ${sid}: ${err.message}`));
      child.unref();
      prompts.push({ sid, pid: child.pid, cwd, log: logPath, startedAt: new Date().toISOString() });
      return { ok: true, pid: child.pid, log: logPath };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  // ---- HTTP plumbing ----
  function send(res, code, obj) {
    const body = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
    res.end(body);
  }

  function notFound(res) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }

  function checkLocal(req, res) {
    const host = String(req.headers.host || "").trim().toLowerCase();
    if (!allowedHosts.has(host)) {
      send(res, 403, { ok: false, error: `Forbidden Host: ${host}` });
      return false;
    }
    const origin = String(req.headers.origin || "").trim();
    if (origin && !allowedOrigins.has(origin)) {
      send(res, 403, { ok: false, error: `Forbidden Origin: ${origin}` });
      return false;
    }
    return true;
  }

  function checkToken(req, res) {
    const tok = Buffer.from(String(req.headers["x-board-token"] || "").trim());
    if (tok.length !== tokenBuf.length || !timingSafeEqual(tok, tokenBuf)) {
      send(res, 401, { ok: false, error: "Missing or invalid X-Board-Token" });
      return false;
    }
    return true;
  }

  /** Read a JSON object body (≤ 256 KB). Resolves to the object, or null after replying. */
  function readJson(req, res) {
    return new Promise((resolve) => {
      const declared = Number.parseInt(req.headers["content-length"] || "0", 10) || 0;
      if (declared > MAX_BODY) {
        send(res, 413, { ok: false, error: "Request too large" });
        req.resume();
        return resolve(null);
      }
      const chunks = [];
      let size = 0;
      let done = false;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY && !done) {
          done = true;
          send(res, 413, { ok: false, error: "Request too large" });
          req.destroy();
          resolve(null);
        } else chunks.push(c);
      });
      req.on("end", () => {
        if (done) return;
        let data;
        try {
          data = size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
        } catch {
          send(res, 400, { ok: false, error: "Invalid JSON" });
          return resolve(null);
        }
        if (!isObj(data)) {
          send(res, 400, { ok: false, error: "JSON object required" });
          return resolve(null);
        }
        resolve(data);
      });
      req.on("error", () => resolve(null));
    });
  }

  function serveStatic(res, path) {
    if (path === "/admin" || path === "/admin/") path = "/admin.html";
    if (path === "/") path = "/index.html";
    // Only the board's own assets — never dotfiles (API token), logs, scripts…
    if (path.includes("..") || !STATIC_ALLOW.test(path)) return notFound(res);
    let body;
    if (path === "/status.json") {
      const st = getStatus();
      if (!st) return notFound(res);
      body = Buffer.from(JSON.stringify(st));
    } else {
      const file = path === "/config.json" ? CONFIG_PATH : fileFor(path);
      try {
        body = readFileSync(file);
      } catch {
        return notFound(res);
      }
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream", "Content-Length": body.length, "Cache-Control": "no-cache" });
    res.end(body);
  }

  async function handle(req, res) {
    if (!checkLocal(req, res)) return;
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      return notFound(res);
    }

    if (req.method === "GET" || req.method === "HEAD") {
      if (path === "/api/token") return send(res, 200, { token });
      if (path === "/api/settings") {
        return send(res, 200, { ok: true, settings: settings(), defaults: S.defaults(), agents: S.AGENT_TYPES,
          file: settingsPath(), exists: S.exists() });
      }
      if (path.startsWith("/api/session/") && path.split("/").length === 4) {
        const sid = path.split("/")[3];
        if (!SID_RE.test(sid)) return send(res, 400, { ok: false, error: "Invalid session id" });
        const meta = lookupSession(sid);
        if (settings().board.privacy) {
          // Privacy mode: the board already shows a generic name; don't leak paths or text here
          const bot = statusBot(sid);
          for (const k of ["cwd", "title", "tty", "bubble", "nameDefault"]) delete meta[k];
          meta.nameCustom = false;
          meta.name = bot?.name || "Agent";
          meta.privacy = true;
          return send(res, 200, { ok: true, session: meta, transcript: [], iconSet: iconSet() });
        }
        return send(res, 200, { ok: true, session: meta, transcript: sessionTranscript(meta, sid), iconSet: iconSet() });
      }
      if (path.startsWith("/api/")) return send(res, 404, { ok: false, error: "Not found" });
      return serveStatic(res, path);
    }

    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "GET, HEAD, POST" });
      return res.end();
    }
    if (!checkToken(req, res)) return;
    if (path === "/api/settings" || path === "/api/settings/check") {
      const body = await readJson(req, res);
      if (!body) return;
      if (!isObj(body.settings)) return send(res, 400, { ok: false, error: "settings object required" });
      if (path.endsWith("/check")) return send(res, 200, { ok: true, ...checkSources(body.settings) });
      const [, errors] = S.validate(body.settings);
      if (errors.length) return send(res, 400, { ok: false, error: errors.join("; ") });
      try {
        return send(res, 200, { ok: true, settings: S.save(body.settings) });
      } catch (err) {
        return send(res, 500, { ok: false, error: `Could not write settings: ${err.message}` });
      }
    }
    const m = /^\/api\/session\/([0-9A-Za-z_-]{8,80})\/(jump|prompt|icon|name)$/.exec(path);
    if (!m) return send(res, 404, { ok: false, error: "Not found" });
    const [, sid, action] = m;
    if (action === "jump") {
      const meta = lookupSession(sid);
      const jump = meta.jump || {};
      if (jump.kind === "terminal") return send(res, 200, jumpTerminal(jump.tty || meta.tty, meta.livePid));
      if (jump.kind === "conductor") return send(res, 200, jumpConductor(jump.workspaceId));
      return send(res, 400, { ok: false, error: "No jump target for this session" });
    }
    const body = await readJson(req, res);
    if (!body) return;
    if (action === "icon") {
      // Pick an icon for this conversation only (null = back to the agent's own icon)
      const icon = body.icon === null ? null : String(body.icon || "");
      try {
        prefs.setIcon(sid, icon);
      } catch (err) {
        return send(res, 400, { ok: false, error: err.message });
      }
      return send(res, 200, { ok: true, icon });
    }
    if (action === "name") {
      // Name this conversation (null = back to the folder name)
      try {
        const name = prefs.setName(sid, body.name === null ? null : body.name);
        return send(res, 200, { ok: true, name });
      } catch (err) {
        return send(res, 400, { ok: false, error: err.message });
      }
    }
    const prompt = String(body.prompt || "").trim();
    if (!prompt) return send(res, 400, { ok: false, error: "Empty prompt" });
    if (prompt.length > 4000) return send(res, 400, { ok: false, error: "Prompt too long" });
    const meta = lookupSession(sid);
    if (!meta.cwd) return send(res, 400, { ok: false, error: "No cwd for session" });
    return send(res, 200, startPrompt(sid, prompt, meta.cwd));
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`server error: ${err.stack || err.message}`);
      if (!res.headersSent) send(res, 500, { ok: false, error: "Internal error" });
      else res.end();
    });
  });
  server.prompts = prompts;
  return server;
}

// ---- jumping to the agent's window (macOS) -------------------------------------------------

const MAC_ONLY = { ok: false, error: "Jumping to a window works on macOS only for now" };

function openApp(app) {
  spawn("open", ["-a", app], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

export function jumpTerminal(tty, pid) {
  if (process.platform !== "darwin") return MAC_ONLY;
  if (!tty && pid) tty = ttyForPid(pid);
  if (!tty) {
    const app = existsSync("/Applications/iTerm.app") ? "iTerm" : "Terminal";
    openApp(app);
    return { ok: true, method: `activate:${app}`, tty: null };
  }
  const short = tty.replace("/dev/", "");
  if (!/^[A-Za-z0-9]+$/.test(short)) return { ok: false, error: "Unexpected terminal name" };
  let host = "iTerm";
  try {
    const out = execFileSync("ps", ["-axo", "pid=,tty=,command="], { encoding: "utf8" });
    for (const line of out.split("\n")) {
      if (!line.includes(short)) continue;
      if (line.includes("iTerm") || line.includes("ShellLauncher")) break;
      if (line.includes("Terminal.app")) {
        host = "Terminal";
        break;
      }
    }
  } catch { /* default to iTerm */ }
  const script = host === "iTerm"
    ? `tell application "iTerm"
  activate
  set found to false
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        try
          if (tty of s) contains "${short}" then
            select t
            set found to true
            exit repeat
          end if
        end try
      end repeat
      if found then exit repeat
    end repeat
    if found then exit repeat
  end repeat
end tell`
    : `tell application "Terminal"
  activate
  repeat with w in windows
    try
      if (tty of w) contains "${short}" then
        set frontmost of w to true
        exit repeat
      end if
    end try
  end repeat
end tell`;
  const r = spawnSync("osascript", ["-e", script], { timeout: 8000, encoding: "utf8" });
  if (r.error) {
    openApp(host);
    return { ok: true, method: `activate-fallback:${host}`, error: r.error.message, tty };
  }
  return { ok: true, method: `osascript:${host}`, tty };
}

export function jumpConductor(workspaceId) {
  if (process.platform !== "darwin") return MAC_ONLY;
  const tried = [];
  if (workspaceId && /^[A-Za-z0-9_-]+$/.test(String(workspaceId))) {
    const url = `conductor://workspace/${workspaceId}`;
    const r = spawnSync("open", [url], { encoding: "utf8" });
    tried.push({ url, code: r.status, err: String(r.stderr || "").slice(0, 200) });
  }
  openApp("Conductor");
  tried.push({ activate: "Conductor" });
  return { ok: true, method: "activate:Conductor", deepLink: "unverified", tried };
}
