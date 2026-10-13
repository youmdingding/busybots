// Turning transcript events into what the board shows: activity key, bubble, room,
// phase and badges. The shared scenarios in tests/scenarios/ pin its behaviour.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { hasChildProcesses } from "./proc.js";

export const CLAUDE_BUSY = new Set(["busy", "running", "active"]);
export const CONDUCTOR_ACTIVE = new Set(["working", "busy", "running", "active"]);
export const CONDUCTOR_MIDTURN = new Set(["waiting"]);
export const ASK_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);
export const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
export const DELEGATE_TOOLS = new Set(["Agent", "Task"]);
// A tool call with no result after this long (and nothing running under the agent's
// process) is almost certainly sitting on a permission prompt.
const QUICK_TOOL_PENDING_S = 6;
const SLOW_TOOL_PENDING_S = 45;
const STUCK_ERRORS = 3;
export const STRONG_KEYS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash.test", "Browser.verify"]);

export const DEFAULT_SKILL_AREAS = {
  plan: "plan", planning: "plan", roadmap: "plan", design: "plan",
  spec: "specs", specs: "specs", specify: "specs", "spec-kit": "specs", speckit: "specs",
  review: "review", "code-review": "review", "pr-review": "review", "security-review": "review",
  test: "review", testing: "review",
  build: "build", implement: "build", refactor: "build", hotfix: "build", debug: "build",
  explore: "explore", research: "explore", "deep-research": "explore", investigate: "explore",
};
export const DEFAULT_SKILL_LABELS = {
  plan: "Planning", planning: "Planning", spec: "Specs", "spec-kit": "Specs",
  review: "Reviewing", "code-review": "Reviewing", "pr-review": "Reviewing",
  test: "Testing", testing: "Testing", debug: "Debugging",
  explore: "Exploring", research: "Researching", "deep-research": "Researching",
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const lowerList = (v) => (Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : []);
const lowerMap = (v) => Object.fromEntries(Object.entries(isObj(v) ? v : {}).map(([k, x]) => [String(k).toLowerCase(), x]));

/**
 * Classification rules: config.json defaults merged with the user's settings.rules.
 * Pass the result around instead of using module state.
 */
export function makeRules(config = {}, userRules = {}) {
  const pf = isObj(config.phaseFiles) ? config.phaseFiles : {};
  const upf = isObj(userRules.phaseFiles) ? userRules.phaseFiles : {};
  return {
    activityAreas: { ...(config.activityAreas || config.activityZones || {}) },
    skillAreas: { ...DEFAULT_SKILL_AREAS, ...lowerMap(config.skillAreas), ...lowerMap(userRules.skillAreas) },
    skillLabels: { ...lowerMap(config.skillLabels), ...lowerMap(userRules.skillLabels) },
    testCommands: [...lowerList(config.testCommands), ...lowerList(userRules.testCommands)],
    planFiles: [...lowerList(pf.plan), ...lowerList(upf.plan)],
    specFiles: [...lowerList(pf.spec), ...lowerList(upf.spec)],
    doneHours: Number(config.doneHours) || 12,
  };
}

// ---- small text helpers ----------------------------------------------------------

export function clip(text, maxChars) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars - 1).trimEnd() + "…";
}

