# ADR 007 — Enforcement and Notification Layer

**Status:** Accepted
**Date:** 2025-01
**Phase:** 6 — Enforcement & Notification Layer

---

## Context

Once the Attention Evaluator produces a `DecisionContract`, Bobtention must translate it into
observable behavior: the correct hook exit code, a human-readable message, and a persistent
record in session state.

Several constraints are non-negotiable:

1. **Exit code contract** (AGENTS.md): only `PreToolUse` and `UserPromptSubmit` may exit 2.
   `PostToolUse`, `SessionStart`, and `Stop` must always exit 0.

2. **stdout is Bob's** (AGENTS.md): messages go to stderr only. stdout is reserved for
   `SessionStart` / `UserPromptSubmit` context injection.

3. **No retroactive claims** (PRD §30.4): `PostToolUse` cannot claim to have prevented an
   action that already happened.

4. **ALLOW is silent** (PRD §27): the common case must not generate noise.

---

## Decision

### Enforcement Layer (`core/enforcement.ts`)

Two public functions:

```typescript
enforcePreAction(contract, state, event, hookType): EnforcementResult
enforcePostAction(contract, state, event): EnforcementResult
```

`EnforcementResult` carries `{ exitCode: 0 | 2, state: SessionState }`.
The caller (hook entry point) passes `result.exitCode` to `process.exit()` and persists
`result.state` via `persistState()`.

#### Pre-action enforcement (PreToolUse / UserPromptSubmit)

```
ALLOW → exit 0, silent
WATCH → exit 0, stderr notification
BLOCK → exit 2, stderr notification (full explanation)
```

Before applying the fresh contract, `enforcePreAction` checks `state.deferredBlock`:
- If present: consume it (single-use, delete from state), emit a post-action BLOCK message,
  exit 2. The fresh contract is ignored in this turn.
- If absent: apply the fresh contract normally.

A safety guard prevents `enforcePreAction` from emitting exit 2 when called from a
non-blocking hook (e.g., due to a caller bug).

#### Post-action enforcement (PostToolUse)

```
ALLOW → exit 0, silent
WATCH → exit 0, stderr notification (informational)
BLOCK → exit 0, write deferredBlock to session state
```

`PostToolUse` can never exit 2. If a BLOCK is warranted after an action, the concern is
recorded as `state.deferredBlock`. The next `PreToolUse` invocation picks it up.

#### Decision recording

Every call records a `DecisionRecord { decision, reason, confidence, timestamp }` in
`state.decisions`. This provides an audit trail without requiring external logging.

---

### Notification Layer (`core/notification.ts`)

Message format per PRD:

**ALLOW** — no output (silent, PRD §27)

**WATCH** (PRD §28):
```
◐ Bobtention: watching — <reason>
```
Post-action variant:
```
◐ Bobtention: observed after action — <reason>
```

**BLOCK** (PRD §29):
```
⚠ Bobtention: human attention required

Reason: <reason>
Task:   <original intent>
Current: <tool> (<files>)
Signals:
  • <signal label 1>
  • <signal label 2>

<summary if present>

The next action has been blocked.
```
Post-action variant uses a different first line:
```
⚠ Bobtention: concern detected after action — next action has been blocked
```
This upholds PRD §30.4 — no retroactive claim of prevention.

All messages go to `process.stderr`. `process.stdout` is never written by the notification layer.

---

### Deferred BLOCK flow (PostToolUse → PreToolUse)

```
PostToolUse            PreToolUse (next invocation)
      │                        │
      │  concern detected       │
      │  → deferredBlock set    │
      │                        │
      │                        ├─ deferredBlock present?
      │                        │     YES → consume (delete), exit 2
      │                        │     NO  → evaluate fresh contract
      │                        │
```

The `deferredBlock` is single-use: consumed and deleted on the first subsequent `PreToolUse`.
This implements the AGENTS.md requirement:
> "Override is single-use, scoped to `next_action`."
> "After consuming an override in `PreToolUse`, remove it from session state immediately."

---

## Rationale

- **Separation of concerns**: enforcement logic (exit codes, state mutation) is cleanly
  separated from formatting logic (notification). This makes both independently testable.
- **Explicit source tagging** (`'pre-action'` / `'post-action'`) drives the message wording
  difference, satisfying PRD §30.4 without conditional logic scattered in callers.
- **Decision audit trail** (`state.decisions`) enables future analytics (Phase 8+) without
  requiring external logging infrastructure in the MVP.
- **Single-use deferred BLOCK** prevents stale blocks from carrying over to unrelated future
  actions, which would violate PRD §30.3 (conservative enforcement).

---

## Consequences

- Hook entry points are thin: normalize → update session → extract signals → evaluate →
  enforce → persist. All policy is in `enforcement.ts` and `notification.ts`.
- The `EnforcementResult` pattern (return exit code rather than call `process.exit` inside
  the enforcement layer) makes unit testing straightforward — no process exit mocking needed.
- `state.decisions` is unbounded in this MVP. Phase 8 may add a configurable cap to prevent
  large session files for long-running sessions.

---

## Alternatives Rejected

- **Call `process.exit()` inside enforcement**: Makes unit testing require process mocking;
  violates separation of concerns.
- **Write BLOCK immediately in PostToolUse (exit 2)**: Violates AGENTS.md and the PRD §16
  enforcement constraint. PostToolUse cannot retroactively block.
- **Write BLOCK messages to stdout**: Violates the stdout/stderr contract — stdout is owned
  by Bob for context injection.
- **One combined Enforcement+Notification module**: Hard to test message formatting in isolation;
  mixing I/O concerns with exit-code logic.
