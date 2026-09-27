#!/usr/bin/env node
"use strict";
/**
 * src/hooks/pre-tool-use.ts
 *
 * Bob PreToolUse hook entry point — main enforcement point.
 *
 * Behavior:
 *  - Reads stdin (tool use payload)
 *  - Loads / updates session state
 *  - Extracts signals, evaluates decision via AttentionEvaluator
 *  - Enforces decision (exit 0 = ALLOW/WATCH, exit 2 = BLOCK)
 *
 * stdout is ignored by Bob for PreToolUse — all output goes to stderr.
 * PreToolUse hooks are matched via `matcher` regex in .bob/settings.json.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const errors_1 = require("../utils/errors");
const event_normalizer_1 = require("../core/event-normalizer");
const config_1 = require("../core/config");
const session_manager_1 = require("../core/session-manager");
const attention_evaluator_1 = require("../core/attention-evaluator");
const enforcement_1 = require("../core/enforcement");
const logger_1 = require("../utils/logger");
void (0, errors_1.runHook)('pre-tool-use', async () => {
    const raw = await (0, event_normalizer_1.readStdin)();
    const event = (0, event_normalizer_1.normalizePreToolUse)(raw);
    if (!event) {
        logger_1.logger.warn('[pre-tool-use] Could not parse payload — allowing through (fail-open)');
        return 0;
    }
    const config = (0, config_1.loadConfig)();
    if (!config.enabled)
        return 0;
    // Resolve session id from the raw payload
    const payloadObj = (typeof raw === 'string' ? JSON.parse(raw || '{}') : raw);
    const sessionId = payloadObj.session_id ?? 'default';
    // T7.2 / T7.3 — Check for a pending human override BEFORE evaluating.
    // If active, consume it (single-use) and allow through immediately.
    const currentState = (0, session_manager_1.getSession)(sessionId, config);
    if (currentState) {
        const overrideCheck = (0, enforcement_1.checkAndConsumeOverride)(currentState);
        if (overrideCheck.overrideConsumed) {
            (0, session_manager_1.persistState)(overrideCheck.state, config);
            logger_1.logger.info('[pre-tool-use] Human override consumed — action allowed');
            return 0;
        }
    }
    // Record the incoming action in session state
    const updatedState = (0, session_manager_1.updateSession)(sessionId, event, config);
    // Extract new signals and append (signals accumulate, never replace)
    const newSignals = (0, attention_evaluator_1.extractEventSignals)(updatedState, event, config);
    let finalState = updatedState;
    for (const signal of newSignals) {
        finalState = (0, session_manager_1.appendSignal)(sessionId, signal, config);
    }
    logger_1.logger.info(`[pre-tool-use] Evaluating: ${event.tool} [${event.files.join(', ')}]`);
    // Evaluate decision (fast ALLOW / deterministic BLOCK / engine)
    const contract = await (0, attention_evaluator_1.evaluateEvent)(finalState, event, config);
    // Enforce — emit notification to stderr, record decision in state
    const result = (0, enforcement_1.enforcePreAction)(contract, finalState, event, 'pre-tool-use', config);
    // Persist state mutations made by enforcement (decision record, deferredBlock consumed)
    (0, session_manager_1.persistState)(result.state, config);
    return result.exitCode;
});
//# sourceMappingURL=pre-tool-use.js.map