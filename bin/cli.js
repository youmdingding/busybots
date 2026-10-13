#!/usr/bin/env node
// busybots: watch your coding agents on a little pixel-art board.
//
//   busybots [start]            run the board and open it in your browser
//   busybots serve              same, without opening the browser
//   busybots status             one watcher pass, printed as JSON
//   busybots doctor             check Node, settings and every agent folder
//   busybots service install    start the board at login (macOS / Linux)
//   busybots service uninstall
//   busybots hook               Claude Code Notification hook (see examples/claude-hooks.json)
//
// Options: --port N (default 8765), --no-open
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createBoardServer, ensureToken, checkSources, DEFAULT_PORT } from "../src/server.js";
import { Watcher } from "../src/watcher.js";
import { stateDir, settingsPath, APP_NAME } from "../src/paths.js";
import * as S from "../src/settings.js";
import { sqliteAvailable } from "../src/sqlite.js";
import * as service from "../src/service.js";
import { notificationHook } from "../src/hook.js";

const USAGE = `Usage: ${APP_NAME} [start|serve|status|doctor|service install|service uninstall|hook] [--port N] [--no-open]`;

function parse(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: "string" },
      "no-open": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
  const port = values.port === undefined ? DEFAULT_PORT : Number.parseInt(values.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid --port: ${values.port}`);
  return { cmd: positionals[0] || "start", rest: positionals.slice(1), port, open: !values["no-open"], help: values.help, version: values.version };
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => console.log(`Open ${url} in your browser.`)).unref();
}

function writeStatus(status) {
  // A copy on disk for debugging and other tools; the board itself is served from memory.
  const dir = stateDir();
  const tmp = join(dir, `.status.${process.pid}.tmp`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, JSON.stringify(status, null, 2) + "\n");
    renameSync(tmp, join(dir, "status.json"));
  } catch { /* best effort */ }
}

async function serve({ port, open }) {
  const watcher = new Watcher();
  let status = null;
  let timer = null;
  const tick = () => {
    try {
      const st = watcher.build();
      delete st._meta;
      status = st;
      writeStatus(st);
    } catch (err) {
      console.error(`watcher error: ${err.stack || err.message}`);
    }
    let poll = 2;
    try { poll = S.load().board.pollSeconds; } catch { /* default */ }
    timer = setTimeout(tick, Math.max(0.5, poll) * 1000);
  };
  tick();

  const server = createBoardServer({ port, getStatus: () => status, token: ensureToken() });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  }).catch((err) => {
    clearTimeout(timer);
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use — is the board already running? Try --port ${port + 1}.`);
      process.exit(1);
    }
    throw err;
  });
  const url = `http://127.0.0.1:${port}/`;
  console.log(`${APP_NAME} running at ${url}  (settings: ${url}admin, data: ${stateDir()})`);
  if (open) openBrowser(url);

  const stop = () => {
    clearTimeout(timer);
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  if (process.platform !== "win32") process.on("SIGHUP", () => {}); // survive a closed terminal
}

function doctor() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const lines = [];
  let bad = 0;
  const row = (ok, label, msg) => {
    if (ok === false) bad++;
    lines.push(`${ok === true ? "✓" : ok === false ? "✗" : "·"} ${label.padEnd(12)} ${msg}`);
  };
  row(major >= 20 ? true : false, "Node", `${process.versions.node}${major >= 20 ? "" : " — needs 20 or newer"}`);
  row(sqliteAvailable() ? true : null, "SQLite", sqliteAvailable() ? "built in" : `not available (Node ${major}.${minor}); OpenCode, Cursor and Conductor need Node 22.5+`);
  row(true, "Settings", `${settingsPath()}${S.exists() ? "" : " (not created yet — using defaults)"}`);
  const res = checkSources(S.load());
  for (const a of S.AGENT_TYPES) {
    const node = S.load().sources[a.id];
    if (node && node.enabled === false) {
      row(null, a.label, "off");
      continue;
    }
    for (const r of res.sources[a.id] || []) row(r.ok, a.label, `${r.path} — ${r.message}`);
  }
  console.log(lines.join("\n"));
  return bad ? 1 : 0;
}

async function main(argv) {
  let o;
  try {
    o = parse(argv);
  } catch (err) {
    console.error(`${err.message}\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    console.log(USAGE);
    return 0;
  }
  if (o.version) {
    const { readFileSync } = await import("node:fs");
    const { PACKAGE_ROOT } = await import("../src/paths.js");
    console.log(JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version);
    return 0;
  }
  if (["start", "serve", "status", "doctor"].includes(o.cmd)) {
    const moved = S.migrateLegacy();
    if (moved) console.error(`Copied your settings from ${moved} to ${settingsPath()}`);
  }
  switch (o.cmd) {
    case "start":
      await serve(o);
      return null;
    case "serve":
      await serve({ ...o, open: false });
      return null;
    case "status": {
      const st = new Watcher().build();
      console.log(JSON.stringify(st, null, 2));
      return 0;
    }
    case "doctor":
      return doctor();
    case "hook":
      return notificationHook(process.stdin);
    case "service": {
      const sub = o.rest[0];
      if (sub === "install") return service.install({ port: o.port });
      if (sub === "uninstall") return service.uninstall();
      console.error(USAGE);
      return 2;
    }
    default:
      console.error(`Unknown command: ${o.cmd}\n${USAGE}`);
      return 2;
  }
}

main(process.argv.slice(2)).then((code) => {
  if (code !== null) process.exitCode = code;
}, (err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
