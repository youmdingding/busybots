// Board state shared between modules. S holds values that get reassigned at runtime;
// each is set where it was declared in the original single-file board (mostly main.js).
export const S = {
  agentFilter: undefined,
  ORIGIN_X: undefined,
  ORIGIN_Y: undefined,
  worldScale: undefined,
  runtimeLayout: undefined,
  runtimePathHubs: undefined,
  runtimePathEdges: undefined,
  runtimeZoneHubMap: undefined,
  claudeConfig: undefined,
  claudeSlotCols: undefined,
  themeId: undefined,
  activeTheme: undefined,
  themeManifest: undefined,
  status: undefined,
  islandTiles: undefined,
  heightAt: undefined,
  decor: undefined,
  CITY_MANIFEST: undefined,
  pollInFlight: undefined,
  lastFrameError: undefined,
  frameErrorCount: undefined,
  boardApiToken: undefined,
  panelSessionId: undefined,
  panelTimer: undefined,
  mini: false,            // mini board (pop-out window or ?mini=1), see mini.js
  botScale: 1,            // agents and badges drawn this much bigger (mini board)
  pipWindow: null,        // the always-on-top window the board was popped out into
  miniOpenAgent: null,
  openAgentFromMini: null,
};

/** Per-zone room palette (a/b/c/d floor variants, floor/wall/edge/ring) — filled from config + theme. */
export const ZONE_ART = {};

/** Per-zone prop + motif sprites — filled from config + theme. */
export const ZONE_PROPS = {};
/** @type {Map<string, BotView>} */
export const bots = new Map();
/** @type {Map<string, HTMLImageElement>} */
export const icons = new Map();
/** @type {Map<string, HTMLImageElement>} */
export const tileImgs = new Map();
