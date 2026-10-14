// Black-box contract tests for the board server (HTTP only, no internals).
//
//   node --test tests/server.contract.test.mjs
//
// By default this starts the Node server (bin/cli.js serve). To check another
// implementation, set BOARD_SERVER_CMD (a shell command) and BOARD_URL, e.g.
//   BOARD_SERVER_CMD="node bin/cli.js serve --port 8800" BOARD_URL=http://127.0.0.1:8800 node --test tests/server.contract.test.mjs
// The command gets BUSYBOTS_SETTINGS / BUSYBOTS_STATE pointing at a temp folder.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.BOARD_TEST_PORT || 18765);
const URL_BASE = process.env.BOARD_URL || `http://127.0.0.1:${PORT}`;
const CMD = process.env.BOARD_SERVER_CMD;
const tmp = mkdtempSync(join(tmpdir(), "board-contract-"));
const settingsPath = join(tmp, "settings.json");
let server;

/** Raw request so we can send any Host / Origin header (fetch forbids Host). */
function req(method, path, { headers = {}, body } = {}) {
  const u = new URL(URL_BASE);
  const payload = body === undefined ? undefined : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const extra = payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {};
  return new Promise((resolve, reject) => {
    const r = http.request({ host: u.hostname, port: u.port, method, path, headers: { Host: u.host, ...extra, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function token() {
  return (await req("GET", "/api/token")).json.token;
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { if ((await req("GET", "/")).status) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not start: ${CMD || "bin/cli.js serve"}`);
}

before(async () => {
  const env = { ...process.env, BUSYBOTS_SETTINGS: settingsPath, BUSYBOTS_STATE: tmp, HOME: tmp, USERPROFILE: tmp, LOCALAPPDATA: tmp };
  // Our own server: spawn node directly so killing it never leaves a stray process behind
  server = CMD
    ? spawn(CMD, { cwd: ROOT, shell: true, stdio: "ignore", env, detached: process.platform !== "win32" })
    : spawn(process.execPath, ["bin/cli.js", "serve", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore", env });
  await waitUp();
});

after(() => {
  if (CMD && process.platform !== "win32") {
    try { process.kill(-server.pid); } catch { /* already gone */ }
  }
  server.kill();
  rmSync(tmp, { recursive: true, force: true });
});

test("serves the board and the settings page", async () => {
  for (const p of ["/", "/index.html", "/board/main.js", "/board/state.js", "/style.css", "/admin", "/admin.html", "/admin.js", "/config.json", "/themes/city.json"]) {
    const r = await req("GET", p);
    assert.equal(r.status, 200, p);
  }
  assert.match((await req("GET", "/admin")).text, /Settings/);
});

test("never serves anything outside the board's own files", async () => {
  for (const p of ["/.board-api-token", "/settings.json", "/logs/serve.log", "/config.claude.json", "/status.claude.json", "/bin/cli.js",
    "/package.json", "/AGENTS.md", "/board.js", "/board/../package.json", "/web/index.html", "/src/server.js", "/%2e%2e/etc/passwd", "/themes/../.board-api-token", "/.git/config"]) {
    const r = await req("GET", p);
    assert.equal(r.status, 404, p);
  }
});

test("rejects other hosts and cross-site origins", async () => {
  assert.equal((await req("GET", "/api/token", { headers: { Host: "evil.example" } })).status, 403);
  assert.equal((await req("GET", "/api/token", { headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await req("GET", "/api/token")).status, 200);
});

test("settings: read defaults, refuse without token, save with token", async () => {
  const r = await req("GET", "/api/settings");
  assert.equal(r.status, 200);
  for (const k of ["claude", "codex", "gemini", "opencode", "cursor", "conductor"]) assert.ok(r.json.settings.sources[k], k);
  assert.ok(Array.isArray(r.json.agents) && r.json.agents.length >= 6);

  const s = r.json.settings;
  s.board.theme = "space";
  const noTok = await req("POST", "/api/settings", { body: { settings: s }, headers: { "Content-Type": "application/json" } });
  assert.equal(noTok.status, 401);

  const tok = await token();
  const ok = await req("POST", "/api/settings", { body: { settings: s }, headers: { "Content-Type": "application/json", "X-Board-Token": tok } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.settings.board.theme, "space");
  assert.ok(existsSync(settingsPath));
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).board.theme, "space");
  assert.equal((await req("GET", "/api/settings")).json.settings.board.theme, "space");
});

test("settings: invalid input is refused and nothing is written", async () => {
  const tok = await token();
  const before = readFileSync(settingsPath, "utf8");
  const s = (await req("GET", "/api/settings")).json.settings;
  s.sources.claude = { enabled: true, paths: [] };
  const r = await req("POST", "/api/settings", { body: { settings: s }, headers: { "X-Board-Token": tok } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /claude/);
  assert.equal(readFileSync(settingsPath, "utf8"), before);
  const big = await req("POST", "/api/settings", { body: "x".repeat(300_000), headers: { "X-Board-Token": tok } });
  assert.equal(big.status, 413);
});

test("settings check reports every source without saving", async () => {
  const tok = await token();
  const s = (await req("GET", "/api/settings")).json.settings;
  s.sources.codex.paths = ["/definitely/not/here"];
  const r = await req("POST", "/api/settings/check", { body: { settings: s }, headers: { "X-Board-Token": tok } });
  assert.equal(r.status, 200);
  for (const k of ["claude", "codex", "gemini", "opencode", "cursor", "conductor"]) assert.ok(Array.isArray(r.json.sources[k]), k);
  assert.equal(r.json.sources.codex[0].ok, null);            // optional agent not installed → neutral
  assert.match(r.json.sources.codex[0].message, /Not found/);
});

test("agent panel API validates ids", async () => {
  assert.ok([400, 404].includes((await req("GET", "/api/session/..%2f..%2fetc")).status));
  assert.equal((await req("GET", "/api/session/a.b")).status, 400);
  const r = await req("GET", "/api/session/ses_00ab12cd34ef56gh");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.transcript, []);
  const tok = await token();
  assert.equal((await req("POST", "/api/session/ses_00ab12cd34ef56gh/prompt", { body: { prompt: "" }, headers: { "X-Board-Token": tok } })).status, 400);
  assert.equal((await req("POST", "/api/session/ses_00ab12cd34ef56gh/nope", { body: {}, headers: { "X-Board-Token": tok } })).status, 404);
});

test("privacy mode: the agent panel API returns no transcript or paths", async () => {
  const tok = await token();
  const s = (await req("GET", "/api/settings")).json.settings;
  s.board.privacy = true;
  assert.equal((await req("POST", "/api/settings", { body: { settings: s }, headers: { "X-Board-Token": tok } })).status, 200);
  const r = await req("GET", "/api/session/ses_00ab12cd34ef56gh");
  assert.equal(r.status, 200);
  assert.equal(r.json.session.privacy, true);
  assert.deepEqual(r.json.transcript, []);
  assert.equal(r.json.session.cwd, undefined);
  s.board.privacy = false;
  await req("POST", "/api/settings", { body: { settings: s }, headers: { "X-Board-Token": tok } });
});

test("icon API: pick for a session, refuse unknown icons and missing token", async () => {
  const tok = await token();
  const url = "/api/session/ses_00ab12cd34ef56gh/icon";
  assert.equal((await req("POST", url, { body: { icon: "icons/pick-owl-02.png" } })).status, 401);
  assert.equal((await req("POST", url, { body: { icon: "icons/pick-owl-02.png" }, headers: { "X-Board-Token": tok } })).status, 200);
  assert.equal((await req("POST", url, { body: { icon: "../api-token" }, headers: { "X-Board-Token": tok } })).status, 400);
  assert.equal((await req("POST", url, { body: { icon: null }, headers: { "X-Board-Token": tok } })).status, 200);
  const r = await req("GET", "/api/session/ses_00ab12cd34ef56gh");
  assert.ok(r.json.iconSet.characters.length >= 22 && r.json.iconSet.colours.length === 12);
  assert.equal((await req("GET", "/icons/pick-owl-02.png")).status, 200);
});

test("name API: rename a session, refuse empty / too long names and missing token", async () => {
  const tok = await token();
  const url = "/api/session/ses_00ab12cd34ef56gh/name";
  assert.equal((await req("POST", url, { body: { name: "Checkout" } })).status, 401);
  const ok = await req("POST", url, { body: { name: "  Checkout  rewrite " }, headers: { "X-Board-Token": tok } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.name, "Checkout rewrite");
  assert.equal((await req("POST", url, { body: { name: "  " }, headers: { "X-Board-Token": tok } })).status, 400);
  assert.equal((await req("POST", url, { body: { name: "x".repeat(41) }, headers: { "X-Board-Token": tok } })).status, 400);
  assert.equal((await req("POST", url, { body: { name: null }, headers: { "X-Board-Token": tok } })).status, 200);
});
