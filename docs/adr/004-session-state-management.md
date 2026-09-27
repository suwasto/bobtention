# ADR 004 — Session State Management

**Status:** Accepted
**Date:** 2025-07-01
**Phase:** 3

## Context

Bobtention needs to maintain context across multiple Bob hook invocations within a session. Each hook is a short-lived process (exit on completion), so state cannot live only in memory. The design must satisfy:

- Original intent must survive multiple tool invocations without being overwritten by agent activity.
- Failure tracking must distinguish "stuck on the same error" from "trying different things".
- Scope tracking must distinguish the initial footprint of a task from later expansion.
- History must be bounded to prevent unbounded growth during long sessions.
- A crash mid-write must never leave a corrupt session file.

## Decision

### Persistence

Session state is stored as a single JSON file at `<storagePath>/<sessionId>.json` (default: `~/.bobtention/sessions/`). There is no database dependency; JSON files are readable by humans and trivially portable.

### Atomic writes

All writes follow a write-to-temp + `fs.renameSync` pattern:

```
write → <sessionId>.json.tmp
rename → <sessionId>.json
```

`rename` on POSIX is atomic with respect to the file system. The `.tmp` file is never visible to readers.

### Bounded history

`state.actions` is trimmed to the most recent `config.session.maxActions` entries (default 50) on every `updateSession` call. Older actions are dropped. This prevents unbounded growth and keeps the in-memory and on-disk state predictable.

### Intent immutability

`state.originalIntent` is set only by `initSession` and `updateIntent`. No other function may write to it. Agent activity (tool events, test events) cannot change the intent field. This is enforced by code structure, not runtime checks — `updateSession` simply does not touch the field.

`updateIntent(sessionId, newIntent)` is the sole explicit task-change API (PRD §52).

### Failure grouping

Failures are grouped by `signature` (test name or error key). Each `FailureRecord` tracks:

- `count` — how many times the failure has been seen without clearing
- `progressing` — whether the failure was cleared by a passing run since it last appeared
- `lastSeen` — timestamp of most recent occurrence

When a test passes, `clearFailureProgression` marks `progressing = true`. If the same test fails again, a new record is created (the old one remains in history with `progressing = true`).

### Scope tracking

`getInitialScope(state, n)` returns the set of top-level directories touched in the first `n` actions (default n=5). `getCurrentScope(state)` returns all directories touched across all actions. Signal detection computes expansion as `|current \ initial| / |initial|`.

### Fail-open

Any file I/O error (missing directory, corrupt JSON, permission error) is caught and logged. `getSession` returns `null` rather than throwing. `updateSession` and other mutating functions create an empty shell state if the session is not found.

## Rationale

- JSON files: zero dependencies, survives process crashes, human-readable for debugging.
- Bounded history: long agentic sessions can run hundreds of tool calls; unconstrained growth would make context payloads to JEV/Laya too large and slow.
- Intent as immutable field: the key invariant for task-alignment detection. If agent activity could rewrite it, drift detection would be blind.
- Atomic rename: crash-safe. The alternative (write-in-place) can leave half-written JSON on a power cut.

## Consequences

- Sessions are stored as individual files. No indexing or query capability beyond load-by-ID.
- On process crash between write and rename, the `.tmp` file may be left behind. On next start it is ignored (no auto-cleanup). This is acceptable for MVP.
- `maxActions = 50` means very old actions are lost. Signal detection works on recent state only. This is intentional.

## Alternatives Considered

| Alternative | Reason Rejected |
|---|---|
| SQLite | Adds a native dependency; unnecessary complexity for MVP |
| Redis/external store | Requires a running service; incompatible with hook-based architecture |
| Single shared JSON file for all sessions | Concurrent writes across sessions would require locking |
| Keep all actions in history | Unbounded growth; makes context payloads too large |
