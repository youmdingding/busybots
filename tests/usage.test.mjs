// Token counts from transcripts: once per message, sub-agents included, by day, incremental.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileUsage, claudeSessionUsage, summarize, totalOf, localDay } from "../src/usage.js";

const dir = mkdtempSync(join(tmpdir(), "busybots-usage-"));
const iso = (d) => d.toISOString();
const today = new Date(); today.setHours(12, 0, 0, 0);
const yesterday = new Date(today.getTime() - 86400000);
const reply = (id, ts, u, rid = "r1") => JSON.stringify({ type: "assistant", requestId: rid, timestamp: iso(ts),
  message: { id, usage: { input_tokens: u[0], cache_creation_input_tokens: u[1], cache_read_input_tokens: u[2], output_tokens: u[3] }, content: [] } });

test("Claude Code: each reply counted once, split by day, sub-agents added", () => {
  const p = join(dir, "s1.jsonl");
  writeFileSync(p, [
    reply("m1", yesterday, [100, 1000, 0, 50]),
    reply("m2", today, [10, 0, 5000, 200]),
    reply("m2", today, [10, 0, 5000, 200]),       // same message, next content block
    JSON.stringify({ type: "user", timestamp: iso(today), message: { content: "hi" } }),
    "not json",
  ].join("\n") + "\n");
  mkdirSync(join(dir, "s1", "subagents"), { recursive: true });
  writeFileSync(join(dir, "s1", "subagents", "agent-a.jsonl"), reply("m9", today, [1, 2, 3, 4]) + "\n");
  const u = claudeSessionUsage(p);
  assert.equal(totalOf(u.total), 1150 + 5210 + 10);
  const s = summarize(u);
  assert.equal(s.today, 5210 + 10);
  assert.deepEqual(u.byDay[localDay(yesterday.getTime())], { input: 100, cacheWrite: 1000, cacheRead: 0, output: 50 });
});

test("reads only what was added; a half-written last line waits for the next read", () => {
  const p = join(dir, "s2.jsonl");
  writeFileSync(p, reply("a", today, [1, 0, 0, 1]) + "\n");
  assert.equal(totalOf(fileUsage(p).total), 2);
  const next = reply("b", today, [2, 0, 0, 2]);
  appendFileSync(p, next.slice(0, 20));
  assert.equal(totalOf(fileUsage(p).total), 2);
  appendFileSync(p, next.slice(20) + "\n");
  assert.equal(totalOf(fileUsage(p).total), 6);
  writeFileSync(p, reply("c", today, [5, 0, 0, 0]) + "\n"); // file replaced (smaller): start over
  assert.equal(totalOf(fileUsage(p).total), 5);
  assert.equal(fileUsage(join(dir, "missing.jsonl")), null);
});

test("Codex: running totals become per-day amounts", () => {
  const p = join(dir, "rollout.jsonl");
  const tc = (ts, inp, cached, out) => JSON.stringify({ timestamp: iso(ts), type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: { input_tokens: inp, cached_input_tokens: cached, output_tokens: out } } } });
  writeFileSync(p, [tc(yesterday, 1000, 400, 100), tc(today, 1500, 600, 180)].join("\n") + "\n");
  const u = fileUsage(p, "codex");
  assert.deepEqual(u.total, { input: 900, cacheWrite: 0, cacheRead: 600, output: 180 });
  // today: 300 new input + 200 more cached + 80 more output
  assert.deepEqual(u.byDay[localDay(today.getTime())], { input: 300, cacheWrite: 0, cacheRead: 200, output: 80 });
  rmSync(dir, { recursive: true, force: true });
});
