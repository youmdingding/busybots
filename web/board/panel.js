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
    elPanelTranscript.appendChild(div);
  }
  elPanelTranscript.scrollTop = elPanelTranscript.scrollHeight;
}

// ---- icon picker: choose another icon for this conversation ----
const elIconBtn = document.getElementById("panel-icon");
const elIconImg = document.getElementById("panel-icon-img");
const elIconPicker = document.getElementById("panel-icon-picker");
const elIconGrid = document.getElementById("panel-icon-grid");
let iconChoiceList = [];
let currentIcon = null;
let ownIcon = null;

function renderIconGrid() {
  if (!elIconGrid) return;
  elIconGrid.replaceChildren();
  let group = null;
  // Characters, then the colour variants of this agent's own type (e.g. every Claude icon)
  const ownKind = String(ownIcon || "").replace(/^icons\//, "").split("-")[0];
  const shown = iconChoiceList.filter((c) => c.group === "fun" || c.id.startsWith(`icons/${ownKind}-`));
  for (const c of shown) {
    if (c.group !== group) {
      group = c.group;
      const lab = document.createElement("div");
      lab.className = "group-label";
      lab.textContent = group === "fun" ? "Characters" : "Other colours";
      elIconGrid.appendChild(lab);
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = c.label;
    btn.setAttribute("aria-label", c.label);
    btn.setAttribute("aria-pressed", String(c.id === currentIcon));
    btn.dataset.icon = c.id;
    const img = document.createElement("img");
    img.src = c.id;
    img.alt = "";
    btn.appendChild(img);
    elIconGrid.appendChild(btn);
  }
}

export function toggleIconPicker(open = elIconPicker?.classList.contains("hidden")) {
  if (!elIconPicker) return;
  elIconPicker.classList.toggle("hidden", !open);
  elIconBtn?.setAttribute("aria-expanded", String(!!open));
  if (open) renderIconGrid();
}

/** icon = a path from the choices, or null for the agent's own icon. */
export async function chooseIcon(icon) {
  if (!S.panelSessionId) return;
  const r = await apiPost(`/api/session/${encodeURIComponent(S.panelSessionId)}/icon`, { icon });
  if (!r?.ok) return;
  currentIcon = icon || ownIcon;
  if (elIconImg && currentIcon) elIconImg.src = currentIcon;
  const b = bots.get(S.panelSessionId); // show it right away; the next status update confirms it
  if (b && currentIcon) {
    if (icon) b.iconDefault = b.iconDefault || ownIcon;
    else b.iconDefault = null;
    b.icon = currentIcon;
  }
  toggleIconPicker(false);
}

export function applyPanelSession(data) {
  const s = data.session || {};
  if (Array.isArray(data.icons)) iconChoiceList = data.icons;
  const shown = bots.get(S.panelSessionId); // fall back to what the board draws
  currentIcon = s.icon || shown?.icon || null;
  ownIcon = s.iconDefault || shown?.iconDefault || currentIcon;
  if (elIconImg) {
    if (currentIcon) elIconImg.src = currentIcon;
    else elIconImg.removeAttribute("src");
  }
  if (elIconPicker && !elIconPicker.classList.contains("hidden")) renderIconGrid();
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
