// What's installed on this machine that changes how agents work, and which room each piece
// belongs in. Read-only, and only small files (the first few KB of each).
//   Claude Code: enabled plugins, skills, slash commands and sub-agents (~/.claude and each
//                project's .claude folder), with the name and description from their front matter.
//   Frameworks, from their footprints in the projects your agents work in: Spec Kit, Kiro,
//                OpenSpec, BMAD, Task Master, Superpowers.
//   Other agents: Codex custom prompts, Gemini custom commands (shown, mapped like skills).
// autoRules() turns that into extra skill → room rules and spec/plan file names. They sit
// between the built-in defaults and config.json / your own rules, which always win.
import { readdirSync, statSync, openSync, readSync, closeSync, readFileSync } from "node:fs";
import { join, basename, extname, sep } from "node:path";

const HEAD_BYTES = 4096;
const MAX_ITEMS = 400;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".venv", "__pycache__"]);

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const list = (p) => { try { return readdirSync(p); } catch { return []; } };

function head(path) {
  let fd;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ }
  }
}

/** name / description from YAML front matter (simple one-line values only). */
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || "");
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

function readItems(dir, kind, source, out) {
  if (!isDir(dir)) return;
  for (const entry of list(dir)) {
    if (out.length >= MAX_ITEMS) return;
    const p = join(dir, entry);
    if (kind === "skill") {
      const md = join(p, "SKILL.md");
      if (!isFile(md)) continue;
      const fm = frontMatter(head(md));
      out.push({ kind, name: (fm.name || entry).toLowerCase(), description: fm.description || "", source });
    } else if (isDir(p) && kind === "command") {
      // nested command folders become "folder:name"
      for (const f of list(p)) {
        if (extname(f) !== ".md" || out.length >= MAX_ITEMS) continue;
        const fm = frontMatter(head(join(p, f)));
        out.push({ kind, name: `${entry}:${basename(f, ".md")}`.toLowerCase(), description: fm.description || "", source });
      }
    } else if ([".md", ".toml"].includes(extname(entry))) {
      const text = head(p);
      const fm = frontMatter(text);
      const desc = fm.description || (/^description\s*=\s*"([^"]*)"/m.exec(text) || [])[1] || "";
      out.push({ kind, name: (fm.name || basename(entry, extname(entry))).toLowerCase(), description: desc, source });
    }
  }
}

/** Installed plugin folders: from installed_plugins.json, else every plugin under plugins/cache. */
function pluginDirs(home) {
  const root = join(home, "plugins");
  const found = new Set();
  try {
    const raw = JSON.parse(readFileSync(join(root, "installed_plugins.json"), "utf8"));
    const walk = (v) => {
      if (typeof v === "string") return;
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
        if (k === "installPath" && typeof x === "string") found.add(x);
        else walk(x);
      }
    };
    walk(raw);
  } catch { /* older layout: look around */ }
  if (!found.size) {
    const stack = [[join(root, "cache"), 0]];
    while (stack.length) {
      const [d, depth] = stack.pop();
      if (depth > 4) continue;
      if (isFile(join(d, ".claude-plugin", "plugin.json"))) { found.add(d); continue; }
      for (const e of list(d)) if (!SKIP_DIRS.has(e) && isDir(join(d, e))) stack.push([join(d, e), depth + 1]);
    }
  }
  return [...found].filter(isDir);
}

function enabledPlugins(home) {
  try {
    const s = JSON.parse(readFileSync(join(home, "settings.json"), "utf8"));
    return s && typeof s.enabledPlugins === "object" ? s.enabledPlugins : null;
  } catch {
    return null;
  }
}

function pluginName(dir) {
  try {
    const m = JSON.parse(readFileSync(join(dir, ".claude-plugin", "plugin.json"), "utf8"));
    if (m && m.name) return String(m.name);
  } catch { /* no manifest */ }
  const parts = dir.split(sep).filter(Boolean);
  return /^\d|^[0-9a-f]{7,}$/.test(parts.at(-1) || "") ? parts.at(-2) : parts.at(-1); // skip version folders
}

