// Read Cursor CLI ("cursor-agent" / "agent") sessions for the agent board.
//
// Cursor's CLI is closed source; this follows the layout documented by several community
// tools (Oct 2026) and is best-effort:
//     ~/.cursor/chats/<md5 of cwd>/<chatId>/meta.json   {"cwd", "createdAtMs", "updatedAtMs", …}
//     ~/.cursor/chats/<md5 of cwd>/<chatId>/store.db    SQLite, WAL mode
//         meta(key, value)   key "0" → hex-encoded JSON with "name" (chat title), …
//         blobs(id, data)    content-addressed; message blobs are JSON
//                            {"role": "user|assistant|tool|system", "content": [parts]}
//                            parts: text, reasoning, tool-call, tool-result
//                            (other blobs are binary protobuf records — skipped)
// Message blobs carry no timestamps, so events get synthetic, ordered timestamps that
// end at the store's last write time.
//
// Not on disk (as far as anyone knows): approval prompts. The Cursor IDE's own chat
// database (state.vscdb) is not read.
//
// Node built-ins only (node:sqlite, Node 22.5+). Opens the database read-only.
//
// Port notes: behaviour mirrors the Python reader, including Python's truthiness
// (`x or y` treats [] / {} / "" / 0 as false), str() of non-string JSON values, and the
// places where Python raises something other than sqlite3.Error (those propagate here too).
import { statSync, readFileSync, opendirSync } from "node:fs";
import { sep } from "node:path";
import { isObj, iso, mapTool, evUser, evText, evThinking, evTool, evResult, evStop, session, transcript as aeTranscript, skipBad } from "../events.js";
import { withReadOnly, sqliteAvailable, SQLITE_HINT } from "../sqlite.js";

const MAX_BLOBS = 200;
const SETTLE_S = 45.0;

// ---- Python-semantics helpers -------------------------------------------------------

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** dict.get(k) → value or null. */
const get = (o, k) => (isObj(o) && hasOwn(o, k) ? o[k] : null);

/** Python bool(v) for JSON / SQLite values. */
function truthy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "number") return v !== 0; // NaN is truthy in Python
  if (typeof v === "bigint") return v !== 0n;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v) || v instanceof Uint8Array) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}
/** Python `a or b`. */
const pyOr = (a, b) => (truthy(a) ? a : b);

function pyError(type, message) {
  const err = new TypeError(message);
  err.pyType = type;
  return err;
}
const pyTypeName = (v) => (v === null ? "NoneType" : Array.isArray(v) ? "list" : typeof v === "string" ? "str" : typeof v === "boolean" ? "bool" : typeof v === "number" ? (Number.isInteger(v) ? "int" : "float") : "dict");

function reprFloat(v) {
  if (Number.isNaN(v)) return "nan";
  if (v === Infinity) return "inf";
  if (v === -Infinity) return "-inf";
  const [mant, expS] = v.toExponential().split("e");
  const exp = Number(expS);
  const digits = mant.replace("-", "").replace(".", "");
  const sign = v < 0 ? "-" : "";
  if (exp >= -4 && exp < 16) {
    if (exp >= 0) return sign + digits.slice(0, exp + 1).padEnd(exp + 1, "0") + "." + (digits.slice(exp + 1) || "0");
    return sign + "0." + "0".repeat(-exp - 1) + digits;
  }
  return sign + digits[0] + (digits.length > 1 ? "." + digits.slice(1) : "") + "e" + (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
}

const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;
function reprStr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === "\\" || ch === q) out += "\\" + ch;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (cp < 0x20 || cp === 0x7f) out += "\\x" + cp.toString(16).padStart(2, "0");
    else if (cp > 0x7f && ch !== " " && NON_PRINTABLE.test(ch)) {
      out += cp <= 0xff ? "\\x" + cp.toString(16).padStart(2, "0") : cp <= 0xffff ? "\\u" + cp.toString(16).padStart(4, "0") : "\\U" + cp.toString(16).padStart(8, "0");
    } else out += ch;
  }
  return out + q;
}
const pyRepr = (v) => (typeof v === "string" ? reprStr(v) : pyStr(v));
/** Python str(v) for JSON values (JSON integers are taken to be Python ints). */
function pyStr(v) {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isInteger(v) && !Object.is(v, -0) ? BigInt(v).toString() : reprFloat(v);
  if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
  if (typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => `${reprStr(k)}: ${pyRepr(x)}`).join(", ") + "}";
  return String(v);
}

