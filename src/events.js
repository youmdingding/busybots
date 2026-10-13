// Shared event shapes for agent readers.
//
// Every reader turns its agent's session files into Claude-Code-shaped events so the
// watcher's logic (rooms, bubbles, done / stuck badges) works for all of them:
//   user prompt  {type:"user", timestamp, message:{content:"text"}}
//   tool result  {type:"user", timestamp, toolUseResult:true, message:{content:[{type:"tool_result", tool_use_id, is_error}]}}
//   assistant    {type:"assistant", timestamp, message:{content:[{type:"text"|"thinking"|"tool_use", ...}]}}
//   end of turn  {type:"system", subtype:"turn_duration", timestamp}
// A reader's discover(homes, recentMinutes) returns Map(sessionId → session) where a session
// has the watcher's keys plus: events, turnOpen, mtime (epoch seconds), reviewMode.

export const COMMON_TOOL_MAP = {
  shell: "Bash", bash: "Bash", run_shell_command: "Bash", exec_command: "Bash", run_terminal_cmd: "Bash",
  edit: "Edit", replace: "Edit", strreplace: "Edit", str_replace: "Edit", patch: "Edit", apply_patch: "Edit",
  multiedit: "MultiEdit", write: "Write", write_file: "Write",
  read: "Read", read_file: "Read", read_many_files: "Read", view_image: "Read",
  grep: "Grep", grep_search: "Grep", search_file_content: "Grep", codebase_search: "Grep",
  glob: "Glob", list: "Glob", ls: "Glob", list_directory: "Glob", list_dir: "Glob", file_search: "Glob",
  webfetch: "WebFetch", web_fetch: "WebFetch", websearch: "WebSearch", web_search: "WebSearch", google_web_search: "WebSearch",
  todowrite: "TodoWrite", write_todos: "TodoWrite", update_plan: "TodoWrite",
  task: "Agent", subagent: "Agent", invoke_agent: "Agent",
  question: "AskUserQuestion", ask_user: "AskUserQuestion",
  exit_plan_mode: "ExitPlanMode",
};
const PATH_KEYS = ["file_path", "filePath", "path", "absolute_path", "target_file", "file"];
const COMMAND_KEYS = ["command", "cmd"];

export const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Epoch seconds → ISO string (UTC), or null. */
export function iso(ts) {
  if (ts === null || ts === undefined || Number.isNaN(Number(ts))) return null;
  return new Date(Number(ts) * 1000).toISOString();
}

/** Agent tool name + input → [Claude-style name, input with file_path / command]. */
export function mapTool(name, inp) {
  const input = isObj(inp) ? inp : {};
  const key = String(name || "").trim();
  const mapped = COMMON_TOOL_MAP[key.toLowerCase()] || key || "tool";
  const out = {};
  if (mapped === "Bash") {
    for (const k of COMMAND_KEYS) {
      if (input[k]) {
        out.command = Array.isArray(input[k]) ? input[k].map(String).join(" ") : String(input[k]);
        break;
      }
    }
    if (input.description) out.description = String(input.description);
  } else {
    for (const k of PATH_KEYS) {
      if (typeof input[k] === "string" && input[k]) {
        out.file_path = input[k];
        break;
      }
    }
    for (const k of ["pattern", "query", "url", "description", "skill"]) {
      if (typeof input[k] === "string" && input[k]) out[k] = input[k];
    }
  }
  return [mapped, out];
}

export const evUser = (ts, text) => ({ type: "user", timestamp: ts, message: { content: String(text).slice(0, 400) } });
export const evText = (ts, text) => ({ type: "assistant", timestamp: ts, message: { content: [{ type: "text", text: String(text) }] } });
export const evThinking = (ts) => ({ type: "assistant", timestamp: ts, message: { content: [{ type: "thinking", thinking: "" }] } });
export const evTool = (ts, callId, name, input) =>
  ({ type: "assistant", timestamp: ts, message: { content: [{ type: "tool_use", id: String(callId), name, input }] } });
export const evResult = (ts, callId, isError = false) =>
  ({ type: "user", timestamp: ts, toolUseResult: true, message: { content: [{ type: "tool_result", tool_use_id: String(callId), is_error: Boolean(isError) }] } });
export const evStop = (ts) => ({ type: "system", subtype: "turn_duration", timestamp: ts });

/** A session record in the shape the watcher expects. */
export function session(source, sid, cwd, events, { turnOpen, mtime, nameHint = null, title = null, entrypoint = null, reviewMode = false, extra = {} }) {
  return {
    pid: null,
    sessionId: sid,
    cwd,
    claude_status: "",
    conductor_status: "",
    name_hint: nameHint,
    title,
    entrypoint: entrypoint || source,
    source,
    agent_type: source,
    cmdline: source,
    events,
    turnOpen: Boolean(turnOpen),
    mtime,
    reviewMode: Boolean(reviewMode),
    ...extra,
  };
}

/** Agent-panel items (user turns, assistant text, tool steps) from normalized events. */
export function transcript(events, limit = 15) {
  const items = [];
  for (const e of events) {
    const ts = e.timestamp;
    if (e.type === "user" && !e.toolUseResult) {
      const text = String(e.message?.content ?? "");
      if (text && text !== "(new turn)") items.push({ kind: "user", text: text.slice(0, 120), ts });
    } else if (e.type === "assistant") {
      for (const b of e.message?.content || []) {
        if (b.type === "text" && b.text) {
          const first = String(b.text).split("\n").map((l) => l.trim()).find(Boolean) || "";
          if (first) items.push({ kind: "assistant", text: first.slice(0, 180), ts });
        } else if (b.type === "tool_use") {
          const inp = b.input || {};
          let detail = inp.command || inp.file_path || inp.query || inp.pattern || "";
          detail = detail ? String(detail).split("\n")[0].slice(0, 60) : "";
          items.push({ kind: "tool", text: b.name + (detail ? ` · ${detail}` : ""), ts });
        }
      }
    }
  }
  return items.slice(-limit);
}

const reported = new Set();
/** One malformed session must not hide the others: skip it and say so once. */
export function skipBad(source, where, err) {
  const key = `${source}:${where}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.error(`${source}: skipped ${where}: ${err && err.message ? err.message : err}`);
}
