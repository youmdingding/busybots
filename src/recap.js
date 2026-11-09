// The daily recap: what each agent did today. Built from the watcher's passes (so it works the
// same for every agent), kept per day in <state>/history/YYYY-MM-DD.json for 30 days.
// Per session: time working in each room, time waiting for you, how often it finished,
// files it edited, when it was first and last seen.
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { stateDir } from "./paths.js";
import { claudeSessionUsage, fileUsage, totalOf } from "./usage.js";

const KEEP_DAYS = 30;
const MAX_STEP_S = 10;      // a gap longer than this (sleep, restart) doesn't count as work
const FLUSH_MS = 30_000;
const MAX_FILES = 200;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local date as YYYY-MM-DD. */
export function dayKey(ms = Date.now()) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const emptyDay = (day) => ({ version: 1, day, sessions: {} });

/** Tokens a session used on a day, from its transcript (0 if unknown or unreadable). */
function tokensOn(transcript, day) {
  if (!transcript || !transcript.path) return 0;
  try {
    const u = transcript.kind === "codex" ? fileUsage(transcript.path, "codex") : claudeSessionUsage(transcript.path);
    return u && u.byDay[day] ? totalOf(u.byDay[day]) : 0;
  } catch {
    return 0;
  }
}

export class Recap {
  constructor({ dir = join(stateDir(), "history"), log = (m) => console.error(m) } = {}) {
    this.dir = dir;
    this.log = log;
    this.data = null;      // the day being recorded
    this.lastMs = null;    // previous pass
    this.prevDone = new Map();
    this.dirty = false;
    this.flushedAt = 0;
  }

  file(day) {
    return join(this.dir, `${day}.json`);
  }

  load(day) {
    try {
      const d = JSON.parse(readFileSync(this.file(day), "utf8"));
      if (d && d.sessions && typeof d.sessions === "object") return d;
    } catch { /* none yet, or unreadable: start fresh */ }
    return emptyDay(day);
  }

  flush(force = false, now = Date.now()) {
    if (!this.data || !this.dirty || (!force && now - this.flushedAt < FLUSH_MS)) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = join(this.dir, `.${this.data.day}.${process.pid}.tmp`);
      writeFileSync(tmp, JSON.stringify(this.data));
      renameSync(tmp, this.file(this.data.day));
      this.dirty = false;
      this.flushedAt = now;
    } catch (err) {
      this.log(`recap: could not save (${err.message})`);
    }
  }

  prune(now = Date.now()) {
    try {
      const cutoff = dayKey(now - KEEP_DAYS * 86400_000);
      for (const f of readdirSync(this.dir)) {
        const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
        if (m && m[1] < cutoff) unlinkSync(join(this.dir, f));
      }
    } catch { /* nothing to prune */ }
  }

  /** One watcher pass: status = the board's status, edits = watcher.lastEdits (Map id → [[path, ts]]),
   *  files = watcher.lastFiles (Map id → { kind, path } of the transcript, for token counts). */
  update(status, edits = new Map(), now = Date.now(), files = new Map()) {
    const day = dayKey(now);
    if (!this.data || this.data.day !== day) {
      this.flush(true, now);
      this.data = this.load(day);
      this.prune(now);
    }
    const step = this.lastMs == null ? 0 : Math.max(0, Math.min(MAX_STEP_S, (now - this.lastMs) / 1000));
    this.lastMs = now;
    const startOfDay = new Date(now).setHours(0, 0, 0, 0) / 1000;
    for (const b of (status && status.bots) || []) {
      const a = b.attention || {};
      let r = this.data.sessions[b.id];
      if (!r) {
        r = this.data.sessions[b.id] = { name: b.name, brand: b.brand || null, project: b.cwd ? basename(b.cwd) : null,
          first: Math.round(now / 1000), last: 0, working: 0, waiting: 0, rooms: {}, finished: 0, files: {} };
      }
      r.name = b.name;
      if (b.cwd) r.project = basename(b.cwd);
      const tf = files.get(b.id);
      if (tf) r.transcript = tf;
      if (b.state === "active" || a.needsYou) r.last = Math.round(now / 1000);
      if (a.needsYou) r.waiting += step;
      else if (b.state === "active") {
        r.working += step;
        r.rooms[b.zone] = (r.rooms[b.zone] || 0) + step;
      }
      const wasDone = this.prevDone.get(b.id);
      if (a.done && wasDone === false) r.finished += 1;
      this.prevDone.set(b.id, !!a.done);
      for (const [path, ts] of edits.get(b.id) || []) {
        if (ts != null && ts < startOfDay) continue; // edited on an earlier day
        if (!(path in r.files) && Object.keys(r.files).length >= MAX_FILES) continue;
        r.files[path] = Math.max(r.files[path] || 0, Math.round(ts || now / 1000));
      }
      this.dirty = true;
    }
    this.flush(false, now);
  }

  /** Today's line for one session (agent panel), or null. */
  forSession(id) {
    const r = this.data && this.data.day === dayKey() ? this.data.sessions[id] : null;
    if (!r) return null;
    return { working: Math.round(r.working), waiting: Math.round(r.waiting), finished: r.finished,
      tokens: tokensOn(r.transcript, dayKey()),
      rooms: Object.fromEntries(Object.entries(r.rooms).map(([k, v]) => [k, Math.round(v)])),
      fileCount: Object.keys(r.files).length };
  }

  /** Days with a recap, newest first. */
  days() {
    try {
      return readdirSync(this.dir).map((f) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1]).filter(Boolean).sort().reverse();
    } catch {
      return [];
    }
  }

  /** One day's recap for the board. privacy: no project or file names, generic agent names. */
  summary(day = dayKey(), { privacy = false } = {}) {
    if (!DAY_RE.test(day)) throw new Error("Invalid day");
    const d = this.data && this.data.day === day ? this.data : this.load(day);
    const counters = {};
    const agents = Object.entries(d.sessions)
      .filter(([, r]) => r.working + r.waiting >= 1 || r.finished || Object.keys(r.files).length)
      .map(([id, r]) => {
        const files = Object.entries(r.files).sort((x, y) => y[1] - x[1]).map(([p]) => p);
        const label = { claude: "Claude", codex: "Codex", gemini: "Gemini", opencode: "OpenCode", cursor: "Cursor", conductor: "Conductor" }[r.brand] || "Agent";
        counters[label] = (counters[label] || 0) + 1;
        return {
          id, brand: r.brand,
          name: privacy ? `${label} ${counters[label]}` : r.name,
          project: privacy ? null : r.project,
          working: Math.round(r.working), waiting: Math.round(r.waiting),
          rooms: Object.fromEntries(Object.entries(r.rooms).map(([k, v]) => [k, Math.round(v)])),
          finished: r.finished,
          tokens: tokensOn(r.transcript, day),
          fileCount: files.length,
          files: privacy ? [] : files.slice(0, 12).map((p) => basename(p)),
          first: r.first, last: r.last || r.first,
        };
      })
      .sort((x, y) => y.working + y.waiting - (x.working + x.waiting));
    const total = (k) => agents.reduce((n, a) => n + a[k], 0);
    return { day, days: this.days().includes(day) ? this.days() : [day, ...this.days()],
      totals: { agents: agents.length, working: total("working"), waiting: total("waiting"), finished: total("finished"), files: total("fileCount"),
        tokens: total("tokens") },
      agents };
  }
}
