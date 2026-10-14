// The agent panel spells out the badges on an agent: "needs you" (and why), done, stuck.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = mkdtempSync(join(tmpdir(), "busybots-att-"));
process.env.BUSYBOTS_STATE = state;
const { createBoardServer } = await import("../src/server.js");
const S = await import("../src/settings.js");

const bots = [
  { id: "ses_needs00000000000", name: "web", state: "active", zone: "build", cwd: "/tmp/x",
    attention: { needsYou: true, reason: "Approve: Run migrations", done: false, stuck: false, errors: 0 } },
  { id: "ses_done000000000000", name: "shop", state: "idle", zone: "idle",
    attention: { needsYou: false, reason: null, done: true, doneAt: 1760000000, stuck: false, errors: 0 } },
];

async function withServer(fn) {
  const port = await new Promise((ok) => { const t = http.createServer().listen(0, "127.0.0.1", () => { const p = t.address().port; t.close(() => ok(p)); }); });
  const srv = createBoardServer({ port, getStatus: () => ({ bots }), token: "t".repeat(32), log: () => {} });
  await new Promise((ok) => srv.listen(port, "127.0.0.1", ok));
  const get = (path) => new Promise((ok, bad) => {
    http.get({ host: "127.0.0.1", port, path, headers: { Host: `127.0.0.1:${port}` } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => ok({ status: res.statusCode, json: JSON.parse(body) }));
    }).on("error", bad);
  });
  try { await fn(get); } finally { srv.close(); }
}

test("session API carries the agent's badges", async () => {
  await withServer(async (get) => {
    const a = (await get("/api/session/ses_needs00000000000")).json.session.attention;
    assert.equal(a.needsYou, true);
    assert.equal(a.reason, "Approve: Run migrations");
    const d = (await get("/api/session/ses_done000000000000")).json.session.attention;
    assert.equal(d.done, true);
    assert.equal(d.doneAt, 1760000000);
    const none = (await get("/api/session/ses_unknown000000000")).json.session;
    assert.equal(none.attention, undefined);
  });
});

test("privacy mode still shows the badges (the watcher has already made the reason generic)", async () => {
  const s = S.load();
  s.board.privacy = true;
  S.save(s);
  try {
    await withServer(async (get) => {
      const r = (await get("/api/session/ses_done000000000000")).json;
      assert.equal(r.session.privacy, true);
      assert.equal(r.session.attention.done, true);
    });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});
