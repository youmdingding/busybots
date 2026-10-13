// Read OpenCode sessions for the agent board.
//
// OpenCode (sst/opencode, Oct 2026) keeps everything in one SQLite database:
//     $XDG_DATA_HOME/opencode/opencode.db   (default ~/.local/share/opencode/opencode.db;
//                                            some release channels write opencode-<channel>.db)
// Tables used (read-only):
//     session_v2       id, parent_id (sub-agent sessions), directory (cwd), title,
//                      time_updated, time_suspended (set while a turn runs), time_idle,
//                      idle_outcome, time_archived — times are epoch milliseconds
//     session_message  session_id, type (user / assistant / idle / shell / …), seq,
//                      time_created, time_updated, data (JSON)
// An assistant row's data.content holds parts: text, reasoning, and tool parts
// {id, name, state: {status: streaming|running|completed|error, input, …}, time}.
// An "idle" row closes a turn.
//
// Not on disk: permission prompts (OpenCode keeps them in memory; the tool just stays
// "running"). Very old installs that used JSON files under storage/ aren't read.
//
// Node built-ins only (node:sqlite, Node 22.5+). Opens the database read-only.
//
// Port notes: behaviour mirrors the Python reader, including Python's truthiness
// (`x or y` treats [] / {} / "" / 0 as false), str() of non-string JSON values, and the
// places where Python raises something other than sqlite3.Error (those propagate here too).
import { statSync, readdirSync } from "node:fs";
import { sep } from "node:path";
import { isObj, iso, mapTool, evUser, evText, evThinking, evTool, evResult, evStop, session, transcript as aeTranscript, skipBad } from "../events.js";
import { withReadOnly, sqliteAvailable, SQLITE_HINT } from "../sqlite.js";

