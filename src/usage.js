// Token usage per session, read from the agents' own transcripts (read-only):
//   Claude Code: message.usage on each assistant reply (counted once per message id; the
//                transcript repeats it for every content block), sub-agent transcripts included.
//   Codex CLI:   the running total in its token_count events.
// Files are read incrementally (they only grow), so asking every few seconds stays cheap.
import { openSync, readSync, closeSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CACHE = new Map(); // path → { size, mtime, offset, rest, seen, kind, total, byDay }
const MAX_CACHE = 400;

const zero = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
const add = (a, b) => { for (const k of Object.keys(a)) a[k] += b[k] || 0; return a; };
export const totalOf = (u) => (u ? u.input + u.cacheWrite + u.cacheRead + u.output : 0);

function localDay(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readFrom(path, offset, size) {
  const len = size - offset;
  if (len <= 0) return "";
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, offset);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function claudeLine(o, st) {
  if (o.type !== "assistant" || !o.message || !o.message.usage) return;
  const id = o.message.id ? `${o.message.id}:${o.requestId || ""}` : null;
  if (id) {
    if (st.seen.has(id)) return;
    st.seen.add(id);
  }
  const u = o.message.usage;
  const one = { input: Number(u.input_tokens) || 0, cacheWrite: Number(u.cache_creation_input_tokens) || 0,
    cacheRead: Number(u.cache_read_input_tokens) || 0, output: Number(u.output_tokens) || 0 };
  add(st.total, one);
  const ms = Date.parse(o.timestamp || "") || null;
  if (ms) {
    const day = localDay(ms);
    st.byDay[day] = add(st.byDay[day] || zero(), one);
  }
}

function codexLine(o, st) {
  const p = o && o.payload;
  if (!p || p.type !== "token_count" || !p.info || !p.info.total_token_usage) return;
  const t = p.info.total_token_usage;
  const now = { input: Math.max(0, (Number(t.input_tokens) || 0) - (Number(t.cached_input_tokens) || 0)), cacheWrite: 0,
    cacheRead: Number(t.cached_input_tokens) || 0, output: (Number(t.output_tokens) || 0) };
  // running total: the part since the previous event belongs to this event's day
  const delta = { input: Math.max(0, now.input - st.total.input), cacheWrite: 0,
    cacheRead: Math.max(0, now.cacheRead - st.total.cacheRead), output: Math.max(0, now.output - st.total.output) };
  st.total = now;
  const ms = Date.parse(o.timestamp || "") || null;
  if (ms) {
    const day = localDay(ms);
    st.byDay[day] = add(st.byDay[day] || zero(), delta);
  }
}

/** Usage of one transcript file: { total, byDay: { "YYYY-MM-DD": usage } } (null if unreadable). */
export function fileUsage(path, kind = "claude") {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return null;
  }
  let st = CACHE.get(path);
  if (!st || st.kind !== kind || stat.size < st.offset) {
    st = { kind, size: 0, mtime: 0, offset: 0, rest: "", seen: new Set(), total: zero(), byDay: {} };
    CACHE.set(path, st);
    if (CACHE.size > MAX_CACHE) CACHE.delete(CACHE.keys().next().value);
  }
  if (stat.size !== st.offset) {
    const text = st.rest + readFrom(path, st.offset, stat.size);
    st.offset = stat.size;
    const lines = text.split("\n");
    st.rest = lines.pop(); // a line still being written
    for (const line of lines) {
      if (!line.includes(kind === "codex" ? "token_count" : "usage")) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (kind === "codex") codexLine(o, st);
      else claudeLine(o, st);
    }
  }
  return { total: st.total, byDay: st.byDay };
}

/** Usage of a Claude Code session: its transcript plus its sub-agents' transcripts. */
export function claudeSessionUsage(jsonlPath) {
  const parts = [fileUsage(jsonlPath, "claude")];
  const subDir = join(jsonlPath.replace(/\.jsonl$/, ""), "subagents");
  try {
    for (const f of readdirSync(subDir)) if (f.endsWith(".jsonl")) parts.push(fileUsage(join(subDir, f), "claude"));
  } catch { /* no sub-agents */ }
  return merge(parts);
}

export function merge(parts) {
  const out = { total: zero(), byDay: {} };
  let any = false;
  for (const p of parts) {
    if (!p) continue;
    any = true;
    add(out.total, p.total);
    for (const [d, u] of Object.entries(p.byDay)) out.byDay[d] = add(out.byDay[d] || zero(), u);
  }
  return any ? out : null;
}

/** For the panel / recap: { session, today, sessionDetail, todayDetail } in tokens. */
export function summarize(u, day = localDay(Date.now())) {
  if (!u) return null;
  const today = u.byDay[day] || zero();
  return { session: totalOf(u.total), today: totalOf(today), sessionDetail: u.total, todayDetail: today };
}

export { localDay };
