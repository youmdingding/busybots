// Notifications from the server, for when no board is open (Settings → Board → "also when the
// board is closed"). An open board sends its own (web/board/notify.js), so these only go out
// when no board has asked for the status for a little while.
//   macOS: osascript "display notification"   Linux: notify-send (if installed)   Windows: none yet
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export const BOARD_IDLE_MS = 15_000; // no /status.json request for this long → no board is open

/** Show one desktop notification. Text goes in as arguments, never into a script. */
export function desktopNotify(title, body, { platform = process.platform, run = spawn } = {}) {
  try {
    if (platform === "darwin") {
      const script = ["on run argv", "display notification (item 2 of argv) with title (item 1 of argv)", "end run"];
      const args = script.flatMap((l) => ["-e", l]).concat([String(title).slice(0, 120), String(body).slice(0, 240)]);
      run("osascript", args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
      return true;
    }
    if (platform === "linux" && ["/usr/bin/notify-send", "/bin/notify-send"].some((p) => existsSync(p))) {
      run("notify-send", ["--app-name=Busybots", String(title).slice(0, 120), String(body).slice(0, 240)], { stdio: "ignore", detached: true })
        .on("error", () => {}).unref();
      return true;
    }
  } catch { /* best effort */ }
  return false;
}

/** Watches each status for agents that start needing you or finish. */
export class Notifier {
  constructor({ send = desktopNotify } = {}) {
    this.send = send;
    this.seen = new Map();
    this.primed = false;
  }

  /** prefs = settings.board.notify; boardSeenAt = when a board last fetched the status (ms). */
  update(status, prefs, boardSeenAt, now = Date.now()) {
    const bots = (status && status.bots) || [];
    const boardOpen = boardSeenAt && now - boardSeenAt < BOARD_IDLE_MS;
    const sent = [];
    for (const b of bots) {
      const a = b.attention || {};
      const before = this.seen.get(b.id);
      if (this.primed && prefs && prefs.whenClosed && !boardOpen) {
        const name = String(b.name || "An agent");
        if (a.needsYou && !(before && before.needsYou) && prefs.needsYou) {
          const why = a.reason && a.reason !== "Needs you" ? a.reason : "It's waiting for your answer.";
          sent.push([`${name} needs you`, why]);
        } else if (a.done && !a.needsYou && before && !before.done && prefs.done) {
          sent.push([`${name} is done`, "Finished and changed files."]);
        }
      }
      this.seen.set(b.id, { needsYou: !!a.needsYou, done: !!a.done });
    }
    const ids = new Set(bots.map((b) => b.id));
    for (const id of [...this.seen.keys()]) if (!ids.has(id)) this.seen.delete(id);
    this.primed = true;
    for (const [title, body] of sent.slice(0, 3)) this.send(title, body); // never a flood
    return sent;
  }
}
