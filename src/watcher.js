// One watcher pass: find every agent session, classify it, and return the board status.
// tests/scenarios/ pins its output.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { pidAlive, cmdlineForPid } from "./proc.js";
import { PACKAGE_ROOT, stateDir } from "./paths.js";
import * as settingsMod from "./settings.js";
import * as claude from "./claude.js";
import * as conductorSrc from "./conductor.js";
import { READERS } from "./readers/index.js";
import { IconChoices } from "./icons.js";
import {
  makeRules, latestActivity, classifySession, attentionFor, bubbleFromTool, phaseFor, zoneFor,
  areaForSkill, skillLabel, clip, DELEGATE_TOOLS, STRONG_KEYS,
} from "./classify.js";

// Rooms and tool → room rules shipped with the board
export const CONFIG_PATH = join(PACKAGE_ROOT, "config.json");

export function loadConfig(path = CONFIG_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function nowLocalIso(now) {
  const d = new Date(now * 1000);
  const p = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${sign}${p(Math.trunc(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

export function shortNameFromCwd(cwd) {
  const parts = String(cwd || "").split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return "";
  let base = parts.at(-1);
  if (["src", "app", "apps", "web", "api", "packages"].includes(base) && parts.length >= 2) base = parts.at(-2);
  if (base.length > 28) base = base.slice(0, 25) + "…";
  return base;
}

/** Same folder name twice → add a short id suffix. */
export function dedupeNames(items) {
  const counts = {};
  for (const it of items) counts[it.name] = (counts[it.name] || 0) + 1;
  for (const it of items) {
    if (counts[it.name] === 1) continue;
    const sid = String(it.id || "");
    const suf = sid.includes("_") ? sid.split("_").pop().slice(-4) : sid.slice(0, 4);
    it.name = `${it.name}·${suf || "x"}`;
  }
}

export function iconForSession(sid, pool, fallback) {
  if (!pool.length) return fallback;
  const h = createHash("sha1").update(sid, "utf8").digest("hex");
  return pool[Number.parseInt(h.slice(0, 8), 16) % pool.length];
}

export function detectBrand(sess) {
  const src = sess.source || "";
  if (src in READERS) return src;
  const entry = String(sess.entrypoint || "").toLowerCase();
  const cwd = String(sess.cwd || "").toLowerCase();
  const agentType = String(sess.agent_type || "").toLowerCase();
  const cmd = String(sess.cmdline || cmdlineForPid(sess.pid)).toLowerCase();
  if (src === "conductor-db" || src === "both" || entry === "sdk-ts" || entry === "conductor"
      || cwd.includes("conductor/") || cmd.includes("agent-binaries") || cmd.includes("com.conductor.app")) return "conductor";
  if (cmd.includes("codex") || ["codex", "openai", "gpt"].includes(agentType) || ["codex", "openai"].includes(entry) || cwd.includes("/.codex")) return "codex";
  return "claude";
}

const BRAND_LABEL = { claude: "Claude", codex: "Codex", gemini: "Gemini", opencode: "OpenCode", cursor: "Cursor", conductor: "Conductor" };
const PHASE_BUBBLE = { build: "Working on code", test: "Running checks", review: "Reviewing", explore: "Looking around",
  plan: "Planning", spec: "Writing specs", specs: "Writing specs", think: "Thinking", delegate: "Delegating" };

/**
 * Privacy mode (Settings → Board): nothing that names a project or quotes an agent leaves
 * the watcher. Names become "Claude 1", bubbles a generic phase, paths and skills go.
 */
export function applyPrivacy(bots) {
  const counters = {};
  for (const b of [...bots].sort((x, y) => String(x.id).localeCompare(String(y.id)))) {
    const label = BRAND_LABEL[b.brand] || "Agent";
    counters[label] = (counters[label] || 0) + 1;
    b.name = `${label} ${counters[label]}`;
  }
  for (const b of bots) {
    if (b.attention?.needsYou) b.bubble = "Needs you";
    else if (b.bubble) b.bubble = b.state === "idle" ? "Waiting" : PHASE_BUBBLE[b.phase] || "Working";
    if (b.attention) b.attention.reason = b.attention.needsYou ? "Needs you" : null;
    b.cwd = null;
    b.skill = null;
    b.task = b.phase || null;
  }
}

export function poolForBrand(cfg, brand) {
  const pools = cfg.iconPools && typeof cfg.iconPools === "object" ? cfg.iconPools : {};
  const pool = [...(pools[brand] || [])];
  if (pool.length) return pool;
  if (brand === "claude" && Array.isArray(cfg.iconPool) && cfg.iconPool.length) return [...cfg.iconPool];
  return Array.from({ length: 8 }, (_, i) => `icons/${brand}-${String(i).padStart(2, "0")}.png`);
}

function areasAsZones(cfg) {
  if (Array.isArray(cfg.areas) && cfg.areas.length) {
    return cfg.areas.filter((a) => a && a.key).map((a) => ({ id: a.key, label: a.label || a.key }));
  }
  return [...(cfg.zones || [])];
}

/**
 * Keeps state between passes (which skill each transcript is in). Everything that
 * touches the outside world can be injected for tests.
 */
export class Watcher {
  constructor({ config, settings, attentionDir, icons, log = (m) => console.error(m) } = {}) {
    this.config = config;           // object, or undefined → read config.json each pass
    this.settings = settings;       // object, or undefined → read settings.json each pass
    this.attentionDir = attentionDir ?? join(stateDir(), "attention");
    this.log = log;
    this.skills = new claude.SkillTracker();
    this.icons = icons ?? new IconChoices();
  }

  build(now = Date.now() / 1000) {
    const cfg = this.config ?? loadConfig();
    const s = this.settings ?? settingsMod.load();
    const rules = makeRules(cfg, s.rules);
    const mapping = rules.activityAreas;
    const busyWindow = Number(cfg.busyWindowSeconds) || 45;
    const maxChars = Number.parseInt(cfg.maxBubbleChars, 10) || 60;

    const claudeHomes = settingsMod.dirs(s, "claude");
    const live = {};
    for (const home of claudeHomes) {
      for (const [sid, meta] of Object.entries(claude.discoverLive(home))) if (!(sid in live)) live[sid] = meta;
    }
    const [condOn, condDb, condWs] = settingsMod.conductor(s);
    const conductor = condOn ? conductorSrc.discover(condDb, condWs, this.log) : {};
    const sessions = conductorSrc.mergeSessions(live, conductor);
    const seen = new Set(sessions.map((x) => x.sessionId));
    for (const [source, reader] of Object.entries(READERS)) {
      const homes = settingsMod.dirs(s, source);
      if (!homes.length) continue;
      let found;
      try {
        found = reader.discover(homes, s.sources[source].recentMinutes);
      } catch (err) { // one broken reader must never take the board down
        this.log(`${source} reader error: ${err.message}`);
        continue;
      }
      for (const [sid, x] of found instanceof Map ? found : Object.entries(found)) {
        if (!seen.has(sid)) {
          seen.add(sid);
          sessions.push(x);
        }
      }
    }
    const firstHome = claudeHomes[0] || null;

    const picked = this.icons ? this.icons.map() : {};
    const bots = [];
    for (const sess of sessions) {
      try {
        const bot = this.bot(sess, { now, cfg, s, rules, mapping, busyWindow, maxChars, firstHome });
        if (picked[bot.id]) {
          bot.iconDefault = bot.icon; // the board draws it as a small badge so the agent type stays visible
          bot.icon = picked[bot.id];
        }
        bots.push(bot);
      } catch (err) {
        this.log(`session ${sess.sessionId}: ${err.stack || err.message}`);
      }
    }
    dedupeNames(bots);
    if (s.board.privacy) applyPrivacy(bots);

    const project = { ...(cfg.project || {}) };
    project.updatedAt = nowLocalIso(now);
    if (!project.name) project.name = "Your coding agents";
    return {
      project, zones: areasAsZones(cfg), bots,
      _meta: { live: Object.keys(live).length, conductor_in_progress: Object.keys(conductor).length, merged: sessions.length },
    };
  }

  bot(sess, { now, cfg, s, rules, mapping, busyWindow, maxChars, firstHome }) {
    const sid = sess.sessionId;
    const cwd = sess.cwd;
    const home = sess.claude_home || firstHome;
    const fromReader = sess.source in READERS;
    let jsonl = null;
    let events;
    if (fromReader) {
      events = sess.events || [];
      // An open turn whose files are still changing = working (cap: 10 min of silence)
      if (sess.turnOpen && typeof sess.mtime === "number" && now - sess.mtime < 600) sess.claude_status = "busy";
    } else {
      jsonl = home ? claude.jsonlPathFor(home, cwd, sid) : null;
      events = jsonl ? claude.tailJsonl(jsonl) : [];
    }
    let act = latestActivity(events, maxChars, rules);
    const newestM = fromReader ? sess.mtime ?? null : home ? claude.newestSessionMtime(home, cwd, sid, jsonl) : null;
    if (newestM !== null && newestM !== undefined) {
      act.jsonl_mtime = newestM;
      if (act.last_ts === null) act.last_ts = newestM;
    }
    const parent = act;
    if (!fromReader && home) act = claude.enrichFromSubagents(home, cwd, sid, act, maxChars, rules, now);
    if (act !== parent) {
      // Turn-level facts come from the parent; a sub-agent's own unanswered tool is still a reason to need you.
      for (const k of ["pending_delegates", "turn_edited", "last_stop_ts", "saw_stop"]) if (k in parent) act[k] = parent[k];
      const subP = act.pending_tool;
      if (!subP || DELEGATE_TOOLS.has(subP.name)) {
        if (parent.pending_tool) act.pending_tool = parent.pending_tool;
        else delete act.pending_tool;
      }
    }

    const livePid = sess.pid && pidAlive(sess.pid) ? sess.pid : null;
    let [isIdle, activityKey, bubble, activeReason] = classifySession(sess, act, { busyWindow, now, live: Boolean(livePid) });
    const attention = attentionFor(sess, act, {
      isIdle, livePid, now, rules, attentionDir: this.attentionDir,
      subagentsLive: fromReader || !home ? 0 : claude.liveSubagentCount(home, cwd, sid, now),
    });
    let skill;
    if (fromReader) skill = sess.reviewMode && !isIdle ? "code-review" : null;
    else skill = !isIdle ? this.skills.current(jsonl, rules) : null;
    let skillArea = areaForSkill(skill, rules);
    if (skillArea && STRONG_KEYS.has(activityKey) && zoneFor(activityKey, mapping) !== skillArea) {
      this.skills.end(jsonl); // e.g. plan done, now editing code / running tests
      skill = null;
      skillArea = null;
    }
    if (attention.needsYou) {
      // Stay in the room of the work that is blocked (don't drift to Idle)
      const pend = act.pending_tool || {};
      if (pend.name) [activityKey] = bubbleFromTool(pend.name, pend.input || {}, maxChars, rules);
      isIdle = false;
      bubble = attention.reason || "Needs you";
      activeReason = activeReason || "needs-you";
    }
    let zoneKey = activityKey;
    if (phaseFor(activityKey) === "explore" && act.turn_work_key) zoneKey = act.turn_work_key; // stay where the real work is
    let zone = zoneFor(zoneKey, mapping, isIdle);
    let phase = phaseFor(zoneKey);
    if (skillArea && !isIdle) {
      zone = skillArea;
      phase = skillArea === "specs" ? "spec" : skillArea;
      if (bubble && !attention.needsYou) bubble = `${skillLabel(skill, rules)} · ${bubble}`;
    }
    if (isIdle && !s.board.showIdleBubbles) bubble = null;

    const brand = detectBrand(sess);
    const folder = shortNameFromCwd(cwd);
    const name = brand === "conductor"
      ? sess.name_hint || sess.secondary_directory_name || folder || "workspace"
      : folder || sess.name_hint || "session";
    return {
      id: sid, name,
      icon: iconForSession(sid, poolForBrand(cfg, brand), `icons/${brand}-00.png`),
      zone, state: isIdle ? "idle" : "active",
      bubble: bubble ? clip(bubble, maxChars) : null,
      task: activityKey,
      origin: brand === "conductor" ? "conductor" : "terminal",
      brand, cwd, livePid, open: Boolean(livePid),
      entrypoint: sess.entrypoint || null,
      activeReason, phase, skill, attention,
    };
  }
}
