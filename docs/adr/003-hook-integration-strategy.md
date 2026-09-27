# ADR 003 — Hook Integration Strategy

**Status:** Accepted  
**Date:** 2025-07-28  
**Phase:** 2 — Hook Adapter & Event Normalizer  

---

## Context

Bob invokes hook scripts via shell commands. The hooks receive JSON payloads on stdin and communicate back through exit codes and stdout. The exact payload schema varies per hook type, and may evolve across Bob versions. Bobtention must:

1. Parse these payloads into typed internal events.
2. Never crash on a malformed payload.
3. Respect the strict stdout/stderr/exit-code semantics per hook type.
4. Be wired into Bob via `.bob/settings.json`.

---

## Decision

### Hook Entry Points

Each Bob hook has a dedicated entry-point file in `src/hooks/`:

| File | Hook | Exit 2 allowed? | stdout role |
|------|------|----------------|-------------|
| `session-start.ts` | SessionStart | No | Context string injected into Bob session |
| `user-prompt-submit.ts` | UserPromptSubmit | Yes (block if needed) | Context merged into prompt |
| `pre-tool-use.ts` | PreToolUse | **Yes — main enforcement point** | Ignored by Bob |
| `post-tool-use.ts` | PostToolUse | **Never** | Ignored by Bob |
| `stop.ts` | Stop | **Never** | Ignored by Bob |

All entry points are wrapped with `runHook()` from `src/utils/errors.ts` (fail-open).

### Event Normalizer (`src/core/event-normalizer.ts`)

Single module responsible for parsing raw Bob JSON → `NormalizedEvent`. Each hook type has its own normalizer function:

```typescript
normalizeSessionStart(raw: string): SessionInitEvent | null
normalizeUserPrompt(raw: string): PromptEvent | null
normalizePreToolUse(raw: string): ToolEvent | null
normalizePostToolUse(raw: string): ToolEvent | null
normalizeStop(raw: string): LifecycleEvent | null
```

On malformed input: log to stderr, return `null`. Callers treat `null` as fail-open (allow through).

### File Path Extraction

File paths are extracted from tool input by scanning common field names (`path`, `file_path`, `file`, `filename`, `paths`, `files`) plus tool-specific logic for `edit`, `write_file`, `apply_diff`. Results are deduplicated.

### Test Result Extraction (heuristic)

`normalizePostToolUse` scans bash/command tool output for common test runner patterns (PASS/FAIL, `✓`/`✗`, "N tests passed/failed"). When detected, the test result is embedded in `event.output._testResult` and extractable via `extractEmbeddedTestResult()`. The Signal Extractor (Phase 4) consumes this.

### Bob Registration (`/.bob/settings.json`)

```json
{
  "hooks": {
    "SessionStart": [{ "type": "command", "command": "node dist/hooks/session-start.js" }],
    "UserPromptSubmit": [{ "type": "command", "command": "node dist/hooks/user-prompt-submit.js" }],
    "PreToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node dist/hooks/pre-tool-use.js", "timeout": 10 }] }],
    "PostToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node dist/hooks/post-tool-use.js" }] }],
    "Stop": [{ "type": "command", "command": "node dist/hooks/stop.js" }]
  }
}
```

`PreToolUse` and `PostToolUse` require the `matcher` regex wrapper around `hooks[]`. SessionStart, UserPromptSubmit, Stop use the flat `type`/`command` format.

---

## Rationale

- **Separate normalizer module:** Keeps hook entry points thin. All payload-parsing logic is testable in isolation without spawning a Node process.
- **Fail-open on null:** A `null` normalized event means "we don't know what this is" — safer to allow than to block, per the fail-open mandate.
- **No output to stdout from PostToolUse/PreToolUse/Stop:** Bob ignores it anyway for these hooks; writing there could interfere with future Bob behavior.
- **Heuristic test detection at the normalizer layer:** Keeps Signal Extractor (Phase 4) decoupled from raw bash output strings.

---

## Consequences

- Hook entry points must never write to stdout except `session-start.ts` and `user-prompt-submit.ts`.
- `normalizePostToolUse` result's `output._testResult` is an internal private convention — not part of the public `NormalizedEvent` type contract.
- When Bob's hook payload schema changes, only the corresponding `normalize*` function needs updating.

---

## Alternatives Considered

| Option | Rejected reason |
|--------|----------------|
| Single generic normalizer (`normalizeHook(hookType, raw)`) | Loses discriminant type narrowing per hook type |
| Parse payloads inline in each hook file | Not unit-testable; duplicates error handling |
| Use Bob's exact documented schema (strict) | Schema may vary or be undocumented; defensive parsing is safer for MVP |