const PY_WS = "\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0                　";
/** str.lstrip() with Python's notion of whitespace. */
function pyLstrip(s) {
  let a = 0;
  while (a < s.length && PY_WS.includes(s[a])) a++;
  return s.slice(a);
}

/** AE.iso() as Python runs it: datetime.fromtimestamp raises outside years 1..9999 / on nan, inf. */
function pyIso(ts) {
  if (ts === null || ts === undefined) return null;
  if (!Number.isFinite(ts) || ts < -62135596800 || ts >= 253402300800) throw pyError("ValueError", `timestamp out of range: ${ts}`);
  return iso(ts);
}

const utf8 = (b) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b);

/** bytes(v) for a non-str SQLite value. */
function pyBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (typeof v === "number" || typeof v === "bigint") {
    if (typeof v === "number" && !Number.isInteger(v)) throw pyError("TypeError", "cannot convert 'float' object to bytes");
    if (v < 0) throw pyError("ValueError", "negative count");
    if (v > 2 ** 31) throw pyError("MemoryError", "bytes() size too large");
    return new Uint8Array(Number(v));
  }
  throw pyError("TypeError", `cannot convert '${pyTypeName(v)}' object to bytes`);
}

/** bytes.fromhex(s): ASCII whitespace allowed between byte pairs. null where Python raises ValueError. */
function fromHex(s) {
  const out = [];
  const hex = (c) => (/^[0-9a-fA-F]$/.test(c) ? parseInt(c, 16) : -1);
  let i = 0;
  while (i < s.length) {
    if (" \t\n\r\x0b\x0c".includes(s[i])) {
      i++;
      continue;
    }
    const hi = hex(s[i]);
    const lo = i + 1 < s.length ? hex(s[i + 1]) : -1;
    if (hi < 0 || lo < 0) return null;
    out.push(hi * 16 + lo);
    i += 2;
  }
  return Uint8Array.from(out);
}

// ---- paths (pathlib semantics) ------------------------------------------------------

/** str(Path(p)) on POSIX: collapse // and /./, drop the trailing slash, "" → ".". */
function pyPath(p) {
  const s = String(p);
  if (sep !== "/") return s === "" ? "." : s;
  if (s === "") return ".";
  const root = s.startsWith("/") ? (s.startsWith("//") && !s.startsWith("///") ? "//" : "/") : "";
  const body = s.split("/").filter((x) => x && x !== ".").join("/");
  return root + body || root || ".";
}
const pjoin = (a, b) => (a === "." ? b : a.endsWith(sep) ? a + b : a + sep + b);
const pyName = (p) => (p === "." || p === sep ? "" : p.slice(p.lastIndexOf(sep) + 1));
function statOr(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}
const isFile = (p) => Boolean(statOr(p)?.isFile());
const isDir = (p) => Boolean(statOr(p)?.isDirectory());

/** os.stat().st_mtime exactly as CPython computes it: sec + nsec * 1e-9. */
function stMtime(p) {
  const ns = statSync(p, { bigint: true }).mtimeNs;
  let s = ns / 1000000000n;
  let n = ns % 1000000000n;
  if (n < 0n) {
    s -= 1n;
    n += 1000000000n;
  }
  return Number(s) + Number(n) * 1e-9;
}

/** Entry names in directory order, like os.scandir (unsorted); [] when unreadable. */
function scandirNames(dir) {
  const names = [];
  let d;
  try {
    d = opendirSync(dir);
  } catch {
    return names;
  }
  try {
    for (let e = d.readSync(); e !== null; e = d.readSync()) names.push(e.name);
  } catch {
    /* unreadable mid-way: keep what we have */
  } finally {
    d.closeSync();
  }
  return names;
}

