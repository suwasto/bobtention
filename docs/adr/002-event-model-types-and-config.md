# ADR 002 — Event Model, Types & Configuration

**Status:** Accepted  
**Date:** 2025-07-28  
**Phase:** 1 — Types, Event Model & Configuration  

---

## Context

Every downstream Bobtention component — session manager, signal extractor, decision adapter, enforcement — depends on a shared type vocabulary and configuration. Defining these upfront prevents breaking interface changes mid-build. The primary question is: what shape should the normalized event model, decision contract, session state, and config take?

---

## Decision

### Event Taxonomy

All Bob hook payloads are normalized into a `NormalizedEvent` discriminated union:

```typescript
type NormalizedEvent =
  | ToolEvent        // tool_use (PreToolUse / PostToolUse)
  | TestResultEvent  // test result parsed from tool output
  | PromptEvent      // UserPromptSubmit payload
  | SessionInitEvent // SessionStart
  | LifecycleEvent   // Stop
```

Each variant carries a `kind` discriminant, ensuring exhaustive pattern matching is possible throughout the codebase.

### Decision Contract

```typescript
interface DecisionContract {
  decision: AttentionDecision;  // 'ALLOW' | 'WATCH' | 'BLOCK'
  confidence: number;           // 0.0–1.0
  reason: string;
  signals: SignalType[];
  summary?: string;
}
```

This is the single output type from the decision engine, regardless of whether the engine is JEV/Laya or LocalRuleAdapter.

### Decision Context (payload to JEV/Laya)

Minimal payload — no raw file contents, no full diffs (PRD §11, AGENTS.md rule):

```typescript
interface DecisionContext {
  intent: string;
  currentAction: { tool: string; files: string[] };
  recentActions: Array<{ type: string; files: string[] }>;
  failures: Array<{ signature: string; count: number; progressing: boolean }>;
  signals: SignalType[];
}
```

### Configuration Resolution

```
Defaults (built-in)
  ← ~/.bobtention/config.json         (global, optional)
    ← ./bobtention.config.json        (workspace, optional)
```

Deep merge at each layer — missing keys always fall back to defaults. Config loader never throws; malformed files are logged as warnings and skipped.

### Session State

Flat bounded structure:

```typescript
interface SessionState {
  sessionId, originalIntent, startTime, status
  actions[]   // capped at config.session.maxActions
  tests[]
  failures[]  // deduplicated by signature
  signals[]   // accumulated, never cleared
  decisions[]
  overrides[]
  deferredBlock?  // PostToolUse → next PreToolUse deferred block
}
```

`originalIntent` is immutable except via `updateIntent()`. Signals accumulate; clearing them on a new event is wrong (AGENTS.md).

### Override Scope

MVP only supports `scope: 'next_action'`. After consuming an override in PreToolUse, it is removed immediately. It never carries over to a second action.

---

## Rationale

- **Discriminated union for events:** Enables exhaustive switch statements; TypeScript narrows type automatically per `kind`.
- **Compact DecisionContext:** Matches PRD §11 and the AGENTS.md rule "no raw file content, no full diffs". Token budget for JEV/Laya stays minimal.
- **Config deep-merge:** Allows workspace-level tuning (e.g., custom highImpactPatterns) without overriding all global defaults.
- **Bounded session state:** Prevents unbounded memory growth across long sessions. `maxActions` cap keeps the context window passed to JEV/Laya predictable.

---

## Consequences

- All hook entry points must import from `src/types/index.ts` only — no ad-hoc type definitions elsewhere.
- Config loader must be called once at hook startup; result should be passed down, not re-loaded per call.
- `deferredBlock` on SessionState is the only mechanism by which PostToolUse can influence the next PreToolUse decision.

---

## Alternatives Considered

| Option | Rejected reason |
|--------|----------------|
| Single flat event type with optional fields | No discriminant → no type narrowing → runtime `undefined` bugs |
| Config via environment variables only | No workspace-level tuning; harder to version-control |
| Config via YAML | Adds a YAML parser dependency; JSON sufficient for MVP |
| Storing full diffs in DecisionContext | Violates AGENTS.md minimal-context rule; balloons JEV/Laya token cost |
