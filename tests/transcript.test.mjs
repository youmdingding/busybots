// The agent panel shows the last 15 messages from you and the agent, with the tool
// steps in between.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lastMessages } from "../src/events.js";

const msg = (kind, i) => ({ kind, text: `${kind} ${i}` });

test("keeps the last N messages and the tool steps between and after them", () => {
  const items = [];
  for (let i = 0; i < 20; i++) items.push(msg(i % 2 ? "assistant" : "user", i), msg("tool", i), msg("tool", `${i}b`));
  const out = lastMessages(items, 15);
  assert.equal(out.filter((x) => x.kind !== "tool").length, 15);
  assert.equal(out[0].text, "assistant 5");          // starts at the 15th message from the end
  assert.equal(out.at(-1).text, "tool 19b");         // trailing steps kept
  assert.equal(out.filter((x) => x.kind === "tool").length, 30);
});

test("fewer messages than the limit: everything, but a runaway tool list is capped", () => {
  assert.deepEqual(lastMessages([msg("user", 1), msg("tool", 1)], 15).length, 2);
  const many = [msg("user", 0), ...Array.from({ length: 500 }, (_, i) => msg("tool", i))];
  assert.equal(lastMessages(many, 15).length, 200);
});
