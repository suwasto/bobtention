#!/usr/bin/env node
/**
 * src/hooks/user-prompt-submit.ts
 *
 * Bob UserPromptSubmit hook entry point.
 *
 * Behavior:
 *  - Reads stdin (prompt payload)
 *  - Captures / updates original intent in session state
 *  - Evaluates the prompt event (can BLOCK if concerning)
 *  - Writes acknowledgment context to stdout (Bob merges into prompt context)
 *  - Exits 0 (allow) or 2 (block)
 *
 * stdout = context injected into Bob prompt context
 * stderr = our logs only
 */
export {};
//# sourceMappingURL=user-prompt-submit.d.ts.map