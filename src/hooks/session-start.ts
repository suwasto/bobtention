#!/usr/bin/env node
/**
 * src/hooks/session-start.ts
 *
 * Bob SessionStart hook entry point.
 *
 * Behavior:
 *  - Reads stdin (Bob session payload)
 *  - Initializes session state
 *  - Writes a context string to stdout (injected into Bob's session context)
 *  - Always exits 0
 *
 * stdout = context injected by Bob into the session
 * stderr = our logs only
 */

import { runHook } from '../utils/errors';
import { readStdin, normalizeSessionStart } from '../core/event-normalizer';
import { logger } from '../utils/logger';

void runHook('session-start', async () => {
  const raw = await readStdin();
  const event = normalizeSessionStart(raw);

  if (!event) {
    logger.warn('[session-start] Failed to parse session payload, proceeding with empty session');
  }

  const sessionId = event?.sessionId ?? `session-${Date.now()}`;
  logger.info(`[session-start] Session initialized: ${sessionId}`);

  // Write context string to stdout — Bob injects this into the session
  const context = [
    'Bobtention is active for this session.',
    'Human attention routing is enabled.',
    'All tool use is being evaluated for task alignment, risk, and progress.',
  ].join('\n');

  process.stdout.write(context + '\n');

  return 0;
});
