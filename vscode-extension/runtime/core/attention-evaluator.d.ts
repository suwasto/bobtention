/**
 * src/core/attention-evaluator.ts
 *
 * Attention Evaluator — orchestrates the full evaluation pipeline for a single event.
 *
 * ADR: dosc/adr/006-decision-architecture.md
 * PRD §13 (evaluation strategy), §31 (intelligent evaluation policy)
 *
 * Decision paths:
 *
 *   1. Fast ALLOW:   no signals present → skip engine, return ALLOW immediately
 *   2. Deterministic BLOCK: repeated identical failures above hard threshold → BLOCK without engine
 *   3. Ambiguous:    signals present but not deterministic → build DecisionContext → evaluateWithFallback
 *
 * This module is the ONLY caller of context-builder and decision-adapter.
 * Hook entry points call evaluateEvent() and then pass the contract to the Enforcement Layer.
 */
import type { SessionState, NormalizedEvent, DecisionContract, Signal } from '../types';
import type { BobtentionConfig } from './config';
/**
 * Evaluate an event against the current session state.
 *
 * Returns a DecisionContract that the caller (hook) must pass to the enforcement layer.
 * Never throws — any internal error produces an ALLOW contract (fail-open).
 */
export declare function evaluateEvent(state: SessionState, event: NormalizedEvent, config: BobtentionConfig): Promise<DecisionContract>;
/**
 * Return newly extracted signals for a given event without making a full decision.
 * Used by PostToolUse to accumulate signals into session state.
 */
export declare function extractEventSignals(state: SessionState, event: NormalizedEvent, config: BobtentionConfig): Signal[];
//# sourceMappingURL=attention-evaluator.d.ts.map