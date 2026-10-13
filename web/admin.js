/* Settings page: edits settings.json through the local API (never innerHTML with data). */
(() => {
  const THEMES = [["island", "Island"], ["office", "Office"], ["city", "City"], ["space", "Space"]];
  let settings = null;      // working copy
  let saved = "";           // JSON of last saved state
  let defaults = null;
  let agents = [];
  let token = null;
  let checkTimer = null;
  let checkSeq = 0;

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const k of kids) if (k) n.append(k);
    return n;
  };

  async function getToken() {
    if (token) return token;
    const r = await fetch("/api/token", { cache: "no-store" });
    token = (await r.json()).token;
    return token;
  }

  async function post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Board-Token": await getToken() },
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch (_) { data = { ok: false, error: `HTTP ${res.status}` }; }
    if (res.status === 401) token = null;
    return data;
  }

  function setMsg(text, kind = "") {
    const m = $("save-msg");
    m.textContent = text;
    m.className = kind;
  }

  function markDirty() {
    const dirty = JSON.stringify(settings) !== saved;
    $("save").disabled = !dirty;
    if (dirty) setMsg("Unsaved changes", "dirty");
    else setMsg("All changes saved");
    scheduleCheck();
  }

  // ---- agents --------------------------------------------------------------
  function statusLine(id) {
    return el("div", { class: "status", "data-status": id, text: "" });
  }

  function folderCard(a) {
    const node = settings.sources[a.id];
    const card = el("div", { class: "card" + (node.enabled ? "" : " off"), "data-agent": a.id });
    const toggle = el("input", { type: "checkbox" });
    toggle.checked = !!node.enabled;
    toggle.addEventListener("change", () => {
      node.enabled = toggle.checked;
      card.classList.toggle("off", !node.enabled);
      markDirty();
    });
    card.append(
      el("div", { class: "card-head" },
        el("h2", {}, a.label, a.beta ? el("span", { class: "beta", text: "beta" }) : null),
        el("label", { class: "switch" }, toggle, el("span", { text: "On" }))),
      el("p", { class: "hint", text: a.hint }),
    );
    const rows = el("div", { class: "rows" });
    const draw = () => {
      rows.replaceChildren();
      node.paths.forEach((p, i) => {
        const input = el("input", { type: "text", value: p, spellcheck: "false", "aria-label": `${a.label} folder ${i + 1}` });
        input.addEventListener("input", () => { node.paths[i] = input.value; markDirty(); });
        const del = el("button", { type: "button", class: "icon-btn", title: "Remove folder", "aria-label": "Remove folder", text: "×" });
        del.addEventListener("click", () => { node.paths.splice(i, 1); draw(); markDirty(); });
        rows.append(el("div", { class: "row" }, input, del, statusLine(`${a.id}:${i}`)));
      });
      const add = el("button", { type: "button", class: "link-btn", text: "+ Add another folder" });
      add.addEventListener("click", () => { node.paths.push(""); draw(); markDirty(); rows.querySelector("input:last-of-type")?.focus(); });
      rows.append(add);
    };
    draw();
    card.append(rows);
    if (a.id !== "claude") {
      const mins = el("input", { type: "number", min: "1", max: "1440", value: String(node.recentMinutes) });
      mins.addEventListener("input", () => { node.recentMinutes = Math.max(1, parseInt(mins.value || "30", 10)); markDirty(); });
      card.append(el("div", { class: "extra" },
        el("span", { text: "Show sessions active in the last" }), mins, el("span", { text: "minutes" })));
    }
    return card;
  }

  function conductorCard(a) {
    const node = settings.sources.conductor;
    const card = el("div", { class: "card", "data-agent": a.id });
    const chips = el("div", { class: "filter-chips", role: "group", "aria-label": "Conductor" });
    const modes = [["auto", "Auto"], [true, "On"], [false, "Off"]];
    const sync = () => {
      for (const b of chips.children) b.setAttribute("aria-pressed", String(b.dataset.v === String(node.enabled)));
      card.classList.toggle("off", node.enabled === false);
    };
    for (const [v, label] of modes) {
      const b = el("button", { type: "button", class: "chip", text: label });
      b.dataset.v = String(v);
      b.addEventListener("click", () => { node.enabled = v; sync(); markDirty(); });
      chips.append(b);
    }
    const field = (key, label) => {
      const input = el("input", { type: "text", value: node[key], spellcheck: "false" });
      input.addEventListener("input", () => { node[key] = input.value; markDirty(); });
      return el("div", { class: "row" }, el("label", { class: "lbl", text: label }), input, el("span"),
        key === "db" ? statusLine("conductor:0") : null);
    };
    card.append(
      el("div", { class: "card-head" }, el("h2", { text: a.label }), chips),
      el("p", { class: "hint", text: a.hint }),
      el("div", { class: "rows" }, field("db", "Database"), field("workspaces", "Workspaces folder")),
    );
    sync();
    return card;
  }

  // ---- board prefs ---------------------------------------------------------
  function drawBoard() {
    const pick = $("theme-pick");
    pick.replaceChildren();
    for (const [id, label] of THEMES) {
      const b = el("button", { type: "button", class: "chip", text: label });
      b.setAttribute("aria-pressed", String(settings.board.theme === id));
      b.addEventListener("click", () => { settings.board.theme = id; drawBoard(); markDirty(); });
      pick.append(b);
    }
    const ib = $("idle-bubbles");
    ib.checked = !!settings.board.showIdleBubbles;
    ib.onchange = () => { settings.board.showIdleBubbles = ib.checked; markDirty(); };
    const pv = $("privacy");
    pv.checked = !!settings.board.privacy;
    pv.onchange = () => { settings.board.privacy = pv.checked; markDirty(); };
    const poll = $("poll");
    poll.value = String(settings.board.pollSeconds);
    poll.oninput = () => { settings.board.pollSeconds = Math.min(30, Math.max(1, Number(poll.value) || 2)); markDirty(); };
  }

  function drawAll() {
    const wrap = $("agents");
    wrap.replaceChildren();
    for (const a of agents) wrap.append(a.kind === "database" ? conductorCard(a) : folderCard(a));
    drawBoard();
  }

  // ---- live checks ---------------------------------------------------------
  function scheduleCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(runCheck, 350);
  }

  async function runCheck() {
    const seq = ++checkSeq;
    let data;
    try { data = await post("/api/settings/check", { settings }); } catch (_) { return; }
    if (seq !== checkSeq || !data.ok) return;     // a newer edit is already being checked
    for (const [sid, rows] of Object.entries(data.sources || {})) {
      rows.forEach((r, i) => {
        const node = document.querySelector(`[data-status="${sid}:${i}"]`);
        if (!node) return;
        node.textContent = r.message || "";
        node.className = "status " + (r.ok === true ? "ok" : r.ok === false ? "bad" : "muted");
      });
    }
  }

  // ---- save / reset ----------------------------------------------------------
  $("save").addEventListener("click", async () => {
    // drop empty folder rows before saving
    for (const sid of ["claude", "codex"]) settings.sources[sid].paths = settings.sources[sid].paths.filter((p) => p.trim());
    $("save").disabled = true;
    setMsg("Saving…");
    const data = await post("/api/settings", { settings });
    if (data.ok) {
      settings = data.settings;
      saved = JSON.stringify(settings);
      drawAll();
      setMsg("Saved — the board picks this up within a few seconds.", "ok");
      scheduleCheck();
    } else {
      $("save").disabled = false;
      setMsg(data.error || "Could not save", "bad");
    }
  });

  $("reset").addEventListener("click", () => {
    settings = JSON.parse(JSON.stringify(defaults));
    drawAll();
    markDirty();
  });

  window.addEventListener("beforeunload", (ev) => {
    if (settings && JSON.stringify(settings) !== saved) { ev.preventDefault(); ev.returnValue = ""; }
  });

  (async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = await res.json();
      settings = data.settings;
      defaults = data.defaults;
      agents = data.agents || [];
      saved = JSON.stringify(settings);
      $("file-note").textContent = data.exists
        ? `Saved in ${data.file}`
        : `Using defaults — saving creates ${data.file}`;
      drawAll();
      setMsg(data.exists ? "All changes saved" : "Defaults loaded — nothing saved yet");
      runCheck();
    } catch (err) {
      setMsg("Could not reach the board server (is busybots running?)", "bad");
    }
  })();
})();