export function basenamePath(p) {
  if (!p || typeof p !== "string") return null;
  const s = p.trim().replace(/^['"]+|['"]+$/g, "");
  if (!s) return null;
  let name = s.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  if (name.length > 28) name = name.slice(0, 25) + "…";
  return name || null;
}

/** Visible assistant line for bubbles — no markdown, first sentence, no "Let me…". */
export function cleanAssistantText(raw, maxChars) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  s = s.replace(/https?:\/\/\S+/g, "");
  s = s.replace(/#{1,6}\s*/g, "");
  s = s.replaceAll("**", "").replaceAll("__", "").replaceAll("*", "").replaceAll("_", "").replaceAll("`", "");
  s = s.replace(/^\s*[-*•]\s+/gm, "");
  s = s.replace(/^\s*\d+[.)]\s+/gm, "");
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  let candidate = lines[0];
  if (candidate.length < 12 && lines.length > 1) candidate = `${candidate} ${lines[1]}`.trim();
  const m = /[.!?]/.exec(candidate);
  if (m && m.index + 1 >= 20) candidate = candidate.slice(0, m.index + 1).trim();
  candidate = candidate.replace(/\s+/g, " ").trim();
  const stripped = candidate.replace(/^(?:let me|i(?:'?ll| am going to|'m going to)|okay[, ]+|ok[, ]+|sure[, ]+)\s+/i, "").trim();
  if (stripped.length >= 12) {
    candidate = stripped;
    const c0 = candidate[0];
    if (c0 && c0 === c0.toLowerCase() && c0 !== c0.toUpperCase()) candidate = c0.toUpperCase() + candidate.slice(1);
  }
  if (candidate.length < 3) return null;
  return clip(candidate, maxChars);
}

export function parseTs(ts) {
  if (ts === null || ts === undefined) return null;
  if (typeof ts === "number") return ts > 1e10 ? ts / 1000 : ts;
  if (typeof ts === "string") {
    const t = Date.parse(ts);
    return Number.isNaN(t) ? null : t / 1000;
  }
  return null;
}

// ---- tool → activity key ---------------------------------------------------------

const TEST_NEEDLES = [
  "pytest", "vitest", "jest", "mocha", "phpunit", "cargo test", "go test",
  "npm test", "pnpm test", "yarn test", "npm run test", "pnpm run test",
  "eslint", "prettier", "ruff", "flake8", "mypy", "tsc --noemit", "tsc -p",
  "lint", "playwright", "cypress", "puppeteer", "selenium",
  "e2e", "end-to-end", "end to end", "browser test", "browser verif",
  "chromium", "webkit", "test:e2e", "test:browser",
];

export function isTestOrLintCmd(cmd, rules) {
  const c = String(cmd || "").toLowerCase();
  return TEST_NEEDLES.some((n) => c.includes(n)) || rules.testCommands.some((n) => c.includes(n));
}

function isBrowserVerifyTool(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("claude-in-chrome") || n.includes("playwright") || n.includes("cypress")) return true;
  if (n.startsWith("mcp__") && ["chrome", "browser", "playwright", "cypress"].some((m) => n.includes(m))) return true;
  return n.includes("computer") || n.endsWith("__screenshot") || n.endsWith("__navigate");
}

function reviewPathSuffix(pathOrText) {
  const s = String(pathOrText || "").toLowerCase().replaceAll("\\", "/");
  if (!s) return false;
  return ["/e2e/", "e2e.", ".e2e.", "playwright", "cypress", "puppeteer", "/tests/e2e", "test-e2e", "browser.spec", "browser.test"]
    .some((b) => s.includes(b));
}

/** ".spec" / ".plan" / "" from a file path or free text. */
export function pathPhaseSuffix(pathOrText, rules) {
  const s = String(pathOrText || "").toLowerCase().replaceAll("\\", "/");
  if (!s) return "";
  const name = s.split("/").pop();
  if (["plan.md", "tasks.md", "roadmap.md", "design.md", "implementation-plan.md"].includes(name)
      || rules.planFiles.includes(name) || name.endsWith("-plan.md") || name.endsWith("_plan.md")) return ".plan";
  if (["spec.md", "requirements.md", "prd.md", "brief.md", "rfc.md"].includes(name)
      || rules.specFiles.includes(name) || name.endsWith("-spec.md")) return ".spec";
  if (["/spec/", "/specs/", "specs/", "spec.md", "requirements", "/prd", "prd.md", "/rfc/", "rfc.md", "user-stor", "acceptance", "brief.md"]
    .some((b) => s.includes(b))) return ".spec";
  if (["/plan/", "plan.md", "roadmap", "architecture", "design.md", "design/", "todo.md", "tasks.md", "implementation-plan", "tech-design"]
    .some((b) => s.includes(b))) return ".plan";
  return "";
}

