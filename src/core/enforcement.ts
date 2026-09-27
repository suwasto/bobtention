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

import { logger } from '../utils/logger';
import { notify } from './notification';
import type {
  DecisionContract,
  SessionState,
  NormalizedEvent,
  DecisionRecord,
} from '../types';
import type { BobtentionConfig } from './config';

// ---------------------------------------------------------------------------
// Hook types that may BLOCK
// ---------------------------------------------------------------------------

type BlockingHook = 'pre-tool-use' | 'user-prompt-submit';
type ObservationHook = 'post-tool-use' | 'session-start' | 'stop';
export type HookType = BlockingHook | ObservationHook;

const BLOCKING_HOOKS = new Set<HookType>(['pre-tool-use', 'user-prompt-submit']);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
export function checkAndConsumeOverride(
  state: SessionState,
): OverrideCheckResult {
  if (!state.pendingOverride?.active) {
    return { overrideConsumed: false, state };
  }

  const override = state.pendingOverride;
  logger.info(`[enforcement] Human override consumed — allowing action (${override.reason})`);

  // Consume the override (single-use, PRD §25, AGENTS.md)
  delete state.pendingOverride;

  // Record override as a decision entry with timestamp
  const record: DecisionRecord = {
    decision: 'ALLOW',
    reason: `Human override: ${override.reason}`,
    confidence: 1.0,
    timestamp: Date.now(),
    engine: 'override',
  };
  state.decisions.push(record);

  process.stderr.write(
    `✓ Bobtention: human override active — continuing (${override.reason})\n`,
  );

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
export function enforcePreAction(
  contract: DecisionContract,
  state: SessionState,
  event: NormalizedEvent,
  hookType: HookType,
  config?: Pick<BobtentionConfig, 'humanOverride'>,
): EnforcementResult {
  if (!BLOCKING_HOOKS.has(hookType)) {
    // Safety guard: callers must not pass a non-blocking hook here
    logger.warn(
      `[enforcement] enforcePreAction called from non-blocking hook "${hookType}" — ignoring BLOCK`,
    );
    return { exitCode: 0, state: recordDecision(state, contract) };
  }

  // Check for pending deferred BLOCK from a prior PostToolUse observation
  const deferred = consumeDeferredBlock(state);
  if (deferred) {
    logger.info(
      `[enforcement] Consuming deferred BLOCK from PostToolUse: ${deferred.reason}`,
    );
    const deferredContract: DecisionContract = {
      decision: 'BLOCK',
      confidence: 1.0,
      reason: deferred.reason,
      signals: deferred.signals,
    };
    notify(deferredContract, state, event, 'post-action');
    const updatedState = recordBlockedAction(state, deferredContract, event);
    return {
      exitCode: resolveBlockExitCode(config),
      state: recordDecision(updatedState, deferredContract),
    };
  }

  // Apply the fresh contract
  notify(contract, state, event, 'pre-action');
  let updatedState = recordDecision(state, contract);

  if (contract.decision === 'BLOCK') {
    logger.info(`[enforcement] BLOCK — exit ${resolveBlockExitCode(config)}: ${contract.reason}`);
    updatedState = recordBlockedAction(updatedState, contract, event);
    return { exitCode: resolveBlockExitCode(config), state: updatedState };
  }

  if (contract.decision === 'WATCH') {
    logger.info(`[enforcement] WATCH — exit 0: ${contract.reason}`);
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
export function enforcePostAction(
  contract: DecisionContract,
  state: SessionState,
  event: NormalizedEvent,
): EnforcementResult {
  if (contract.decision === 'BLOCK') {
    logger.info(
      `[enforcement] PostToolUse: concern detected — deferring BLOCK to next PreToolUse`,
    );
    notify(contract, state, event, 'post-action');
    state.deferredBlock = {
      reason: contract.reason,
      signals: contract.signals,
    };
  } else if (contract.decision === 'WATCH') {
    notify(contract, state, event, 'post-action');
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
function consumeDeferredBlock(
  state: SessionState,
): { reason: string; signals: DecisionContract['signals'] } | null {
  if (!state.deferredBlock) return null;
  const block = state.deferredBlock;
  delete state.deferredBlock;
  return block;
}

/**
 * Append a DecisionRecord to the session decisions list.
 * Carries engine tag, trigger context, and Laya Q&A detail from the contract.
 */
function recordDecision(state: SessionState, contract: DecisionContract): SessionState {
  const record: DecisionRecord = {
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
function recordBlockedAction(
  state: SessionState,
  contract: DecisionContract,
  event: NormalizedEvent,
): SessionState {
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
function resolveBlockExitCode(
  config?: Pick<BobtentionConfig, 'humanOverride'>,
): 0 | 2 {
  if (config?.humanOverride.enabled === false) {
    process.stderr.write(
      `⚠ Bobtention: advisory BLOCK (override disabled) — continuing\n`,
    );
    return 0;
  }
  return 2;
}
