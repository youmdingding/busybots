// The Claude Code Notification hook writes a marker the watcher turns into "needs you".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { notificationHook } from "../src/hook.js";

test("hook writes a marker for a valid session and ignores bad input", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hook-"));
  try {
    assert.equal(await notificationHook(Readable.from([JSON.stringify({ session_id: "s-1", message: "needs your permission" })]), dir), 0);
    assert.equal(JSON.parse(readFileSync(join(dir, "s-1.json"), "utf8")).message, "needs your permission");
    assert.equal(await notificationHook(Readable.from(["not json"]), dir), 0);
    assert.equal(await notificationHook(Readable.from([JSON.stringify({ session_id: "../escape" })]), dir), 0);
    assert.deepEqual(readdirSync(dir), ["s-1.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
