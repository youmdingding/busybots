// Which app an agent's terminal lives in (iTerm, Terminal, VS Code, Cursor, Ghostty, tmux…),
// found by walking up the agent's process ancestry, and how to bring it to the front.
// macOS for the jump itself; detection works anywhere `ps` does.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/** Apps with a nicer name than their bundle, and editors whose terminal sits inside a project window. */
const KNOWN = [
  { re: /iTerm/, id: "iterm", label: "iTerm" },                                   // iTermServer lives outside the .app
  { re: /\/Terminal\.app\//, id: "terminal", label: "Terminal" },
  { re: /\/Visual Studio Code - Insiders\.app\//, id: "editor", label: "VS Code Insiders" },
  { re: /\/Visual Studio Code\.app\//, id: "editor", label: "VS Code" },
  { re: /\/Cursor\.app\//, id: "editor", label: "Cursor" },
  { re: /\/Windsurf\.app\//, id: "editor", label: "Windsurf" },
  { re: /\/VSCodium\.app\//, id: "editor", label: "VSCodium" },
  { re: /\/Zed\.app\//, id: "editor", label: "Zed" },
  { re: /\/(IntelliJ IDEA|WebStorm|PyCharm|GoLand|PhpStorm|RubyMine|CLion|Rider|RustRover|DataGrip|Android Studio)[^/]*\.app\//, id: "editor" },
  // Linux names, so the panel's label is right there too (the jump itself is macOS only)
  { re: /(^|\/)(code|code-insiders|codium)(\s|$)/, id: "editor", label: "VS Code" },
  { re: /(^|\/)(cursor)(\s|$)/i, id: "editor", label: "Cursor" },
];
const TMUX = /(^|\/)tmux(:| |$)/;

/** pid → { ppid, cmd } for every process (one `ps` call). */
export function processTable(psOutput) {
  let out = psOutput;
  if (out == null) {
    try {
      out = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return new Map();
    }
  }
  const table = new Map();
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), cmd: m[3] });
  }
  return table;
}

/** The outermost "<Name>.app" in a command line, with its path: Code Helper → Visual Studio Code. */
function appBundle(cmd) {
  const m = /^(.*?\/([^/]+)\.app)\/Contents\//.exec(cmd);
  return m ? { path: m[1], name: m[2] } : null;
}

/**
 * Where this process's terminal lives: { id: "iterm"|"terminal"|"editor"|"app"|"tmux", label,
 * appPath?, appPid? (the app's main process), tmuxPid? }, or null if nothing recognisable.
 */
export function terminalHost(pid, table = processTable()) {
  let cur = table.get(Number(pid));
  let p = cur ? cur.ppid : 0;
  for (let depth = 0; p > 1 && depth < 40; depth++) {
    const proc = table.get(p);
    if (!proc) break;
    const cmd = proc.cmd;
    if (TMUX.test(cmd.split(" ")[0]) || /^tmux\b/.test(cmd)) return { id: "tmux", label: "tmux", tmuxPid: p };
    const known = KNOWN.find((k) => k.re.test(cmd));
    const bundle = appBundle(cmd);
    if (known || bundle) {
      const host = {
        id: known ? known.id : "app",
        label: (known && known.label) || (bundle && bundle.name) || cmd.split(/[\s/]/).filter(Boolean).pop(),
        appPath: bundle ? bundle.path : null,
        appPid: null,
      };
      // the app's main process: the ancestor running <App>.app/Contents/MacOS/<exe> itself
      for (let q = p, d = 0; q > 1 && d < 10; d++) {
        const pr = table.get(q);
        if (!pr) break;
        const b = appBundle(pr.cmd);
        if (b && host.appPath && b.path === host.appPath && /^\.app\/Contents\/MacOS\//.test(pr.cmd.slice(b.path.length - 4))) host.appPid = q;
        q = pr.ppid;
      }
      return host;
    }
    p = proc.ppid;
  }
  return null;
}

const CACHE = new Map(); // pid → { at, host }

/** terminalHost() for the panel, cached for a while (the panel asks every few seconds). */
export function terminalHostCached(pid) {
  const hit = CACHE.get(pid);
  if (hit && Date.now() - hit.at < 30_000) return hit.host;
  const host = process.platform === "win32" ? null : terminalHost(pid);
  CACHE.set(pid, { at: Date.now(), host });
  if (CACHE.size > 200) CACHE.delete(CACHE.keys().next().value);
  return host;
}

// ---- bringing it to the front (macOS) ---------------------------------------------
const asStr = (s) => `"${String(s).replace(/[\\"]/g, "\\$&")}"`;

function osa(script) {
  const r = spawnSync("osascript", ["-e", script], { timeout: 8000, encoding: "utf8" });
  return { ok: !r.error && r.status === 0, out: String(r.stdout || "").trim(), err: String(r.stderr || r.error?.message || "").trim() };
}

function openPath(path) {
  spawn("open", [path], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

/** Project names to look for in window titles: the folder, then its parents. */
function titleHints(cwd) {
  const parts = String(cwd || "").split("/").filter(Boolean);
  return parts.slice(-3).reverse().filter((p) => p.length > 1);
}

/** Bring an app forward and raise the window whose title names the project (editors put it there). */
function raiseAppWindow(host, cwd) {
  if (host.appPath) openPath(host.appPath); // activates the running app, no permission needed
  if (!host.appPid) return { ok: true, method: `activate:${host.label}` };
  const hints = titleHints(cwd);
  if (!hints.length) return { ok: true, method: `activate:${host.label}` };
  // System Events can raise one window; macOS asks once for permission. If refused, the app is still in front.
  const r = osa(`tell application "System Events"
  set p to first application process whose unix id is ${Number(host.appPid)}
  set frontmost of p to true
  repeat with hint in {${hints.map(asStr).join(", ")}}
    repeat with w in windows of p
      if name of w contains hint then
        perform action "AXRaise" of w
        return "raised"
      end if
    end repeat
  end repeat
  return "front"
end tell`);
  if (r.ok && r.out === "raised") return { ok: true, method: `window:${host.label}` };
  return { ok: true, method: `activate:${host.label}`, note: r.ok ? "no window named after the project" : "window not raised (macOS permission?)" };
}

function iTermScript(short) {
  return `tell application "iTerm"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        try
          if (tty of s) contains "${short}" then
            select w
            select t
            select s
            return "found"
          end if
        end try
      end repeat
    end repeat
  end repeat
end tell`;
}

function terminalScript(short) {
  return `tell application "Terminal"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      try
        if (tty of t) contains "${short}" then
          set selected of t to true
          set frontmost of w to true
          return "found"
        end if
      end try
    end repeat
  end repeat
end tell`;
}

function tmuxBin() {
  return ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].find((p) => existsSync(p)) || "tmux";
}

/** Select the agent's tmux pane, then bring forward the terminal a client of that session runs in. */
function jumpTmux(short, cwd, table) {
  const bin = tmuxBin();
  const run = (args) => spawnSync(bin, args, { encoding: "utf8", timeout: 4000 });
  const panes = run(["list-panes", "-a", "-F", "#{pane_tty} #{session_name} #{window_id} #{pane_id}"]);
  if (panes.error || panes.status !== 0) return { ok: false, error: "tmux not reachable" };
  const row = String(panes.stdout).split("\n").map((l) => l.split(" ")).find((c) => c[0] && c[0].endsWith(short));
  if (!row) return { ok: false, error: "tmux pane not found" };
  const [, session, win, pane] = row;
  run(["select-window", "-t", win]);
  run(["select-pane", "-t", pane]);
  const clients = run(["list-clients", "-F", "#{client_pid} #{client_session} #{client_tty}"]);
  const client = String(clients.stdout || "").split("\n").map((l) => l.split(" ")).find((c) => c[1] === session)
    || String(clients.stdout || "").split("\n").map((l) => l.split(" ")).find((c) => c[0]);
  if (!client) return { ok: true, method: "tmux:pane (no attached client)" };
  const host = terminalHost(Number(client[0]), table);
  if (!host || host.id === "tmux") return { ok: true, method: "tmux:pane" };
  const r = jumpToHost(host, client[2], cwd, table);
  return { ...r, method: `tmux+${r.method}` };
}

function jumpToHost(host, tty, cwd, table) {
  const short = String(tty || "").replace("/dev/", "");
  const safeTty = /^[A-Za-z0-9]+$/.test(short);
  if (host.id === "iterm" && safeTty) {
    const r = osa(iTermScript(short));
    if (!r.ok) openPath("/Applications/iTerm.app");
    return { ok: true, method: r.ok ? "osascript:iTerm" : "activate:iTerm" };
  }
  if (host.id === "terminal" && safeTty) {
    const r = osa(terminalScript(short));
    if (!r.ok) spawn("open", ["-a", "Terminal"], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
    return { ok: true, method: r.ok ? "osascript:Terminal" : "activate:Terminal" };
  }
  if (host.id === "tmux" && safeTty) return jumpTmux(short, cwd, table);
  return raiseAppWindow(host, cwd);
}

/**
 * Bring the agent's terminal to the front: the exact tab in iTerm / Terminal, the project's
 * window in VS Code / Cursor / other apps, the pane in tmux.
 */
export function jumpToAgent({ pid, tty, cwd }) {
  if (process.platform !== "darwin") return { ok: false, error: "Jumping to a window works on macOS only for now" };
  const table = processTable();
  const host = pid ? terminalHost(pid, table) : null;
  if (host) return { ...jumpToHost(host, tty, cwd, table), host: host.label };
  // Unknown: the old behaviour (iTerm if installed, else Terminal)
  const app = existsSync("/Applications/iTerm.app") ? "iTerm" : "Terminal";
  const short = String(tty || "").replace("/dev/", "");
  if (/^[A-Za-z0-9]+$/.test(short)) {
    const r = osa(app === "iTerm" ? iTermScript(short) : terminalScript(short));
    if (r.ok) return { ok: true, method: `osascript:${app}` };
  }
  spawn("open", ["-a", app], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  return { ok: true, method: `activate:${app}` };
}