/** [activity key, bubble text] for a tool call. */
export function bubbleFromTool(name, inp, maxChars, rules) {
  name = name || "unknown";
  inp = isObj(inp) ? inp : {};
  const rawPath = String(inp.file_path || inp.path || inp.pattern || "");
  const phase = pathPhaseSuffix(rawPath, rules) || pathPhaseSuffix(String(inp.description || ""), rules);

  if (EDIT_TOOLS.has(name)) {
    const fp = basenamePath(inp.file_path || inp.path);
    if (rawPath.replaceAll("\\", "/").includes("/.claude/")) return ["Edit.memory", clip("Updating notes", maxChars)];
    let key;
    if (reviewPathSuffix(rawPath)) key = "Edit.review";
    else {
      key = phase ? `${name}${phase}` : name;
      if (name === "NotebookEdit" && phase) key = `Edit${phase}`;
    }
    return [key, clip(fp ? `Editing ${fp}` : "Editing files", maxChars)];
  }
  if (name === "Read") {
    const fp = basenamePath(inp.file_path || inp.path);
    const key = reviewPathSuffix(rawPath) ? "Read.review" : phase ? `Read${phase}` : name;
    return [key, clip(fp ? `Reading ${fp}` : "Reading files", maxChars)];
  }
  if (name === "Grep" || name === "Glob") {
    const key = reviewPathSuffix(rawPath) ? `${name}.review` : phase ? `${name}${phase}` : name;
    return [key, clip(`Searching with ${name}`, maxChars)];
  }
  if (name === "WebFetch") return [name, clip("Fetching a page", maxChars)];
  if (name === "WebSearch") return [name, clip("Searching the web", maxChars)];
  if (name === "ToolSearch") return [name, clip("Looking up tools", maxChars)];
  if (name === "Bash") {
    const cmd = String(inp.command || "");
    const desc = String(inp.description || "").trim();
    if (isTestOrLintCmd(cmd, rules) || isTestOrLintCmd(desc, rules)) {
      const blob = `${cmd} ${desc}`.toLowerCase();
      if (["eslint", "lint", "ruff", "prettier", "flake8"].some((x) => blob.includes(x))) return ["Bash.test", clip("Running lint", maxChars)];
      if (["playwright", "cypress", "e2e", "puppeteer", "browser"].some((x) => blob.includes(x))) return ["Bash.test", clip("Running E2E", maxChars)];
      return ["Bash.test", clip("Running tests", maxChars)];
    }
    return ["Bash.other", clip(desc || "Running a command", maxChars)];
  }
  if (["Agent", "Task", "TaskCreate", "TaskUpdate"].includes(name)) {
    const desc = String(inp.description || inp.prompt || "");
    if (isTestOrLintCmd(desc, rules) || reviewPathSuffix(desc)) return ["Bash.test", clip("Delegating E2E/review", maxChars)];
    return [name, clip("Delegating work", maxChars)];
  }
  const shortName = () => {
    let short = name.includes("__") ? name.split("__").pop() : name;
    if (short.length > 24) short = short.slice(0, 21) + "…";
    return short;
  };
  if (isBrowserVerifyTool(name)) {
    const short = shortName();
    const label = { navigate: "Browsing the app", screenshot: "Capturing the UI", computer: "Verifying in browser",
      find: "Finding UI elements", tabs_context: "Checking browser tabs" }[short] || `Browser · ${short}`;
    return ["Browser.verify", clip(label, maxChars)];
  }
  if (name.startsWith("mcp__") || name.startsWith("mcp_")) return ["WebFetch", clip(`Using ${shortName()}`, maxChars)];
  return [name, clip(`Using ${name}`, maxChars)];
}

export function phaseFor(key) {
  const k = key || "";
  if (k === "idle" || k === "waiting") return "idle";
  if (k.endsWith(".spec")) return "spec";
  if (k.endsWith(".plan")) return "plan";
  if (k.endsWith(".review")) return "review";
  if (k === "Bash.test" || k === "Browser.verify") return "test";
  if (["Read", "Grep", "Glob", "WebFetch", "WebSearch", "ToolSearch"].includes(k)) return "explore";
  if (["Agent", "Task", "TaskCreate", "TaskUpdate"].includes(k)) return "delegate";
  if (k === "thinking" || k === "assistant") return "think";
  return "build";
}

