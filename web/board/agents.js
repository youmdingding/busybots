// Agent filter chips and Claude Code seat slots.
import { S } from "./state.js";
import { AGENT_FILTERS } from "./constants.js";

export function normalizeAgentFilter(raw) {
  const s = String(raw || "").toLowerCase();
  return AGENT_FILTERS.has(s) ? s : "all";
}

/** Resolve brand bucket for Agents filter chips. */
export function botBrandKey(b) {
  const brand = String(b?.brand || "").toLowerCase();
  if (AGENT_FILTERS.has(brand) && brand !== "all") return brand;
  const origin = String(b?.origin || "").toLowerCase();
  if (brand === "codex" || origin === "codex") return "codex";
  if (brand === "conductor" || origin === "conductor") return "conductor";
  if (brand === "claude" || origin === "terminal" || origin === "claude") return "claude";
  // icon path heuristics (icons/codex-*.png etc.)
  const icon = String(b?.icon || "").toLowerCase();
  if (icon.includes("codex")) return "codex";
  if (icon.includes("conductor")) return "conductor";
  if (icon.includes("claude")) return "claude";
  return brand || origin || "claude";
}

export function botPassesAgentFilter(b) {
  if (S.agentFilter === "all") return true;
  return botBrandKey(b) === S.agentFilter;
}
/** Persistent per-zone slot indices so arrivals don't reshuffle neighbours. */
export const zoneSlotUsed = new Map(); // zoneId -> Set<slotIndex>
export function releaseClaudeSlot(bot) {
  if (!bot || bot.slotZone == null || bot.slotIndex == null) return;
  const used = zoneSlotUsed.get(bot.slotZone);
  if (used) used.delete(bot.slotIndex);
  bot.slotZone = null;
  bot.slotIndex = null;
}
export function assignClaudeSlot(bot, zoneId) {
  if (!bot || !zoneId) return 0;
  if (bot.slotZone === zoneId && Number.isInteger(bot.slotIndex)) {
    return bot.slotIndex;
  }
  releaseClaudeSlot(bot);
  let used = zoneSlotUsed.get(zoneId);
  if (!used) {
    used = new Set();
    zoneSlotUsed.set(zoneId, used);
  }
  let idx = 0;
  while (used.has(idx)) idx += 1;
  used.add(idx);
  bot.slotZone = zoneId;
  bot.slotIndex = idx;
  return idx;
}
