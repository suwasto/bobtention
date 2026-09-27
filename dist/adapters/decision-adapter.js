"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalRuleAdapter = exports.LayaAdapter = void 0;
exports.createDecisionEngine = createDecisionEngine;
exports.evaluateWithFallback = evaluateWithFallback;
const logger_1 = require("../utils/logger");
class LayaAdapter {
    constructor(endpoint, timeoutMs) {
        this.endpoint = endpoint;
        this.timeoutMs = timeoutMs;
    }
    async evaluate(context) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const body = buildLayaRequest(context);
            const res = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!res.ok) {
                throw new Error(`Laya HTTP ${res.status}: ${res.statusText}`);
            }
            const raw = (await res.json());
            return parseLayaResponse(raw, context);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
exports.LayaAdapter = LayaAdapter;
// ---------------------------------------------------------------------------
// Laya request builder — multi-question guardrail pattern
// ---------------------------------------------------------------------------
/**
 * Max chars for the intent string in the state body.
 * Keeps total body well within the 4k-token accuracy window.
 */
const INTENT_MAX_CHARS = 2000;
/**
 * Question key prefix used for per-signal guardrail questions.
 * The aggregation logic identifies these by prefix.
 */
const SIGNAL_QUESTION_PREFIX = 'guardrail_';
/**
 * Build a Laya request using the multi-question guardrail pattern.
 *
 * Instead of one vague meta-question, we post:
 *   1. One "intent_alignment" question — is the current action aligned with the
 *      stated task, regardless of signals?
 *   2. One focused guardrail question per active signal — each question gets the
 *      signal's detail text injected into its instructions so Laya can reason
 *      about the *specific* evidence, not just the label.
 *
 * This lets Laya override a signal when context makes it safe (e.g. a
 * HIGH_IMPACT_CHANGE on a test fixture is not the same as one on a prod schema).
 */
function buildLayaRequest(context) {
    const intent = context.intent.length > INTENT_MAX_CHARS
        ? context.intent.slice(0, INTENT_MAX_CHARS) + '…'
        : context.intent;
    const failureSummary = context.failures.length > 0
        ? `failures: ${context.failures.map((f) => `${f.signature}(x${f.count})`).join(', ')}`
        : 'no failures';
    const recentSummary = context.recentActions.length > 0
        ? `recent actions: ${context.recentActions
            .slice(-5)
            .map((a) => `${a.type}(${a.files.join(',')})`)
            .join('; ')}`
        : 'no prior actions';
    const stateBody = [
        `task: ${intent}`,
        `current action: ${context.currentAction.tool}(${context.currentAction.files.join(', ')})`,
        recentSummary,
        failureSummary,
    ].join(' | ');
    const questions = {};
    // --- Always-present question: intent alignment ---
    questions['intent_alignment'] = {
        type: 'choice',
        instructions: 'Does the current action align with the stated task? ' +
            'Consider the tool being used, the files it touches, and the recent action history.',
        criteria: {
            aligned: 'The action is clearly on-task — files and tool match the stated intent',
            minor_drift: 'The action is mostly on-task but touches files tangentially related to the intent',
            drifted: 'The action is off-task — files or tool have no clear relationship to the stated intent',
        },
    };
    // --- Per-signal guardrail questions ---
    for (const signal of context.signals) {
        const key = `${SIGNAL_QUESTION_PREFIX}${signal.type.toLowerCase()}`;
        questions[key] = buildSignalQuestion(signal);
    }
    return { state: { body: stateBody }, questions };
}
/**
 * Build a focused guardrail question for a specific signal.
 * Each question includes the signal's detail text so Laya reasons about
 * the actual evidence, not a generic category label.
 */
