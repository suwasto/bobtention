#!/usr/bin/env node
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

import { runHook } from '../utils/errors';
import { readStdin, normalizePostToolUse } from '../core/event-normalizer';
import { loadConfig } from '../core/config';
import { appendSignal, updateSession, persistState } from '../core/session-manager';
import { evaluateEvent, extractEventSignals } from '../core/attention-evaluator';
import { enforcePostAction } from '../core/enforcement';
import { logger } from '../utils/logger';

void runHook('post-tool-use', async () => {
  const raw = await readStdin();
  const event = normalizePostToolUse(raw);

  if (!event) {
    logger.warn('[post-tool-use] Could not parse payload — skipping observation');
    return 0; // Always exit 0
  }

  const config = loadConfig();
  if (!config.enabled) return 0;

  const payloadObj = (typeof raw === 'string' ? JSON.parse(raw || '{}') : raw) as Record<string, unknown>;
  const sessionId = (payloadObj.session_id as string | undefined) ?? 'default';

  // Record the completed action in session state
  const updatedState = updateSession(sessionId, event, config);

  // Extract signals from the post-action event and append
  const newSignals = extractEventSignals(updatedState, event, config);
  let finalState = updatedState;
  for (const signal of newSignals) {
    finalState = appendSignal(sessionId, signal, config);
  }

  logger.info(`[post-tool-use] Observed: ${event.tool} [${event.files.join(', ')}]`);

  // Evaluate post-action — any BLOCK deferred to next PreToolUse
  const contract = await evaluateEvent(finalState, event, config);

  // enforcePostAction always returns exit 0; writes deferredBlock if BLOCK
  const result = enforcePostAction(contract, finalState, event);

  // Persist state (decisions + possible deferredBlock)
  persistState(result.state, config);

  return 0; // ALWAYS exit 0
});
