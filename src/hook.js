// Claude Code Notification hook → marks a session as "needs you" on the board.
//
// Claude Code runs Notification hooks when it is waiting on you (e.g. a permission
// prompt). This reads the hook's JSON on stdin and writes <state>/attention/<session>.json;
// the watcher shows a "!" badge until the session's transcript moves on.
// Never blocks Claude Code: always exits 0. Install: see examples/claude-hooks.json.
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "./paths.js";

export async function notificationHook(stdin, dir = join(stateDir(), "attention")) {
  try {
    const chunks = [];
    for await (const c of stdin) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const sid = String(data?.session_id || "").trim();
    if (!/^[0-9A-Za-z_-]{1,80}$/.test(sid)) return 0;
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${sid}.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify({ message: String(data.message || ""), ts: Date.now() / 1000 }));
    renameSync(tmp, join(dir, `${sid}.json`));
  } catch {
    /* bad input or unwritable folder: never get in Claude Code's way */
  }
  return 0;
}
