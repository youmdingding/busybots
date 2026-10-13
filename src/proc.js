// Process checks, safe on every platform.
import { execFileSync } from "node:child_process";

const isWindows = process.platform === "win32";

/** True if a process with this pid exists (signal 0 only tests, on Windows too). */
export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists, but belongs to another user
  }
}

/** True if the process has running children (e.g. a shell command executing). */
export function hasChildProcesses(pid) {
  if (!pid || isWindows) return false;
  try {
    return execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== "";
  } catch {
    return false;
  }
}

/** The process's command line ("" if unknown). */
export function cmdlineForPid(pid) {
  if (!pid || isWindows) return "";
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** The process's terminal device ("" if none). */
export function ttyForPid(pid) {
  if (!pid || isWindows) return "";
  try {
    const t = execFileSync("ps", ["-p", String(pid), "-o", "tty="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!t || t === "??") return "";
    return t.startsWith("/") ? t : `/dev/${t}`;
  } catch {
    return "";
  }
}
