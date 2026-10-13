// Read Gemini CLI sessions for the agent board.
//
// Layout (gemini-cli, Oct 2026):
//     <home>/.gemini/projects.json                  {"projects": {"/abs/project": "<slug>"}}
//     <home>/.gemini/tmp/<slug>/.project_root       the project folder (cwd)
//     <home>/.gemini/tmp/<slug>/chats/session-<UTC yyyy-mm-ddTHH-MM>-<id8>.jsonl
// Older installs used a sha256 of the project path instead of a slug and wrote one
// JSON file per session (session-*.json with a "messages" list); both are read.
//
// The .jsonl file is append-only: a metadata line, then message records. A record with
// an id that was seen before REPLACES the earlier one; {"$set": …} updates metadata,
// {"$patch": …} patches messages, {"$rewindTo": id} drops that message and everything
// after it.
//
// What the file can't tell us: Gemini writes a tool call only after it finishes, so a
// command that is still running isn't on disk yet (the agent's last message shows
// instead), and approval prompts aren't recorded.
//
// Standard library only. Read-only.
//
// Port notes: behaviour mirrors the Python original, including its quirks. The small
// "py*"-style helpers below reproduce Python semantics the original relies on
// (truthiness of empty containers, str() of non-strings, == deep equality, dict keys
// must be hashable, str.splitlines / str.strip whitespace sets, strict UTF-8 for
// read_text). Where Python would raise, this module throws too; the watcher wraps
// each reader.
import { openSync, readSync, closeSync, statSync, readFileSync, opendirSync } from "node:fs";
import { isObj, mapTool, evUser, evText, evThinking, evTool, evResult, evStop, session, transcript as aeTranscript, skipBad } from "../events.js";

const TAIL_BYTES = 600_000;
// A final text reply and "text, then a tool starts running" look the same on disk.
// Treat the turn as finished once the file has been quiet this long.
const SETTLE_S = 45.0;

// ---- Python-compat helpers ---------------------------------------------------------
const PY_WS = "\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const STRIP_RE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "gu");
// JSONL: a record ends at \n only (a raw U+2028 inside a JSON string is not a line break)
const SPLITLINES_RE = /\r?\n/;