function buildSignalQuestion(signal) {
    const detail = signal.detail ?? signal.type;
    const questionMap = {
        HIGH_IMPACT_CHANGE: {
            type: 'choice',
            instructions: `A high-impact change was detected: "${detail}". ` +
                'Does this change warrant stopping the agent for human review, or is it safe to proceed?',
            criteria: {
                safe: 'The change is routine or clearly within the scope of the stated task — allow',
                review_recommended: 'The change is significant but low-risk — log and continue with a watch flag',
                must_review: 'The change is high-risk (production config, secrets, destructive operation, deployment) — block and require human approval',
            },
        },
        TASK_DRIFT: {
            type: 'choice',
            instructions: `Task drift was detected: "${detail}". ` +
                'Is this drift intentional and acceptable given the task, or does it indicate the agent is off-course?',
            criteria: {
                acceptable: 'The drift is justified — the agent is exploring a necessary dependency or related concern',
                investigate: 'The drift is unexpected but could be incidental — monitor but allow',
                off_course: 'The agent has clearly diverged from the task — block and re-orient',
            },
        },
        REPEATED_FAILURE: {
            type: 'choice',
            instructions: `Repeated failures detected: "${detail}". ` +
                'Should the agent continue attempting to resolve this, or has it exhausted reasonable options?',
            criteria: {
                continue: 'The failure pattern suggests the agent is making progress — allow another attempt',
                warn: 'The agent is stuck but not at risk — log and allow one more attempt',
                stop: 'The agent is looping without progress — block and request human guidance',
            },
        },
        SCOPE_EXPANSION: {
            type: 'choice',
            instructions: `Scope expansion detected: "${detail}". ` +
                'Is the expanded scope justified by the stated task, or is the agent overreaching?',
            criteria: {
                justified: 'The additional scope is a necessary part of completing the task — allow',
                borderline: 'The expansion is plausible but not clearly required — watch and log',
                overreach: 'The agent is expanding significantly beyond what the task requires — block',
            },
        },
        UNCERTAINTY: {
            type: 'choice',
            instructions: `Agent uncertainty detected: "${detail}". ` +
                'Does this pattern indicate the agent is confused, or is it legitimately exploring?',
            criteria: {
                exploring: 'The breadth of activity is consistent with legitimate discovery or refactoring — allow',
                uncertain: 'The activity pattern suggests the agent lacks direction — watch and prompt',
                confused: 'The agent appears to be thrashing across unrelated areas — block and re-prompt',
            },
        },
    };
    return questionMap[signal.type] ?? {
        type: 'choice',
        instructions: `An attention signal was raised: "${detail}". Should the agent continue?`,
        criteria: {
            allow: 'The signal does not indicate a real risk — allow',
            watch: 'The signal warrants monitoring — watch',
            block: 'The signal indicates a serious risk — block',
        },
    };
}
// ---------------------------------------------------------------------------
// Laya response parser — aggregate multi-question answers
// ---------------------------------------------------------------------------
/**
 * Decision severity ordering — used to pick the worst-case across all answers.
 */
const DECISION_SEVERITY = {
    ALLOW: 0,
    WATCH: 1,
    BLOCK: 2,
};
/**
 * Map per-question answer choices to an AttentionDecision.
 * Each question has domain-specific criteria keys; we normalise them here.
 */
