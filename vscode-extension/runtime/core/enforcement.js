"use strict";
/**
 * src/core/enforcement.ts
 *
 * Enforcement Layer — translates a DecisionContract into hook exit behavior.
 *
 * ADR: dosc/adr/007-enforcement-and-notification.md
 * PRD §7 (decisions), §16 (enforcement constraint), §30 (safety principles)
 *
 * Exit-code contract (AGENTS.md):
 *   PreToolUse / UserPromptSubmit:  ALLOW → 0,  WATCH → 0,  BLOCK → 2
 *   PostToolUse / SessionStart / Stop: ALWAYS 0 — never exit 2
 *
 * PostToolUse BLOCK path:
 *   Concern detected AFTER an action → write deferredBlock to session state.
 *   The next PreToolUse reads deferredBlock and enforces it.
 *
 * Every decision (decision + timestamp) is recorded in session state.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAndConsumeOverride = checkAndConsumeOverride;
exports.enforcePreAction = enforcePreAction;
exports.enforcePostAction = enforcePostAction;
const logger_1 = require("../utils/logger");
const notification_1 = require("./notification");
const BLOCKING_HOOKS = new Set(['pre-tool-use', 'user-prompt-submit']);
/**
 * Check whether a pending human override should consume the next action.
 * If an active override is present in the session, consume it (single-use) and return
 * overrideConsumed=true. The caller should exit 0 immediately without further evaluation.
 *
 * T7.2 / T7.3 / T7.4 (PRD §24–§25)
 */
function checkAndConsumeOverride(state) {
    if (!state.pendingOverride?.active) {
        return { overrideConsumed: false, state };
    }
    const override = state.pendingOverride;
    logger_1.logger.info(`[enforcement] Human override consumed — allowing action (${override.reason})`);
    // Consume the override (single-use, PRD §25, AGENTS.md)
    delete state.pendingOverride;
    // Record override as a decision entry with timestamp
    const record = {
        decision: 'ALLOW',
        reason: `Human override: ${override.reason}`,
        confidence: 1.0,
        timestamp: Date.now(),
        engine: 'override',
    };
    state.decisions.push(record);
    process.stderr.write(`✓ Bobtention: human override active — continuing (${override.reason})\n`);
    return { overrideConsumed: true, state };
}
/**
 * Apply a decision contract for a blocking hook (PreToolUse or UserPromptSubmit).
 *
 * ALLOW → exit 0, silent
 * WATCH → exit 0, stderr notification
 * BLOCK → exit 2, stderr notification with full explanation
 *         (advisory-only when config.humanOverride.enabled === false → exit 0)
 *
 * Checks for a pending deferredBlock before applying the fresh contract —
 * a deferred block from PostToolUse takes precedence.
 *
 * T7.1 / T7.5 (PRD §24–§25)
 */
function enforcePreAction(contract, state, event, hookType, config) {
    if (!BLOCKING_HOOKS.has(hookType)) {
        // Safety guard: callers must not pass a non-blocking hook here
        logger_1.logger.warn(`[enforcement] enforcePreAction called from non-blocking hook "${hookType}" — ignoring BLOCK`);
        return { exitCode: 0, state: recordDecision(state, contract) };
    }
    // Check for pending deferred BLOCK from a prior PostToolUse observation
    const deferred = consumeDeferredBlock(state);
    if (deferred) {
        logger_1.logger.info(`[enforcement] Consuming deferred BLOCK from PostToolUse: ${deferred.reason}`);
        const deferredContract = {
            decision: 'BLOCK',
            confidence: 1.0,
            reason: deferred.reason,
            signals: deferred.signals,
        };
        (0, notification_1.notify)(deferredContract, state, event, 'post-action');
        const updatedState = recordBlockedAction(state, deferredContract, event);
        return {
            exitCode: resolveBlockExitCode(config),
            state: recordDecision(updatedState, deferredContract),
        };
    }
    // Apply the fresh contract
    (0, notification_1.notify)(contract, state, event, 'pre-action');
    let updatedState = recordDecision(state, contract);
    if (contract.decision === 'BLOCK') {
        logger_1.logger.info(`[enforcement] BLOCK — exit ${resolveBlockExitCode(config)}: ${contract.reason}`);
        updatedState = recordBlockedAction(updatedState, contract, event);
        return { exitCode: resolveBlockExitCode(config), state: updatedState };
    }
    if (contract.decision === 'WATCH') {
        logger_1.logger.info(`[enforcement] WATCH — exit 0: ${contract.reason}`);
    }
    return { exitCode: 0, state: updatedState };
}
/**
 * Apply a decision contract from a PostToolUse observation.
 *
 * ALWAYS returns exit 0.
 * If the contract says BLOCK, it writes a deferredBlock to session state.
 * The next PreToolUse will enforce it.
 *
 * PRD §16 — PostToolUse cannot retroactively undo an action.
 */
function enforcePostAction(contract, state, event) {
    if (contract.decision === 'BLOCK') {
        logger_1.logger.info(`[enforcement] PostToolUse: concern detected — deferring BLOCK to next PreToolUse`);
        (0, notification_1.notify)(contract, state, event, 'post-action');
        state.deferredBlock = {
            reason: contract.reason,
            signals: contract.signals,
        };
    }
    else if (contract.decision === 'WATCH') {
        (0, notification_1.notify)(contract, state, event, 'post-action');
    }
    const updatedState = recordDecision(state, contract);
    return { exitCode: 0, state: updatedState }; // ALWAYS 0
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Consume (and remove) a pending deferredBlock from state.
 * Returns the block data if present, null otherwise.
 * Per AGENTS.md: override is single-use — remove after consumption.
 */
function consumeDeferredBlock(state) {
    if (!state.deferredBlock)
        return null;
    const block = state.deferredBlock;
    delete state.deferredBlock;
    return block;
}
/**
 * Append a DecisionRecord to the session decisions list.
 * Carries engine tag, trigger context, and Laya Q&A detail from the contract.
 */
function recordDecision(state, contract) {
    const record = {
        decision: contract.decision,
        reason: contract.reason,
        confidence: contract.confidence,
        timestamp: Date.now(),
        ...(contract.engine !== undefined && { engine: contract.engine }),
        ...(contract.trigger !== undefined && { trigger: contract.trigger }),
        ...(contract.layaDetail !== undefined && { layaDetail: contract.layaDetail }),
    };
    state.decisions.push(record);
    return state;
}
/**
 * Record the blocked action context in session state.
 * Enables the override CLI to show the user what was blocked.
 * T7.1 (PRD §24–§25)
 */
function recordBlockedAction(state, contract, event) {
    const files = event.kind === 'tool' ? event.files : [];
    const tool = event.kind === 'tool' ? event.tool : event.kind;
    state.blockedAction = {
        tool,
        files,
        reason: contract.reason,
        timestamp: Date.now(),
    };
    return state;
}
/**
 * Determine exit code for a BLOCK decision.
 * When humanOverride.enabled === false, BLOCK is advisory-only → exit 0.
 * T7.5 (PRD §25)
 */
function resolveBlockExitCode(config) {
    if (config?.humanOverride.enabled === false) {
        process.stderr.write(`⚠ Bobtention: advisory BLOCK (override disabled) — continuing\n`);
        return 0;
    }
    return 2;
}
//# sourceMappingURL=enforcement.js.map