/** Path(chats).glob("*\/*"): every entry one level below each sub-directory, in scandir order. */
function globChats(chats) {
  const out = [];
  for (const a of scandirNames(chats)) {
    const dir = pjoin(chats, a);
    if (!isDir(dir)) continue;
    for (const b of scandirNames(dir)) out.push(pjoin(dir, b));
  }
  return out;
}

function chatMtime(chat) {
  let best = 0.0;
  for (const n of ["store.db", "store.db-wal", "meta.json"]) {
    try {
      best = Math.max(best, stMtime(pjoin(chat, n)));
    } catch {
      /* missing file is normal */
    }
  }
  return best;
}

// ---- SQLite ---------------------------------------------------------------------------

const isSqliteError = (err) => Boolean(err) && err.code === "ERR_SQLITE_ERROR";

/** First column of each row, integers read exactly (BigInt beyond 2^53, like Python's int). */
function column0(con, sql, params) {
  const stmt = con.prepare(sql);
  stmt.setReadBigInts(true);
  return stmt.all(...params).map((row) => {
    const v = Object.values(row)[0];
    return typeof v === "bigint" && Number.isSafeInteger(Number(v)) ? Number(v) : v;
  });
}

function title(con) {
  let rows;
  try {
    rows = column0(con, "SELECT value FROM meta WHERE key = '0'", []);
  } catch (err) {
    if (isSqliteError(err)) return null;
    throw err;
  }
  if (!rows.length) return null;
  const raw = rows[0];
  let b;
  if (typeof raw === "string") {
    b = fromHex(raw);
    if (b === null) return null;
  } else {
    try {
      b = pyBytes(raw);
    } catch (err) {
      if (err.pyType === "ValueError") return null;
      throw err;
    }
  }
  let obj;
  try {
    obj = JSON.parse(utf8(b));
  } catch {
    return null;
  }
  obj = pyOr(obj, {});
  if (!isObj(obj)) return null; // .get on a non-dict → AttributeError → None
  return pyOr(get(obj, "name"), null);
}

function messages(con) {
  const rows = column0(con, "SELECT data FROM blobs ORDER BY rowid DESC LIMIT ?", [MAX_BLOBS]).reverse();
  const out = [];
  for (const data of rows) {
    if (data === null || data === undefined) continue;
    const b = typeof data === "string" ? new TextEncoder().encode(data) : pyBytes(data);
    let k = 0;
    while (k < b.length && [0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c].includes(b[k])) k++;
    if (b[k] !== 0x7b) continue; // protobuf record
    let m;
    try {
      m = JSON.parse(utf8(b));
    } catch {
      continue;
    }
    if (isObj(m) && ["user", "assistant", "tool"].includes(get(m, "role"))) out.push(m);
  }
  return out;
}

// ---- events -------------------------------------------------------------------------

function parts(m) {
  const c = get(m, "content");
  if (typeof c === "string") return [{ type: "text", text: c }];
  return Array.isArray(c) ? c.filter(isObj) : [];
}

function isError(part) {
  const r = hasOwn(part, "result") ? part.result : get(part, "output");
  if (truthy(get(part, "isError")) || truthy(get(part, "is_error"))) return true;
  if (isObj(r)) return truthy(get(r, "error")) || ["error", "failed", "failure"].includes(pyStr(pyOr(get(r, "status"), "")).toLowerCase());
  return false;
}

const SYSTEM_PREFIXES = ["<user_info>", "<system", "<rules>", "<environment"];

