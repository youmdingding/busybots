// Claude Code sessions: live processes from <home>/sessions/*.json, transcripts from
// <home>/projects/<encoded cwd>/<sessionId>.jsonl (plus sub-agent transcripts beside them).
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, basename } from "node:path";
import { pidAlive, cmdlineForPid } from "./proc.js";
import { realpathOr } from "./paths.js";
import { latestActivity, parseTs, bubbleFromTool, areaForSkill, zoneFor, STRONG_KEYS } from "./classify.js";

const TAIL_BYTES = 240_000;
const MAX_SCAN_LINES = 100;
const SKILL_SCAN_BYTES = 2_000_000;
const SKILL_QUIET_RESET_S = 30 * 60;
const COMMAND_RE = /<command-name>\s*\/?([A-Za-z0-9_.:-]+)\s*<\/command-name>/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const mtimeOf = (p) => {
  try {
    return statSync(p).mtimeMs / 1000;
  } catch {
    return null;
  }
};
const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const list = (dir, ext) => {
  try {
    return readdirSync(dir).filter((n) => n.endsWith(ext)).sort().map((n) => join(dir, n));
  } catch {
    return [];
  }
};

export const encodeProjectDir = (cwd) => realpathOr(cwd).replace(/[^A-Za-z0-9]/g, "-");
const projectDir = (home, cwd) => join(home, "projects", encodeProjectDir(cwd));

