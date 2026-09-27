/**
 * src/adapters/decision-adapter.ts
 *
 * Decision Adapter — abstraction boundary between Bobtention and the decision engine.
 *
 * ADR: dosc/adr/006-decision-architecture.md
 * PRD §9 (Laya role), §10 (config), §12 (contract), §13 (evaluation strategy)
 *
 * Two implementations behind the `DecisionEngine` interface:
 *   LayaAdapter      — HTTP POST to self-hosted Laya endpoint; used in prod/demo
 *   LocalRuleAdapter — threshold-based fallback; no network required
 *
 * Selection is driven by `config.decisionEngine.provider`.
 * Fallback chain: LayaAdapter failure → LocalRuleAdapter → ALLOW+warn (fail-open).
 *
 * Laya API contract (self-hosted, localhost:8000):
 *   POST /v1/systemone
 *   Body: { state: { body: string }, questions: { [key]: { type, instructions, criteria } } }
 *   Response: { answers: { [key]: { choice, answer_confidence, probabilities } } }
 *
 * Multi-question guardrail pattern (laya-ai.com/recipes/llm-guardrails):
 *   Each active signal type gets its own focused choice question, allowing Laya
 *   to reason independently about each concern using the specific detail text.
 *   Answers are aggregated: worst-case decision wins, reasons compose into summary.
 */
import type { DecisionContext, DecisionContract } from '../types';
import type { BobtentionConfig } from '../core/config';
export interface DecisionEngine {
    evaluate(context: DecisionContext): Promise<DecisionContract>;
}
export declare class LayaAdapter implements DecisionEngine {
    private readonly endpoint;
    private readonly timeoutMs;
    constructor(endpoint: string, timeoutMs: number);
    evaluate(context: DecisionContext): Promise<DecisionContract>;
}
export declare class LocalRuleAdapter implements DecisionEngine {
    private readonly watchThreshold;
    private readonly blockThreshold;
    constructor(watchThreshold: number, blockThreshold: number);
    evaluate(context: DecisionContext): Promise<DecisionContract>;
}
/**
 * Build the primary decision engine from config.
 * Returns a LayaAdapter or LocalRuleAdapter.
 */
export declare function createDecisionEngine(config: BobtentionConfig): DecisionEngine;
/**
 * Evaluate with fallback chain:
 *   Laya engine → LocalRuleAdapter (fallback) → ALLOW+warn (fail-open)
 *
 * Laya is always the primary when an endpoint is configured. Local rules
 * are the fallback for any Laya unavailability (network error, timeout, etc.).
 * Called by AttentionEvaluator — never invoke Laya directly outside this file.
 */
export declare function evaluateWithFallback(context: DecisionContext, config: BobtentionConfig): Promise<DecisionContract>;
//# sourceMappingURL=decision-adapter.d.ts.map