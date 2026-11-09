// Detecting how agents are set up (plugins, skills, commands, frameworks) and placing them in rooms.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSetup, autoRules, guessArea, frontMatter, projectFrameworks } from "../src/setup.js";
import { makeRules, areaForSkill } from "../src/classify.js";
import { setupReport } from "../src/server.js";

const root = mkdtempSync(join(tmpdir(), "busybots-setup-"));
const w = (p, text) => { mkdirSync(join(root, p, ".."), { recursive: true }); writeFileSync(join(root, p), text); };
const md = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\nBody`;

// Claude Code home: one enabled plugin (Superpowers-like), one disabled, personal skills/commands/agents
const claude = join(root, ".claude");
w(".claude/plugins/installed_plugins.json", JSON.stringify({ plugins: {
  "superpowers@market": [{ installPath: join(claude, "plugins/cache/market/superpowers/4.0.1") }],
  "noisy@market": [{ installPath: join(claude, "plugins/cache/market/noisy/1.0.0") }] } }));
w(".claude/settings.json", JSON.stringify({ enabledPlugins: { "superpowers@market": true, "noisy@market": false } }));
for (const [n, d] of [["brainstorming", "Turn ideas into designs"], ["writing-plans", "Write an implementation plan"], ["executing-plans", "Execute a plan"]]) {
  w(`.claude/plugins/cache/market/superpowers/4.0.1/skills/${n}/SKILL.md`, md(n, d));
}
w(".claude/plugins/cache/market/superpowers/4.0.1/.claude-plugin/plugin.json", JSON.stringify({ name: "superpowers" }));
w(".claude/plugins/cache/market/noisy/1.0.0/skills/hidden/SKILL.md", md("hidden", "Review code"));
w(".claude/skills/ship-it/SKILL.md", md("ship-it", "Implement the feature and fix failing builds"));
w(".claude/skills/mystery/SKILL.md", md("mystery", "Does a thing"));
w(".claude/commands/qa/smoke.md", "---\ndescription: Run the smoke tests and verify the release\n---\n");
w(".claude/agents/researcher.md", md("researcher", "Research libraries and read documentation"));
// projects with framework footprints
w("work/shop/.specify/memory/constitution.md", "# rules");
w("work/shop/.claude/commands/speckit.tasks.md", "---\ndescription: Break the plan into tasks\n---\n");
w("work/web/.kiro/specs/cart/requirements.md", "# req");
w("work/api/.bmad-core/agents/pm.md", "# pm");
w("codex/prompts/review-pr.md", "---\ndescription: Review a pull request\n---\n");

const scan = scanSetup({ claudeHomes: [claude], projects: [join(root, "work/shop"), join(root, "work/web"), join(root, "work/api")],
  codexHomes: [join(root, "codex")] });

test("finds enabled plugins' skills, your skills, commands, agents and project commands", () => {
  const names = scan.items.map((i) => i.name).sort();
  assert.deepEqual(names, ["brainstorming", "executing-plans", "mystery", "qa:smoke", "researcher", "review-pr", "ship-it", "speckit.tasks", "writing-plans"]);
  assert.deepEqual(scan.plugins.map((p) => [p.name, p.enabled]).sort(), [["noisy", false], ["superpowers", true]]);
  assert.equal(scan.items.find((i) => i.name === "speckit.tasks").source, "project:shop");
  assert.equal(scan.items.find((i) => i.name === "review-pr").source, "codex");
});

test("spots frameworks from files and from skill names", () => {
  const f = Object.fromEntries(scan.frameworks.map((x) => [x.id, x.projects]));
  assert.deepEqual(f.speckit, ["shop"]);
  assert.deepEqual(f.kiro, ["web"]);
  assert.deepEqual(f.bmad, ["api"]);
  assert.ok(f.superpowers);
  assert.deepEqual(projectFrameworks(join(root, "work")), []);
});

test("places skills by name and description; leaves unclear ones alone", () => {
  assert.equal(guessArea("ship-it", "Implement the feature and fix failing builds"), "build");
  assert.equal(guessArea("qa:smoke", "Run the smoke tests and verify the release"), "review");
  assert.equal(guessArea("researcher", "Research libraries and read documentation"), "explore");
  assert.equal(guessArea("mystery", "Does a thing"), null);
  const auto = autoRules(scan);
  assert.equal(auto.skillAreas["ship-it"], "build");
  assert.equal(auto.skillAreas["speckit.tasks"], "plan");   // Spec Kit profile
  assert.equal(auto.skillAreas.pm, "specs");                // BMAD profile
  assert.equal(auto.why["speckit.tasks"], "Spec Kit");
  assert.ok(auto.specFiles.includes("requirements.md") && auto.planFiles.includes("research.md"));
  assert.ok(!("mystery" in auto.skillAreas));
});

test("your rules and config.json beat what's detected; detected beats built-in defaults", () => {
  const auto = { skillAreas: { "ship-it": "build", design: "specs", "writing-plans": "build" } };
  const rules = makeRules({ skillAreas: { "writing-plans": "plan" } }, { skillAreas: { "ship-it": "review" } }, auto);
  assert.equal(areaForSkill("ship-it", rules), "review");       // yours
  assert.equal(areaForSkill("writing-plans", rules), "plan");   // config.json
  assert.equal(areaForSkill("design", rules), "specs");         // detected over the default (plan)
  assert.equal(areaForSkill("design", makeRules({}, {}, null)), "plan");
});

test("Settings report: room and where it came from; off switch", () => {
  const det = { at: 1, scan, auto: autoRules(scan) };
  const s = { rules: { skillAreas: { "ship-it": "review" }, autoDetect: true } };
  const cfg = { skillAreas: { brainstorming: "specs" } };
  const by = Object.fromEntries(setupReport(det, s, cfg).items.map((i) => [i.name, [i.area, i.from]]));
  assert.deepEqual(by["ship-it"], ["review", "yours"]);
  assert.deepEqual(by.brainstorming, ["specs", "config"]);
  assert.deepEqual(by["speckit.tasks"], ["plan", "profile:Spec Kit"]);
  assert.deepEqual(by.researcher, ["explore", "keywords"]);
  assert.deepEqual(by.mystery, [null, "none"]);
  const off = Object.fromEntries(setupReport(det, { rules: { skillAreas: {}, autoDetect: false } }, {}).items.map((i) => [i.name, i.from]));
  assert.equal(off["ship-it"], "none");          // only keywords placed it
  assert.notEqual(off.researcher, "keywords");
  assert.equal(off["writing-plans"], "name"); // still placed by the name fragment "plan"
});

test("front matter parsing", () => {
  assert.deepEqual(frontMatter('---\nname: "x"\ndescription: does y\n---\n'), { name: "x", description: "does y" });
  assert.deepEqual(frontMatter("no front matter"), {});
  rmSync(root, { recursive: true, force: true });
});
