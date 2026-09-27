# ADR 006 — Decision Architecture

**Status:** Accepted
**Date:** 2025-01
**Phase:** 5 — Attention Evaluator & Decision Adapter

---

## Context

Bobtention needs to evaluate every Bob tool event and decide: ALLOW, WATCH, or BLOCK.
This decision must be reliable, fast, and explainable — even when the configured external
decision engine (JEV/Laya) is unavailable or slow.

Two competing concerns:
1. Latency — calling an HTTP service on every hook invocation is too slow for low-risk events.
2. Intelligence — simple thresholds cannot capture the nuanced reasoning required for
   ambiguous situations (task drift, unexpected scope changes).

---

## Decision

### Three-path evaluation

The Attention Evaluator (`core/attention-evaluator.ts`) implements three paths, evaluated in order:

```
Event
  │
  ▼
Extract signals
  │
  ├─ No signals → fast ALLOW (exit 0 in < 5ms, no engine call)
  │
  ├─ Deterministic BLOCK:
  │    repeated identical failure ≥ 4× without progress
  │    → BLOCK, confidence=1.0 (no engine call)
  │
  └─ Ambiguous:
       signals present → build DecisionContext → evaluateWithFallback()
```

**Fast ALLOW** handles the majority of hook events (file reads, searches, normal edits in scope)
without touching the network.

**Deterministic BLOCK** handles the "stuck agent" scenario directly — if the same error has
appeared 4+ times without progress, no intelligent reasoning is needed. The threshold (4) is
a constant; future phases may make it configurable.

**Ambiguous path** delegates to the decision adapter, which provides the intelligence layer.

---

### Decision Adapter interface

```typescript
interface DecisionEngine {
  evaluate(context: DecisionContext): Promise<DecisionContract>;
}
```

All coupling to JEV/Laya or any external engine is behind this interface. No hook, session
manager, or signal extractor imports anything from `adapters/`.

Two implementations:
- `JevLayaAdapter`: HTTP POST to `config.decisionEngine.endpoint`, with `AbortController` timeout.
- `LocalRuleAdapter`: threshold-based rules using signal severity weights; no network required.

Selection is driven by `config.decisionEngine.provider` (`'jev-laya'` or `'local'`).

---

### Fallback chain

```
JevLayaAdapter (if provider='jev-laya')
  │ failure / timeout
  ▼
LocalRuleAdapter
  │ failure (unexpected)
  ▼
fail-open: { decision: 'ALLOW', confidence: 0.0, reason: 'engine unavailable' }
```

Engine failure must never surface as a BLOCK. Fail-open is mandatory (AGENTS.md).

---

### DecisionContext — minimal payload

The context sent to the decision engine contains only:
- `intent`: original task intent string
- `currentAction`: `{ tool, files }` — no raw content, no diffs
- `recentActions`: last 10 actions, `{ type, files }` only
- `failures`: signature + count, bounded to 5 entries
- `signals`: deduplicated list of active `SignalType` values

Raw file content, full diffs, and environment details are never included (PRD §49 privacy).

---

## Rationale

- **Swappable engine**: The interface boundary makes it trivial to swap JEV/Laya for any future
  decision runtime without touching hook code.
- **Deterministic shortcuts** reduce engine load and latency for clear-cut cases.
- **Minimal context** satisfies privacy constraints and reduces token cost for external engines.
- **Fail-open** is non-negotiable per AGENTS.md — a crashed engine must never accidentally BLOCK Bob.

---

## Consequences

- Engine selection is config-driven; no code changes needed to switch between providers.
- LocalRuleAdapter uses signal weight combination (evidence combination formula) which is
  intentionally simple — complex reasoning is the engine's responsibility.
- `DETERMINISTIC_BLOCK_FAILURE_COUNT = 4` is a hard-coded constant in this MVP. Phase 7+ may
  expose it as `config.autonomy.deterministicBlockThreshold`.
- Context builder deduplicates signal types (keeps only latest of each); engine receives
  a clean list, not every individual signal occurrence.

---

## Alternatives Rejected

- **Call engine on every event**: Too slow for latency requirements; wastes engine capacity on
  obvious low-risk events.
- **Only local rules, no external engine**: Cannot provide the nuanced context-aware reasoning
  the PRD requires for ambiguous situations.
- **Hard-code JEV/Laya**: Violates the adapter boundary rule in AGENTS.md and makes testing
  impractical without a live JEV/Laya instance.
