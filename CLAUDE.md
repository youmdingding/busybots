# CLAUDE.md

@AGENTS.md

## Claude Code notes

- The rules above apply in full; this file only adds Claude-specific notes.
- This board watches Claude Code itself: `src/claude.js` reads `~/.claude/sessions/*.json` and the JSONL transcripts in `~/.claude/projects/`, and `src/classify.js` decides the room. When you change how it classifies activity, keep existing behaviour for real Claude Code sessions unless that is the point of the change.
- `busybots hook` (`src/hook.js`) with `examples/claude-hooks.json` is an optional Claude Code Notification hook (exact "needs you" badge). Don't install hooks into the user's settings without asking.
- In plan mode: read, ask, discuss; don't write a full plan until asked.
