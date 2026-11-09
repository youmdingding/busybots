// Know what's happening without watching the board:
//   - the tab shows it: "(2) Busybots" while agents need you, and a dot on the tab icon
//     (orange: needs you, green: finished);
//   - desktop notifications when an agent starts needing you or finishes (🔔 in the header turns
//     them on; Settings → Board chooses which). Clicking one opens that agent's panel.
// Notifications only come from an open board; the server can send macOS ones when no board is
// open (Settings → Board → "also when the board is closed").
import { S, bots } from "./state.js";

const LS_KEY = "busybots.notify";
const BASE_TITLE = "Busybots";
const seen = new Map(); // agent id → { needsYou, done } at the last update
let primed = false;
let prefs = { needsYou: true, done: true, sound: false };
let openAgent = () => {};

function wanted() {
  let on = null;
  try { on = localStorage.getItem(LS_KEY); } catch { /* private window */ }
  return on === "on";
}

function setWanted(on) {
  try { localStorage.setItem(LS_KEY, on ? "on" : "off"); } catch { /* private window */ }
}

function permission() {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

function syncBell() {
  const btn = document.getElementById("notify-btn");
  if (!btn) return;
  const perm = permission();
  const on = perm === "granted" && wanted();
  btn.textContent = on ? "🔔 On" : "🔕 Notify";
  btn.setAttribute("aria-pressed", String(on));
  btn.title = perm === "unsupported" ? "This browser can't show notifications"
    : perm === "denied" ? "Notifications are blocked for this page in the browser's settings"
    : on ? "Notifications on: you'll hear when an agent needs you or finishes. Click to turn off."
    : "Get a notification when an agent needs you or finishes";
  btn.disabled = perm === "unsupported";
}

async function toggleBell() {
  if (permission() === "unsupported") return;
  if (permission() === "granted" && wanted()) {
    setWanted(false);
  } else {
    const p = permission() === "granted" ? "granted" : await Notification.requestPermission();
    setWanted(p === "granted");
    if (p === "granted") testNotice();
  }
  syncBell();
}

/** Right away when you turn them on, so you know they get through (the browser can allow them
 *  while macOS, Windows or Focus / Do Not Disturb still hides them). */
function testNotice() {
  try {
    const n = new Notification("Busybots notifications are on", {
      body: "You'll get one like this when an agent needs you or finishes, while you're in another window.",
      tag: "busybots-test", silent: !prefs.sound,
    });
    n.onclick = () => { window.focus(); n.close(); };
    if (prefs.sound) chime();
  } catch (err) {
    console.warn("notification failed", err);
  }
}

/** A short two-note chime (no sound file needed). */
function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ac = new Ctx();
    [660, 880].forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.12, ac.currentTime + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.14 + 0.3);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + i * 0.14);
      o.stop(ac.currentTime + i * 0.14 + 0.32);
    });
    setTimeout(() => ac.close(), 800);
  } catch { /* no audio */ }
}

function notify(raw, kind) {
  if (S.miniStandalone) return; // the separate mini window: the main board notifies
  if (permission() !== "granted" || !wanted()) return;
  if (document.hasFocus()) return; // you're looking at the board already
  const name = String(raw.name || "An agent");
  const a = raw.attention || {};
  const body = kind === "needs"
    ? (a.reason && a.reason !== "Needs you" ? String(a.reason) : "It's waiting for your answer.")
    : "Finished and changed files.";
  try {
    const n = new Notification(kind === "needs" ? `${name} needs you` : `${name} is done`, {
      body, tag: `busybots-${raw.id}-${kind}`, silent: !prefs.sound,
    });
    n.onclick = () => {
      window.focus();
      const b = bots.get(raw.id);
      if (b) openAgent(b);
      n.close();
    };
    if (prefs.sound) chime();
  } catch (err) {
    console.warn("notification failed", err);
  }
}

/** Tab title and icon: what needs you, at a glance. */
function drawTab(need, done) {
  document.title = need ? `(${need}) ${BASE_TITLE}` : BASE_TITLE;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2d8a7a";
  // a little robot head
  g.fillStyle = accent;
  g.beginPath();
  g.roundRect ? g.roundRect(4, 7, 24, 20, 6) : g.rect(4, 7, 24, 20);
  g.fill();
  g.fillRect(15, 2, 2, 5);
  g.beginPath(); g.arc(16, 3, 2.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#ffffff";
  g.fillRect(9, 14, 4, 5);
  g.fillRect(19, 14, 4, 5);
  if (need || done) {
    g.fillStyle = need ? "#ff7a1a" : "#2fbf71";
    g.beginPath(); g.arc(24, 24, 7.5, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2; g.strokeStyle = "#ffffff"; g.stroke();
  }
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
  }
  link.href = c.toDataURL("image/png");
}

/** Call with every status: notifies on changes (never for what was already there at load). */
export function noticeStatus(list) {
  let need = 0, done = 0;
  for (const raw of list) {
    const a = raw.attention || {};
    if (a.needsYou) need++;
    else if (a.done) done++;
    const before = seen.get(raw.id);
    if (primed && before) {
      if (a.needsYou && !before.needsYou && prefs.needsYou) notify(raw, "needs");
      else if (a.done && !before.done && !a.needsYou && prefs.done) notify(raw, "done");
    } else if (primed && !before) {
      if (a.needsYou && prefs.needsYou) notify(raw, "needs"); // a new agent that already needs you
    }
    seen.set(raw.id, { needsYou: !!a.needsYou, done: !!a.done });
  }
  const ids = new Set(list.map((r) => r.id));
  for (const id of [...seen.keys()]) if (!ids.has(id)) seen.delete(id);
  primed = true;
  drawTab(need, done);
}

/** Settings → Board → notifications (which events, sound). */
export function setNotifyPrefs(p) {
  if (p && typeof p === "object") prefs = { ...prefs, ...p };
}

export function initNotify({ onOpenAgent }) {
  openAgent = onOpenAgent || openAgent;
  document.getElementById("notify-btn")?.addEventListener("click", toggleBell);
  syncBell();
  drawTab(0, 0);
}
