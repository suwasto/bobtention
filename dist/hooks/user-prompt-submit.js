#!/usr/bin/env node
"use strict";
/**
 * src/hooks/user-prompt-submit.ts
 *
 * Bob UserPromptSubmit hook entry point.
 *
 * Behavior:
 *  - Reads stdin (prompt payload)
 *  - Captures / updates original intent in session state
 *  - Evaluates the prompt event (can BLOCK if concerning)
 *  - Writes acknowledgment context to stdout (Bob merges into prompt context)
 *  - Exits 0 (allow) or 2 (block)
 *
 * stdout = context injected into Bob prompt context
 * stderr = our logs only
 */
Object.defineProperty(exports, "__esModule", { value: true });
const errors_1 = require("../utils/errors");
const event_normalizer_1 = require("../core/event-normalizer");
const config_1 = require("../core/config");
const session_manager_1 = require("../core/session-manager");
const attention_evaluator_1 = require("../core/attention-evaluator");
const enforcement_1 = require("../core/enforcement");
const logger_1 = require("../utils/logger");
void (0, errors_1.runHook)('user-prompt-submit', async () => {
    const raw = await (0, event_normalizer_1.readStdin)();
    const event = (0, event_normalizer_1.normalizeUserPrompt)(raw);
    if (!event) {
        logger_1.logger.warn('[user-prompt-submit] Could not parse prompt payload — allowing through');
        process.stdout.write('Bobtention: monitoring active.\n');
        return 0;
    }
    const config = (0, config_1.loadConfig)();
    if (!config.enabled) {
        process.stdout.write('Bobtention: monitoring inactive.\n');
        return 0;
    }
    const payloadObj = (typeof raw === 'string' ? JSON.parse(raw || '{}') : raw);
    const sessionId = payloadObj.session_id ?? 'default';
    const { text } = event;
    logger_1.logger.info(`[user-prompt-submit] Intent: "${text.slice(0, 80)}…"`);
    // Initialize or resume the session; set intent from the first prompt
    let state = (0, session_manager_1.initSession)(sessionId, text, config);
    // If this is not the first prompt, update intent (explicit task change)
    if (state.originalIntent && state.originalIntent !== text && state.actions.length > 0) {
        state = (0, session_manager_1.updateIntent)(sessionId, text, config);
        logger_1.logger.info('[user-prompt-submit] Task intent updated');
    }
    // Extract signals (rare at prompt time, but possible)
    const newSignals = (0, attention_evaluator_1.extractEventSignals)(state, event, config);
    let finalState = state;
    for (const signal of newSignals) {
        finalState = (0, session_manager_1.appendSignal)(sessionId, signal, config);
    }
    // Evaluate and potentially block
    const contract = await (0, attention_evaluator_1.evaluateEvent)(finalState, event, config);
    const result = (0, enforcement_1.enforcePreAction)(contract, finalState, event, 'user-prompt-submit');
    // Persist state mutations
    (0, session_manager_1.persistState)(result.state, config);
    // Write context to stdout — Bob injects this into the prompt context
    const context = `Bobtention: task intent recorded — "${text.slice(0, 120)}".`;
    process.stdout.write(context + '\n');
    return result.exitCode;
});
//# sourceMappingURL=user-prompt-submit.js.map