// Read Codex CLI sessions for the agent board.
//
// Codex writes one JSONL "rollout" per session under <codex home>/sessions/YYYY/MM/DD/
// rollout-<time>-<id>.jsonl. This module finds recently active rollouts and translates
// their events into the same shape as Claude Code transcripts (user / assistant /
// tool_use / tool_result / stop), so the watcher's existing logic (rooms, bubbles,
// done / stuck badges) works unchanged.
//
// Standard library only. Read-only: never writes to the Codex folder.
//
// Port notes: behaviour mirrors the Python original, including its quirks. The small
// "py*" helpers below reproduce Python semantics the original relies on (truthiness of
// empty containers, str() of non-strings, str.splitlines / str.strip whitespace sets,
// code-point slicing, Unicode-aware \b \s \d in regexes, json.dumps formatting).
// Where Python would raise (e.g. `.get` on a non-dict), this module throws too; the
// watcher wraps each reader.
import { openSync, readSync, closeSync, fstatSync, statSync, opendirSync } from "node:fs";
import { isObj, evUser, evText, evThinking, evTool, evResult, evStop, session, transcript as aeTranscript, skipBad } from "../events.js";

const TAIL_BYTES = 400_000;
const HEAD_BYTES = 64_000; // session_meta sits at the top of the file
const DAYS_BACK = 2; // only look in the last few dated folders
const SKIP_USER_PREFIXES = ["<environment_context>", "<user_instructions>", "# AGENTS.md",
  "<recommended_plugins>", "<user_action>", "<turn_aborted>"];

// ---- Python-compat helpers ---------------------------------------------------------
// Python's str.isspace() / regex \s set (str patterns).
const PY_WS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const S = `[${PY_WS}]`;
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}_])"; // Python's Unicode \b before a word char
const EXIT_RE = new RegExp(`(?:Process exited with code|exit_code\\\\?"?:|Exit code:?)${S}*(-?\\p{Nd}+)`, "u");
// {"cmd": "..."} or {cmd: "..."}
const CMD_IN_JS_RE = new RegExp(`["']?${NOT_WORD_BEFORE}cmd["']?${S}*:${S}*"((?:[^"\\\\]|\\\\[^\\n])*)"`, "u");
const JS_TOOL_RE = new RegExp(`${NOT_WORD_BEFORE}tools\\.([A-Za-z_][A-Za-z0-9_]*)${S}*\\(`, "u");
const PATCH_FILE_RE = /\*\*\* (Update|Add|Delete) File: ([^\n]+)/;
const STRIP_RE = new RegExp(`^${S}+|${S}+$`, "gu");
const LSTRIP_RE = new RegExp(`^${S}+`, "u");
// JSONL: a record ends at \n only (a raw U+2028 inside a JSON string is not a line break)
const SPLITLINES_RE = /\r?\n/;

