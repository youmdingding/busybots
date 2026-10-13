// Build a scenario's fake home folder.
import { mkdirSync, writeFileSync, utimesSync, mkdtempSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const encodeProjectDir = (p) => p.replace(/[^A-Za-z0-9]/g, "-");
const iso = (t) => new Date(t * 1000).toISOString();

export class Materializer {
  constructor(home, now, pids) {
    Object.assign(this, { home, now, pids });
  }

  sub(s) {
    return s.replace(/\{\{([^}]+)\}\}/g, (m, body) => {
      const i = body.indexOf(":");
      const kind = i < 0 ? body : body.slice(0, i);
      const arg = i < 0 ? "" : body.slice(i + 1);
      if (kind === "home") return this.home;
      if (kind === "t") return iso(this.now + Number(arg));
      if (kind === "ms") return String(Math.trunc((this.now + Number(arg)) * 1000));
      if (kind === "pid") return String(this.pids[arg]);
      if (kind === "projdir") return encodeProjectDir(join(this.home, arg));
      if (kind === "today") {
        const d = new Date(this.now * 1000);
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
      }
      throw new Error(`unknown placeholder ${m}`);
    });
  }

  deep(v) {
    if (typeof v === "string") {
      const out = this.sub(v);
      return /^\{\{(ms|pid):[^}]+\}\}$/.test(v) ? Number(out) : out;
    }
    if (Array.isArray(v)) return v.map((x) => this.deep(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [this.sub(k), this.deep(x)]));
    return v;
  }

  write(entry) {
    const path = join(this.home, this.sub(entry.path));
    mkdirSync(dirname(path), { recursive: true });
    if ("json" in entry) writeFileSync(path, JSON.stringify(this.deep(entry.json)));
    else if ("jsonl" in entry) writeFileSync(path, entry.jsonl.map((e) => JSON.stringify(this.deep(e)) + "\n").join(""));
    else if ("text" in entry) writeFileSync(path, this.sub(entry.text));
    else if ("sqlite" in entry) {
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(path);
      db.exec("PRAGMA foreign_keys=OFF");
      for (const stmt of entry.sqlite) db.exec(this.sub(stmt));
      db.close();
    }
    if ("mtime" in entry) {
      const t = this.now + Number(entry.mtime);
      utimesSync(path, t, t);
    }
  }
}

/** A harmless long-lived process standing in for an agent (no children). */
export function spawnHelper() {
  return spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], { stdio: "ignore" });
}

/** Materialize a scenario spec into a fresh temp home. Returns {home, procs, m}. */
export function materialize(spec, now = Date.now() / 1000) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "scn-")));
  const procs = Object.fromEntries((spec.procs || []).map((name) => [name, spawnHelper()]));
  const m = new Materializer(home, now, Object.fromEntries(Object.entries(procs).map(([k, p]) => [k, p.pid])));
  for (const e of spec.files || []) m.write(e);
  return { home, procs, m };
}
