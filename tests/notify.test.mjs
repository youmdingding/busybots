// Server notifications: only on changes, only when no board is open, never a flood.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Notifier, desktopNotify, BOARD_IDLE_MS } from "../src/notify.js";
import * as S from "../src/settings.js";

const prefs = { needsYou: true, done: true, sound: false, whenClosed: true };
const st = (...bots) => ({ bots });
const bot = (id, a = {}) => ({ id, name: id, attention: { needsYou: false, done: false, ...a } });

test("notifies on the change, not for what was already there", () => {
  const sent = [];
  const n = new Notifier({ send: (t, b) => sent.push([t, b]) });
  const now = 1_000_000;
  n.update(st(bot("web", { needsYou: true })), prefs, 0, now);           // first look: just remember
  assert.equal(sent.length, 0);
  n.update(st(bot("web", { needsYou: true }), bot("api")), prefs, 0, now);
  assert.equal(sent.length, 0);                                          // nothing changed
  n.update(st(bot("web", { needsYou: true }), bot("api", { needsYou: true, reason: "Approve: Run tests" })), prefs, 0, now);
  assert.deepEqual(sent.at(-1), ["api needs you", "Approve: Run tests"]);
  n.update(st(bot("web", { done: true }), bot("api", { needsYou: true })), prefs, 0, now);
  assert.deepEqual(sent.at(-1), ["web is done", "Finished and changed files."]);
});

test("quiet while a board is open, when turned off, or for unwanted kinds", () => {
  const sent = [];
  const n = new Notifier({ send: (t) => sent.push(t) });
  const now = 1_000_000;
  n.update(st(bot("a"), bot("b")), prefs, 0, now);
  n.update(st(bot("a", { needsYou: true }), bot("b")), prefs, now - 2000, now);   // board open
  n.update(st(bot("a"), bot("b", { needsYou: true })), { ...prefs, whenClosed: false }, 0, now);
  n.update(st(bot("a", { done: true }), bot("b", { needsYou: true })), { ...prefs, done: false }, now - BOARD_IDLE_MS - 1, now);
  assert.deepEqual(sent, []);
});

test("at most three at once", () => {
  const sent = [];
  const n = new Notifier({ send: (t) => sent.push(t) });
  const ids = ["a", "b", "c", "d", "e"];
  n.update(st(...ids.map((i) => bot(i))), prefs, 0, 1);
  n.update(st(...ids.map((i) => bot(i, { needsYou: true }))), prefs, 0, 1);
  assert.equal(sent.length, 3);
});

test("desktopNotify passes text as arguments, never inside the script", () => {
  const calls = [];
  const run = (cmd, args) => { calls.push([cmd, args]); return { on() { return this; }, unref() {} }; };
  assert.equal(desktopNotify('web "needs" you', "rm -rf / `x`", { platform: "darwin", run }), true);
  const [cmd, args] = calls[0];
  assert.equal(cmd, "osascript");
  assert.ok(!args.slice(0, -2).some((a) => a.includes("needs") || a.includes("rm -rf")));
  assert.deepEqual(args.slice(-2), ['web "needs" you', "rm -rf / `x`"]);
  assert.equal(desktopNotify("t", "b", { platform: "win32", run }), false);
});

test("settings: notification defaults and cleanup", () => {
  const [s] = S.validate({ board: { notify: { needsYou: false, sound: "yes", whenClosed: 1, junk: true } } });
  assert.deepEqual(s.board.notify, { needsYou: false, done: true, sound: true, whenClosed: true });
  assert.deepEqual(S.validate({})[0].board.notify, { needsYou: true, done: true, sound: false, whenClosed: false });
});
