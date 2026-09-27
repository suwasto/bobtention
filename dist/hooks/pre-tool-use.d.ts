#!/usr/bin/env node
/**
 * src/hooks/pre-tool-use.ts
 *
 * Bob PreToolUse hook entry point — main enforcement point.
 *
 * Behavior:
 *  - Reads stdin (tool use payload)
 *  - Loads / updates session state
 *  - Extracts signals, evaluates decision via AttentionEvaluator
 *  - Enforces decision (exit 0 = ALLOW/WATCH, exit 2 = BLOCK)
 *
 * stdout is ignored by Bob for PreToolUse — all output goes to stderr.
 * PreToolUse hooks are matched via `matcher` regex in .bob/settings.json.
 */
export {};
//# sourceMappingURL=pre-tool-use.d.ts.map