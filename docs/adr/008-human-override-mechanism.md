# ADR 008 — Human Override Mechanism

**Status:** Accepted
**Date:** 2025-01
**Phase:** 7 — Human Override

---

## Context

When Bobtention issues a BLOCK, the developer must be able to explicitly acknowledge the
concern and allow Bob to continue. The system must never become an opaque authority that
permanently prevents Bob from acting (PRD §24).

Two design tensions exist:

1. **Bob does not expose a native pause/resume API.** When a `PreToolUse` hook exits 2,
   Bob stops. There is no built-in callback mechanism that lets the hook "wait" for human
   input. Any override mechanism must therefore work asynchronously — the developer acts
   *after* the block, and the next time Bob attempts an action the override is consumed.

2. **Override must be scoped and single-use.** An override that persists across multiple
   actions would silently suppress future legitimate blocks, violating PRD §30.3
   (conservative enforcement). The MVP scope is `next_action` only.

---

## Decision

### Override data model (PRD §25)

A `pendingOverride` field is added to `SessionState`:

```typescript
interface Override {
  active: boolean;
  reason: string;
  scope: 'next_action';    // MVP only
}

// In SessionState:
pendingOverride?: Override;
```

A `blockedAction` field is also added to `SessionState` to record what was blocked,
so the override CLI can show the developer what they are approving:

```typescript
blockedAction?: {
  tool: string;
  files: string[];
  reason: string;
  timestamp: number;
};
```

### BLOCK → blocked state

When `enforcePreAction` (or the deferred-block path) issues a BLOCK, it calls
`recordBlockedAction()` which writes `state.blockedAction` with the tool, files, reason,
and timestamp. This persists to disk via `persistState()`.

### Developer override command (T7.1)

```
npx bobtention override [--session <id>] [--reason <text>]
```

Implemented in `scripts/override.ts`, compiled to `dist/scripts/override.js` (the `bin`
entry in `package.json`). The script:

1. Scans `~/.bobtention/sessions/` for active session files.
2. Selects the most recently blocked session (or the session named by `--session`).
3. Displays what was blocked (tool, files, reason, timestamp).
4. Writes `pendingOverride = { active: true, reason, scope: "next_action" }` using the
   atomic write-to-temp + rename pattern.

The script has no imports from the compiled project — it uses inline type declarations
and direct `fs` operations — so it can be executed before or after a `npm run build`.

### PreToolUse override check (T7.2 / T7.3 / T7.4)

At the top of `pre-tool-use.ts`, before any signal extraction or decision evaluation:

```
1. Load current session state
2. Call checkAndConsumeOverride(state)
3. If overrideConsumed = true:
     - State already has override removed and a DecisionRecord added
     - persistState(state)
     - return 0 (exit 0 — allow through)
4. Otherwise: proceed with normal evaluation pipeline
```

`checkAndConsumeOverride()` in `enforcement.ts`:
- Returns `{ overrideConsumed: false }` immediately if `pendingOverride` is absent or inactive.
- If active:
  - Deletes `pendingOverride` from state (single-use, AGENTS.md)
  - Appends a `DecisionRecord { decision: 'ALLOW', reason: 'Human override: <reason>', timestamp }`
  - Writes `✓ Bobtention: human override active — continuing (…)` to stderr
  - Returns `{ overrideConsumed: true, state }`

### Advisory mode (T7.5)

When `config.humanOverride.enabled === false`, BLOCK is advisory-only: the enforcement layer
calls `resolveBlockExitCode(config)` which returns `0` and writes a warning to stderr:

```
⚠ Bobtention: advisory BLOCK (override disabled) — continuing
```

This allows Bobtention to operate in observe-only mode (e.g., CI environments or demos where
blocking would disrupt the pipeline).

---

## Rationale

- **Asynchronous override via session file** is the only approach compatible with Bob's hook
  architecture, where hooks run to completion before Bob proceeds or halts. There is no
  persistent process to "notify".

- **Single-use pendingOverride** (deleted on first consumption) prevents the override from
  silently suppressing unrelated future BLOCKs, satisfying PRD §25 and AGENTS.md:
  > "Override is single-use, scoped to `next_action`."

- **blockedAction in session state** gives the override CLI enough information to present a
  meaningful confirmation to the developer. Without it, the human would be approving a
  blank slate, reducing the trust value of the override.

- **Recorded in decisions history** ensures the audit trail is complete — a session replay
  shows precisely where human overrides were applied and why. PRD §30.2 (explainability).

- **Advisory mode** (enabled=false) was kept in the same code path via `resolveBlockExitCode`
  rather than a separate branch, to avoid duplicating the BLOCK notification logic.

- **Scripts separate tsconfig** (`tsconfig.scripts.json`) keeps the CLI script out of the
  `src/` compilation unit (whose `rootDir` is `./src`), while still benefiting from full
  strict TypeScript checking at build time.

---

## Consequences

- `SessionState` now has two additional optional fields: `blockedAction` and `pendingOverride`.
  Existing session files written by Phase 6 remain valid — both fields are optional.

- The `enforcePreAction` signature gains an optional `config` parameter for the advisory-mode
  check. Existing call sites that omit it default to `enabled: true` (safe default — BLOCK
  remains hard).

- The `pre-tool-use.ts` hook now performs a `getSession` call at the start of each invocation
  to check for a pending override. This adds one potential disk read per PreToolUse (mitigated
  by the in-memory cache in session-manager — the read is a cache hit when the session was
  recently active).

- `scripts/override.ts` is compiled by a second `tsc` pass (`tsconfig.scripts.json`), adding
  ~1 s to build time. It is a minimal script (no external dependencies) so this is acceptable.

---

## Alternatives Rejected

- **Write override to a separate override file** (e.g., `~/.bobtention/override`): Simpler
  discovery but breaks the single-source-of-truth principle — session state is already the
  authoritative record. Two files create race conditions.

- **Env variable as override signal** (`BOBTENTION_OVERRIDE=1`): Convenient but not scoped
  to a session or action. It would require the developer to unset it manually, making it
  likely to accidentally suppress future legitimate blocks.

- **Persistent override (session-scoped or signal-scoped)**: Possible future extension
  (PRD §25 lists `current_session` and `current_signal` as future scopes). Excluded from
  MVP per PRD §53 (explicit MVP non-requirements).

- **Interactive prompt inside the hook**: `PreToolUse` hooks are non-interactive — they read
  a fixed stdin payload and must exit. There is no way to pause and wait for terminal input
  within the hook's execution context.