export function zoneFor(key, mapping, isIdle = false) {
  if (isIdle) return mapping.idle || mapping.waiting || "idle";
  return mapping[key] || mapping.active || mapping.default || mapping.build || "build";
}

export function areaForSkill(skill, rules) {
  if (!skill) return null;
  const name = skill.toLowerCase().split(":").pop();
  if (Object.prototype.hasOwnProperty.call(rules.skillAreas, name)) return rules.skillAreas[name] || null;
  for (const [frag, area] of [["plan", "plan"], ["spec", "specs"], ["review", "review"], ["test", "review"], ["explor", "explore"], ["research", "explore"]]) {
    if (name.includes(frag)) return area;
  }
  return null;
}

export function skillLabel(skill, rules) {
  const n = String(skill || "").split(":").pop().toLowerCase();
  return rules.skillLabels[n] || DEFAULT_SKILL_LABELS[n] || `/${n}`;
}

// ---- transcript → activity ---------------------------------------------------------

const isToolResultList = (content) => Array.isArray(content) && content.some((c) => isObj(c) && c.type === "tool_result");

/** Derive activity from transcript events (Claude-shaped). */
export function latestActivity(events, maxChars, rules) {
  let lastTs = null, lastTool = null, lastAssistantText = null, lastAssistantTextTs = null;
  let lastThinkingTs = null, lastUserPromptTs = null, lastStopTs = null, lastQueueTs = null, lastResultTs = null;
  const toolUses = []; // [id, name, input, ts]
  const resultIds = new Set();
  const resultErrors = [];
  const maxOf = (a, b) => (a === null ? b : Math.max(a, b));

  for (const o of events) {
    const ts = parseTs(o.timestamp);
    if (ts !== null) lastTs = maxOf(lastTs, ts);
    const typ = o.type;
    if (typ === "system" && ["stop_hook_summary", "turn_duration", "away_summary"].includes(o.subtype)) {
      if (ts !== null) lastStopTs = maxOf(lastStopTs, ts);
      continue;
    }
    if (typ === "queue-operation") {
      if (ts !== null) lastQueueTs = maxOf(lastQueueTs, ts);
      continue;
    }
    if (typ === "user") {
      const content = o.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (isObj(c) && c.type === "tool_result") {
            if (c.tool_use_id) resultIds.add(String(c.tool_use_id));
            resultErrors.push(Boolean(c.is_error));
            if (ts !== null) lastResultTs = ts;
          }
        }
      }
      if (!("toolUseResult" in o) && !isToolResultList(content) && ts !== null) lastUserPromptTs = ts;
      continue;
    }
    if (typ !== "assistant") continue;
    const content = o.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isObj(block)) continue;
      if (block.type === "tool_use") {
        lastTool = [String(block.name || "tool"), block.input || {}, ts];
        toolUses.push([String(block.id || ""), lastTool[0], lastTool[1], ts]);
      } else if (block.type === "thinking") {
        lastThinkingTs = ts;
      } else if (block.type === "text") {
        const cleaned = cleanAssistantText(String(block.text || ""), maxChars);
        if (cleaned) {
          lastAssistantText = cleaned;
          lastAssistantTextTs = ts;
        }
      }
    }
  }

  const result = {
    activity_key: "idle", bubble: "Waiting for you", assistant_text: null,
    last_ts: lastTs, last_tool_ts: lastTool ? lastTool[2] : null,
    last_user_prompt_ts: lastUserPromptTs, last_queue_ts: lastQueueTs, saw_stop: false,
  };
  // A stop marker only counts if it closed the latest user turn
  let sawStop = false;
  if (lastStopTs !== null && (lastUserPromptTs === null || lastStopTs >= lastUserPromptTs)) {
    const toolTs = lastTool ? lastTool[2] : null;
    if (toolTs === null || lastStopTs >= toolTs) sawStop = true;
  }
  result.saw_stop = sawStop;
  result.last_stop_ts = lastStopTs;

  let pending = toolUses.filter((t) => t[0] && !resultIds.has(t[0]));
  if (pending.length && lastUserPromptTs !== null && pending.at(-1)[3] !== null && pending.at(-1)[3] < lastUserPromptTs) pending = [];
  if (pending.length) {
    const [, pname, pinp, pts] = pending.at(-1);
    result.pending_tool = { name: pname, input: isObj(pinp) ? pinp : {}, ts: pts };
  }
  result.pending_delegates = pending.filter((t) => DELEGATE_TOOLS.has(t[1])).length;
  let trailing = 0;
  for (let i = resultErrors.length - 1; i >= 0 && resultErrors[i]; i--) trailing++;
  result.trailing_errors = trailing;
  const turnStart = lastUserPromptTs || 0;
  result.turn_edited = toolUses.some((t) => EDIT_TOOLS.has(t[1]) && (t[3] || 0) >= turnStart);
  result.last_result_ts = lastResultTs;
  // Most recent "real work" in this turn: reading while implementing stays in Build.
  let workKey = null;
  for (let i = toolUses.length - 1; i >= 0; i--) {
    const t = toolUses[i];
    if ((t[3] || 0) < turnStart) break;
    const [k] = bubbleFromTool(t[1], isObj(t[2]) ? t[2] : {}, 60, rules);
    if (!["explore", "think", "idle"].includes(phaseFor(k)) && k !== "Edit.memory") {
      workKey = k;
      break;
    }
  }
  result.turn_work_key = workKey;
  result.assistant_text = lastAssistantText;
  result.last_assistant_text_ts = lastAssistantTextTs;

  let toolKey = null, toolBubble = null, toolTs = null;
  if (lastTool) {
    toolTs = lastTool[2];
    [toolKey, toolBubble] = bubbleFromTool(lastTool[0], isObj(lastTool[1]) ? lastTool[1] : {}, maxChars, rules);
  }
  const toolNewer = toolKey !== null && toolTs !== null && (lastAssistantTextTs === null || toolTs > lastAssistantTextTs);
  if (toolNewer) {
    result.activity_key = toolKey;
    result.bubble = toolBubble;
  } else if (lastAssistantText) {
    result.activity_key = sawStop ? "waiting" : "assistant";
    result.bubble = lastAssistantText;
  } else if (toolKey) {
    result.activity_key = toolKey;
    result.bubble = toolBubble;
  } else if (lastThinkingTs !== null) {
    result.activity_key = "thinking";
    result.bubble = "Thinking";
  } else if (lastQueueTs !== null || lastUserPromptTs !== null) {
    result.activity_key = "thinking";
    result.bubble = "Working";
  }
  return result;
}