/** Framework footprints in one project folder. */
export function projectFrameworks(cwd) {
  const has = (...p) => isDir(join(cwd, ...p)) || isFile(join(cwd, ...p));
  const out = [];
  if (has(".specify")) out.push("speckit");
  if (has(".kiro", "specs") || has(".kiro", "steering")) out.push("kiro");
  if (has("openspec", "changes") || has("openspec", "project.md")) out.push("openspec");
  if (has(".bmad-core") || has("bmad") || has("_bmad") || has(".bmad")) out.push("bmad");
  if (has(".taskmaster")) out.push("taskmaster");
  return out;
}

export const FRAMEWORKS = {
  superpowers: { label: "Superpowers" },
  speckit: { label: "Spec Kit" },
  kiro: { label: "Kiro specs" },
  openspec: { label: "OpenSpec" },
  bmad: { label: "BMAD" },
  taskmaster: { label: "Task Master" },
};

/**
 * Scan the machine. claudeHomes: Claude Code folders; projects: folders agents work in;
 * codexHomes / geminiHomes for their custom prompts and commands.
 */
export function scanSetup({ claudeHomes = [], projects = [], codexHomes = [], geminiHomes = [] } = {}) {
  const items = [];
  const plugins = [];
  for (const home of claudeHomes) {
    const enabled = enabledPlugins(home);
    for (const dir of pluginDirs(home)) {
      const name = pluginName(dir);
      const on = !enabled || Object.entries(enabled).some(([k, v]) => v && k.split("@")[0] === name);
      const before = items.length;
      if (on) {
        readItems(join(dir, "skills"), "skill", `plugin:${name}`, items);
        readItems(join(dir, "commands"), "command", `plugin:${name}`, items);
        readItems(join(dir, "agents"), "agent", `plugin:${name}`, items);
      }
      plugins.push({ name, enabled: on, items: items.length - before });
    }
    readItems(join(home, "skills"), "skill", "you", items);
    readItems(join(home, "commands"), "command", "you", items);
    readItems(join(home, "agents"), "agent", "you", items);
  }
  for (const h of codexHomes) readItems(join(h, "prompts"), "command", "codex", items);
  for (const h of geminiHomes) readItems(join(h, "commands"), "command", "gemini", items);
  const frameworks = {};
  for (const cwd of projects) {
    const proj = basename(cwd);
    readItems(join(cwd, ".claude", "skills"), "skill", `project:${proj}`, items);
    readItems(join(cwd, ".claude", "commands"), "command", `project:${proj}`, items);
    readItems(join(cwd, ".claude", "agents"), "agent", `project:${proj}`, items);
    for (const f of projectFrameworks(cwd)) (frameworks[f] ||= new Set()).add(proj);
  }
  const names = new Set(items.map((i) => i.name.split(":").pop()));
  if (["brainstorming", "writing-plans", "executing-plans"].filter((n) => names.has(n)).length >= 2) (frameworks.superpowers ||= new Set());
  if ([...names].some((n) => n.startsWith("speckit."))) (frameworks.speckit ||= new Set());
  if ([...names].some((n) => n.startsWith("openspec"))) (frameworks.openspec ||= new Set());
  if ([...names].some((n) => /^bmad|bmad-/.test(n))) (frameworks.bmad ||= new Set());
  // one entry per name (a project skill with the same name as a personal one: first wins)
  const seen = new Set();
  const unique = items.filter((i) => (seen.has(i.name) ? false : seen.add(i.name)));
  return {
    plugins,
    items: unique,
    frameworks: Object.entries(frameworks).map(([id, set]) => ({ id, label: FRAMEWORKS[id]?.label || id, projects: [...set].sort() })),
  };
}

