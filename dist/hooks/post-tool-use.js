#!/usr/bin/env node
"use strict";
/**
 * src/hooks/post-tool-use.ts
 *
 * Bob PostToolUse hook entry point — observation only.
 *
 * Behavior:
 *  - Reads stdin (tool response payload)
 *  - Updates session state (records action, failures, signals)
 *  - Evaluates post-action signals — if concerning, writes deferredBlock to session
 *  - ALWAYS exits 0 — PostToolUse CANNOT block (PRD §16, AGENTS.md)
 *
 * A BLOCK discovered here is deferred: the next PreToolUse will enforce it.
 *
 * stdout is ignored by Bob for PostToolUse — all output goes to stderr.
 * PostToolUse hooks are matched via `matcher` regex in .bob/settings.json.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const errors_1 = require("../utils/errors");
const event_normalizer_1 = require("../core/event-normalizer");
const config_1 = require("../core/config");
const session_manager_1 = require("../core/session-manager");
const attention_evaluator_1 = require("../core/attention-evaluator");
const enforcement_1 = require("../core/enforcement");
const logger_1 = require("../utils/logger");
void (0, errors_1.runHook)('post-tool-use', async () => {
    const raw = await (0, event_normalizer_1.readStdin)();
    const event = (0, event_normalizer_1.normalizePostToolUse)(raw);
    if (!event) {
        logger_1.logger.warn('[post-tool-use] Could not parse payload — skipping observation');
        return 0; // Always exit 0
    }
    const config = (0, config_1.loadConfig)();
    if (!config.enabled)
        return 0;
    const payloadObj = (typeof raw === 'string' ? JSON.parse(raw || '{}') : raw);
    const sessionId = payloadObj.session_id ?? 'default';
    // Record the completed action in session state
    const updatedState = (0, session_manager_1.updateSession)(sessionId, event, config);
    // Extract signals from the post-action event and append
    const newSignals = (0, attention_evaluator_1.extractEventSignals)(updatedState, event, config);
    let finalState = updatedState;
    for (const signal of newSignals) {
        finalState = (0, session_manager_1.appendSignal)(sessionId, signal, config);
    }
    logger_1.logger.info(`[post-tool-use] Observed: ${event.tool} [${event.files.join(', ')}]`);
    // Evaluate post-action — any BLOCK deferred to next PreToolUse
    const contract = await (0, attention_evaluator_1.evaluateEvent)(finalState, event, config);
    // enforcePostAction always returns exit 0; writes deferredBlock if BLOCK
    const result = (0, enforcement_1.enforcePostAction)(contract, finalState, event);
    // Persist state (decisions + possible deferredBlock)
    (0, session_manager_1.persistState)(result.state, config);
    return 0; // ALWAYS exit 0
});
//# sourceMappingURL=post-tool-use.js.map