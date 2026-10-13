// Privacy mode: nothing that names a project or quotes an agent leaves the watcher.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { materialize } from "./lib/materialize.mjs";
import { Watcher, loadConfig } from "../src/watcher.js";
import { validate } from "../src/settings.js";

const SCEN = join(dirname(fileURLToPath(import.meta.url)), "scenarios");
const load = (n) => JSON.parse(readFileSync(join(SCEN, `${n}.json`), "utf8"));

function run(names, privacy) {
  const specs = names.map(load);
  const spec = { files: specs.flatMap((s) => s.files || []), procs: [...new Set(specs.flatMap((s) => s.procs || []))] };
  const { home, procs, m } = materialize(spec);
  const saved = process.env.HOME;
  try {
    process.env.HOME = home;
    const [settings] = validate({ board: { privacy, showIdleBubbles: true } });
    const w = new Watcher({ config: loadConfig(), settings, attentionDir: join(home, "attention"), log: () => {} });
    return { status: w.build(m.now), home };
  } finally {
    process.env.HOME = saved;
    for (const p of Object.values(procs)) p.kill();
    rmSync(home, { recursive: true, force: true });
  }
}

test("privacy mode hides names, paths, file names and agent text", () => {
  const scen = ["claude_perm", "codex_tests", "gemini_live"];
  const open = run(scen, false).status;
  const { status, home } = run(scen, true);
  assert.equal(status.bots.length, open.bots.length);
  const text = JSON.stringify(status.bots);
  assert.ok(!text.includes(home), "no home path");
  for (const b of open.bots) {
    assert.ok(!text.includes(`"${b.name}"`), `no folder name ${b.name}`);
    if (b.bubble && b.bubble.length > 12) assert.ok(!text.includes(b.bubble), `no bubble "${b.bubble}"`);
  }
  for (const b of status.bots) {
    assert.match(b.name, /^(Claude|Codex|Gemini|OpenCode|Cursor|Conductor|Agent) \d+$/);
    assert.equal(b.cwd, null);
    assert.equal(b.skill, null);
  }
  const perm = status.bots.find((b) => b.attention.needsYou);
  assert.ok(perm, "needs-you badge kept");
  assert.equal(perm.bubble, "Needs you");
  assert.equal(perm.attention.reason, "Needs you");
});