const hasOwn = (o, k) => Object.hasOwn(o, k);
const get = (o, k) => (hasOwn(o, k) ? o[k] : undefined);
function pyType(v) {
  if (v === null || v === undefined) return "NoneType";
  if (Array.isArray(v)) return "list";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  return "dict";
}
/** `v.get(k)` where v may not be a dict: Python raises AttributeError. */
function dget(v, k) {
  if (!isObj(v)) throw new TypeError(`'${pyType(v)}' object has no attribute 'get'`);
  return get(v, k);
}
function truthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string" || Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}
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
/** Python ==: deep, and True == 1. */
function eq(a, b) {
  if (a === undefined) a = null;
  if (b === undefined) b = null;
  const num = (v) => (typeof v === "boolean" ? Number(v) : v);
  if ((typeof a === "number" || typeof a === "boolean") && (typeof b === "number" || typeof b === "boolean")) return num(a) === num(b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => hasOwn(b, k) && eq(a[k], b[k]));
}
/** `k in some_dict` (keys are str): lists / dicts as keys raise TypeError: unhashable. */
function inDict(map, k) {
  if (Array.isArray(k) || isObj(k)) throw new TypeError(`unhashable type: '${pyType(k)}'`);
  return typeof k === "string" && map.has(k);
}
/** dict.update(src) without invoking the __proto__ setter. */
function update(dst, src) {
  for (const k of Object.keys(src)) Object.defineProperty(dst, k, { value: src[k], writable: true, enumerable: true, configurable: true });
}
function numStr(n) {
  if (Number.isNaN(n)) return "nan";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (Number.isInteger(n)) return BigInt(n).toString();
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
/** str(PurePosixPath(p)): collapse slashes, drop "." parts and the trailing slash. */
function pathStr(p) {
  const s = String(p);
  const root = s.startsWith("//") && !s.startsWith("///") ? "//" : s.startsWith("/") ? "/" : "";
  const parts = s.split("/").filter((x) => x && x !== ".");
  return root + parts.join("/") || ".";
}
const pjoin = (a, ...rest) => pathStr([a, ...rest].join("/"));
const pathName = (p) => {
  const parts = pathStr(p).split("/").filter(Boolean);
  const n = parts[parts.length - 1] || "";
  return n === "." ? "" : n;
};
const pathStem = (p) => {
  const name = pathName(p);
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
const lenient = new TextDecoder("utf-8", { ignoreBOM: true }); // bytes.decode(errors="replace")
const strict = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
/** Path.read_text(encoding="utf-8"): strict decoding (raises ValueError-like TypeError), universal newlines. */
function readText(path) {
  const buf = readFileSync(path); // fs errors = OSError
  let s;
  try {
    s = strict.decode(buf);
  } catch {
    const err = new Error(`'utf-8' codec can't decode ${path}`);
    err.unicodeDecodeError = true;
    throw err;
  }
  return s.replace(/\r\n?/g, "\n");
}
const isOSError = (e) => Boolean(e && typeof e.code === "string" && !e.unicodeDecodeError);

// ---- reader ------------------------------------------------------------------------
function replay(lines) {
  const meta = Object.create(null);
  let order = [];
  const msgs = new Map();
  for (const o of lines) {
    if (!isObj(o)) continue;
    if (hasOwn(o, "sessionId") && hasOwn(o, "projectHash") && !hasOwn(o, "id")) {
      update(meta, o);
    } else if (hasOwn(o, "$set") && isObj(o.$set)) {
      update(meta, o.$set);
    } else if (hasOwn(o, "$rewindTo")) {
      const cut = order.indexOf(o.$rewindTo);
      if (cut >= 0) {
        for (const gone of order.slice(cut)) msgs.delete(gone);
        order = order.slice(0, cut);
      }
    } else if (hasOwn(o, "$patch") && isObj(o.$patch)) {
      const p = o.$patch;
      for (const rid of iter(get(p, "removeIds"))) {
        if (inDict(msgs, rid)) msgs.delete(rid);
        const i = order.indexOf(rid);
        if (i >= 0) order.splice(i, 1);
      }
      if (Array.isArray(get(p, "orderIds"))) {
        const ids = p.orderIds;
        order = [...ids.filter((i) => inDict(msgs, i)), ...order.filter((i) => !ids.includes(i))];
      }
      const mid = get(p, "id");
      if (inDict(msgs, mid)) {
        const m = msgs.get(mid);
        if (hasOwn(p, "content")) m.content = p.content;
        for (const tc of iter(get(p, "toolCalls"))) {
          for (const old of iter(get(m, "toolCalls"))) {
            if (eq(dget(old, "id"), dget(tc, "id"))) update(old, tc);
          }
        }
      }
    } else if (typeof get(o, "id") === "string") {
      if (!msgs.has(o.id)) order.push(o.id);
      msgs.set(o.id, o);
    }
  }
  return [meta, order.filter((i) => msgs.has(i)).map((i) => msgs.get(i))];
}

/** Bytes from pos up to and including the next "\n" (or EOF), like f.readline(). */
function readLineAt(fd, pos) {
  const chunks = [];
  for (;;) {
    const buf = Buffer.alloc(65536);
    const n = readSync(fd, buf, 0, buf.length, pos);
    if (n <= 0) break;
    const nl = buf.subarray(0, n).indexOf(0x0a);
    if (nl >= 0) {
      chunks.push(buf.subarray(0, nl + 1));
      break;
    }
    chunks.push(buf.subarray(0, n));
    pos += n;
  }
  return Buffer.concat(chunks);
}
function readToEnd(fd, pos) {
  const chunks = [];
  for (;;) {
    const buf = Buffer.alloc(1 << 20);
    const n = readSync(fd, buf, 0, buf.length, pos);
    if (n <= 0) break;
    chunks.push(buf.subarray(0, n));
    pos += n;
  }
  return Buffer.concat(chunks);
}

function readJsonl(path) {
  let chunk;
  try {
    const size = statSync(path).size;
    const fd = openSync(path, "r");
    try {
      if (size > TAIL_BYTES) {
        // keep the metadata line, then the tail
        const head = readLineAt(fd, 0);
        const start = size - TAIL_BYTES;
        const partial = readLineAt(fd, start); // partial line
        chunk = Buffer.concat([head, readToEnd(fd, start + partial.length)]);
      } else {
        chunk = readToEnd(fd, 0);
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    return [];
  }
  const out = [];
  for (const ln of splitlines(lenient.decode(chunk))) {
    try {
      out.push(jsonLoads(ln));
    } catch {
      continue;
    }
  }
  return out;
}

function readLegacyJson(path) {
  let data;
  try {
    data = jsonLoads(readText(path));
  } catch {
    return []; // OSError, ValueError (incl. UnicodeDecodeError)
  }
  if (!isObj(data)) return [];
  const meta = {};
  update(meta, Object.fromEntries(Object.entries(data).filter(([k]) => k !== "messages")));
  if (!hasOwn(meta, "projectHash")) meta.projectHash = "";
  return [meta, ...iter(get(data, "messages")).filter(isObj)];
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((p) => isObj(p) && truthy(get(p, "text"))).map((p) => str(or(get(p, "text"), ""))).join("\n");
  }
  return "";
}

function functionResponses(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((p) => isObj(p) && isObj(get(p, "functionResponse"))).map((p) => p.functionResponse);
}

/** Gemini messages → [events, turnOpen]. */
function normalize(messages, mtime, now = null) {
  now = or(now, Date.now() / 1000);
  const events = [];
  for (const m of messages) {
    const ts = get(m, "timestamp") ?? null;
    const typ = get(m, "type");
    if (typ === "user") {
      const responses = functionResponses(get(m, "content"));
      if (responses.length) {
        for (const r of responses) {
          const resp = isObj(get(r, "response")) ? r.response : {};
          events.push(evResult(ts, str(or(get(r, "id"), get(r, "name"), "")), truthy(get(resp, "error"))));
        }
      } else {
        const text = textOf(get(m, "content"));
        if (text) events.push(evUser(ts, text));
      }
    } else if (typ === "gemini") {
      if (truthy(get(m, "thoughts"))) events.push(evThinking(ts));
      const text = textOf(get(m, "content"));
      if (text) events.push(evText(ts, text));
      for (const tc of iter(get(m, "toolCalls"))) {
        if (!isObj(tc)) continue;
        const [name, inp] = mapTool(strip(str(or(get(tc, "name"), ""))), get(tc, "args"));
        const cid = str(or(get(tc, "id"), get(tc, "name"), ""));
        const tts = or(get(tc, "timestamp"), ts) ?? null;
        events.push(evTool(tts, cid, name, inp));
        const status = get(tc, "status");
        if (status === "success" || status === "error" || status === "cancelled") events.push(evResult(tts, cid, status === "error"));
      }
    }
  }
  // Where is the turn?
  let last = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = get(messages[i], "type");
    if (t === "user" || t === "gemini") {
      last = messages[i];
      break;
    }
  }
  let turnOpen = false;
  if (last !== null) {
    const quiet = typeof mtime === "number" ? now - mtime : 1e9;
    if (get(last, "type") === "user") turnOpen = quiet < 600; // a prompt or tool results waiting for the model
    else if (truthy(get(last, "toolCalls"))) turnOpen = quiet < 600; // tools finished; the model continues
    else turnOpen = quiet < SETTLE_S; // text only: still going, or the final reply
    if (!turnOpen && get(last, "type") === "gemini") events.push(evStop(get(last, "timestamp") ?? null));
  }
  return [events, turnOpen];
}

/** [tmp/<slug> folder, project path] pairs. */
function projectDirs(base) {
  const tmp = pjoin(base, "tmp");
  if (!isDir(tmp)) return [];
  const roots = new Map();
  try {
    const reg = jsonLoads(readText(pjoin(base, "projects.json")));
    const projects = or(dget(reg, "projects"), {});
    if (!isObj(projects)) throw new TypeError("'list' object has no attribute 'items'");
    for (const [path, slug] of Object.entries(projects)) roots.set(str(slug), str(path));
  } catch {
    // OSError, ValueError, AttributeError
  }
  const out = [];
  for (const name of listNames(tmp)) {
    const d = pjoin(tmp, name);
    if (!isDir(d)) continue;
    let root = "";
    try {
      root = strip(readText(pjoin(d, ".project_root")));
    } catch (e) {
      if (!isOSError(e)) throw e; // UnicodeDecodeError isn't caught in Python either
      root = roots.get(name) ?? "";
    }
    out.push([d, root]);
  }
  return out;
}

/** Accept either the .gemini folder itself or the home folder that contains it. */
function geminiBase(home) {
  if (isDir(pjoin(home, "tmp")) || pathName(home) === ".gemini") return home;
  return pjoin(home, ".gemini");
}

/** One gemini session; the caller skips it if it's malformed. */
function readChat(path, proj, root, since, found) {
  let mtime;
  try {
    mtime = mtimeOf(path);
  } catch {
    return;
  }
  if (mtime < since) return;
  const lines = path.endsWith(".jsonl") ? readJsonl(path) : readLegacyJson(path);
  const [meta, messages] = replay(lines);
  if (meta.kind === "subagent") return;
  const sid = str(or(meta.sessionId, pathStem(path)));
  const [events, turnOpen] = normalize(messages, mtime);
  const cwd = root || pathStr(proj);
  found.set(sid, session("gemini", sid, cwd, events, { turnOpen, mtime, title: meta.summary ?? null, extra: { file: path } }));
}

export function discover(homes, recentMinutes = 30) {
  const since = Date.now() / 1000 - recentMinutes * 60;
  const found = new Map();
  for (const home of homes) {
    const base = geminiBase(home);
    for (const [proj, root] of projectDirs(base)) {
      const chats = pjoin(proj, "chats");
      if (!isDir(chats)) continue;
      for (const path of [...glob(chats, "session-", ".jsonl"), ...glob(chats, "session-", ".json")]) {
        try {
          readChat(path, proj, root, since, found);
        } catch (err) {
          skipBad("gemini", path, err);
        }
      }
    }
  }
  return found;
}

export function check(home, recentMinutes = 30) {
  const base = geminiBase(home);
  if (!exists(home)) return { ok: false, message: "Folder not found" };
  if (!isDir(pjoin(base, "tmp"))) return { ok: false, message: "No tmp/ folder inside — is this Gemini CLI's .gemini folder?" };
  const n = discover([home], recentMinutes).size;
  return { ok: true, message: `Found — ${n} session(s) active in the last ${BigInt(Math.trunc(recentMinutes))} min` };
}

export function transcript(sessionId, homes, recentMinutes = 24 * 60, limit = 15) {
  const sess = discover(homes, recentMinutes).get(sessionId);
  return sess ? aeTranscript(sess.events, limit) : [];
}

export function defaultHome() {
  const h = process.env.GEMINI_CLI_HOME;
  return h ? `${h}/.gemini` : "~/.gemini";
}
