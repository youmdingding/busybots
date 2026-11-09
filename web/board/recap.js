// "Today": what each agent did on a day (time in each room, waiting for you, finishes, files),
// from GET /api/recap. Opened with the Today button in the header; ‹ › walks through past days.
// Built with DOM nodes and textContent only: names and file names come from agents' folders.
import { S, bots } from "./state.js";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** 3725 → "1h 2m", 95 → "1m", 20 → "<1m". */
export function duration(s) {
  s = Math.round(Number(s) || 0);
  if (s < 60) return s > 0 ? "<1m" : "0m";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** 1234567 → "1.2M", 45600 → "46k". */
export function tokensText(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

function rooms() {
  const areas = (S.claudeConfig && S.claudeConfig.areas) || [];
  const out = {};
  for (const a of areas) out[a.key] = { label: a.label || a.key, tint: a.tint || "#8aa8b0" };
  return out;
}

function dayTitle(day) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const same = (x, yv) => x.toDateString() === yv.toDateString();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const label = date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return same(date, today) ? `Today · ${label}` : same(date, yest) ? `Yesterday · ${label}` : label;
}

/** A bar split by room, widths by time. */
function roomBar(roomTimes, total, R) {
  const bar = el("div", "recap-bar");
  for (const [k, v] of Object.entries(roomTimes).sort((a, b) => b[1] - a[1])) {
    if (!v) continue;
    const seg = el("span", "recap-seg");
    seg.style.width = `${Math.max(2, (100 * v) / Math.max(1, total))}%`;
    seg.style.background = (R[k] && R[k].tint) || "#8aa8b0";
    seg.title = `${(R[k] && R[k].label) || k}: ${duration(v)}`;
    bar.append(seg);
  }
  return bar;
}

let current = null;
let openAgent = () => {};

async function load(day) {
  const q = day ? `?day=${encodeURIComponent(day)}` : "";
  const r = await fetch(`/api/recap${q}`, { cache: "no-store" });
  const data = await r.json();
  if (!data.ok) throw new Error(data.error || "No recap");
  return data.recap;
}

function render(rc) {
  const box = document.getElementById("recap-body");
  const title = document.getElementById("recap-title");
  if (!box || !title) return;
  current = rc;
  title.textContent = dayTitle(rc.day);
  const i = rc.days.indexOf(rc.day);
  document.getElementById("recap-prev").disabled = i < 0 || i >= rc.days.length - 1;
  document.getElementById("recap-next").disabled = i <= 0;
  box.replaceChildren();
  const R = rooms();
  const t = rc.totals;
  const sum = el("div", "recap-totals");
  const parts = [
    [`${t.agents}`, t.agents === 1 ? "agent" : "agents"],
    [duration(t.working), "working"],
    [duration(t.waiting), "waiting for you"],
    [`${t.finished}`, "finished"],
    [`${t.files}`, t.files === 1 ? "file edited" : "files edited"],
  ];
  if (t.tokens) parts.push([tokensText(t.tokens), "tokens"]);
  for (const [v, l] of parts) {
    const p = el("div", "recap-stat");
    p.append(el("strong", null, v), el("span", null, l));
    sum.append(p);
  }
  box.append(sum);
  if (!rc.agents.length) {
    box.append(el("p", "recap-empty", "No agent activity recorded for this day."));
    return;
  }
  const maxTime = Math.max(...rc.agents.map((a) => a.working + a.waiting), 1);
  for (const a of rc.agents) {
    const row = el("div", "recap-row");
    const head = el("div", "recap-row-head");
    const name = el("strong", "recap-name", a.name);
    head.append(name);
    if (a.project && a.project !== a.name) head.append(el("span", "recap-project", a.project));
    const live = bots.get(a.id);
    if (live) {
      const btn = el("button", "recap-open", "Open");
      btn.type = "button";
      btn.title = "Open this agent's panel";
      btn.addEventListener("click", () => { closeRecap(); openAgent(live); });
      head.append(btn);
    }
    row.append(head);
    const barWrap = el("div", "recap-barwrap");
    barWrap.style.width = `${Math.max(8, (100 * (a.working + a.waiting)) / maxTime)}%`;
    barWrap.append(roomBar({ ...a.rooms, ...(a.waiting ? { __waiting: a.waiting } : {}) }, a.working + a.waiting,
      { ...R, __waiting: { label: "Waiting for you", tint: "#ff9a4a" } }));
    row.append(barWrap);
    const facts = [`${duration(a.working)} working`];
    const top = Object.entries(a.rooms).sort((x, y) => y[1] - x[1]).slice(0, 3)
      .filter(([, v]) => v >= 30).map(([k, v]) => `${(R[k] && R[k].label) || k} ${duration(v)}`);
    if (top.length) facts[0] += ` (${top.join(" · ")})`;
    if (a.waiting >= 30) facts.push(`waited ${duration(a.waiting)} for you`);
    if (a.finished) facts.push(`finished ${a.finished}×`);
    if (a.tokens) facts.push(`${tokensText(a.tokens)} tokens`);
    row.append(el("div", "recap-facts", facts.join(" · ")));
    if (a.fileCount) {
      const files = a.files.length ? a.files.slice(0, 6).join(", ") + (a.fileCount > 6 ? ` +${a.fileCount - Math.min(6, a.files.length)} more` : "")
        : `${a.fileCount} ${a.fileCount === 1 ? "file" : "files"}`;
      row.append(el("div", "recap-files", `Edited: ${files}`));
    }
    box.append(row);
  }
}

async function show(day) {
  const box = document.getElementById("recap-body");
  try {
    render(await load(day));
  } catch (err) {
    if (box) box.replaceChildren(el("p", "recap-empty", `Couldn't load the recap (${err.message}). Restart Busybots if you just updated it.`));
  }
}

/** Keep the sheet over the board's top-left corner (the row is centred, the panel may be open). */
function place() {
  const box = document.getElementById("recap");
  const board = document.getElementById("board");
  if (!box || !board || box.classList.contains("hidden")) return;
  box.style.left = `${board.offsetLeft + 12}px`;
  box.style.top = `${board.offsetTop + 12}px`;
}

export function openRecap() {
  document.getElementById("recap")?.classList.remove("hidden");
  place();
  document.getElementById("recap-btn")?.setAttribute("aria-pressed", "true");
  show(null);
}

export function closeRecap() {
  document.getElementById("recap")?.classList.add("hidden");
  document.getElementById("recap-btn")?.setAttribute("aria-pressed", "false");
}

export function initRecap({ onOpenAgent }) {
  openAgent = onOpenAgent || openAgent;
  document.getElementById("recap-btn")?.addEventListener("click", () => {
    const hidden = document.getElementById("recap")?.classList.contains("hidden");
    if (hidden) openRecap(); else closeRecap();
  });
  document.getElementById("recap-close")?.addEventListener("click", closeRecap);
  window.addEventListener("resize", place);
  if (typeof ResizeObserver !== "undefined") {
    const row = document.getElementById("board-row");
    if (row) new ResizeObserver(place).observe(row);
  }
  const step = (dir) => {
    if (!current) return;
    const i = current.days.indexOf(current.day) + dir;
    if (i >= 0 && i < current.days.length) show(current.days[i]);
  };
  document.getElementById("recap-prev")?.addEventListener("click", () => step(1));
  document.getElementById("recap-next")?.addEventListener("click", () => step(-1));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !document.getElementById("recap")?.classList.contains("hidden")) closeRecap();
  });
}

/** One line for the agent panel: "Today: 1h 20m working (Build 50m · Plan 20m) · waited 6m · 3 files". */
export function todayLine(t) {
  if (!t || (t.working + t.waiting < 30 && !t.finished && !t.fileCount && !t.tokens)) return "";
  const R = rooms();
  const top = Object.entries(t.rooms || {}).sort((x, y) => y[1] - x[1]).slice(0, 2)
    .filter(([, v]) => v >= 30).map(([k, v]) => `${(R[k] && R[k].label) || k} ${duration(v)}`);
  const parts = [`${duration(t.working)} working${top.length ? ` (${top.join(" · ")})` : ""}`];
  if (t.waiting >= 30) parts.push(`waited ${duration(t.waiting)}`);
  if (t.finished) parts.push(`finished ${t.finished}×`);
  if (t.fileCount) parts.push(`${t.fileCount} ${t.fileCount === 1 ? "file" : "files"}`);
  if (t.tokens) parts.push(`${tokensText(t.tokens)} tokens`);
  return `Today: ${parts.join(" · ")}`;
}
