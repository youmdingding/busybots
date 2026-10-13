// Start the board at login: a LaunchAgent on macOS, a systemd user unit on Linux.
// Windows: not automated yet (print instructions instead).
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { home, stateDir, APP_NAME, LEGACY_APP_NAMES, PACKAGE_ROOT } from "./paths.js";

const LABEL = `dev.${APP_NAME}`;
const CLI = join(PACKAGE_ROOT, "bin", "cli.js");

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });

function plist(port) {
  const logs = join(stateDir(), "logs");
  const args = [process.execPath, CLI, "serve", "--port", String(port)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(join(logs, "board.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logs, "board.log"))}</string>
</dict>
</plist>
`;
}

function unit(port) {
  const q = (s) => `"${String(s).replace(/(["\\])/g, "\\$1")}"`;
  return `[Unit]
Description=${APP_NAME} (coding agents board)

[Service]
ExecStart=${q(process.execPath)} ${q(CLI)} serve --port ${port}
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

const plistPath = (name = APP_NAME) => join(home(), "Library", "LaunchAgents", `dev.${name}.plist`);
const unitPath = (name = APP_NAME) => join(process.env.XDG_CONFIG_HOME || join(home(), ".config"), "systemd", "user", `${name}.service`);

/** A service installed under the project's working name would run a second board: remove it. */
function removeLegacy() {
  for (const name of LEGACY_APP_NAMES) {
    if (process.platform === "darwin" && existsSync(plistPath(name))) {
      run("launchctl", ["unload", "-w", plistPath(name)]);
      rmSync(plistPath(name));
      console.log(`Removed the old ${plistPath(name)}`);
    }
    if (process.platform === "linux" && existsSync(unitPath(name))) {
      run("systemctl", ["--user", "disable", "--now", `${name}.service`]);
      rmSync(unitPath(name));
      console.log(`Removed the old ${unitPath(name)}`);
    }
  }
}

export function install({ port }) {
  mkdirSync(join(stateDir(), "logs"), { recursive: true });
  removeLegacy();
  if (process.platform === "darwin") {
    const p = plistPath();
    mkdirSync(join(home(), "Library", "LaunchAgents"), { recursive: true });
    if (existsSync(p)) run("launchctl", ["unload", p]);
    writeFileSync(p, plist(port));
    const r = run("launchctl", ["load", "-w", p]);
    if (r.status !== 0) {
      console.error(`launchctl load failed: ${r.stderr || r.stdout}`);
      return 1;
    }
    console.log(`Installed ${p}\nThe board now starts at login: http://127.0.0.1:${port}/`);
    return 0;
  }
  if (process.platform === "linux") {
    const p = unitPath();
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, unit(port));
    for (const args of [["--user", "daemon-reload"], ["--user", "enable", "--now", `${APP_NAME}.service`]]) {
      const r = run("systemctl", args);
      if (r.status !== 0) {
        console.error(`systemctl ${args.join(" ")} failed: ${r.stderr || r.error?.message || ""}\nUnit written to ${p}`);
        return 1;
      }
    }
    console.log(`Installed ${p}\nThe board now starts at login: http://127.0.0.1:${port}/`);
    return 0;
  }
  console.log(`Automatic start isn't set up for ${process.platform} yet.\nAdd a shortcut that runs:\n  "${process.execPath}" "${CLI}" serve --port ${port}`);
  return 1;
}

export function uninstall() {
  if (process.platform === "darwin") {
    const p = plistPath();
    if (existsSync(p)) {
      run("launchctl", ["unload", "-w", p]);
      rmSync(p);
      console.log(`Removed ${p}`);
    } else console.log("Not installed.");
    return 0;
  }
  if (process.platform === "linux") {
    const p = unitPath();
    run("systemctl", ["--user", "disable", "--now", `${APP_NAME}.service`]);
    if (existsSync(p)) {
      rmSync(p);
      run("systemctl", ["--user", "daemon-reload"]);
      console.log(`Removed ${p}`);
    } else console.log("Not installed.");
    return 0;
  }
  console.log("Nothing to remove.");
  return 0;
}

export const _test = { plist, unit };
