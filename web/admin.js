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
    const nt = settings.board.notify || (settings.board.notify = { needsYou: true, done: true, sound: false, whenClosed: false });
    for (const [id, key] of [["notify-needs", "needsYou"], ["notify-done", "done"], ["notify-sound", "sound"], ["notify-closed", "whenClosed"]]) {
      const el = $(id);
      el.checked = !!nt[key];
      el.onchange = () => { nt[key] = el.checked; markDirty(); };
    }
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
    drawRooms();
    if (setup) drawSetup();
  }


  // ---- rooms: names, colours, kinds of work ---------------------------------
  let roomDefs = [];   // config.json areas: { key, labelDefault, tintDefault }
  let workKinds = [];  // { id, label, room } (room = config.json's)
  let maxRoomName = 24;

  function roomLabel(key) {
    const r = (settings.rooms || {})[key];
    const d = roomDefs.find((x) => x.key === key);
    return (r && r.label) || (d && d.labelDefault) || key;
  }

  function drawRooms() {
    const list = $("rooms-list");
    if (!list || !roomDefs.length) return;
    list.replaceChildren();
    const mine = settings.rooms || (settings.rooms = {});
    for (const d of roomDefs) {
      const cur = mine[d.key] || {};
      const name = el("input", { type: "text", maxlength: String(maxRoomName), placeholder: d.labelDefault, "aria-label": `Name for ${d.labelDefault}` });
      name.value = cur.label || "";
      const colour = el("input", { type: "color", title: "Room colour", "aria-label": `Colour for ${d.labelDefault}` });
      colour.value = cur.tint || d.tintDefault || "#8aa8b0";
      const reset = el("button", { type: "button", class: "link-btn", text: "Reset" });
      reset.hidden = !cur.label && !cur.tint;
      const save = () => {
        const label = name.value.replace(/\s+/g, " ").trim();
        const o = {};
        if (label && label !== d.labelDefault) o.label = label;
        if (colour.value.toLowerCase() !== String(d.tintDefault || "").toLowerCase()) o.tint = colour.value.toLowerCase();
        if (Object.keys(o).length) mine[d.key] = o; else delete mine[d.key];
        reset.hidden = !Object.keys(o).length;
        markDirty();
        drawWork();
        if (setup) drawSetup();
      };
      name.addEventListener("input", save);
      colour.addEventListener("input", save);
      reset.addEventListener("click", () => { name.value = ""; colour.value = d.tintDefault || "#8aa8b0"; save(); });
      list.append(el("div", { class: "room-row" }, colour, name, reset));
    }
    drawWork();
  }

  function drawWork() {
    const body = $("work-list");
    if (!body || !workKinds.length) return;
    body.replaceChildren();
    const mine = settings.rules.workAreas || (settings.rules.workAreas = {});
    for (const k of workKinds) {
      const sel = el("select", { "aria-label": `Room for ${k.label}` });
      for (const d of roomDefs) if (d.key !== "idle") sel.append(el("option", { value: d.key, text: roomLabel(d.key) + (d.key === k.room ? " (default)" : "") }));
      sel.value = mine[k.id] || k.room || "";
      sel.onchange = () => {
        if (sel.value && sel.value !== k.room) mine[k.id] = sel.value; else delete mine[k.id];
        markDirty();
        drawWork();
      };
      body.append(el("tr", { class: mine[k.id] ? "changed" : "" }, el("td", { text: k.label }), el("td", {}, sel)));
    }
  }

  async function loadRooms() {
    try {
      const cfg = await (await fetch("/config.json", { cache: "no-store" })).json();
      roomDefs = (cfg.areas || []).filter((a) => a && a.key)
        .map((a) => ({ key: a.key, labelDefault: a.labelDefault || a.label || a.key, tintDefault: a.tintDefault || a.tint || null }));
      drawRooms();
    } catch (err) {
      $("rooms-list").replaceChildren(el("p", { class: "note", text: `Couldn't load the rooms (${err.message}).` }));
    }
  }

  // ---- your setup (detected skills → rooms) ---------------------------------
  let setup = null;
  let rooms = [];
  let setupFilter = "";
  const FROM = {
    yours: "your choice", config: "config.json", keywords: "from its description", default: "built-in",
    name: "from its name", none: "",
  };
  const fromText = (f) => (f && f.startsWith("profile:") ? f.slice(8) : FROM[f] ?? "");
  const kindText = { skill: "Skill", command: "Command", agent: "Sub-agent" };

  async function loadSetup(rescan = false) {
    const body = $("setup-body");
    try {
      if (!rooms.length) {
        const cfg = await (await fetch("/config.json", { cache: "no-store" })).json();
        rooms = (cfg.areas || []).filter((a) => a.key !== "idle").map((a) => [a.key, a.label || a.key]);
      }
      const data = await (await fetch(`/api/setup${rescan ? "?rescan=1" : ""}`, { cache: "no-store" })).json();
      if (!data.ok) throw new Error(data.error || "no data");
      setup = data.setup;
      drawSetup();
    } catch (err) {
      body.replaceChildren(el("p", { class: "note", text: `Couldn't scan (${err.message}). Restart Busybots if you just updated it.` }));
    }
  }

  function drawSetup() {
    const ad = $("auto-detect");
    ad.checked = settings.rules.autoDetect !== false;
    ad.onchange = () => { settings.rules.autoDetect = ad.checked; markDirty(); drawSetup(); };
    const body = $("setup-body");
    body.replaceChildren();
    if (!setup) return;
    const tags = el("div", { class: "setup-tags" });
    const pluginNames = new Set(setup.plugins.map((p) => p.name.toLowerCase()));
    for (const f of setup.frameworks) {
      if (!f.projects.length && pluginNames.has(f.label.toLowerCase())) continue; // the plugin tag says it
      const t = el("span", { class: "setup-tag", text: f.label });
      if (f.projects.length) t.append(el("small", { text: f.projects.slice(0, 4).join(", ") + (f.projects.length > 4 ? ` +${f.projects.length - 4}` : "") }));
      tags.append(t);
    }
    for (const p of setup.plugins) {
      const t = el("span", { class: "setup-tag" + (p.enabled ? "" : " off"), text: p.name, title: p.enabled ? "Plugin" : "Plugin (turned off)" });
      t.append(el("small", { text: p.enabled ? "plugin" : "plugin, off" }));
      tags.append(t);
    }
    if (!tags.children.length) tags.append(el("span", { class: "note", text: "No plugins or workflow frameworks found." }));
    body.append(tags);
    if (!setup.items.length) {
      body.append(el("p", { class: "note", text: "No skills, slash commands or sub-agents found in your agent folders or recent projects." }));
      return;
    }
    const filter = el("input", { type: "text", placeholder: "Filter…", "aria-label": "Filter skills" });
    filter.value = setupFilter;
    const count = el("span", { class: "note" });
    body.append(el("div", { class: "setup-filter" }, filter, count));
    const table = el("table", { class: "setup-table" });
    table.append(el("thead", {}, el("tr", {}, el("th", { text: "Skill / command" }), el("th", { text: "Type" }), el("th", { text: "Room" }), el("th", { text: "Why" }))));
    const tbody = el("tbody");
    table.append(tbody);
    body.append(table);
    const mine = settings.rules.skillAreas || (settings.rules.skillAreas = {});
    const pending = (settings.rules.autoDetect !== false) !== setup.autoDetect;
    if (pending) body.insertBefore(el("p", { class: "note", text: "Save to see where they go with this switch changed." }), table);
    const rows = () => {
      tbody.replaceChildren();
      const q = setupFilter.trim().toLowerCase();
      const list = setup.items.filter((it) => !q || it.name.includes(q) || (it.description || "").toLowerCase().includes(q));
      count.textContent = `${list.length} of ${setup.items.length}`;
      for (const it of list.slice(0, 300)) {
        const own = mine[it.key];
        let from = own ? "yours" : it.from === "yours" ? "none" : it.from;
        const area = own || (from === "none" ? null : it.area);
        const sel = el("select", { "aria-label": `Room for ${it.name}` });
        sel.append(el("option", { value: "", text: area && !own ? `Automatic (${roomLabel(area)})` : "Automatic" }));
        for (const [k] of rooms) sel.append(el("option", { value: k, text: roomLabel(k) }));
        sel.value = own || "";
        sel.onchange = () => {
          if (sel.value) mine[it.key] = sel.value; else delete mine[it.key];
          markDirty();
          rows();
        };
        const desc = it.description ? el("div", { text: it.description.length > 110 ? it.description.slice(0, 107) + "…" : it.description }) : null;
        const src = it.source && it.source !== "you" ? ` · ${it.source.replace(/^plugin:/, "").replace(/^project:/, "")}` : "";
        tbody.append(el("tr", { class: own ? "yours" : "" },
          el("td", { class: "name", text: it.name }, desc),
          el("td", { class: "from", text: (kindText[it.kind] || it.kind) + src }),
          el("td", {}, sel),
          el("td", { class: "from", text: area ? fromText(from) : "not placed" })));
      }
    };
    filter.oninput = () => { setupFilter = filter.value; rows(); };
    rows();
  }

  $("setup-rescan").addEventListener("click", async () => {
    $("setup-rescan").disabled = true;
    await loadSetup(true);
    $("setup-rescan").disabled = false;
  });

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
      loadSetup();
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
      workKinds = data.workKinds || [];
      maxRoomName = data.maxRoomName || 24;
      saved = JSON.stringify(settings);
      $("file-note").textContent = data.exists
        ? `Saved in ${data.file}`
        : `Using defaults — saving creates ${data.file}`;
      drawAll();
      setMsg(data.exists ? "All changes saved" : "Defaults loaded — nothing saved yet");
      runCheck();
      await loadRooms();
      loadSetup();
    } catch (err) {
      setMsg("Could not reach the board server (is busybots running?)", "bad");
    }
  })();
})();
