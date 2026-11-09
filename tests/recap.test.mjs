// Daily recap: time per room, waiting for you, finishes, files; saved per day.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recap, dayKey } from "../src/recap.js";

const tmp = () => mkdtempSync(join(tmpdir(), "busybots-recap-"));
const bot = (id, zone, state = "active", attention = {}, extra = {}) =>
  ({ id, name: id, brand: "claude", cwd: `/work/${id}`, zone, state, attention: { needsYou: false, done: false, ...attention }, ...extra });
const noon = new Date(2026, 9, 27, 12, 0, 0).getTime();

test("counts time per room, waiting for you and finishes", () => {
  const dir = tmp();
  const r = new Recap({ dir, log: () => {} });
  let t = noon;
  const pass = (bots, edits) => { r.update({ bots }, edits, t); t += 2000; };
  pass([bot("web", "plan")]);                       // first pass: nothing to count yet
  for (let i = 0; i < 5; i++) pass([bot("web", "plan")]);
  for (let i = 0; i < 3; i++) pass([bot("web", "build")]);
  for (let i = 0; i < 2; i++) pass([bot("web", "build", "active", { needsYou: true })]);
  pass([bot("web", "idle", "idle")]);
  pass([bot("web", "idle", "idle", { done: true })]);
  const s = r.summary(dayKey(noon));
  const a = s.agents[0];
  assert.equal(a.name, "web");
  assert.equal(a.project, "web");
  assert.deepEqual(a.rooms, { plan: 10, build: 6 });
  assert.equal(a.working, 16);
  assert.equal(a.waiting, 4);
  assert.equal(a.finished, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("long gaps don't count, files from earlier days are skipped, it survives a restart", () => {
  const dir = tmp();
  const r = new Recap({ dir, log: () => {} });
  const today = noon / 1000, yesterday = today - 86400;
  const edits = new Map([["web", [["/work/web/app.ts", today - 60], ["/work/web/old.ts", yesterday], ["/work/web/b.ts", today - 30]]]]);
  r.update({ bots: [bot("web", "build")] }, edits, noon);
  r.update({ bots: [bot("web", "build")] }, edits, noon + 3600_000); // laptop asleep for an hour
  r.flush(true, noon + 3600_000);
  const again = new Recap({ dir, log: () => {} }).summary(dayKey(noon));
  assert.equal(again.agents[0].working, 10);
  assert.deepEqual(again.agents[0].files, ["b.ts", "app.ts"]);
  assert.equal(again.agents[0].fileCount, 2);
  rmSync(dir, { recursive: true, force: true });
});

test("privacy mode: generic names, no projects or files", () => {
  const dir = tmp();
  const r = new Recap({ dir, log: () => {} });
  const edits = new Map([["web", [["/secret/plan.md", noon / 1000]]]]);
  r.update({ bots: [bot("web", "plan"), bot("api", "build", "active", {}, { brand: "codex" })] }, edits, noon);
  r.update({ bots: [bot("web", "plan"), bot("api", "build", "active", {}, { brand: "codex" })] }, edits, noon + 2000);
  const s = r.summary(dayKey(noon), { privacy: true });
  assert.deepEqual(s.agents.map((a) => a.name).sort(), ["Claude 1", "Codex 1"]);
  assert.ok(s.agents.every((a) => a.project === null && a.files.length === 0));
  assert.equal(s.agents.find((a) => a.name === "Claude 1").fileCount, 1);
  assert.throws(() => r.summary("../etc"), /Invalid day/);
  rmSync(dir, { recursive: true, force: true });
});

test("a new day starts a new file; days older than 30 are removed", () => {
  const dir = tmp();
  writeFileSync(join(dir, "2026-08-01.json"), "{}");
  writeFileSync(join(dir, "2026-10-20.json"), JSON.stringify({ version: 1, day: "2026-10-20", sessions: {} }));
  const r = new Recap({ dir, log: () => {} });
  const lateNight = new Date(2026, 9, 27, 23, 59, 58).getTime();
  r.update({ bots: [bot("web", "build")] }, new Map(), lateNight);
  r.update({ bots: [bot("web", "build")] }, new Map(), lateNight + 4000); // past midnight
  r.flush(true, lateNight + 4000);
  assert.ok(existsSync(join(dir, "2026-10-27.json")));
  assert.ok(existsSync(join(dir, "2026-10-28.json")));
  assert.ok(!existsSync(join(dir, "2026-08-01.json")));
  assert.deepEqual(r.days().slice(0, 3), ["2026-10-28", "2026-10-27", "2026-10-20"]);
  rmSync(dir, { recursive: true, force: true });
});
