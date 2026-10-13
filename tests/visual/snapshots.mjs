// Pixel snapshots of the board, for refactors that must not change what it draws.
//
//   node tests/visual/snapshots.mjs record <dir>     # render and save PNG + hashes
//   node tests/visual/snapshots.mjs compare <dir>    # render again, fail on any pixel change
//
// Needs Playwright with Chromium (dev only, not a dependency): set PLAYWRIGHT_MODULE to its
// path if it isn't resolvable. The clock is frozen, Math.random seeded and the status fixed
// (tests/visual/status.json), so the same code draws the same pixels.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [mode, outDir] = process.argv.slice(2);
if (!["record", "compare"].includes(mode) || !outDir) {
  console.error("usage: snapshots.mjs record|compare <dir>");
  process.exit(2);
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
import { createServer } from "node:net";
// A free port, so a server left over from an interrupted run can't get in the way
const PORT = await new Promise((ok) => { const t = createServer(); t.listen(0, "127.0.0.1", () => { const p = t.address().port; t.close(() => ok(p)); }); });
const status = readFileSync(join(ROOT, "tests/visual/status.json"), "utf8");
const home = join(tmpdir(), `board-visual-${process.pid}`);
mkdirSync(home, { recursive: true });
const srv = spawn(process.execPath, ["bin/cli.js", "serve", "--port", String(PORT)], {
  cwd: ROOT, stdio: "ignore", env: { ...process.env, HOME: home, BUSYBOTS_STATE: join(home, "state") },
});
const stopServer = () => { try { srv.kill(); } catch { /* gone */ } };
process.on("exit", stopServer);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopServer(); process.exit(1); });
await new Promise((r) => setTimeout(r, 1200));

const SEED = `(() => { let a = 0x9e3779b9; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const shots = [];
for (const theme of ["island", "office", "city", "space"]) shots.push({ name: theme, url: `/?debug=1&theme=${theme}` });
shots.push({ name: "island-filter-codex", url: "/?debug=1&theme=island", filter: "codex" });
shots.push({ name: "office-panel", url: "/?debug=1&theme=office", panel: true });

const browser = await chromium.launch(existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {});
// Warm-up: the first load after the server starts can resolve its requests in a different
// order (seat assignment then differs); load the board once and throw it away.
{
  const warm = await browser.newPage();
  await warm.route(/\/status\.json/, (r) => r.fulfill({ contentType: "application/json", body: status }));
  await warm.goto(`http://127.0.0.1:${PORT}/?theme=island`);
  await warm.waitForLoadState("networkidle");
  await warm.close();
}
const results = {};
let failed = 0;
mkdirSync(outDir, { recursive: true });
const prev = mode === "compare" ? JSON.parse(readFileSync(join(outDir, "hashes.json"), "utf8")) : null;
async function shoot(s) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(SEED);
  await page.clock.install({ time: new Date("2026-10-12T09:00:00+13:00") });
  await page.clock.pauseAt(new Date("2026-10-12T09:00:01+13:00")); // only runFor() moves time
  await page.route(/\/status\.json/, (r) => r.fulfill({ contentType: "application/json", body: status }));
  await page.route(/\/api\/session\//, (r) => r.fulfill({ contentType: "application/json",
    body: JSON.stringify({ ok: true, session: { id: "x", name: "api-gateway", origin: "terminal", livePid: 1, promptAllowed: false, promptDisabledReason: "Open in its window to reply", jump: { kind: "terminal" } },
      transcript: [{ kind: "user", text: "Add rate limiting", ts: null }, { kind: "tool", text: "Edit · server.ts", ts: null }, { kind: "assistant", text: "Added a token bucket.", ts: null }] }) }));
  await page.goto(`http://127.0.0.1:${PORT}${s.url}`);
  // Real time: wait until the board has applied the status and every image has loaded
  await page.waitForFunction(() => /2026/.test(document.getElementById("updated-at")?.textContent || ""), null, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await page.clock.runFor(4000);                // fake time: bots walk to their rooms
  if (s.filter) {
    await page.click(`[data-agent="${s.filter}"], button:has-text("${s.filter}")`).catch(() => {});
    await page.clock.runFor(1500);
  }
  if (s.panel) {
    await page.evaluate(() => window.__boardDebug.openFirstClaude());
    await page.waitForTimeout(500);
    await page.clock.runFor(1500);
  }
  await page.clock.runFor(200);
  await page.addStyleTag({ content: "#poll-dot { visibility: hidden !important; }" }); // flashes on real-time polls
  const png = await page.screenshot({ fullPage: true, animations: "disabled" });
  const canvas = await page.evaluate(() => document.getElementById("board").toDataURL("image/png"));
  const frameErrors = await page.evaluate(() => window.__boardDebug?.frameErrors?.() ?? -1);
  const hash = createHash("sha256").update(canvas).digest("hex").slice(0, 16);
  let tag = "";
  if (mode === "compare") {
    // Canvas: must be identical. Page around it: a few anti-aliasing pixels may flicker.
    const oldPng = readFileSync(join(outDir, `${s.name}.png`)).toString("base64");
    const diff = await page.evaluate(async ([a, b]) => {
      const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return -1;
      const px = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const x = c.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
      const da = px(ia), db = px(ib);
      let n = 0;
      for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) n++;
      return n;
    }, [`data:image/png;base64,${oldPng}`, `data:image/png;base64,${png.toString("base64")}`]);
    const canvasSame = prev[s.name] === hash;
    tag = canvasSame && diff >= 0 && diff <= 8 ? "same" : `CHANGED (canvas ${canvasSame ? "same" : "differs"}, page pixels ${diff})`;
  }
  await page.close();
  return { hash, png, tag, errors, frameErrors };
}
for (const s of shots) {
  // A rare first-frames ordering flake can move one sprite; a real change fails twice.
  let r = await shoot(s);
  if (mode === "compare" && r.tag.startsWith("CHANGED")) r = await shoot(s);
  results[s.name] = r.hash;
  if (r.tag.startsWith("CHANGED") || r.errors.length || r.frameErrors !== 0) failed++;
  writeFileSync(join(outDir, `${s.name}${mode === "compare" ? ".new" : ""}.png`), r.png);
  console.log(`${s.name.padEnd(22)} ${r.hash} ${r.tag} frameErrors=${r.frameErrors}${r.errors.length ? " errors: " + r.errors.join("; ") : ""}`);
}
await browser.close();
srv.kill();
if (mode === "record") writeFileSync(join(outDir, "hashes.json"), JSON.stringify(results, null, 1));
process.exit(failed ? 1 : 0);
