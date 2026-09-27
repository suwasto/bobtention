# ADR 005 — Signal Extraction Strategy

**Status:** Accepted
**Date:** 2025-07-01
**Phase:** 4

## Context

Bobtention must detect five categories of agent behavior that warrant human attention. Each must:

- Be computable from session state + a single normalized event (no external calls).
- Have configurable enable/disable per signal type.
- Start at low severity and escalate with repeated evidence — not fire at maximum on first occurrence.
- Never modify session state directly; the caller accumulates emitted signals.

## Decision

### Signal types and detection heuristics

| Type | Primary Evidence | Fire Condition |
|---|---|---|
| `REPEATED_FAILURE` | `state.failures[]` | Any non-progressing failure with count ≥ 3 |
| `SCOPE_EXPANSION` | `state.actions[]` files | New dirs beyond initial scope / initial size > 50%; at least 6 actions in history |
| `TASK_DRIFT` | Current event files vs intent keywords | Current files match neither intent keywords nor initial scope dirs |
| `HIGH_IMPACT_CHANGE` | Current event files | Any file path matches a configured high-impact pattern (glob or regex) |
| `UNCERTAINTY` | Last 10 actions dirs | ≥4 distinct top-level directories in the last 10 actions |

### Severity accumulation

Severity is computed with an asymptotic formula that prevents instant escalation to maximum:

```
severity = base + (max − base) × (1 − e^(−0.4 × (prior + step)))
```

Where:
- `prior` = number of prior signals of the same type already in `state.signals`
- `step` = additional evidence weight (1 for first new detection, higher for worse failures)
- `base` = per-type starting severity
- `max` = per-type ceiling

Per-type base/max values:

| Type | base | max |
|---|---|---|
| REPEATED_FAILURE | 0.30 | 0.90 |
| SCOPE_EXPANSION | 0.20 | 0.75 |
| TASK_DRIFT | 0.25 | 0.80 |
| HIGH_IMPACT_CHANGE | 0.50 | 0.95 |
| UNCERTAINTY | 0.20 | 0.70 |

`HIGH_IMPACT_CHANGE` starts higher because the detection itself is deterministic (pattern match), not probabilistic.

### Pattern matching

`HIGH_IMPACT_CHANGE` patterns support two forms:

1. **Glob** (contains `*`, `?`, or `/`): matched via `minimatch` with `matchBase: true`.
2. **Regex** (everything else): compiled as a case-insensitive `RegExp` against the file path.

This allows the default patterns shipped with config (glob-style like `**/migration*`) and user-authored regex patterns like `\\.env|secret` to coexist without a separate flag.

### Scope detection baseline

`getInitialScope` uses the first 5 actions as baseline. The requirement for ≥6 total actions before firing `SCOPE_EXPANSION` prevents false positives at session start when scope is still being established.

### Signals are not appended by extractSignals

`extractSignals` returns a slice of new signals. The caller (`updateSession` or the attention evaluator) is responsible for appending them to `state.signals`. This keeps the function pure and testable.

### Disabled signals

If a signal type is disabled in `config.signals`, `extractSignals` skips that detector entirely. No partial computation.

## Rationale

- **Asymptotic severity**: Avoids the cliff-edge problem where the first occurrence instantly triggers a BLOCK. Escalation happens naturally as evidence accumulates. The `e^(−0.4x)` factor makes the first few occurrences relatively gentle and subsequent ones steeper.
- **Intent keywords from text**: Extracting 4+ character words from free-text intent is a simple heuristic that works well for typical task descriptions ("fix the login authentication bug" → ["login", "authentication"]). More sophisticated NLP would require external dependencies.
- **Top-level directory as scope unit**: Individual file paths change too rapidly to be meaningful for scope comparison. Top-level directories (e.g., `src`, `tests`, `infra`) are stable enough to represent work areas.
- **minimatch for glob**: Already in the dependency tree transitively; no new dependency added.

## Consequences

- Task drift detection is heuristic and may produce false positives for tasks described with generic language ("fix bug" → no useful keywords).
- Scope expansion requires 6+ actions, so it cannot fire in the very first few tool calls.
- Pattern matching is per-file, not per-diff content. A rename that moves a file to a sensitive path would trigger HIGH_IMPACT_CHANGE; a write to a non-matching file would not, even if the content is sensitive.

## Alternatives Considered

| Alternative | Reason Rejected |
|---|---|
| ML-based intent alignment | Requires external model call; violates context-minimality rule |
| Fixed severity per signal type | Ignores accumulation; would either over-alert or under-alert |
| Accumulate by modifying state inside extractSignals | Makes the function impure; harder to test and reason about |
| Directory depth > 1 for scope | More granular but noisier; top-level dirs map better to project modules |
