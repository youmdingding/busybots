// Mini board: the board in a small window that can sit in a corner of the screen.
//   ⧉ Pop out  →  Chrome / Edge: an always-on-top window (Document Picture-in-Picture) the live
//                 board moves into; other browsers: a small separate window with ?mini=1.
//   ?mini=1    →  the mini view on its own (a spare screen, a desktop-wallpaper app…).
// Mini view: the camera hugs the rooms, agents and badges are drawn bigger, and the labels
// (names, speech bubbles, title) are left out. Clicking an agent opens its panel in the main board.
import { S, bots } from "./state.js";
import { canvas } from "./dom.js";
import { CANVAS_H, CANVAS_W } from "./constants.js";
import { fitIslandCamera } from "./layout.js";

const BOT_SCALE = 2.1; // agents and badges, relative to the full board
let loopId = 0;
let drawFn = null;
let pollFn = null;
let pollTimer = null;

/** Run the frame loop on this window's animation frames (the visible one keeps it smooth). */
function startLoop(win) {
  const id = ++loopId;
  const tick = (ts) => {
    if (id !== loopId) return; // a newer loop took over
    // a popped-out window counts time from its own start: use the main window's clock there
    drawFn(win === window ? ts : performance.now());
    try {
      win.requestAnimationFrame(tick);
    } catch {
      startLoop(window); // that window went away
    }
  };
  win.requestAnimationFrame(tick);
}

/** Poll the status from this window's timers (a hidden tab's timers get slowed down). */
function startPolling(win, ms) {
  if (pollTimer) pollTimer.win.clearInterval(pollTimer.id);
  pollTimer = { win, id: win.setInterval(pollFn, ms) };
}

export function setMini(on) {
  S.mini = !!on;
  S.botScale = on ? BOT_SCALE : 1;
  fitIslandCamera();
}

/** Start the board: frame loop + polling, in mini mode if the URL asks for it. */
export function initMini({ draw, poll, pollMs, standalone }) {
  drawFn = draw;
  pollFn = poll;
  startLoop(window);
  startPolling(window, pollMs);
  const btn = document.getElementById("popout-btn");
  if (btn) btn.addEventListener("click", () => popOut(pollMs));
  document.getElementById("popped-back")?.addEventListener("click", () => S.pipWindow?.close());
  if (standalone) {
    document.body.classList.add("mini");
    setMini(true);
    // A click on an agent: show it in the main board (the window that opened us), not in here
    S.miniOpenAgent = (b) => {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ busybots: "open-agent", id: b.id }, location.origin);
        try { window.opener.focus(); } catch { /* the browser decides */ }
        return true;
      }
      return false;
    };
  }
  // the separate mini window asks us to open an agent's panel
  window.addEventListener("message", (ev) => {
    if (ev.origin !== location.origin || ev.data?.busybots !== "open-agent") return;
    const b = bots.get(String(ev.data.id));
    if (b) S.openAgentFromMini?.(b);
  });
}

export async function popOut(pollMs) {
  if (S.pipWindow && !S.pipWindow.closed) {
    S.pipWindow.focus();
    return;
  }
  const theme = S.themeId ? `&theme=${encodeURIComponent(S.themeId)}` : "";
  if (!("documentPictureInPicture" in window)) {
    window.open(`${location.pathname}?mini=1${theme}`, "busybots-mini", "popup,width=520,height=360");
    return;
  }
  let pip;
  try {
    pip = await window.documentPictureInPicture.requestWindow({ width: 520, height: 340 });
  } catch (err) {
    console.warn("pop out:", err);
    window.open(`${location.pathname}?mini=1${theme}`, "busybots-mini", "popup,width=520,height=360");
    return;
  }
  const home = canvas.parentElement;
  const next = canvas.nextSibling;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#c5e4ec";
  const style = pip.document.createElement("style");
  style.textContent = `html, body { margin: 0; height: 100%; overflow: hidden; background: ${bg}; }
body { display: flex; align-items: center; justify-content: center; }
canvas { display: block; cursor: pointer; }`;
  pip.document.head.append(style);
  pip.document.title = "Busybots";
  pip.document.body.append(canvas);
  // keep the board's shape so clicks land on the right agent
  const fit = () => {
    const k = Math.min(pip.innerWidth / CANVAS_W, pip.innerHeight / CANVAS_H);
    canvas.style.width = `${Math.floor(CANVAS_W * k)}px`;
    canvas.style.height = `${Math.floor(CANVAS_H * k)}px`;
  };
  fit();
  pip.addEventListener("resize", fit);
  S.pipWindow = pip;
  document.body.classList.add("popped");
  setMini(true);
  startLoop(pip);
  startPolling(pip, pollMs);
  pip.addEventListener("pagehide", () => {
    canvas.style.width = "";
    canvas.style.height = "";
    home.insertBefore(canvas, next);
    S.pipWindow = null;
    document.body.classList.remove("popped");
    setMini(false);
    startLoop(window);
    startPolling(window, pollMs);
  });
}

/** After a click on an agent in the floating window: bring the main board forward. */
export function focusMainBoard() {
  if (S.pipWindow) {
    try { window.focus(); } catch { /* the browser decides */ }
  }
}
