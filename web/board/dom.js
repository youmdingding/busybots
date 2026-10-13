// Page elements and URL options the board reads at startup.

export const canvas = document.getElementById("board");
export const ctx = canvas.getContext("2d");

export const elProject = document.getElementById("project-name");
export const elUpdated = document.getElementById("updated-at");
export const elStale = document.getElementById("stale-warn");
export const elDot = document.getElementById("poll-dot");

export const bootParams = new URLSearchParams(location.search);
export const bootPanelRaw = bootParams.get("panel");
export const bootPanelId = bootPanelRaw && /^[0-9A-Za-z_-]{8,80}$/.test(bootPanelRaw) ? bootPanelRaw : null;
