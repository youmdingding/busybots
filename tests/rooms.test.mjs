// Your own room names, colours and which room each kind of work goes to (Settings → Rooms).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/settings.js";
import { applyRooms, loadConfig, Watcher } from "../src/watcher.js";
import { makeRules, zoneFor, WORK_KINDS } from "../src/classify.js";
import { FONT7, signText, glyphOn, textCols } from "../web/board/pixelfont.js";

test("settings: room names and colours are cleaned, bad ones dropped", () => {
  const [s] = S.validate({ rooms: {
    build: { label: "  Ship\nit  ", tint: "#E0703A" },
    review: { label: "x".repeat(60), tint: "red" },
    "../etc": { label: "nope" },
    plan: { label: "   " },
  }, rules: { workAreas: { tests: "build", code: "../x", Bad: "plan" } } });
  assert.deepEqual(s.rooms.build, { label: "Ship it", tint: "#e0703a" });
  assert.equal(s.rooms.review.label.length, S.MAX_ROOM_NAME);
  assert.equal(s.rooms.review.tint, undefined);
  assert.ok(!("../etc" in s.rooms) && !("plan" in s.rooms));
  assert.deepEqual(s.rules.workAreas, { tests: "build" });
  assert.deepEqual(S.validate({})[0].rooms, {});
});

test("config with your rooms: names, colours and what changed", () => {
  const cfg = applyRooms(loadConfig(), { rooms: { build: { label: "Ship it" }, plan: { tint: "#e0403a" }, specs: { label: "Specs" } } });
  const by = Object.fromEntries(cfg.areas.map((a) => [a.key, a]));
  assert.equal(by.build.label, "Ship it");
  assert.equal(by.build.renamed, true);
  assert.equal(by.build.labelDefault, "Build");
  assert.equal(by.plan.recoloured, true);
  assert.equal(by.plan.renamed, undefined);
  assert.equal(by.specs.renamed, undefined); // same as the default: nothing to repaint
});

test("kinds of work go to the room you pick; unknown rooms are ignored", () => {
  const cfg = loadConfig();
  const base = makeRules(cfg, {});
  assert.equal(zoneFor("Bash.test", base.activityAreas), "review");
  const r = makeRules(cfg, { workAreas: { tests: "build", reading: "plan", code: "nowhere" } });
  assert.equal(zoneFor("Bash.test", r.activityAreas), "build");
  assert.equal(zoneFor("lint", r.activityAreas), "build");
  assert.equal(zoneFor("Grep", r.activityAreas), "plan");
  assert.equal(zoneFor("Edit", r.activityAreas), "build"); // unchanged
  for (const k of WORK_KINDS) for (const key of k.keys) assert.ok(key in cfg.activityAreas, `${k.id}: ${key} not in config.json`);
});

test("the board's zones carry your names", () => {
  const settings = S.validate({ rooms: { idle: { label: "Lounge" } }, sources: Object.fromEntries(S.AGENT_TYPES.map((a) => [a.id, { enabled: false }])) })[0];
  const st = new Watcher({ settings, log: () => {} }).build();
  assert.equal(st.zones.find((z) => z.id === "idle").label, "Lounge");
});

test("sign font: the generators' letters, sign text and layout", () => {
  // Every letter the art generators paint must match, or old names wouldn't be recognised
  const src = readFileSync(new URL("../tools/city_props/interiors.py", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("FONT7 = {"), src.indexOf("}", src.indexOf("FONT7 = {")));
  const py = [...block.matchAll(/"(.)": \[([^\]]*)\]/g)].map((m) => [m[1], m[2].match(/"([01]+)"/g).map((x) => x.slice(1, -1))]);
  assert.ok(py.length >= 18);
  for (const [ch, rows] of py) if (rows.length === 7) assert.deepEqual(FONT7[ch], rows, `glyph ${ch}`); // (" " is ["00000"] * 7)
  for (const [k, g] of Object.entries(FONT7)) assert.ok(g.length === 7 && g.every((r) => /^[01]{5}$/.test(r)), k);
  assert.equal(signText("Réview  & QA ✓"), "REVIEW & QA");
  assert.equal(textCols("BUILD"), 29);
  assert.equal(glyphOn("I", 2, 3), true);
  assert.equal(glyphOn("I", 5, 3), false); // the gap column
});
