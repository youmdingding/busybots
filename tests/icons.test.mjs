// Icons picked for one conversation from the agent panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { IconChoices, iconChoices } from "../src/icons.js";
import { materialize } from "./lib/materialize.mjs";
import { Watcher, loadConfig } from "../src/watcher.js";
import { validate } from "../src/settings.js";

test("the choice list has the fun set first, then every agent icon", () => {
  const list = iconChoices();
  assert.ok(list.length >= 16 + 6);
  assert.equal(list[0].group, "fun");
  assert.ok(list.some((c) => c.id === "icons/pick-robot.png" && c.label === "Robot"));
  assert.ok(list.some((c) => c.id === "icons/claude-00.png" && c.group === "agent"));
});

test("set / clear a session's icon; unknown icons are refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "icons-"));
  try {
    const ic = new IconChoices(join(dir, "icons.json"));
    ic.set("sess-1", "icons/pick-cat.png");
    assert.deepEqual(ic.map(), { "sess-1": "icons/pick-cat.png" });
    assert.throws(() => ic.set("sess-1", "../settings.json"), /Unknown icon/);
    assert.throws(() => ic.set("sess-1", "icons/pick-nope.png"), /Unknown icon/);
    ic.set("sess-1", null);
    assert.deepEqual(ic.map(), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the watcher shows the picked icon and keeps the agent's own as iconDefault", () => {
  const spec = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "scenarios", "codex_tests.json"), "utf8"));
  const { home, procs, m } = materialize(spec);
  const saved = process.env.HOME;
  try {
    process.env.HOME = home;
    const ic = new IconChoices(join(home, "icons.json"));
    const [settings] = validate({});
    const w = new Watcher({ config: loadConfig(), settings, attentionDir: join(home, "att"), icons: ic, log: () => {} });
    const before = w.build(m.now).bots[0];
    ic.set(before.id, "icons/pick-frog.png");
    const after = w.build(m.now).bots[0];
    assert.equal(after.icon, "icons/pick-frog.png");
    assert.equal(after.iconDefault, before.icon);
  } finally {
    process.env.HOME = saved;
    for (const p of Object.values(procs)) p.kill();
    rmSync(home, { recursive: true, force: true });
  }
});
