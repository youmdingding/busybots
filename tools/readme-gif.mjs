// Records docs/busybots.gif for the README: a short story with made-up agents, played on
// a frozen clock so every run gives the same frames.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tools/readme-gif.mjs [theme]
//
// Dev only: needs Playwright + Chromium and Python with Pillow (to assemble the GIF).
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const theme = process.argv[2] || "island";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");

// ---- the story: one status per beat (2 s apart, the board's poll interval) ----
const base = JSON.parse(readFileSync(join(ROOT, "tests/visual/status.json"), "utf8"));
const byName = (st, name) => st.bots.find((b) => b.name === name);
const beat = (prev, changes) => {
  const st = structuredClone(prev);
  for (const [name, patch] of Object.entries(changes)) Object.assign(byName(st, name), patch);
  return st;
};
const ok = { needsYou: false, reason: null, done: false, subagents: 0, stuck: false, errors: 0 };
const s0 = base;
const s1 = beat(s0, {
  web: { zone: "build", phase: "build", bubble: "Editing App.tsx" },
  analytics: { zone: "plan", phase: "plan", bubble: "Planning · Writing plan.md" },
});
const s2 = beat(s1, {
  "api-gateway": { zone: "review", phase: "test", bubble: "Running tests" },
  shop: { zone: "idle", state: "idle", bubble: null, attention: { ...ok, done: true } },
});
const s3 = beat(s2, {
  "mobile-app": { bubble: "Editing migrations.sql", attention: { ...ok } },
  infra: { zone: "build", phase: "build", bubble: "Editing main.tf" },
  web: { attention: { ...ok, needsYou: true, reason: "Approve: Run dev server" }, bubble: "Approve: Run dev server" },
});
const story = [s0, s1, s2, s3];

const PORT = await new Promise((ok_) => { const t = createServer(); t.listen(0, "127.0.0.1", () => { const p = t.address().port; t.close(() => ok_(p)); }); });
const home = mkdtempSync(join(tmpdir(), "busybots-gif-"));
const srv = spawn(process.execPath, ["bin/cli.js", "serve", "--port", String(PORT)], {
  cwd: ROOT, stdio: "ignore", env: { ...process.env, HOME: home, BUSYBOTS_STATE: join(home, "state") },
});
process.on("exit", () => { try { srv.kill(); } catch { /* gone */ } });
await new Promise((r) => setTimeout(r, 1200));

const browser = await chromium.launch(existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {});
const page = await browser.newPage({ viewport: { width: 1700, height: 1200 } });
let current = 0;
await page.clock.install({ time: new Date("2026-10-12T09:00:00+13:00") });
await page.clock.pauseAt(new Date("2026-10-12T09:00:01+13:00"));
await page.route(/\/status\.json/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(story[current]) }));
await page.goto(`http://127.0.0.1:${PORT}/?theme=${theme}`);
await page.waitForFunction(() => /2026/.test(document.getElementById("updated-at")?.textContent || ""));
await page.waitForLoadState("networkidle");
await page.clock.runFor(3000); // everyone walks to their first room

const frames = join(home, "frames");
mkdirSync(frames);
const canvas = page.locator("#board");
const FPS = 12;
let n = 0;
for (let b = 0; b < story.length; b++) {
  current = b;
  const beatFrames = b === story.length - 1 ? FPS * 3 : FPS * 2.5;
  for (let i = 0; i < beatFrames; i++) {
    await page.clock.runFor(1000 / FPS);
    writeFileSync(join(frames, `f${String(n++).padStart(4, "0")}.png`), await canvas.screenshot());
  }
}
await browser.close();
srv.kill();

const out = join(ROOT, "docs", `busybots${theme === "island" ? "" : "-" + theme}.gif`);
mkdirSync(dirname(out), { recursive: true });
const py = `
import glob, sys
from PIL import Image
files = sorted(glob.glob(sys.argv[1] + "/f*.png"))
W = 960
imgs = []
for f in files:
    im = Image.open(f).convert("RGB")
    im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
    imgs.append(im)
pal = imgs[len(imgs)//2].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
q = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in imgs]
q[0].save(sys.argv[2], save_all=True, append_images=q[1:], duration=int(1000/${FPS}), loop=0, optimize=True, disposal=1)
print(len(q), "frames")
`;
const r = spawnSync("python3", ["-c", py, frames, out], { encoding: "utf8" });
if (r.status !== 0) {
  console.error(r.stderr);
  process.exit(1);
}
rmSync(home, { recursive: true, force: true });
console.log(`${r.stdout.trim()} → ${out}`);
