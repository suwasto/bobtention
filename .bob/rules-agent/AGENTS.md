# Bobtention — Agent Coding Rules

## Fail-open wrapper is non-negotiable
Every hook entry point (`src/hooks/*.ts`) must import and use the error wrapper from `src/utils/errors.ts`. A thrown exception must produce exit 0 + stderr log — never exit 2.

## Exit code contract per hook type
| Hook | ALLOW | BLOCK | Notes |
|------|-------|-------|-------|
| PreToolUse | exit 0 | exit 2 | main enforcement point |
| UserPromptSubmit | exit 0 | exit 2 | can block if needed |
| PostToolUse | exit 0 | — | NEVER exit 2; write deferred BLOCK to session state instead |
| SessionStart | exit 0 | — | stdout = context string injected by Bob |
| Stop | exit 0 | — | cleanup only |

## stdout is Bob's, stderr is ours
- `SessionStart`/`UserPromptSubmit`: write context string to stdout.
- All other output (ALLOW silent, WATCH `◐`, BLOCK `⚠`) → stderr.
- No other hook may write to stdout.

## Decision adapter is always behind an interface
Never call JEV/Laya HTTP directly from outside `adapters/decision-adapter.ts`. The `DecisionEngine` interface must be the only coupling point. Config selects the implementation.

## Session file writes must be atomic
Use write-to-temp + rename pattern in `core/session-manager.ts`. No partial writes.

## Signals accumulate, never replace
Appending signals to `state.signals[]` is correct. Clearing existing signals on a new event is wrong.

## Override is single-use, scoped to `next_action`
After consuming an override in `PreToolUse`, remove it from session state immediately. Never let it carry over to a second action.

## Context sent to JEV/Laya must be minimal
No raw file content, no full diffs. Only: intent, current action, recent actions (bounded), failure summaries, active signal types.
