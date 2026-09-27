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
import type { DecisionContract, SessionState, NormalizedEvent } from '../types';
import type { BobtentionConfig } from './config';
type BlockingHook = 'pre-tool-use' | 'user-prompt-submit';
type ObservationHook = 'post-tool-use' | 'session-start' | 'stop';
export type HookType = BlockingHook | ObservationHook;
export interface EnforcementResult {
    /** Exit code to pass to process.exit() */
    exitCode: 0 | 2;
    /** Updated session state (caller must persist) */
    state: SessionState;
}
/**
 * Result of checking a pending override in PreToolUse.
 * If an override was consumed, the hook should exit 0 immediately.
 */
export interface OverrideCheckResult {
    overrideConsumed: boolean;
    state: SessionState;
}
/**
 * Check whether a pending human override should consume the next action.
 * If an active override is present in the session, consume it (single-use) and return
 * overrideConsumed=true. The caller should exit 0 immediately without further evaluation.
 *
 * T7.2 / T7.3 / T7.4 (PRD §24–§25)
 */
export declare function checkAndConsumeOverride(state: SessionState): OverrideCheckResult;
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
export declare function enforcePreAction(contract: DecisionContract, state: SessionState, event: NormalizedEvent, hookType: HookType, config?: Pick<BobtentionConfig, 'humanOverride'>): EnforcementResult;
/**
 * Apply a decision contract from a PostToolUse observation.
 *
 * ALWAYS returns exit 0.
 * If the contract says BLOCK, it writes a deferredBlock to session state.
 * The next PreToolUse will enforce it.
 *
 * PRD §16 — PostToolUse cannot retroactively undo an action.
 */
export declare function enforcePostAction(contract: DecisionContract, state: SessionState, event: NormalizedEvent): EnforcementResult;
export {};
//# sourceMappingURL=enforcement.d.ts.map