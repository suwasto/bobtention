/**
 * src/core/context-builder.ts
 *
 * DecisionContext Builder — assembles the compact payload sent to the decision engine.
 *
 * ADR: dosc/adr/006-decision-architecture.md
 * PRD §11 (decision context), §49 (privacy/minimal context)
 *
 * Rules:
 *  - No raw file content, no full diffs
 *  - Only: intent, current action, recent actions (bounded), failure summary, active signals
 *  - recentActions capped at RECENT_ACTIONS_LIMIT
 *  - failures include only signature + count (no raw output)
 */

import type { DecisionContext, SessionState, Signal, NormalizedEvent } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max number of recent actions included in the context payload */
const RECENT_ACTIONS_LIMIT = 10;

/** Max number of failures included in the context payload */
const FAILURES_LIMIT = 5;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a compact DecisionContext from the current session state and the
 * incoming event (pre-action context — tool not yet executed).
 */
export function buildDecisionContext(
  state: SessionState,
  currentEvent: NormalizedEvent,
  activeSignals: Signal[],
): DecisionContext {
  const currentAction = extractCurrentAction(currentEvent);

  const recentActions = state.actions
    .slice(-RECENT_ACTIONS_LIMIT)
    .map((a) => ({
      type: a.tool,
      files: a.files,
    }));

  const failures = state.failures
    .filter((f) => !f.progressing && f.count >= 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, FAILURES_LIMIT)
    .map((f) => ({
      signature: f.signature,
      count: f.count,
      progressing: f.progressing,
    }));

  // Deduplicate by type — keep the highest-severity Signal per type so the
  // decision engine gets one representative entry per concern (with its detail).
  const signals: Signal[] = dedupeSignals(activeSignals);

  return {
    intent: state.originalIntent || '(unknown)',
    currentAction,
    recentActions,
    failures,
    signals,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractCurrentAction(event: NormalizedEvent): DecisionContext['currentAction'] {
  if (event.kind === 'tool') {
    return { tool: event.tool, files: event.files };
  }
  if (event.kind === 'prompt') {
    return { tool: 'user_prompt', files: [] };
  }
  return { tool: event.kind, files: [] };
}

/**
 * Deduplicate signals — keep the highest-severity Signal per type.
 * Preserves the full Signal object (including detail text) rather than
 * collapsing to a bare SignalType, so the decision engine can reason about
 * *why* each signal fired.
 */
function dedupeSignals(signals: Signal[]): Signal[] {
  const best = new Map<string, Signal>();
  for (const s of signals) {
    const existing = best.get(s.type);
    if (!existing || s.severity > existing.severity) {
      best.set(s.type, s);
    }
  }
  return [...best.values()];
}
