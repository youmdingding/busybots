// Agent panel and the local API.
import { S } from "./state.js";
import { bots } from "./state.js";
import { CANVAS_H, CANVAS_W, SCALE, SPRITE } from "./constants.js";
import { canvas } from "./dom.js";
import { botPassesAgentFilter } from "./agents.js";

export const elPanel = document.getElementById("agent-panel");
export const elPanelName = document.getElementById("panel-name");
export const elPanelMeta = document.getElementById("panel-meta");
export const elPanelStatus = document.getElementById("panel-status");
export const elPanelTranscript = document.getElementById("panel-transcript");
export const elPanelJump = document.getElementById("panel-jump");
export const elPanelPrompt = document.getElementById("panel-prompt");
export const elPanelNote = document.getElementById("panel-prompt-note");
export const elPanelSend = document.getElementById("panel-send");
export const elPanelClose = document.getElementById("panel-close");

export async function ensureApiToken() {
  if (S.boardApiToken) return S.boardApiToken;
  const res = await fetch("/api/token", { cache: "no-store" });
  if (!res.ok) throw new Error("token " + res.status);
  const data = await res.json();
  S.boardApiToken = data.token;
  return S.boardApiToken;
}

export async function apiPost(path, body) {
  const tok = await ensureApiToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Board-Token": tok,
    },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}


export function setBoardPanelOpen(open) {
  const row = document.getElementById("board-row");
  if (row) row.classList.toggle("panel-open", !!open);
}

export function closeAgentPanel() {
  S.panelSessionId = null;
  toggleIconPicker(false);
  toggleRename(false);
  if (S.panelTimer) {
    clearInterval(S.panelTimer);
    S.panelTimer = null;
  }
  if (elPanel) {
    elPanel.classList.add("hidden");
    elPanel.setAttribute("aria-hidden", "true");
  }
  setBoardPanelOpen(false);
}