const hasOwn = (o, k) => Object.hasOwn(o, k);
/** dict.get on a value known to be a dict (missing → undefined, i.e. None). */
const get = (o, k) => (hasOwn(o, k) ? o[k] : undefined);
/** `v.get(k)` where v may not be a dict: Python raises AttributeError. */
function dget(v, k) {
  if (!isObj(v)) throw new TypeError(`'${pyType(v)}' object has no attribute 'get'`);
  return get(v, k);
}
function pyType(v) {
  if (v === null || v === undefined) return "NoneType";
  if (Array.isArray(v)) return "list";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  return "dict";
}
function truthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string" || Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}
/** Python's `a or b or c`. */
function or(...vals) {
  for (const v of vals) if (truthy(v)) return v;
  return vals[vals.length - 1];
}
/** Iterate `v or []` like Python: list items, str characters, dict keys; numbers raise. */
function iter(v) {
  if (!truthy(v)) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return Array.from(v);
  if (isObj(v)) return Object.keys(v);
  throw new TypeError(`'${pyType(v)}' object is not iterable`);
}
function numStr(n) {
  if (Number.isNaN(n)) return "nan";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (Number.isInteger(n)) return BigInt(n).toString(); // JSON ints → Python int (1.0 can't be told apart)
  const [mant, e] = n.toExponential().split("e");
  const exp = Number(e);
  if (exp >= -4 && exp < 16) return String(n);
  return `${mant}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
}
function reprStr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === q) out += "\\" + q;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch !== " " && /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u.test(ch)) {
      if (c < 0x100) out += "\\x" + c.toString(16).padStart(2, "0");
      else if (c < 0x10000) out += "\\u" + c.toString(16).padStart(4, "0");
      else out += "\\U" + c.toString(16).padStart(8, "0");
    } else out += ch;
  }
  return out + q;
}
function repr(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return numStr(v);
  if (typeof v === "string") return reprStr(v);
  if (Array.isArray(v)) return "[" + v.map(repr).join(", ") + "]";
  return "{" + Object.keys(v).map((k) => `${reprStr(k)}: ${repr(v[k])}`).join(", ") + "}";
}
/** Python str(v). */
const str = (v) => (typeof v === "string" ? v : repr(v));
/** Python json.dumps(v) with default settings (ensure_ascii, ", " / ": " separators). */
function jsonDumps(v) {
  if (v === null || v === undefined) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "NaN";
    if (v === Infinity) return "Infinity";
    if (v === -Infinity) return "-Infinity";
    return numStr(v);
  }
  if (typeof v === "string") {
    let out = '"';
    for (let i = 0; i < v.length; i++) {
      const ch = v[i];
      const c = v.charCodeAt(i);
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (ch === "\b") out += "\\b";
      else if (ch === "\f") out += "\\f";
      else if (c < 0x20 || c > 0x7e) out += "\\u" + c.toString(16).padStart(4, "0");
      else out += ch;
    }
    return out + '"';
  }
  if (Array.isArray(v)) return "[" + v.map(jsonDumps).join(", ") + "]";
  return "{" + Object.keys(v).map((k) => `${jsonDumps(k)}: ${jsonDumps(v[k])}`).join(", ") + "}";
}
/** Python json.loads: like JSON.parse, but also accepts NaN / Infinity / -Infinity. */
const SENT = `\u0000py${Math.random().toString(36).slice(2)}`;
function jsonLoads(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    if (!/NaN|Infinity/.test(text)) throw err;
  }
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
      out += ch;
    } else if (text.startsWith("-Infinity", i)) {
      out += JSON.stringify(SENT + "-inf");
      i += 8;
    } else if (text.startsWith("Infinity", i)) {
      out += JSON.stringify(SENT + "inf");
      i += 7;
    } else if (text.startsWith("NaN", i)) {
      out += JSON.stringify(SENT + "nan");
      i += 2;
    } else out += ch;
  }
  const special = { [SENT + "-inf"]: -Infinity, [SENT + "inf"]: Infinity, [SENT + "nan"]: NaN };
  return JSON.parse(out, (k, v) => (typeof v === "string" && hasOwn(special, v) ? special[v] : v));
}
function splitlines(s) {
  const parts = s.split(SPLITLINES_RE);
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}
const strip = (s) => s.replace(STRIP_RE, "");
const lstrip = (s) => s.replace(LSTRIP_RE, "");
/** s[:n] by code points. */
const slice = (s, n) => (s.length <= n ? s : Array.from(s).slice(0, n).join(""));
/** str(PurePosixPath(p)): collapse slashes, drop "." parts and the trailing slash. */
function pathStr(p) {
  const s = String(p);
  const root = s.startsWith("//") && !s.startsWith("///") ? "//" : s.startsWith("/") ? "/" : "";
  const parts = s.split("/").filter((x) => x && x !== ".");
  return root + parts.join("/") || ".";
}
const pjoin = (a, ...rest) => pathStr([a, ...rest].join("/"));
const pathStem = (p) => {
  const parts = pathStr(p).split("/");
  const name = parts[parts.length - 1];
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(0, i) : name;
};
function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function exists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
/** os.stat(p).st_mtime, computed the way CPython does (sec + nsec * 1e-9). Throws on error. */
function mtimeOf(p) {
  const ns = statSync(p, { bigint: true }).mtimeNs;
  return Number(ns / 1_000_000_000n) + Number(ns % 1_000_000_000n) * 1e-9;
}
/** Names in a folder, in directory order (like os.scandir; readdirSync would sort). */
function listNames(dir) {
  const out = [];
  let d;
  try {
    d = opendirSync(dir);
  } catch {
    return out;
  }
  try {
    for (let e = d.readSync(); e; e = d.readSync()) out.push(e.name);
  } finally {
    d.closeSync();
  }
  return out;
}
/** Path.glob("<prefix>*<suffix>") in one folder (case-insensitive on Windows, like pathlib). */
function glob(dir, prefix, suffix) {
  const ci = process.platform === "win32";
  const norm = (s) => (ci ? s.toLowerCase() : s);
  const pre = norm(prefix), suf = norm(suffix);
  return listNames(dir)
    .filter((n) => norm(n).length >= pre.length + suf.length && norm(n).startsWith(pre) && norm(n).endsWith(suf))
    .map((n) => pjoin(dir, n));
}
const decoder = new TextDecoder("utf-8", { ignoreBOM: true }); // errors="replace", BOM kept
/** Read bytes [start, start+max) (max = Infinity → to EOF). */
function readRange(fd, start, max) {
  const chunks = [];
  let pos = start, total = 0;
  while (total < max) {
    const buf = Buffer.alloc(Math.min(1 << 20, max - total));
    const n = readSync(fd, buf, 0, buf.length, pos);
    if (n <= 0) break;
    chunks.push(buf.subarray(0, n));
    pos += n;
    total += n;
  }
  return Buffer.concat(chunks);
}
function parseDicts(lines) {
  const out = [];
  for (const ln of lines) {
    let o;
    try {
      o = jsonLoads(ln);
    } catch {
      continue;
    }
    if (isObj(o)) out.push(o);
  }
  return out;
}

// ---- reader ------------------------------------------------------------------------
function readHead(path) {
  let chunk;
  try {
    const fd = openSync(path, "r");
    try {
      chunk = decoder.decode(readRange(fd, 0, HEAD_BYTES));
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
  return parseDicts(splitlines(chunk).slice(0, 20));
}

function readTail(path) {
  let chunk, size;
  try {
    const fd = openSync(path, "r");
    try {
      size = fstatSync(fd).size;
      chunk = decoder.decode(readRange(fd, Math.max(0, size - TAIL_BYTES), Infinity));
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
  let lines = splitlines(chunk);
  if (size > TAIL_BYTES && lines.length) lines = lines.slice(1); // first line is probably cut in half
  return parseDicts(lines);
}

function jsonArgs(raw) {
  if (isObj(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const v = jsonLoads(raw);
      return isObj(v) ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

function shellCmd(cmd) {
  if (Array.isArray(cmd)) {
    const parts = cmd.map(str);
    if (parts.length >= 3 && ["bash", "sh", "zsh"].some((s) => parts[0].endsWith(s)) && (parts[1] === "-lc" || parts[1] === "-c")) {
      return parts[2];
    }
    return parts.join(" ");
  }
  return str(or(cmd, ""));
}

function patchTool(text) {
  const m = PATCH_FILE_RE.exec(text || "");
  if (!m) return ["Edit", { file_path: "" }];
  const kind = m[1], path = strip(m[2]);
  return [kind === "Add" ? "Write" : "Edit", { file_path: path }];
}

/** Codex tool call → [Claude-style tool name, input]. null = not a new action. */
function mapTool(ptype, p) {
  const name = str(or(get(p, "name"), ""));
  if (ptype === "local_shell_call") {
    const action = or(get(p, "action"), {});
    return ["Bash", { command: shellCmd(dget(action, "command")) }];
  }
  if (ptype === "web_search_call") {
    const action = or(get(p, "action"), {});
    return ["WebSearch", { query: str(or(dget(action, "query"), "")) }];
  }
  if (ptype === "custom_tool_call") {
    const raw = str(or(get(p, "input"), ""));
    if (name === "apply_patch" || raw.includes("*** Begin Patch")) return patchTool(raw);
    const m = CMD_IN_JS_RE.exec(raw);
    if (m) {
      let cmd;
      try {
        cmd = JSON.parse(`"${m[1]}"`);
      } catch {
        cmd = m[1];
      }
      return ["Bash", { command: cmd }];
    }
    // Code-mode calls look like `await tools.<name>({...})` — map by the inner tool name
    const inner = JS_TOOL_RE.exec(raw);
    if (inner) return mapTool("function_call", { name: inner[1], arguments: {} });
    return [name || "tool", {}];
  }
  // function_call
  const args = jsonArgs(get(p, "arguments"));
  if (["exec_command", "shell", "container.exec", "local_shell"].includes(name)) {
    const cmd = shellCmd(hasOwn(args, "cmd") ? args.cmd : get(args, "command"));
    if (cmd.includes("apply_patch") && cmd.includes("*** Begin Patch")) return patchTool(cmd);
    return ["Bash", { command: cmd }];
  }
  if (name === "write_stdin") return null; // feeding a running command, not a new step
  if (name === "apply_patch") return patchTool(str(or(get(args, "input"), get(args, "patch"), "")));
  if (name === "update_plan") return ["TodoWrite", {}];
  if (name === "view_image") return ["Read", { file_path: str(or(get(args, "path"), "")) }];
  if (name === "web_search" || name === "search") return ["WebSearch", { query: str(or(get(args, "query"), "")) }];
  return [name || "tool", args];
}

function outputFailed(out) {
  const s = typeof out === "string" ? out : slice(jsonDumps(out), 2000);
  const m = EXIT_RE.exec(slice(s, 2000));
  return Boolean(m && m[1] !== "0");
}

/** Codex rollout entries → [Claude-shaped events, {turnOpen, reviewMode}]. */
function normalize(entries) {
  const events = [];
  const hidden = new Set(); // calls we don't show (write_stdin): ignore their outputs too
  let turnOpen = false;
  let review = false;
  for (const o of entries) {
    const ts = get(o, "timestamp") ?? null;
    const typ = get(o, "type");
    const p = isObj(get(o, "payload")) ? o.payload : {};
    const ptype = get(p, "type");
    if (typ === "event_msg") {
      if (ptype === "task_started" || ptype === "turn_started") {
        turnOpen = true;
        events.push(evUser(ts, "(new turn)"));
      } else if (ptype === "task_complete" || ptype === "turn_complete" || ptype === "turn_aborted") {
        turnOpen = false;
        events.push(evStop(ts));
      } else if (ptype === "item_completed") {
        const it = dget(or(get(p, "item"), {}), "type");
        if (it === "EnteredReviewMode") review = true;
        else if (it === "ExitedReviewMode") review = false;
      } else if (ptype === "entered_review_mode") review = true;
      else if (ptype === "exited_review_mode") review = false;
      continue;
    }
    if (typ !== "response_item") continue;
    if (ptype === "message") {
      const role = get(p, "role");
      const texts = iter(get(p, "content"))
        .filter((c) => isObj(c) && ["input_text", "output_text", "text"].includes(get(c, "type")))
        .map((c) => str(or(get(c, "text"), "")));
      const text = texts.filter(Boolean).join("\n");
      if (role === "assistant" && text) {
        events.push(evText(ts, text));
      } else if (role === "user" && text && !SKIP_USER_PREFIXES.some((pre) => lstrip(text).startsWith(pre))) {
        events.push(evUser(ts, slice(text, 200)));
      }
    } else if (ptype === "reasoning") {
      events.push(evThinking(ts));
    } else if (["function_call", "custom_tool_call", "local_shell_call", "web_search_call"].includes(ptype)) {
      const mapped = mapTool(ptype, p);
      if (!mapped) {
        const hiddenId = str(or(get(p, "call_id"), get(p, "id"), ""));
        if (hiddenId) hidden.add(hiddenId);
        continue;
      }
      const [name, inp] = mapped;
      const callId = str(or(get(p, "call_id"), get(p, "id"), ""));
      events.push(evTool(ts, callId, name, inp));
      if (ptype === "web_search_call" && callId) { // completes in the same item
        events.push({ type: "user", timestamp: ts, toolUseResult: true,
          message: { content: [{ type: "tool_result", tool_use_id: callId }] } });
      }
    } else if (["function_call_output", "custom_tool_call_output", "local_shell_call_output"].includes(ptype)) {
      const callId = str(or(get(p, "call_id"), ""));
      if (callId && !hidden.has(callId)) events.push(evResult(ts, callId, outputFailed(get(p, "output"))));
    }
  }
  return [events, { turnOpen, reviewMode: review }];
}

function shortBranch(branch) {
  const s = branch || "";
  const slug = strip(s.slice(s.lastIndexOf("/") + 1));
  return ["", "main", "master", "develop", "development", "head"].includes(slug.toLowerCase()) ? "" : slug;
}

function recentRollouts(home, since) {
  const root = pjoin(home, "sessions");
  if (!isDir(root)) return [];
  const found = [];
  const day = 86400;
  const pad = (n, w) => String(n).padStart(w, "0");
  for (let back = 0; back <= DAYS_BACK; back++) {
    const t = new Date((Date.now() / 1000 - back * day) * 1000); // local time, like time.localtime
    const d = pjoin(root, pad(t.getFullYear(), 4), pad(t.getMonth() + 1, 2), pad(t.getDate(), 2));
    if (!isDir(d)) continue;
    for (const p of glob(d, "rollout-", ".jsonl")) {
      try {
        if (mtimeOf(p) >= since) found.push(p);
      } catch {
        continue;
      }
    }
  }
  // Flat layouts (older versions) — cheap fallback
  for (const p of glob(root, "rollout-", ".jsonl")) {
    try {
      if (mtimeOf(p) >= since) found.push(p);
    } catch {
      continue;
    }
  }
  return found;
}

/** sessionId → session (same keys the watcher uses, plus Codex-only extras). */
/** One codex session; the caller skips it if it's malformed. */
function readRollout(home, path, found) {
  let meta = {};
  for (const o of readHead(path)) {
    if (get(o, "type") === "session_meta" && isObj(get(o, "payload"))) {
      meta = o.payload;
      break;
    }
  }
  const src = get(meta, "source");
  if (isObj(src) && hasOwn(src, "subagent")) return; // helper threads; their parent session is shown
  const stemParts = pathStem(path).split("-");
  const stemId = stemParts.length > 7 ? stemParts.slice(6).join("-") : stemParts[stemParts.length - 1];
  const sid = str(or(get(meta, "id"), get(meta, "session_id"), stemId));
  const entries = readTail(path);
  let cwd = str(or(get(meta, "cwd"), ""));
  for (let i = entries.length - 1; i >= 0; i--) { // latest turn_context wins
    const o = entries[i];
    if (get(o, "type") === "turn_context" && isObj(get(o, "payload"))) {
      cwd = str(or(get(o.payload, "cwd"), cwd));
      break;
    }
  }
  const [events, facts] = normalize(entries);
  const git = isObj(get(meta, "git")) ? meta.git : {};
  let mtime;
  try {
    mtime = mtimeOf(path);
  } catch {
    mtime = null;
  }
  found.set(sid, session("codex", sid, cwd || pathStr(home), events, {
    turnOpen: facts.turnOpen, mtime, reviewMode: facts.reviewMode,
    nameHint: shortBranch(str(or(get(git, "branch"), ""))) || null,
    entrypoint: str(or(get(meta, "originator"), "codex")),
    extra: { file: path },
  }));

}

export function discover(homes, recentMinutes = 30) {
  const since = Date.now() / 1000 - recentMinutes * 60;
  const found = new Map();
  for (const home of homes) {
    for (const path of recentRollouts(home, since)) {
      try {
        readRollout(home, path, found);
      } catch (err) {
        skipBad("codex", path, err);
      }
    }
  }
  return found;
}

/** Admin-page status for one Codex folder. */
export function check(home, recentMinutes = 30) {
  const sess = pjoin(home, "sessions");
  if (!exists(home)) return { ok: false, message: "Folder not found" };
  if (!isDir(sess)) return { ok: false, message: "No sessions/ folder inside" };
  const recent = discover([home], recentMinutes).size;
  return { ok: true, message: `Found — ${recent} session(s) active in the last ${BigInt(Math.trunc(recentMinutes))} min` };
}

/** Recent items for the agent panel: user turns, assistant text, tool steps. */
export function transcript(sessionId, homes, recentMinutes = 24 * 60, limit = 15) {
  const sess = discover(homes, recentMinutes).get(sessionId);
  return sess ? aeTranscript(sess.events, limit) : [];
}

export function defaultHome() {
  return process.env.CODEX_HOME || "~/.codex";
}
