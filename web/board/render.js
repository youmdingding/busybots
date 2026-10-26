// Drawing a frame.
import { S } from "./state.js";
import { bots } from "./state.js";
import { CANVAS_H, CANVAS_W, SCALE, SPRITE, UI_FONT } from "./constants.js";
import { ctx } from "./dom.js";
import { botPassesAgentFilter } from "./agents.js";
import { cityGround, drawCityScene, stepTraffic } from "./city.js";
import { drawAttentionBadges } from "./status.js";
import { drawAllTiles, drawCityRoadMarkings, drawSky, drawWaterBase } from "./terrain.js";
import { drawDecor } from "./decor.js";
import { drawZoneChips, drawZonePlateaus, drawZoneSigns } from "./zones.js";
import { advanceBot, drawBot } from "./bots.js";

// ---- Frame --------------------------------------------------------------
export function drawFrame(now) {
  stepTraffic(now || performance.now());
  drawSky();
  drawWaterBase();
  drawAllTiles();
  drawCityRoadMarkings();
  const cityScene = !!cityGround();
  const botList = [...bots.values()]
    .filter(botPassesAgentFilter)
    .sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
  if (cityScene) {
    drawCityScene(now, botList);
  } else {
    drawZonePlateaus();
    drawDecor();
  }
  drawZoneSigns();

  // subtle title on canvas (readable UI font)
  ctx.font = `700 14px ${UI_FONT}`;
  ctx.fillStyle = "rgba(42,58,70,0.62)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const canvasTitle = "Agents activity";
  const visibleCount = [...bots.values()].filter(botPassesAgentFilter).length;
  const place = S.activeTheme?.label || "Island";
  const canvasSub = visibleCount
    ? `${place} · ${visibleCount} shown${S.agentFilter !== "all" ? ` · ${S.agentFilter}` : ""}`
    : (bots.size ? `${place} · none match “${S.agentFilter}”` : `${place} · no live sessions`);
  if (!S.mini) { // the mini board keeps only the picture
    ctx.fillText(canvasTitle, 28, 20);
    ctx.font = `500 11px ${UI_FONT}`;
    ctx.fillStyle = "rgba(42,58,70,0.45)";
    ctx.fillText(canvasSub, 28, 40);
  }
  // empty-board note
  if (bots.size === 0) {
    ctx.font = `600 13px ${UI_FONT}`;
    ctx.fillStyle = "rgba(42,58,70,0.55)";
    ctx.textAlign = "center";
    ctx.fillText("No agent sessions running", CANVAS_W / 2, CANVAS_H / 2 - 10);
    ctx.font = `500 11px ${UI_FONT}`;
    ctx.fillStyle = "rgba(42,58,70,0.4)";
    ctx.fillText("Start an agent in a terminal — the board picks it up", CANVAS_W / 2, CANVAS_H / 2 + 12);
    ctx.textAlign = "left";
  } else if (bots.size > 0 && visibleCount === 0) {
    ctx.font = `600 13px ${UI_FONT}`;
    ctx.fillStyle = "rgba(42,58,70,0.55)";
    ctx.textAlign = "center";
    ctx.fillText(`No ${S.agentFilter} agents on the island`, CANVAS_W / 2, CANVAS_H / 2 - 6);
    ctx.font = `500 11px ${UI_FONT}`;
    ctx.fillStyle = "rgba(42,58,70,0.4)";
    ctx.fillText("Pick All or another chip", CANVAS_W / 2, CANVAS_H / 2 + 14);
    ctx.textAlign = "left";
  }

  if (!S.mini) drawZoneChips();

  if (S.mini) { // no names or speech bubbles: just the agents (the city scene has drawn them already)
    if (!cityScene) for (const b of botList) { advanceBot(b, now); drawBot(b, now, "sprite"); }
  } else {
    for (const b of botList) drawBot(b, now, cityScene ? "overlay" : "all");
  }
  // Badges last, so another agent's bubble or name never covers a "needs you" flag
  for (const b of botList) {
    if (!b.attention) continue;
    const sz = SPRITE * SCALE * (S.claudeConfig?.spriteScale || 0.82);
    const still = b.zone === "idle" || b.zone === "waiting" || b.state === "idle";
    const bob = still ? 0 : b.state === "active" ? Math.sin(now / 280 + b.bobPhase) * 2.5 : 0;
    const k = S.botScale || 1; // mini board: bigger agents, bigger badges
    if (k === 1) {
      drawAttentionBadges(b, b.x, b.y + bob, sz, now);
    } else {
      ctx.save();
      ctx.translate(b.x, b.y + bob * k);
      ctx.scale(k, k);
      drawAttentionBadges(b, 0, 0, sz, now);
      ctx.restore();
    }
  }
}
/** One frame (the loop itself lives in mini.js: it follows whichever window is showing the board). */
export function frame(now) {
  try {
    drawFrame(now);
  } catch (err) {
    S.frameErrorCount += 1;
    if (now - S.lastFrameError > 5000) console.error("frame failed", err);
    S.lastFrameError = now;
  }
}
