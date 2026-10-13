// The shared watcher scenarios (tests/scenarios/*.json) against the Node watcher.
//
//   node --test tests/scenarios.test.mjs
//   SCENARIO=perm,ask node --test tests/scenarios.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { materialize } from "./lib/materialize.mjs";
import { Watcher, loadConfig } from "../src/watcher.js";
import { validate } from "../src/settings.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "scenarios");
const COMPARE = ["brand", "name", "zone", "state", "phase", "skill", "bubble"];
const ATT = ["needsYou", "reason", "done", "stuck", "subagents"];
const only = (process.env.SCENARIO || "").split(",").filter(Boolean);
for (const k of ["XDG_DATA_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "GEMINI_CLI_HOME"]) delete process.env[k];
const baseCfg = loadConfig();

function project(bot) {
  const out = Object.fromEntries(COMPARE.map((k) => [k, bot[k] ?? null]));
  out.attention = Object.fromEntries(ATT.map((k) => [k, bot.attention?.[k] ?? null]));
  return out;
}

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
  const name = file.replace(/\.json$/, "");
  if (only.length && !only.includes(name)) continue;
  test(name, () => {
    const spec = JSON.parse(readFileSync(join(DIR, file), "utf8"));
    const { home, procs, m } = materialize(spec);
    const savedHome = process.env.HOME;
    try {
      process.env.HOME = home;
      const [settings] = validate(m.deep(spec.settings || {}));
      const w = new Watcher({ config: { ...baseCfg, ...(spec.config || {}) }, settings, attentionDir: join(home, "attention"), log: () => {} });
      const got = w.build(m.now).bots.map(project)
        .sort((a, b) => cmp(a.brand || "", b.brand || "") || cmp(a.name || "", b.name || ""));
      assert.deepEqual(got, spec.expect);
    } finally {
      process.env.HOME = savedHome;
      for (const p of Object.values(procs)) p.kill();
      rmSync(home, { recursive: true, force: true });
    }
  });
}

// Python sorts by code point; localeCompare would not
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
