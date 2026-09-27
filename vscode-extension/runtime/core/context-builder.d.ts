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
/**
 * Build a compact DecisionContext from the current session state and the
 * incoming event (pre-action context — tool not yet executed).
 */
export declare function buildDecisionContext(state: SessionState, currentEvent: NormalizedEvent, activeSignals: Signal[]): DecisionContext;
//# sourceMappingURL=context-builder.d.ts.map