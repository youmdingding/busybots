// Icons picked for one conversation from the agent panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionPrefs, iconSet, ICON_COLOURS, cleanName } from "../src/icons.js";
import { materialize } from "./lib/materialize.mjs";
import { Watcher, loadConfig } from "../src/watcher.js";
import { validate } from "../src/settings.js";

test("every character comes in the same 12 colours; agents first, then the picks", () => {
  const { colours, characters } = iconSet();
  assert.equal(colours.length, 12);
  assert.deepEqual(colours, ICON_COLOURS);
  assert.ok(characters.filter((c) => c.group === "fun").length >= 16);
  assert.equal(characters[0].group, "agent");
  for (const c of characters) assert.equal(c.files.filter(Boolean).length, 12, c.key);
  const cat = characters.find((c) => c.key === "pick-cat");
  assert.equal(cat.label, "Cat");
  assert.equal(cat.files[3], "icons/pick-cat-03.png");
});

test("set / clear a session's icon; unknown icons are refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "icons-"));
  try {
    const ic = new SessionPrefs(join(dir, "sessions.json"));
    ic.setIcon("sess-1", "icons/pick-cat-03.png");
    assert.deepEqual(ic.map(), { "sess-1": { icon: "icons/pick-cat-03.png" } });
    assert.throws(() => ic.setIcon("sess-1", "../settings.json"), /Unknown icon/);
    assert.throws(() => ic.setIcon("sess-1", "icons/pick-nope-00.png"), /Unknown icon/);
    ic.setIcon("sess-1", null);
    assert.deepEqual(ic.map(), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the watcher shows the picked icon and name, keeping the defaults", () => {
  const spec = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "scenarios", "codex_tests.json"), "utf8"));
  const { home, procs, m } = materialize(spec);
  const saved = process.env.HOME;
  try {
    process.env.HOME = home;
    const ic = new SessionPrefs(join(home, "sessions.json"));
    const [settings] = validate({});
    const w = new Watcher({ config: loadConfig(), settings, attentionDir: join(home, "att"), prefs: ic, log: () => {} });
    const before = w.build(m.now).bots[0];
    ic.setIcon(before.id, "icons/pick-frog-05.png");
    ic.setName(before.id, "  Checkout   rewrite ");
    const after = w.build(m.now).bots[0];
    assert.equal(after.icon, "icons/pick-frog-05.png");
    assert.equal(after.iconDefault, before.icon);
    assert.equal(after.name, "Checkout rewrite");
    assert.equal(after.nameDefault, before.name);
    // privacy mode still hides a typed name, and the folder name behind it
    const [priv] = validate({ board: { privacy: true } });
    const hidden = new Watcher({ config: loadConfig(), settings: priv, attentionDir: join(home, "att"), prefs: ic, log: () => {} }).build(m.now).bots[0];
    assert.match(hidden.name, /^Codex \d+$/);
    assert.equal(hidden.nameDefault, undefined);
  } finally {
    process.env.HOME = saved;
    for (const p of Object.values(procs)) p.kill();
    rmSync(home, { recursive: true, force: true });
  }
});

test("names: trimmed, no control characters, not empty, at most 40 characters", () => {
  assert.equal(cleanName("  Fix \n login  bug "), "Fix login bug");
  assert.throws(() => cleanName("   "), /empty/);
  assert.throws(() => cleanName("x".repeat(41)), /longer/);
  assert.equal(cleanName("é".repeat(40)).length, 40);
});

test("icons picked with 0.2/0.3 (icons.json) are still read until the first save", () => {
  const dir = mkdtempSync(join(tmpdir(), "prefs-"));
  try {
    writeFileSync(join(dir, "icons.json"), JSON.stringify({ s1: { icon: "icons/pick-owl-01.png", at: Date.now() } }));
    const p = new SessionPrefs(join(dir, "sessions.json"));
    assert.deepEqual(p.map(), { s1: { icon: "icons/pick-owl-01.png" } });
    p.setName("s1", "Owl");
    assert.deepEqual(new SessionPrefs(join(dir, "sessions.json")).map(), { s1: { icon: "icons/pick-owl-01.png", name: "Owl" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
