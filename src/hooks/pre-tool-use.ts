#!/usr/bin/env node
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

import { runHook } from '../utils/errors';
import { readStdin, normalizePreToolUse } from '../core/event-normalizer';
import { loadConfig } from '../core/config';
import { appendSignal, updateSession, persistState, getSession } from '../core/session-manager';
import { evaluateEvent, extractEventSignals } from '../core/attention-evaluator';
import { enforcePreAction, checkAndConsumeOverride } from '../core/enforcement';
import { logger } from '../utils/logger';

void runHook('pre-tool-use', async () => {
  const raw = await readStdin();
  const event = normalizePreToolUse(raw);

  if (!event) {
    logger.warn('[pre-tool-use] Could not parse payload — allowing through (fail-open)');
    return 0;
  }

  const config = loadConfig();
  if (!config.enabled) return 0;

  // Resolve session id from the raw payload
  const payloadObj = (typeof raw === 'string' ? JSON.parse(raw || '{}') : raw) as Record<string, unknown>;
  const sessionId = (payloadObj.session_id as string | undefined) ?? 'default';

  // T7.2 / T7.3 — Check for a pending human override BEFORE evaluating.
  // If active, consume it (single-use) and allow through immediately.
  const currentState = getSession(sessionId, config);
  if (currentState) {
    const overrideCheck = checkAndConsumeOverride(currentState);
    if (overrideCheck.overrideConsumed) {
      persistState(overrideCheck.state, config);
      logger.info('[pre-tool-use] Human override consumed — action allowed');
      return 0;
    }
  }

  // Record the incoming action in session state
  const updatedState = updateSession(sessionId, event, config);

  // Extract new signals and append (signals accumulate, never replace)
  const newSignals = extractEventSignals(updatedState, event, config);
  let finalState = updatedState;
  for (const signal of newSignals) {
    finalState = appendSignal(sessionId, signal, config);
  }

  logger.info(`[pre-tool-use] Evaluating: ${event.tool} [${event.files.join(', ')}]`);

  // Evaluate decision (fast ALLOW / deterministic BLOCK / engine)
  const contract = await evaluateEvent(finalState, event, config);

  // Enforce — emit notification to stderr, record decision in state
  const result = enforcePreAction(contract, finalState, event, 'pre-tool-use', config);

  // Persist state mutations made by enforcement (decision record, deferredBlock consumed)
  persistState(result.state, config);

  return result.exitCode;
});