const MAX_MESSAGES = 80;

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
function reprBytes(b) {
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = "b" + q;
  for (const c of b) {
    const ch = String.fromCharCode(c);
    if (ch === "\\" || ch === q) out += "\\" + ch;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (c < 0x20 || c >= 0x7f) out += "\\x" + c.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + q;
}
const pyRepr = (v) => (typeof v === "string" ? reprStr(v) : pyStr(v));
/** Python str(v) for JSON / SQLite values (JSON integers are taken to be Python ints). */
function pyStr(v) {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isInteger(v) && !Object.is(v, -0) ? BigInt(v).toString() : reprFloat(v);
  if (v instanceof Uint8Array) return reprBytes(v);
  if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
  if (typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => `${reprStr(k)}: ${pyRepr(x)}`).join(", ") + "}";
  return String(v);
}

const PY_WS = "\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0                　";
function pyStrip(s) {
  let a = 0;
  let b = s.length;
  while (a < b && PY_WS.includes(s[a])) a++;
  while (b > a && PY_WS.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

const FLOAT_RE = /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/;
const SPECIAL_RE = /^([+-]?)(inf|infinity|nan)$/i;
/** Python float(v), or null where Python raises TypeError / ValueError. */
function pyFloat(v) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  let s;
  if (typeof v === "string") s = v;
  else if (v instanceof Uint8Array) {
    if (v.some((c) => c > 0x7f)) return null;
    s = String.fromCharCode(...v);
  } else return null;
  s = pyStrip(s);
  if (FLOAT_RE.test(s)) return Number(s.replace(/_/g, ""));
  const m = SPECIAL_RE.exec(s);
  if (m) return m[2].toLowerCase() === "nan" ? NaN : m[1] === "-" ? -Infinity : Infinity;
  return null;
}

/** _ms(): epoch ms → epoch seconds (float), or null. */
function ms(v) {
  if (v === null || v === undefined) return null;
  const f = pyFloat(v);
  return f === null ? null : f / 1000.0;
}

/** AE.iso() as Python runs it: datetime.fromtimestamp raises outside years 1..9999 / on nan, inf. */
function pyIso(ts) {
  if (ts === null || ts === undefined) return null;
  if (!Number.isFinite(ts) || ts < -62135596800 || ts >= 253402300800) throw pyError("ValueError", `timestamp out of range: ${ts}`);
  return iso(ts);
}

/** Python max(list): first element wins unless a later one compares greater. */
function pyMax(xs) {
  let best = xs[0];
  for (const x of xs.slice(1)) if (x > best) best = x;
  return best;
}

function decodeBytes(b, encoding) {
  return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(b);
}
function decodeUtf32(b, little) {
  if (b.length % 4) throw new Error("truncated utf-32");
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let out = "";
  for (let i = 0; i < b.length; i += 4) out += String.fromCodePoint(view.getUint32(i, little));
  return out;
}
/** json.loads(bytes): json.detect_encoding() then decode. Throws on bad input (ValueError). */
function decodeJsonBytes(b) {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return decodeBytes(b.subarray(3), "utf-8");
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) {
    if (b[0] === 0xff && b[2] === 0 && b[3] === 0 && b.length >= 4) return decodeUtf32(b.subarray(4), true);
    return decodeBytes(b.subarray(2), b[0] === 0xff ? "utf-16le" : "utf-16be");
  }
  if (b[0] === 0 && b[1] === 0 && b[2] === 0xfe && b[3] === 0xff) return decodeUtf32(b.subarray(4), false);
  if (b.length >= 4) {
    if (!b[0]) return b[1] ? decodeBytes(b, "utf-16be") : decodeUtf32(b, false);
    if (!b[1]) return b[2] || b[3] ? decodeBytes(b, "utf-16le") : decodeUtf32(b, true);
  } else if (b.length === 2) {
    if (!b[0]) return decodeBytes(b, "utf-16be");
    if (!b[1]) return decodeBytes(b, "utf-16le");
  }
  return decodeBytes(b, "utf-8");
}

/** json.loads(r["data"] or "{}") → {ok, value}; ok=false where Python raises ValueError (row skipped). */
function loadsData(raw) {
  const v = truthy(raw) ? raw : "{}";
  let text;
  if (typeof v === "string") text = v;
  else if (v instanceof Uint8Array) {
    try {
      text = decodeJsonBytes(v);
    } catch {
      return { ok: false };
    }
  } else throw pyError("TypeError", `the JSON object must be str, bytes or bytearray, not ${typeof v}`);
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

const requireDict = (v) => {
  if (!isObj(v)) throw pyError("AttributeError", `'${pyTypeName(v)}' object has no attribute 'get'`);
};
const pyTypeName = (v) => (v === null ? "NoneType" : Array.isArray(v) ? "list" : typeof v === "string" ? "str" : typeof v === "boolean" ? "bool" : typeof v === "number" ? (Number.isInteger(v) ? "int" : "float") : "dict");

/** Python `for x in v` over a JSON value, keeping only what could be a dict. */
function iterParts(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" || isObj(v)) return []; // chars / keys: never dicts
  throw pyError("TypeError", `'${pyTypeName(v)}' object is not iterable`);
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
function pySuffix(p) {
  const name = p.slice(p.lastIndexOf(sep) + 1);
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i) : "";
}
function isFile(p) {
  try {
    return statSync(p).isFile();
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
function cmpCodepoints(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
}

const DB_GLOB = process.platform === "win32" ? /^opencode[\s\S]*\.db$/i : /^opencode[\s\S]*\.db$/;

function dbs(home) {
  if (isFile(home) && pySuffix(home) === ".db") return [home];
  let names;
  try {
    names = readdirSync(home);
  } catch {
    return [];
  }
  return names.filter((n) => DB_GLOB.test(n)).sort(cmpCodepoints).map((n) => pjoin(home, n)).filter(isFile);
}

function mtimeOf(db) {
  let best = 0.0;
  for (const p of [db, db + "-wal"]) {
    try {
      best = Math.max(best, stMtime(p));
    } catch {
      /* missing -wal is normal */
    }
  }
  return best;
}

// ---- SQLite ---------------------------------------------------------------------------

const isSqliteError = (err) => Boolean(err) && err.code === "ERR_SQLITE_ERROR";

/** stmt.all() with integers read exactly (BigInt when beyond 2^53, like Python's int). */
function query(con, sql, params) {
  const stmt = con.prepare(sql);
  stmt.setReadBigInts(true);
  return stmt.all(...params).map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = typeof v === "bigint" && Number.isSafeInteger(Number(v)) ? Number(v) : v;
    return out;
  });
}

const SESSIONS_SQL = `SELECT id, directory, title, time_updated, time_suspended, time_idle
                       FROM session_v2
                       WHERE parent_id IS NULL AND time_archived IS NULL
                         AND (time_suspended IS NOT NULL OR time_updated >= ? OR time_idle >= ?)
                       ORDER BY time_updated DESC LIMIT 40`;
const MESSAGES_SQL = `SELECT type, seq, time_created, time_updated, data FROM session_message
                           WHERE session_id = ? ORDER BY seq DESC LIMIT ?`;

// ---- events -------------------------------------------------------------------------

function userText(data) {
  requireDict(data);
  if (typeof get(data, "text") === "string") return data.text;
  const parts = pyOr(pyOr(get(data, "content"), get(data, "parts")), []);
  if (Array.isArray(parts)) {
    return parts.filter((p) => isObj(p) && truthy(get(p, "text"))).map((p) => pyStr(pyOr(get(p, "text"), ""))).join("\n");
  }
  return "";
}

function normalize(rows) {
  const events = [];
  for (const r of rows) {
    const parsed = loadsData(r.data);
    if (!parsed.ok) continue;
    const data = parsed.value;
    const ts = pyIso(ms(r.time_created));
    const typ = r.type;
    if (typ === "user") {
      const text = userText(data);
      if (text) events.push(evUser(ts, text));
    } else if (typ === "assistant") {
      requireDict(data);
      for (const part of iterParts(pyOr(get(data, "content"), []))) {
        if (!isObj(part)) continue;
        const pt = get(part, "type");
        const ptime = isObj(get(part, "time")) ? part.time : {};
        const pts = pyOr(pyIso(ms(get(ptime, "created"))), ts);
        if (pt === "text" && truthy(get(part, "text"))) {
          events.push(evText(pts, pyStr(part.text)));
        } else if (pt === "reasoning") {
          events.push(evThinking(pts));
        } else if (pt === "tool") {
          const state = isObj(get(part, "state")) ? part.state : {};
          const [name, inp] = mapTool(pyStr(pyOr(get(part, "name"), "")), get(state, "input"));
          const cid = pyStr(pyOr(get(part, "id"), ""));
          events.push(evTool(pts, cid, name, inp));
          const status = get(state, "status");
          if (status === "completed" || status === "error") {
            const done = pyOr(pyIso(ms(get(ptime, "completed"))), pts);
            events.push(evResult(done, cid, status === "error"));
          }
        }
      }
      const err = get(data, "error");
      if (isObj(err) && truthy(err)) events.push(evText(ts, `Error: ${pyStr(pyOr(get(err, "message"), "failed"))}`));
    } else if (typ === "idle") {
      events.push(evStop(ts));
    }
  }
  return events;
}

// ---- reader API ---------------------------------------------------------------------

export function discover(homes, recentMinutes = 30) {
  const found = new Map();
  if (!sqliteAvailable()) return found;
  const now = Date.now() / 1000;
  const since = now - recentMinutes * 60;
  for (const rawHome of homes) {
    const home = pyPath(rawHome);
    for (const db of dbs(home)) {
      const mtime = mtimeOf(db);
      if (mtime < since) continue;
      try {
        withReadOnly(db, (con) => {
          const sessions = query(con, SESSIONS_SQL, [since * 1000, since * 1000]);
          for (const s of sessions) {
            try {
              const rows = query(con, MESSAGES_SQL, [s.id, MAX_MESSAGES]).reverse();
              const lastChange = pyMax([...rows.map((r) => pyOr(ms(r.time_updated), 0)), pyOr(ms(s.time_updated), 0)]);
              const suspended = s.time_suspended !== null && s.time_suspended !== undefined;
              // A crashed process can leave the "turn running" mark behind: cap it at 10 min of silence
              const turnOpen = suspended && now - lastChange < 600;
              const sid = pyStr(s.id);
              found.set(sid, session("opencode", sid, pyStr(pyOr(s.directory, home)), normalize(rows), {
                turnOpen,
                mtime: pyOr(lastChange, mtime),
                title: typeof s.title === "bigint" ? Number(s.title) : s.title,
                extra: { file: db },
              }));
            } catch (err) {
              if (isSqliteError(err)) throw err; // the whole database: handled below
              skipBad("opencode", `session ${s.id}`, err);
            }
          }
        });
      } catch (err) {
        if (!isSqliteError(err)) throw err;
        continue; // locked mid-migration, older schema, …
      }
    }
  }
  return found;
}

export function check(home, recentMinutes = 30) {
  if (!sqliteAvailable()) return { ok: false, message: SQLITE_HINT };
  const h = pyPath(home);
  if (!exists(h)) return { ok: false, message: "Folder not found" };
  const found = dbs(h);
  if (!found.length) return { ok: false, message: "No opencode.db inside — is this OpenCode's data folder?" };
  try {
    withReadOnly(found[0], (con) => con.prepare("SELECT 1 FROM session_v2 LIMIT 1").all());
  } catch (err) {
    if (!isSqliteError(err)) throw err;
    return { ok: false, message: "Database found but in an older format this board can't read yet" };
  }
  const n = discover([home], recentMinutes).size;
  return { ok: true, message: `Found — ${n} session(s) active in the last ${Math.trunc(recentMinutes)} min` };
}

export function transcript(sessionId, homes, recentMinutes = 24 * 60, limit = 15) {
  const sess = discover(homes, recentMinutes).get(sessionId);
  return sess ? aeTranscript(sess.events, limit) : [];
}

export function defaultHome() {
  const x = process.env.XDG_DATA_HOME;
  return x ? `${x}/opencode` : "~/.local/share/opencode";
}
