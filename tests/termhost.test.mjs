// "Open in …": which app an agent's terminal lives in, from its process ancestry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { processTable, terminalHost } from "../src/termhost.js";

const VSC = "/Applications/Visual Studio Code.app";
const tree = (rows) => processTable(rows.map(([pid, ppid, cmd]) => `${pid} ${ppid} ${cmd}`).join("\n"));

test("Claude in VS Code's integrated terminal → VS Code, with its main process", () => {
  const t = tree([
    [1, 0, "/sbin/launchd"],
    [500, 1, `${VSC}/Contents/MacOS/Electron`],
    [620, 500, `${VSC}/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper --type=utility --utility-sub-type=node.mojom.NodeService`],
    [700, 620, "/bin/zsh -il"],
    [800, 700, "claude"],
  ]);
  const h = terminalHost(800, t);
  assert.equal(h.id, "editor");
  assert.equal(h.label, "VS Code");
  assert.equal(h.appPath, VSC);
  assert.equal(h.appPid, 500);
});

test("Cursor, Terminal, iTerm (via iTermServer) and Ghostty", () => {
  const cursor = tree([[1, 0, "launchd"], [10, 1, "/Applications/Cursor.app/Contents/MacOS/Cursor"],
    [11, 10, "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin) --type=utility"],
    [12, 11, "-zsh"], [13, 12, "node /usr/local/bin/claude"]]);
  assert.deepEqual([terminalHost(13, cursor).label, terminalHost(13, cursor).appPid], ["Cursor", 10]);

  const term = tree([[1, 0, "launchd"], [20, 1, "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"],
    [21, 20, "login -pf laurent"], [22, 21, "-zsh"], [23, 22, "claude"]]);
  assert.equal(terminalHost(23, term).id, "terminal");

  const iterm = tree([[1, 0, "launchd"], [30, 1, "/Users/x/Library/Application Support/iTerm2/iTermServer-3.5.4 /Users/x/Library/Application Support/iTerm2/iterm2-daemon-1.socket"],
    [31, 30, "login -fp x"], [32, 31, "-zsh"], [33, 32, "claude"]]);
  assert.equal(terminalHost(33, iterm).id, "iterm");

  const ghostty = tree([[1, 0, "launchd"], [40, 1, "/Applications/Ghostty.app/Contents/MacOS/ghostty"],
    [41, 40, "/usr/bin/login -flp x /bin/bash --noprofile --norc -c exec -l /bin/zsh"], [42, 41, "-zsh"], [43, 42, "claude"]]);
  const g = terminalHost(43, ghostty);
  assert.deepEqual([g.id, g.label, g.appPid], ["app", "Ghostty", 40]);
});

test("tmux, unknown parents and dead pids", () => {
  const tmux = tree([[1, 0, "launchd"], [50, 1, "tmux new -s work"], [51, 50, "-zsh"], [52, 51, "claude"]]);
  assert.equal(terminalHost(52, tmux).id, "tmux");
  const bare = tree([[1, 0, "launchd"], [60, 1, "sshd: x@ttys001"], [61, 60, "-zsh"], [62, 61, "claude"]]);
  assert.equal(terminalHost(62, bare), null);
  assert.equal(terminalHost(999, bare), null);
  assert.equal(terminalHost(52, new Map()), null);
});

test("the agent's own command line never counts as its host", () => {
  const t = tree([[1, 0, "launchd"], [70, 1, "-zsh"], [71, 70, "claude --add-dir /Applications/Cursor.app/Contents/Resources"]]);
  assert.equal(terminalHost(71, t), null);
});
