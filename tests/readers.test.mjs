// Reader edge cases that the shared scenarios don't cover: odd but valid files must
// not drop lines, invent steps, or hide other sessions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { materialize } from "./lib/materialize.mjs";
import * as codex from "../src/readers/codex.js";
import * as cursor from "../src/readers/cursor.js";

const SCEN = join(dirname(fileURLToPath(import.meta.url)), "scenarios");
const scenario = (name) => JSON.parse(readFileSync(join(SCEN, `${name}.json`), "utf8"));

function withHome(spec, fn) {
  const { home, procs } = materialize(spec);
  try {
    return fn(home);
  } finally {
    for (const p of Object.values(procs)) p.kill();
    rmSync(home, { recursive: true, force: true });
  }
}

test("codex: a U+2028 inside a message doesn't split the record", () => {
  const spec = { files: [{ path: ".codex/sessions/{{today:/}}/rollout-x-ls.jsonl", jsonl: [
    { timestamp: "{{t:-60}}", type: "session_meta", payload: { id: "cx-ls", cwd: "/work/a" } },
    { timestamp: "{{t:-50}}", type: "event_msg", payload: { type: "task_started" } },
    { timestamp: "{{t:-40}}", type: "response_item", payload: { type: "message", role: "assistant",
      content: [{ type: "output_text", text: "First part second part" }] } },
  ] }] };
  withHome(spec, (home) => {
    const s = codex.discover([join(home, ".codex")], 30).get("cx-ls");
    assert.ok(s, "session found");
    const texts = s.events.flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : [])).filter((c) => c.type === "text");
    assert.equal(texts.length, 1);
    assert.match(texts[0].text, /second part/);
  });
});

test("codex: write_stdin calls and their outputs are not shown as steps", () => {
  const spec = { files: [{ path: ".codex/sessions/{{today:/}}/rollout-x-stdin.jsonl", jsonl: [
    { timestamp: "{{t:-60}}", type: "session_meta", payload: { id: "cx-stdin", cwd: "/work/a" } },
    { timestamp: "{{t:-50}}", type: "event_msg", payload: { type: "task_started" } },
    { timestamp: "{{t:-40}}", type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "c1", arguments: "{\"cmd\":\"npm run dev\"}" } },
    { timestamp: "{{t:-39}}", type: "response_item", payload: { type: "function_call_output", call_id: "c1", output: "started" } },
    { timestamp: "{{t:-30}}", type: "response_item", payload: { type: "function_call", name: "write_stdin", call_id: "c2", arguments: "{\"chars\":\"q\"}" } },
    { timestamp: "{{t:-29}}", type: "response_item", payload: { type: "function_call_output", call_id: "c2", output: "Process exited with code 1" } },
  ] }] };
  withHome(spec, (home) => {
    const s = codex.discover([join(home, ".codex")], 30).get("cx-stdin");
    const blocks = s.events.flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : []));
    const toolIds = blocks.filter((b) => b.type === "tool_use").map((b) => b.id);
    const resultIds = blocks.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id);
    assert.deepEqual(toolIds, ["c1"]);
    assert.deepEqual(resultIds, ["c1"]); // no orphan (failing) result for c2
  });
});

test("cursor: a meta.json that isn't an object doesn't hide the chat", () => {
  const spec = scenario("cursor_running");
  withHome(spec, (home) => {
    const metaPath = join(home, spec.files.find((f) => f.path.endsWith("meta.json")).path);
    writeFileSync(metaPath, "[]");
    const found = cursor.discover([join(home, ".cursor")], 30);
    assert.equal(found.size, 1);
    assert.equal([...found.values()][0].cwd, "");
  });
});
