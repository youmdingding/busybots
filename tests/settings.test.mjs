// Settings: one-time move from the old location, and personal rules on top of config.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateLegacy, validate } from "../src/settings.js";
import { makeRules, areaForSkill, skillLabel } from "../src/classify.js";

test("migrateLegacy copies old settings once and keeps the old file", () => {
  const dir = mkdtempSync(join(tmpdir(), "settings-"));
  try {
    const from = join(dir, "old.json"), to = join(dir, "state", "settings.json");
    writeFileSync(from, JSON.stringify({ board: { theme: "city" }, rules: { skillAreas: { ship: "build" } } }));
    assert.equal(migrateLegacy(from, to), from);
    const saved = JSON.parse(readFileSync(to, "utf8"));
    assert.equal(saved.board.theme, "city");
    assert.deepEqual(saved.rules.skillAreas, { ship: "build" });
    assert.ok(existsSync(from));
    writeFileSync(from, JSON.stringify({ board: { theme: "space" } }));
    assert.equal(migrateLegacy(from, to), null); // never overwrites the new file
    assert.equal(JSON.parse(readFileSync(to, "utf8")).board.theme, "city");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("personal rules from settings extend and override config.json", () => {
  const config = { skillAreas: { "writing-plans": "plan" }, skillLabels: { "writing-plans": "Planning" } };
  const [s] = validate({ rules: { skillAreas: { "Quick-Ship": "build", "writing-plans": "specs" }, skillLabels: { "quick-ship": "Shipping" } } });
  const rules = makeRules(config, s.rules);
  assert.equal(areaForSkill("quick-ship", rules), "build");
  assert.equal(areaForSkill("myplugin:quick-ship", rules), "build");
  assert.equal(areaForSkill("writing-plans", rules), "specs");
  assert.equal(skillLabel("quick-ship", rules), "Shipping");
});