/** Read the last bytes of a file. Returns [text, fileSize] or null. */
function readTail(path, nbytes) {
  let fd;
  try {
    fd = openSync(path, "r");
    const size = statSync(path).size;
    const start = Math.max(0, size - nbytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return [buf.toString("utf8"), size];
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The last transcript entries (by default at most 100 objects from the last 240 KB). */
export function tailJsonl(path, nbytes = TAIL_BYTES, maxLines = MAX_SCAN_LINES) {
  if (!path || !isFile(path)) return [];
  const r = readTail(path, nbytes);
  if (!r) return [];
  const [chunk, size] = r;
  let lines = chunk.split(/\r?\n/).filter((l) => l.trim());
  if (size > nbytes && lines.length) lines = lines.slice(1); // first line is cut
  const out = [];
  for (const ln of Number.isFinite(maxLines) ? lines.slice(-maxLines) : lines) {
    try {
      const o = JSON.parse(ln);
      if (isObj(o)) out.push(o);
    } catch { /* partial line */ }
  }
  return out;
}

/** sessionId → meta for Claude Code processes that are still running. */
export function discoverLive(home) {
  const found = {};
  for (const path of list(join(home, "sessions"), ".json")) {
    let meta;
    try {
      meta = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (!isObj(meta)) continue;
    const pid = Number.parseInt(meta.pid || basename(path, ".json"), 10);
    if (!Number.isInteger(pid) || !pidAlive(pid)) continue;
    const sid = meta.sessionId;
    const cwd = meta.cwd;
    if (!sid || !cwd) continue;
    found[String(sid)] = {
      pid, sessionId: String(sid), cwd: String(cwd),
      claude_status: String(meta.status || "").toLowerCase(),
      name_hint: meta.name ?? null, entrypoint: meta.entrypoint ?? null,
      source: "claude-sessions", cmdline: cmdlineForPid(pid), agent_type: "",
      claude_home: home,
    };
  }
  return found;
}

function claimedSessionIds(home) {
  const ids = new Set();
  for (const p of list(join(home, "sessions"), ".json")) {
    try {
      const sid = JSON.parse(readFileSync(p, "utf8"))?.sessionId;
      if (sid) ids.add(String(sid));
    } catch { /* unreadable */ }
  }
  return ids;
}

/** The session's transcript, or (resumed sessions) the newest one no other session claims. */
export function jsonlPathFor(home, cwd, sessionId) {
  const proj = projectDir(home, cwd);
  if (!isDir(proj)) return null;
  const direct = join(proj, `${sessionId}.jsonl`);
  if (isFile(direct)) return direct;
  const claimed = claimedSessionIds(home);
  claimed.delete(sessionId);
  let best = null, bestM = -Infinity;
  for (const p of list(proj, ".jsonl")) {
    if (claimed.has(basename(p, ".jsonl")) || !isFile(p)) continue;
    const m = mtimeOf(p);
    if (m !== null && m > bestM) {
      best = p;
      bestM = m;
    }
  }
  return best;
}

const subagentFiles = (home, cwd, sid) => list(join(projectDir(home, cwd), sid, "subagents"), ".jsonl");

/** Newest write across the transcript and its sub-agent transcripts. */
export function newestSessionMtime(home, cwd, sid, jsonl) {
  let newest = jsonl ? mtimeOf(jsonl) : null;
  for (const p of subagentFiles(home, cwd, sid)) {
    const m = mtimeOf(p);
    if (m !== null) newest = newest === null ? m : Math.max(newest, m);
  }
  return newest;
}

export function liveSubagentCount(home, cwd, sid, now, windowS = 45) {
  return subagentFiles(home, cwd, sid).filter((p) => {
    const m = mtimeOf(p);
    return m !== null && now - m <= windowS;
  }).length;
}

/** If sub-agents are fresher than the parent transcript, show their tool / text. */
export function enrichFromSubagents(home, cwd, sid, act, maxChars, rules, now) {
  let newestPath = null, newestM = -1;
  for (const p of subagentFiles(home, cwd, sid)) {
    const m = mtimeOf(p);
    if (m !== null && m > newestM) {
      newestM = m;
      newestPath = p;
    }
  }
  if (!newestPath) return act;
  const parentTs = typeof act.last_ts === "number" ? act.last_ts : null;
  const parentAge = parentTs !== null ? now - parentTs : 1e9;
  if (now - newestM > 60) return act;
  if (parentTs !== null && newestM <= parentTs + 2 && parentAge < 45) return act;
  const sub = latestActivity(tailJsonl(newestPath), maxChars, rules);
  if (!sub.bubble && act.bubble) sub.bubble = act.bubble;
  if (!sub.assistant_text && act.assistant_text) {
    sub.assistant_text = act.assistant_text;
    sub.last_assistant_text_ts = act.last_assistant_text_ts ?? null;
  }
  sub.jsonl_mtime = Math.max(Number(act.jsonl_mtime) || 0, newestM, Number(sub.last_ts) || 0) || newestM;
  const lt = [act.last_ts, sub.last_ts, newestM].filter((t) => typeof t === "number");
  if (lt.length) sub.last_ts = Math.max(...lt);
  return sub;
}

// ---- skill / slash command of the current turn --------------------------------------

/** ["set", skill] when this entry invokes a skill or slash command, else null. */
function skillFromEntry(o) {
  const content = o.message?.content;
  if (o.type === "assistant" && Array.isArray(content)) {
    for (const b of content) {
      if (isObj(b) && b.type === "tool_use" && b.name === "Skill") {
        const inp = isObj(b.input) ? b.input : {};
        const name = String(inp.skill || inp.command || inp.name || "").trim().replace(/^\/+/, "");
        if (name) return ["set", name];
      }
    }
    return null;
  }
  if (o.type !== "user" || o.isMeta || "toolUseResult" in o) return null;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    if (content.some((c) => isObj(c) && c.type === "tool_result")) return null;
    text = content.filter(isObj).map((c) => String(c.text || "")).join(" ");
  }
  const m = COMMAND_RE.exec(text);
  if (m) return ["set", m[1]];
  const t = text.trim();
  if (t.startsWith("/") && t.length > 1 && !t.startsWith("//")) {
    const word = t.slice(1).split(/\s/, 1)[0];
    if (/^[A-Za-z0-9_.:-]+$/.test(word || "")) return ["set", word];
  }
  return null; // plain follow-ups keep the current skill
}

/** Remembers, per transcript, how far it was scanned and which skill is active. */
export class SkillTracker {
  constructor() {
    this.cache = new Map();
  }

  current(path, rules) {
    if (!path || !isFile(path)) return null;
    let size;
    try {
      size = statSync(path).size;
    } catch {
      return null;
    }
    let c = this.cache.get(path);
    if (!c || size < c.offset) {
      c = { offset: Math.max(0, size - SKILL_SCAN_BYTES), skill: null, partial: Buffer.alloc(0), skipFirst: size > SKILL_SCAN_BYTES, lastTs: null };
      this.cache.set(path, c);
    }
    if (size === c.offset) return c.skill;
    let chunk;
    let fd;
    try {
      fd = openSync(path, "r");
      chunk = Buffer.alloc(size - c.offset);
      readSync(fd, chunk, 0, chunk.length, c.offset);
    } catch {
      return c.skill;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    const data = Buffer.concat([c.partial, chunk]);
    const lines = [];
    let start = 0;
    for (let i = data.indexOf(10); i !== -1; i = data.indexOf(10, start)) {
      lines.push(data.subarray(start, i));
      start = i + 1;
    }
    c.partial = Buffer.from(data.subarray(start));
    if (c.skipFirst && lines.length) lines.shift();
    c.skipFirst = false;
    for (const raw of lines) {
      const ln = raw.toString("utf8");
      if (!ln.includes('"timestamp"')) continue;
      let o;
      try {
        o = JSON.parse(ln);
      } catch {
        continue;
      }
      if (!isObj(o)) continue;
      const ts = parseTs(o.timestamp);
      if (ts !== null) {
        if (c.lastTs !== null && ts - c.lastTs > SKILL_QUIET_RESET_S) c.skill = null; // long pause → over
        c.lastTs = ts;
      }
      const r = skillFromEntry(o);
      if (r) c.skill = r[1];
      else if (c.skill && o.type === "assistant") {
        // Clearly different work (editing code, running tests) ends the skill
        const area = areaForSkill(c.skill, rules);
        const blocks = Array.isArray(o.message?.content) ? o.message.content : [];
        for (const b of blocks) {
          if (!(isObj(b) && b.type === "tool_use")) continue;
          const [key] = bubbleFromTool(String(b.name || ""), b.input || {}, 60, rules);
          if (area && STRONG_KEYS.has(key) && zoneFor(key, rules.activityAreas) !== area) {
            c.skill = null;
            break;
          }
        }
      }
    }
    c.offset = size;
    return c.skill;
  }

  end(path) {
    const c = path && this.cache.get(path);
    if (c) c.skill = null;
  }
}

