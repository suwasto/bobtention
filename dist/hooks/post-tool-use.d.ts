#!/usr/bin/env node
/**
 * src/hooks/post-tool-use.ts
 *
 * Bob PostToolUse hook entry point — observation only.
 *
 * Behavior:
 *  - Reads stdin (tool response payload)
 *  - Updates session state (records action, failures, signals)
 *  - Evaluates post-action signals — if concerning, writes deferredBlock to session
 *  - ALWAYS exits 0 — PostToolUse CANNOT block (PRD §16, AGENTS.md)
 *
 * A BLOCK discovered here is deferred: the next PreToolUse will enforce it.
 *
 * stdout is ignored by Bob for PostToolUse — all output goes to stderr.
 * PostToolUse hooks are matched via `matcher` regex in .bob/settings.json.
 */
export {};
//# sourceMappingURL=post-tool-use.d.ts.map