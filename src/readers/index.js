// Agents read through a reader module. Each exports discover(homes, recentMinutes),
// check(home, recentMinutes), transcript(sessionId, homes) and defaultHome().
import * as codex from "./codex.js";
import * as gemini from "./gemini.js";
import * as opencode from "./opencode.js";
import * as cursor from "./cursor.js";

export const READERS = { codex, gemini, opencode, cursor };