/** "14:05" for today, "Mon 12 Oct, 14:05" otherwise (viewer's own locale and time zone). */
export function formatWhen(ts, now = new Date()) {
  if (ts === null || ts === undefined || ts === "") return "";
  let d;
  if (typeof ts === "number") d = new Date(ts < 1e12 ? ts * 1000 : ts); // seconds or milliseconds
  else d = new Date(String(ts));
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(undefined, sameYear
    ? { weekday: "short", day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" });
  return `${date}, ${time}`;
}

export function renderTranscript(items, hidden = false) {
  if (!elPanelTranscript) return;
  document.getElementById("panel-transcript-note")?.classList.toggle("hidden", hidden);
  elPanelTranscript.replaceChildren();
  if (!items || !items.length) {
    const div = document.createElement("div");
    div.className = "panel-item tool";
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = "—";
    div.append(k, hidden ? "Hidden in privacy mode (Settings → Board)" : "No recent transcript");
    elPanelTranscript.appendChild(div);
    return;
  }
  for (const it of items) {
    const div = document.createElement("div");
    div.className = "panel-item " + (it.kind || "assistant");
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = it.kind === "tool" ? "tool" : it.kind === "user" ? "you" : "agent";
    div.appendChild(k);
    div.appendChild(document.createTextNode(it.text || ""));
    const when = formatWhen(it.ts);
    if (when) {
      const t = document.createElement("time");
      t.className = "t";
      t.textContent = when;
      const d = new Date(typeof it.ts === "number" && it.ts < 1e12 ? it.ts * 1000 : it.ts);
      if (!Number.isNaN(d.getTime())) t.dateTime = d.toISOString();
      div.appendChild(t);
    }
    elPanelTranscript.appendChild(div);
  }
  elPanelTranscript.scrollTop = elPanelTranscript.scrollHeight;
}

// ---- icon picker: choose a character and a colour for this conversation ----
// Nothing changes until Save; the panel's big icon previews the selection.
const elIconBtn = document.getElementById("panel-icon");
const elIconImg = document.getElementById("panel-icon-img");
const elIconPicker = document.getElementById("panel-icon-picker");
const elIconChars = document.getElementById("panel-icon-chars");
const elIconColours = document.getElementById("panel-icon-colours");
const elIconMsg = document.getElementById("panel-icon-msg");
let iconSetData = { colours: [], characters: [] };
let currentIcon = null; // what the board shows now
let ownIcon = null; // the agent's own icon
let pick = { key: null, colour: 0 }; // selection in the picker

/** "icons/pick-cat-03.png" → { key: "pick-cat", colour: 3 } */
function parseIcon(path) {
  const m = /^icons\/((?:pick-)?[a-z]+)-(\d{2})\.png$/.exec(String(path || ""));
  return m ? { key: m[1], colour: Number(m[2]) } : { key: null, colour: 0 };
}

function pickedPath() {
  const c = iconSetData.characters.find((x) => x.key === pick.key);
  return (c && c.files[pick.colour]) || null;
}

function setPreview(path) {
  if (!elIconImg) return;
  if (path) elIconImg.src = path;
  else elIconImg.removeAttribute("src");
}

function renderPicker() {
  if (!elIconChars || !elIconColours) return;
  elIconChars.replaceChildren();
  elIconColours.replaceChildren();
  const own = parseIcon(ownIcon).key;
  // The agent's own character, then every pick character
  const chars = iconSetData.characters.filter((c) => c.group === "fun" || c.key === own);
  if (elIconMsg) {
    elIconMsg.classList.toggle("hidden", chars.length > 0);
    elIconMsg.textContent = chars.length ? "" : "No icons came from the server. Restart Busybots to load them.";
  }
  for (const c of chars) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = c.group === "agent" ? `${c.label} (its own)` : c.label;
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-pressed", String(c.key === pick.key));
    btn.dataset.key = c.key;
    const img = document.createElement("img");
    img.src = c.files[pick.colour] || c.files.find(Boolean) || "";
    img.alt = "";
    btn.appendChild(img);
    elIconChars.appendChild(btn);
  }
  const avail = iconSetData.characters.find((c) => c.key === pick.key)?.files || [];
  iconSetData.colours.forEach((hex, i) => {
    if (!avail[i]) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.background = hex;
    btn.title = `Colour ${i + 1}`;
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-pressed", String(i === pick.colour));
    btn.dataset.colour = String(i);
    elIconColours.appendChild(btn);
  });
  setPreview(pickedPath() || currentIcon);
}

export function toggleIconPicker(open = elIconPicker?.classList.contains("hidden")) {
  if (!elIconPicker) return;
  elIconPicker.classList.toggle("hidden", !open);
  elIconBtn?.setAttribute("aria-expanded", String(!!open));
  if (open) {
    pick = parseIcon(currentIcon);
    renderPicker();
  } else {
    setPreview(currentIcon); // Cancel / close: back to what the board shows
  }
}

export function pickCharacter(key) {
  pick.key = key;
  renderPicker();
}

export function pickColour(i) {
  pick.colour = i;
  renderPicker();
}

export function pickOwnIcon() {
  pick = parseIcon(ownIcon);
  renderPicker();
}

/** Save: the selection becomes this conversation's icon (its own icon = no choice). */
export async function saveIcon() {
  if (!S.panelSessionId) return;
  const chosen = pickedPath();
  if (!chosen) return;
  const icon = chosen === ownIcon ? null : chosen;
  const r = await apiPost(`/api/session/${encodeURIComponent(S.panelSessionId)}/icon`, { icon });
  if (!r?.ok) {
    if (elIconMsg) {
      elIconMsg.textContent = r?.error || "Could not save the icon";
      elIconMsg.classList.remove("hidden");
    }
    return;
  }
  currentIcon = chosen;
  const b = bots.get(S.panelSessionId); // show it right away; the next status update confirms it
  if (b) {
    b.icon = chosen;
    b.iconDefault = icon ? ownIcon : null;
  }
  toggleIconPicker(false);
}

// ---- rename this conversation ----
const elNameRow = document.getElementById("panel-name-row");
const elNameForm = document.getElementById("panel-name-form");
const elNameInput = document.getElementById("panel-name-input");
const elNameMsg = document.getElementById("panel-name-msg");
const elRename = document.getElementById("panel-rename");
let nameDefault = null;

export function toggleRename(open = elNameForm?.classList.contains("hidden")) {
  if (!elNameForm) return;
  elNameForm.classList.toggle("hidden", !open);
  elNameRow?.classList.toggle("hidden", !!open);
  elNameMsg?.classList.add("hidden");
  if (open && elNameInput) {
    elNameInput.value = elPanelName?.textContent || "";
    elNameInput.focus();
    elNameInput.select();
  }
}

/** name = text you typed, or null for the default (folder) name. */
export async function saveName(name) {
  if (!S.panelSessionId) return;
  if (name !== null && name.trim() === (nameDefault || "")) name = null; // typed the default back
  const r = await apiPost(`/api/session/${encodeURIComponent(S.panelSessionId)}/name`, { name });
  if (!r?.ok) {
    if (elNameMsg) {
      elNameMsg.textContent = r?.error || "Could not rename";
      elNameMsg.classList.remove("hidden");
    }
    return;
  }
  const shown = r.name || nameDefault || "Agent";
  if (elPanelName) elPanelName.textContent = shown;
  const b = bots.get(S.panelSessionId); // show it right away; the next status update confirms it
  if (b) b.name = shown;
  toggleRename(false);
}

export function applyPanelSession(data) {
  const s = data.session || {};
  nameDefault = s.nameDefault || null;
  if (elRename) elRename.classList.toggle("hidden", !!s.privacy); // privacy mode: names stay generic
  if (data.iconSet && Array.isArray(data.iconSet.characters)) iconSetData = data.iconSet;
  const shown = bots.get(S.panelSessionId); // fall back to what the board draws
  currentIcon = s.icon || shown?.icon || null;
  ownIcon = s.iconDefault || shown?.iconDefault || currentIcon;
  // While the picker is open, keep previewing the selection (the panel refreshes every few seconds)
  if (elIconPicker && !elIconPicker.classList.contains("hidden")) renderPicker();
  else setPreview(currentIcon);
  if (elPanelName) elPanelName.textContent = s.name || s.id || "Agent";
  if (elPanelMeta) {
    const BRAND_LABELS = { codex: "Codex CLI", gemini: "Gemini CLI", opencode: "OpenCode", cursor: "Cursor CLI" };
    const origin = BRAND_LABELS[s.brand] ||
      (s.origin === "conductor" ? "Conductor" : s.origin === "terminal" ? "Terminal" : (s.origin || "—"));
    // Never innerHTML here: origin/cwd come from transcripts and folder names.
    elPanelMeta.replaceChildren();
    const line1 = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = String(origin);
    line1.append(strong, s.livePid ? ` · pid ${Number(s.livePid) || "?"}` : " · no live process");
    const line2 = document.createElement("div");
    line2.textContent = s.privacy ? "Details hidden (privacy mode)" : s.cwd ? String(s.cwd) : "cwd unknown";
    elPanelMeta.append(line1, line2);
  }
  if (elPanelStatus) {
    elPanelStatus.textContent =
      `zone ${s.zone || "—"} · state ${s.state || "—"}` +
      (s.bubble ? ` · “${s.bubble}”` : "");
  }
  renderTranscript(data.transcript || [], s.privacy);

  const canJump = !!(s.jump && s.jump.kind);
  if (elPanelJump) {
    elPanelJump.disabled = !canJump;
    elPanelJump.textContent =
      s.jump?.kind === "conductor" ? "Open Conductor" :
      s.jump?.kind === "terminal" ? "Jump to terminal" : "Jump to it";
  }
  const allow = !!s.promptAllowed;
  const promptWrap = document.getElementById("panel-prompt-wrap");
  const promptHeading = [...document.querySelectorAll("#agent-panel .panel-section")]
    .find((el) => /prompt/i.test(el.textContent || ""));
  if (promptWrap) promptWrap.classList.toggle("hidden", !allow);
  if (promptHeading) promptHeading.classList.toggle("hidden", !allow);
  if (elPanelPrompt) {
    elPanelPrompt.disabled = !allow;
    if (!allow) elPanelPrompt.value = "";
  }
  if (elPanelSend) elPanelSend.disabled = !allow;
  if (elPanelNote) {
    // When prompt UI is hidden, show a short muted hint under Jump instead
    elPanelNote.textContent = allow
      ? "Idle · no live process — confirm before send"
      : (s.promptDisabledReason || "Reply in its window");
    // Move note under jump when prompt hidden
    const actions = document.querySelector("#agent-panel .panel-actions");
    if (!allow && actions && elPanelNote.parentElement !== actions) {
      actions.appendChild(elPanelNote);
    } else if (allow) {
      const row = document.querySelector("#panel-prompt-wrap .panel-prompt-row");
      if (row && elPanelNote.parentElement !== row) row.insertBefore(elPanelNote, elPanelSend);
    }
  }
}

export async function refreshPanel() {
  if (!S.panelSessionId) return;
  try {
    const res = await fetch(`/api/session/${encodeURIComponent(S.panelSessionId)}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    applyPanelSession(data);
  } catch (err) {
    console.warn("panel refresh failed", err);
  }
}

export async function openAgentPanel(bot) {
  toggleIconPicker(false);
  toggleRename(false);
  if (!bot) return;
  S.panelSessionId = bot.id;
  if (elPanel) {
    elPanel.classList.remove("hidden");
    elPanel.setAttribute("aria-hidden", "false");
  }
  setBoardPanelOpen(true);
  await refreshPanel();
  if (S.panelTimer) clearInterval(S.panelTimer);
  S.panelTimer = setInterval(refreshPanel, 2500);
}

export function hitTestBot(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = CANVAS_W / rect.width;
  const scaleY = CANVAS_H / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  const list = [...bots.values()]
    .filter(botPassesAgentFilter)
    .sort((a, b) => b.y - a.y || b.x - a.x);
  const hitR = SPRITE * SCALE * 0.55;
  for (const b of list) {
    const dx = x - b.x;
    const dy = y - b.y;
    if (dx * dx + dy * dy <= hitR * hitR) return b;
  }
  return null;
}