/** [isIdle, activityKey, bubble, activeReason] — busy only when the signals say so. */
export function classifySession(sess, act, { busyWindow, now, live }) {
  const age = (t) => (typeof t === "number" ? now - t : null);
  const toolAge = age(act.last_tool_ts);
  const asstAge = age(act.last_assistant_text_ts);
  const jsonlAge = age(act.jsonl_mtime);
  const claudeStatus = String(sess.claude_status || "").toLowerCase();
  const conductorStatus = String(sess.conductor_status || "").toLowerCase();
  const effectiveWindow = Math.max(busyWindow, 90);
  const claudeBusy = CLAUDE_BUSY.has(claudeStatus);
  const conductorBusy = CONDUCTOR_ACTIVE.has(conductorStatus);
  const conductorMidturn = CONDUCTOR_MIDTURN.has(conductorStatus) && live;
  const recentTool = toolAge !== null && toolAge <= effectiveWindow;
  const recentJsonl = live && jsonlAge !== null && jsonlAge <= 60;
  const statusBusy = claudeBusy || conductorBusy || conductorMidturn;
  const recentAsstWhileBusy = statusBusy && asstAge !== null && asstAge <= effectiveWindow;

  let reason = null;
  if (claudeBusy) reason = `claude:${claudeStatus}`;
  else if (conductorBusy) reason = `conductor:${conductorStatus}`;
  else if (conductorMidturn) reason = "conductor:waiting+live";
  else if (recentJsonl) reason = `jsonl:${Math.trunc(jsonlAge)}s`;
  else if (recentTool) reason = `tool:${Math.trunc(toolAge)}s`;
  else if (recentAsstWhileBusy) reason = `asst+busy:${Math.trunc(asstAge)}s`;

  // The turn has clearly ended: don't wait out the "recent activity" windows.
  if (reason !== null && act.saw_stop && !act.pending_tool && !claudeBusy && !conductorBusy && !conductorMidturn) reason = null;

  const assistantText = act.assistant_text || null;
  if (reason === null) return [true, "idle", assistantText || "Waiting for you", null];

  let key = act.activity_key || "build";
  let bubble = act.bubble || "Working";
  if (key === "idle" || key === "waiting") {
    if (assistantText) {
      bubble = assistantText;
      key = "assistant";
    } else if (recentTool && act.bubble) {
      bubble = act.bubble;
      key = act.activity_key || "build";
    } else {
      key = "build";
      bubble = "Working";
    }
  }
  return [false, key, bubble, reason];
}