function choiceToDecision(questionKey, choice) {
    const c = choice.toLowerCase();
    if (questionKey === 'intent_alignment') {
        if (c === 'drifted')
            return 'BLOCK';
        if (c === 'minor_drift')
            return 'WATCH';
        return 'ALLOW';
    }
    if (questionKey.startsWith(SIGNAL_QUESTION_PREFIX)) {
        const signalType = questionKey.slice(SIGNAL_QUESTION_PREFIX.length).toUpperCase();
        const blockChoices = {
            HIGH_IMPACT_CHANGE: ['must_review'],
            TASK_DRIFT: ['off_course'],
            REPEATED_FAILURE: ['stop'],
            SCOPE_EXPANSION: ['overreach'],
            UNCERTAINTY: ['confused'],
        };
        const watchChoices = {
            HIGH_IMPACT_CHANGE: ['review_recommended'],
            TASK_DRIFT: ['investigate'],
            REPEATED_FAILURE: ['warn'],
            SCOPE_EXPANSION: ['borderline'],
            UNCERTAINTY: ['uncertain'],
        };
        if (blockChoices[signalType]?.includes(c))
            return 'BLOCK';
        if (watchChoices[signalType]?.includes(c))
            return 'WATCH';
        return 'ALLOW';
    }
    // Generic fallback
    if (c === 'block')
        return 'BLOCK';
    if (c === 'watch')
        return 'WATCH';
    return 'ALLOW';
}
/**
 * Parse Laya's multi-question response into a single DecisionContract.
 *
 * Strategy:
 *   - Collect (decision, confidence, questionKey, choice) for every answered question.
 *   - Worst-case decision wins (BLOCK > WATCH > ALLOW).
 *   - Confidence = weighted average of answer_confidence values, biased toward
 *     the worst-case answer (its confidence counts double).
 *   - Compose a human-readable reason from all non-ALLOW answers.
 *   - Attach full summary listing every question result.
 */
function parseLayaResponse(raw, context) {
    const answers = raw?.answers ?? {};
    const signalTypes = context.signals.map((s) => s.type);
    const results = [];
    for (const [key, entry] of Object.entries(answers)) {
        if (!entry?.choice)
            continue;
        const decision = choiceToDecision(key, entry.choice);
        const confidence = typeof entry.answer_confidence === 'number' ? entry.answer_confidence : 0.5;
        results.push({ questionKey: key, choice: entry.choice, decision, confidence });
    }
    if (results.length === 0) {
        logger_1.logger.warn('[decision-adapter] Laya returned no answers — defaulting to ALLOW');
        return {
            decision: 'ALLOW',
            confidence: 0.5,
            reason: 'Laya returned no answers — defaulting to ALLOW',
            signals: signalTypes,
            engine: 'laya',
        };
    }
    // Worst-case decision
    const worstResult = results.reduce((worst, r) => DECISION_SEVERITY[r.decision] > DECISION_SEVERITY[worst.decision] ? r : worst);
    // Weighted confidence: worst-case answer counts double
    const totalWeight = results.length + 1; // +1 for the double-weight of worst
    const weightedSum = results.reduce((sum, r) => sum + r.confidence, 0) + worstResult.confidence;
    const confidence = Math.round((weightedSum / totalWeight) * 100) / 100;
    // Compose reason from non-ALLOW answers
    const concerns = results
        .filter((r) => r.decision !== 'ALLOW')
        .map((r) => `${r.questionKey.replace(SIGNAL_QUESTION_PREFIX, '').replace('_', ' ')}: ${r.choice}`);
    const reason = concerns.length > 0
        ? `Laya: ${concerns.join('; ')}`
        : `Laya: all guardrails passed (${worstResult.questionKey} → ${worstResult.choice})`;
    // Full summary listing every question
    const summary = results
        .map((r) => `${r.questionKey}=${r.choice}(${r.decision},${r.confidence.toFixed(2)})`)
        .join(' | ');
    // Build layaDetail array for dashboard display
    const layaDetail = results.map((r) => ({
        question: r.questionKey,
        choice: r.choice,
        decision: r.decision,
        confidence: r.confidence,
    }));
    return {
        decision: worstResult.decision,
        confidence,
        reason,
        signals: signalTypes,
        summary,
        engine: 'laya',
        layaDetail,
    };
}
// ---------------------------------------------------------------------------
// LocalRuleAdapter (threshold-based fallback)
// ---------------------------------------------------------------------------
class LocalRuleAdapter {
    constructor(watchThreshold, blockThreshold) {
        this.watchThreshold = watchThreshold;
        this.blockThreshold = blockThreshold;
    }
    async evaluate(context) {
        const signalTypes = context.signals.map((s) => s.type);
        if (context.signals.length === 0) {
            return {
                decision: 'ALLOW',
                confidence: 0.95,
                reason: 'No signals detected',
                signals: [],
            };
        }
        // Compute aggregate severity from the signal list.
        // Each signal type maps to a base severity weight used by the rule engine.
        const signalWeights = {
            HIGH_IMPACT_CHANGE: 0.85,
            REPEATED_FAILURE: 0.75,
            TASK_DRIFT: 0.7,
            SCOPE_EXPANSION: 0.6,
            UNCERTAINTY: 0.55,
        };
        const weights = context.signals.map((s) => signalWeights[s.type] ?? 0.5);
        // Combined confidence = 1 - product of (1-w) for each weight (evidence combination)
        const combined = 1 - weights.reduce((acc, w) => acc * (1 - w), 1);
        const confidence = Math.round(combined * 100) / 100;
        const decision = confidence >= this.blockThreshold
            ? 'BLOCK'
            : confidence >= this.watchThreshold
                ? 'WATCH'
                : 'ALLOW';
        // Use the highest-severity signal's detail for the reason when available
        const worstSignal = [...context.signals].sort((a, b) => b.severity - a.severity)[0];
        const reason = worstSignal?.detail
            ? `${signalToReason(worstSignal.type)}: ${worstSignal.detail}`
            : signalToReason(worstSignal?.type ?? 'UNCERTAINTY');
        return { decision, confidence, reason, signals: signalTypes, engine: 'local' };
    }
}
exports.LocalRuleAdapter = LocalRuleAdapter;
// ---------------------------------------------------------------------------
// Factory — select adapter based on config
// ---------------------------------------------------------------------------
/**
 * Build the primary decision engine from config.
 * Returns a LayaAdapter or LocalRuleAdapter.
 */