function normalize(msgs, mtime, now = null) {
  now = pyOr(now, Date.now() / 1000);
  const events = [];
  const n = Math.max(1, msgs.length);
  const pending = new Set();
  msgs.forEach((m, i) => {
    const base = mtime - (n - 1 - i) * 0.5; // ordered, ending at the last write
    const role = get(m, "role");
    parts(m).forEach((p, j) => {
      const ts = pyIso(base - 0.4 + j * 0.01); // parts keep their order within a message
      const pt = get(p, "type");
      if (role === "user" && pt === "text" && truthy(get(p, "text"))) {
        const text = pyStr(p.text);
        const head = pyLstrip(text);
        if (!SYSTEM_PREFIXES.some((x) => head.startsWith(x))) events.push(evUser(ts, text));
      } else if (role === "assistant" && pt === "text" && truthy(get(p, "text"))) {
        events.push(evText(ts, pyStr(p.text)));
      } else if (role === "assistant" && (pt === "reasoning" || pt === "redacted-reasoning")) {
        events.push(evThinking(ts));
      } else if (pt === "tool-call") {
        const cid = pyStr(pyOr(pyOr(get(p, "toolCallId"), get(p, "id")), ""));
        const [name, inp] = mapTool(pyStr(pyOr(pyOr(get(p, "toolName"), get(p, "name")), "")), pyOr(get(p, "args"), get(p, "input")));
        events.push(evTool(ts, cid, name, inp));
        pending.add(cid);
      } else if (pt === "tool-result") {
        const cid = pyStr(pyOr(pyOr(get(p, "toolCallId"), get(p, "id")), ""));
        events.push(evResult(ts, cid, isError(p)));
        pending.delete(cid);
      }
    });
  });
  const last = msgs.length ? msgs[msgs.length - 1] : null;
  const quiet = now - mtime;
  let turnOpen;
  if (last === null) turnOpen = false;
  else if (["user", "tool"].includes(get(last, "role")) || pending.size) turnOpen = quiet < 600;
  else turnOpen = quiet < SETTLE_S;
  if (last !== null && !turnOpen && get(last, "role") === "assistant" && !pending.size) events.push(evStop(pyIso(mtime)));
  return [events, turnOpen];
}

function cursorBase(home) {
  return isDir(pjoin(home, "chats")) || pyName(home) === ".cursor" ? home : pjoin(home, ".cursor");
}

// ---- reader API ---------------------------------------------------------------------

/** One cursor session; the caller skips it if it's malformed. */
function readChat(chat, since, found) {
  const store = pjoin(chat, "store.db");
  if (!isDir(chat) || !isFile(store)) return;
  const mtime = chatMtime(chat);
  if (mtime < since) return;
  let meta = {};
  try {
    meta = JSON.parse(utf8(readFileSync(pjoin(chat, "meta.json"))));
  } catch {
    /* missing or unreadable meta.json: no cwd */
  }
  let chatTitle;
  let msgs;
  try {
    withReadOnly(store, (con) => {
      chatTitle = title(con);
      msgs = messages(con);
    });
  } catch (err) {
    if (!isSqliteError(err)) throw err;
    return;
  }
  const [events, turnOpen] = normalize(msgs, mtime);
  if (!isObj(meta)) meta = {}; // meta.json that isn't an object: no cwd
  const sid = pyName(chat);
  found.set(sid, session("cursor", sid, pyStr(pyOr(get(meta, "cwd"), "")), events, {
    turnOpen,
    mtime,
    title: typeof chatTitle === "bigint" ? Number(chatTitle) : chatTitle,
    extra: { file: store },
  }));
}

export function discover(homes, recentMinutes = 30) {
  const found = new Map();
  if (!sqliteAvailable()) return found;
  const since = Date.now() / 1000 - recentMinutes * 60;
  for (const rawHome of homes) {
    const chats = pjoin(cursorBase(pyPath(rawHome)), "chats");
    if (!isDir(chats)) continue;
    for (const chat of globChats(chats)) {
      try {
        readChat(chat, since, found);
      } catch (err) {
        skipBad("cursor", chat, err);
      }
    }
  }
  return found;
}

export function check(home, recentMinutes = 30) {
  if (!sqliteAvailable()) return { ok: false, message: SQLITE_HINT };
  const h = pyPath(home);
  if (!statOr(h)) return { ok: false, message: "Folder not found" };
  if (!isDir(pjoin(cursorBase(h), "chats"))) return { ok: null, message: "No chats/ folder yet — appears after your first Cursor CLI chat" };
  const n = discover([home], recentMinutes).size;
  return { ok: true, message: `Found — ${n} session(s) active in the last ${Math.trunc(recentMinutes)} min` };
}

export function transcript(sessionId, homes, recentMinutes = 24 * 60, limit = 15) {
  const sess = discover(homes, recentMinutes).get(sessionId);
  return sess ? aeTranscript(sess.events, limit) : [];
}

export function defaultHome() {
  return "~/.cursor";
}