// ---- badges --------------------------------------------------------------------------

export function readAttentionMarker(attentionDir, sessionId) {
  if (!attentionDir) return null;
  const p = join(attentionDir, `${sessionId}.json`);
  try {
    const data = JSON.parse(readFileSync(p, "utf8"));
    if (!isObj(data)) return null;
    data._mtime = statSync(p).mtimeMs / 1000;
    return data;
  } catch {
    return null;
  }
}

export function describePending(name, inp) {
  if (name === "AskUserQuestion") return "Has a question for you";
  if (name === "ExitPlanMode") return "Plan ready for your OK";
  if (name === "Bash") {
    const d = String(inp.description || "").trim();
    return d ? `Approve: ${d}` : "Approve a command";
  }
  if (EDIT_TOOLS.has(name)) {
    const fp = basenamePath(inp.file_path || inp.path);
    return fp ? `Approve edit: ${fp}` : "Approve an edit";
  }
  return `Approve ${name.includes("__") ? name.split("__").pop() : name}`;
}

/** Badges: needsYou (+reason), done, subagents, stuck/errors. */
export function attentionFor(sess, act, { isIdle, livePid, now, rules, subagentsLive, attentionDir, childProbe = hasChildProcesses }) {
  const out = { needsYou: false, reason: null, done: false, subagents: 0, stuck: false, errors: 0 };
  const lastActivity = Math.max(0, ...[act.last_ts, act.jsonl_mtime].filter((t) => typeof t === "number"));

  // 1) exact: Notification hook marker newer than any transcript activity
  const marker = readAttentionMarker(attentionDir, sess.sessionId);
  if (marker) {
    const msg = String(marker.message || "");
    const fresh = marker._mtime > lastActivity + 0.5 && now - marker._mtime < 6 * 3600;
    if (fresh && msg.toLowerCase().includes("permission")) {
      out.needsYou = true;
      out.reason = clip(msg, 60) || "Needs your permission";
    }
  }
  // 2) heuristics from the transcript
  const pend = act.pending_tool;
  if (!out.needsYou && pend && (livePid || sess.conductor_status)) {
    const name = pend.name || "";
    const age = now - Number(pend.ts || now);
    const inp = pend.input || {};
    if (ASK_TOOLS.has(name)) out.needsYou = true;
    else if (livePid && !DELEGATE_TOOLS.has(name)) {
      const slow = name === "WebFetch" || name === "WebSearch" || name.startsWith("mcp__");
      if (age >= (slow ? SLOW_TOOL_PENDING_S : QUICK_TOOL_PENDING_S) && !childProbe(livePid)) out.needsYou = true;
    }
    if (out.needsYou) out.reason = describePending(name, inp);
  }
  // 3) done: the last turn finished after editing files, and you haven't replied yet
  const stopTs = act.last_stop_ts;
  if (isIdle && !out.needsYou && act.saw_stop && act.turn_edited && typeof stopTs === "number" && now - stopTs < rules.doneHours * 3600) out.done = true;
  // 4) delegating
  if (!isIdle) out.subagents = Math.max(Number(subagentsLive) || 0, Number(act.pending_delegates) || 0);
  // 5) stuck
  const errs = Number(act.trailing_errors) || 0;
  out.errors = errs;
  if (!isIdle && errs >= STUCK_ERRORS) out.stuck = true;
  return out;
}
