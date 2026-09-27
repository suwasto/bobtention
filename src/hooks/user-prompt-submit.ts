#!/usr/bin/env node
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

import { runHook } from '../utils/errors';
import { readStdin, normalizeUserPrompt } from '../core/event-normalizer';
import { loadConfig } from '../core/config';
import { initSession, updateIntent, appendSignal, persistState } from '../core/session-manager';
import { evaluateEvent, extractEventSignals } from '../core/attention-evaluator';
import { enforcePreAction } from '../core/enforcement';
import { logger } from '../utils/logger';

void runHook('user-prompt-submit', async () => {
  const raw = await readStdin();
  const event = normalizeUserPrompt(raw);

  if (!event) {
    logger.warn('[user-prompt-submit] Could not parse prompt payload — allowing through');
    process.stdout.write('Bobtention: monitoring active.\n');
    return 0;
  }

  const config = loadConfig();
  if (!config.enabled) {
    process.stdout.write('Bobtention: monitoring inactive.\n');
    return 0;
  }

  const payloadObj = (typeof raw === 'string' ? JSON.parse(raw || '{}') : raw) as Record<string, unknown>;
  const sessionId = (payloadObj.session_id as string | undefined) ?? 'default';

  const { text } = event;
  logger.info(`[user-prompt-submit] Intent: "${text.slice(0, 80)}…"`);

  // Initialize or resume the session; set intent from the first prompt
  let state = initSession(sessionId, text, config);

  // If this is not the first prompt, update intent (explicit task change)
  if (state.originalIntent && state.originalIntent !== text && state.actions.length > 0) {
    state = updateIntent(sessionId, text, config);
    logger.info('[user-prompt-submit] Task intent updated');
  }

  // Extract signals (rare at prompt time, but possible)
  const newSignals = extractEventSignals(state, event, config);
  let finalState = state;
  for (const signal of newSignals) {
    finalState = appendSignal(sessionId, signal, config);
  }

  // Evaluate and potentially block
  const contract = await evaluateEvent(finalState, event, config);
  const result = enforcePreAction(contract, finalState, event, 'user-prompt-submit');

  // Persist state mutations
  persistState(result.state, config);

  // Write context to stdout — Bob injects this into the prompt context
  const context = `Bobtention: task intent recorded — "${text.slice(0, 120)}".`;
  process.stdout.write(context + '\n');

  return result.exitCode;
});