// ---- which room ---------------------------------------------------------------------
// Words in a name count three times as much as words in a description.
const KEYWORDS = {
  specs: ["spec", "specs", "specify", "requirement", "requirements", "brainstorm", "brainstorming", "prd", "user stor", "story", "stories", "persona", "ideation", "discovery", "product brief", "brief", "clarify", "analyst", "proposal", "constitution"],
  plan: ["plan", "plans", "planning", "design", "architect", "architecture", "roadmap", "breakdown", "tasks", "outline", "estimate", "strategy", "approach"],
  build: ["implement", "implementation", "build", "execute", "executing", "code", "coding", "develop", "development", "fix", "refactor", "debug", "debugging", "tdd", "feature", "migrate", "scaffold", "worktree", "commit"],
  review: ["review", "reviewing", "test", "tests", "testing", "qa", "verify", "verification", "audit", "lint", "check", "checklist", "security", "validate", "validation", "analyze", "analysis"],
  explore: ["research", "explore", "exploring", "search", "investigate", "learn", "docs", "documentation", "onboard", "understand", "find"],
};

const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Best room for a skill / command / agent from its name and description (null: no idea). */
export function guessArea(name, description = "") {
  const n = ` ${words(name.split(":").pop())} `;
  const d = ` ${words(description)} `;
  let best = null, bestScore = 0;
  for (const [area, keys] of Object.entries(KEYWORDS)) {
    let score = 0;
    for (const k of keys) {
      const w = ` ${k}`;
      if (n.includes(w)) score += 3;
      if (d.includes(w)) score += 1;
    }
    if (score > bestScore) { best = area; bestScore = score; }
  }
  return bestScore >= 2 ? best : null;
}

/** Names that are too generic to guess, per framework. */
const PROFILES = {
  speckit: {
    skillAreas: { "speckit.constitution": "specs", "speckit.specify": "specs", "speckit.clarify": "specs", "speckit.plan": "plan",
      "speckit.tasks": "plan", "speckit.implement": "build", "speckit.analyze": "review", "speckit.checklist": "review",
      specify: "specs", clarify: "specs", tasks: "plan", implement: "build", analyze: "review" },
    planFiles: ["research.md", "data-model.md", "quickstart.md"], specFiles: ["constitution.md", "checklist.md"],
  },
  openspec: {
    skillAreas: { "openspec-proposal": "specs", proposal: "specs", "openspec-apply": "build", apply: "build", "openspec-archive": "review", archive: "review" },
    planFiles: [], specFiles: ["proposal.md", "project.md"],
  },
  kiro: { skillAreas: {}, planFiles: ["design.md", "tasks.md"], specFiles: ["requirements.md"] },
  bmad: {
    skillAreas: { analyst: "specs", pm: "specs", po: "specs", "ux-expert": "specs", "ux-designer": "specs", architect: "plan", sm: "plan",
      dev: "build", qa: "review", "bmad-master": "explore", "bmad-orchestrator": "explore" },
    planFiles: ["architecture.md", "front-end-architecture.md"], specFiles: ["prd.md", "project-brief.md", "brief.md", "front-end-spec.md"],
  },
  taskmaster: { skillAreas: {}, planFiles: ["tasks.json"], specFiles: ["prd.txt"] },
  superpowers: { skillAreas: {}, planFiles: [], specFiles: [] },
};

/** Detected setup → { skillAreas, planFiles, specFiles, why: { name: "keywords"|"Spec Kit"|… } }. */
export function autoRules(setup) {
  const skillAreas = {}, why = {};
  const planFiles = new Set(), specFiles = new Set();
  for (const f of setup.frameworks || []) {
    const p = PROFILES[f.id];
    if (!p) continue;
    for (const [k, v] of Object.entries(p.skillAreas)) { skillAreas[k] = v; why[k] = f.label; }
    p.planFiles.forEach((x) => planFiles.add(x));
    p.specFiles.forEach((x) => specFiles.add(x));
  }
  for (const it of setup.items || []) {
    const key = it.name.split(":").pop();
    if (key in skillAreas) continue;
    const area = guessArea(it.name, it.description);
    if (area) { skillAreas[key] = area; why[key] = "keywords"; }
  }
  return { skillAreas, planFiles: [...planFiles], specFiles: [...specFiles], why };
}
