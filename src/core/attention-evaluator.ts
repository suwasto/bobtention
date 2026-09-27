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
 *   1. Deterministic BLOCK: repeated identical failures above hard threshold → BLOCK without engine
 *   2. Deterministic BLOCK: any signal severity ≥ blockThreshold → BLOCK without engine
 *   3. Always:       build DecisionContext → evaluateWithFallback (Laya evaluates every event)
 *
 * This module is the ONLY caller of context-builder and decision-adapter.
 * Hook entry points call evaluateEvent() and then pass the contract to the Enforcement Layer.
 */

import { logger } from '../utils/logger';
import { extractSignals } from './signal-extractor';
import { buildDecisionContext } from './context-builder';
import { evaluateWithFallback } from '../adapters/decision-adapter';
import type {
  SessionState,
  NormalizedEvent,
  DecisionContract,
  Signal,
} from '../types';
import type { BobtentionConfig } from './config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Number of identical failures above which we deterministically BLOCK
 * without invoking the decision engine (PRD §13, §31).
 */
const DETERMINISTIC_BLOCK_FAILURE_COUNT = 4;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate an event against the current session state.
 *
 * Returns a DecisionContract that the caller (hook) must pass to the enforcement layer.
 * Never throws — any internal error produces an ALLOW contract (fail-open).
 */
export async function evaluateEvent(
  state: SessionState,
  event: NormalizedEvent,
  config: BobtentionConfig,
): Promise<DecisionContract> {
  // Only tool and prompt events carry meaningful decision data
  if (event.kind !== 'tool' && event.kind !== 'prompt') {
    return fastAllow('Non-actionable event kind');
  }

  // Capture trigger context for the DecisionRecord
  const trigger =
    event.kind === 'tool'
      ? { tool: event.tool, files: event.files }
      : { tool: 'user_prompt', files: [] };

  // --- Path 1: extract signals ---
  const newSignals: Signal[] = extractSignals(state, event, config);
  // Combine with existing session signals for full picture
  const allSignals = [...state.signals, ...newSignals];

  // --- Path 2: deterministic BLOCK —  repeated identical failure ---
  const deterministicBlock = checkDeterministicBlock(state);
  if (deterministicBlock) {
    logger.info(
      `[attention-evaluator] Deterministic BLOCK: ${deterministicBlock}`,
    );
    return {
      decision: 'BLOCK',
      confidence: 1.0,
      reason: deterministicBlock,
      signals: ['REPEATED_FAILURE'],
      engine: 'deterministic',
      trigger,
    };
  }

  // --- Path 2b: deterministic BLOCK — signal severity meets blockThreshold ---
  // Laya resolves ambiguity; it cannot override a signal that already exceeds the
  // operator-configured hard threshold.
  const severityBlock = checkSeverityBlock(allSignals, config.autonomy.blockThreshold);
  if (severityBlock) {
    logger.info(
      `[attention-evaluator] Deterministic BLOCK (severity): ${severityBlock}`,
    );
    return {
      decision: 'BLOCK',
      confidence: 1.0,
      reason: severityBlock,
      signals: allSignals.map((s) => s.type),
      engine: 'deterministic',
      trigger,
    };
  }

  // --- Path 3: invoke decision engine unconditionally ---
  // Laya evaluates every event regardless of local signal count so it can use
  // its own full context — local detectors augment, they do not gate Laya.
  logger.info(
    `[attention-evaluator] Invoking decision engine (${allSignals.length} local signal(s))`,
  );
  const context = buildDecisionContext(state, event, allSignals);
  const contract = await evaluateWithFallback(context, config);

  logger.info(
    `[attention-evaluator] Engine decision: ${contract.decision} (confidence=${contract.confidence})`,
  );
  // engine tag and layaDetail are set by the adapter; inject trigger here
  return { ...contract, trigger };
}

/**
 * Return newly extracted signals for a given event without making a full decision.
 * Used by PostToolUse to accumulate signals into session state.
 */
export function extractEventSignals(
  state: SessionState,
  event: NormalizedEvent,
  config: BobtentionConfig,
): Signal[] {
  return extractSignals(state, event, config);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fastAllow(reason: string): DecisionContract {
  return {
    decision: 'ALLOW',
    confidence: 1.0,
    reason,
    signals: [],
  };
}

/**
 * Check whether the session state alone warrants a deterministic BLOCK.
 * Returns a reason string if yes, null otherwise.
 */
function checkDeterministicBlock(state: SessionState): string | null {
  const worstFailure = state.failures
    .filter((f) => !f.progressing && f.count >= DETERMINISTIC_BLOCK_FAILURE_COUNT)
    .sort((a, b) => b.count - a.count)[0];

  if (worstFailure) {
    return `"${worstFailure.signature}" failed ${worstFailure.count}× without progress — automatic block`;
  }
  return null;
}

/**
 * Check whether any signal's severity already meets or exceeds the operator's
 * blockThreshold. When it does, the decision engine (Laya) must not override it —
 * Laya resolves ambiguity, not hard-threshold violations.
 *
 * Returns a reason string if a block is warranted, null otherwise.
 */
function checkSeverityBlock(signals: Signal[], blockThreshold: number): string | null {
  const worst = [...signals].sort((a, b) => b.severity - a.severity)[0];
  if (worst && worst.severity >= blockThreshold) {
    return `Signal ${worst.type} severity ${worst.severity.toFixed(2)} ≥ blockThreshold ${blockThreshold} — automatic block`;
  }
  return null;
}