function createDecisionEngine(config) {
    if (config.decisionEngine.provider === 'laya' &&
        config.decisionEngine.endpoint) {
        logger_1.logger.info(`[decision-adapter] Using Laya engine at ${config.decisionEngine.endpoint}`);
        return new LayaAdapter(config.decisionEngine.endpoint, config.decisionEngine.timeout);
    }
    logger_1.logger.info('[decision-adapter] Using local rule-based engine');
    return new LocalRuleAdapter(config.autonomy.watchThreshold, config.autonomy.blockThreshold);
}
/**
 * Evaluate with fallback chain:
 *   primary engine → LocalRuleAdapter → ALLOW+warn (fail-open)
 *
 * Called by AttentionEvaluator — never invoke Laya directly outside this file.
 */
async function evaluateWithFallback(context, config) {
    const primary = createDecisionEngine(config);
    try {
        return await primary.evaluate(context);
    }
    catch (primaryErr) {
        const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
        logger_1.logger.warn(`[decision-adapter] Primary engine failed: ${msg} — falling back to local rules`);
        // If primary was already local, no point trying it again
        if (config.decisionEngine.provider === 'local') {
            logger_1.logger.warn('[decision-adapter] Local engine failed — fail-open: ALLOW');
            return failOpenContract();
        }
        try {
            const fallback = new LocalRuleAdapter(config.autonomy.watchThreshold, config.autonomy.blockThreshold);
            return await fallback.evaluate(context);
        }
        catch (fallbackErr) {
            const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
            logger_1.logger.error(`[decision-adapter] Fallback engine failed: ${fbMsg} — fail-open: ALLOW`);
            return failOpenContract();
        }
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function failOpenContract() {
    return {
        decision: 'ALLOW',
        confidence: 0.0,
        reason: 'Decision engine unavailable — fail-open',
        signals: [],
    };
}
function signalToReason(signal) {
    const map = {
        TASK_DRIFT: 'Task drift detected',
        REPEATED_FAILURE: 'Repeated failures without progress',
        SCOPE_EXPANSION: 'Scope expanding beyond initial boundaries',
        HIGH_IMPACT_CHANGE: 'High-impact change detected',
        UNCERTAINTY: 'Agent direction appears uncertain',
    };
    return map[signal] ?? signal;
}
//# sourceMappingURL=decision-adapter.js.map