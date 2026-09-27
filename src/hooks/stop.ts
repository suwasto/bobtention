#!/usr/bin/env node
/**
 * src/hooks/stop.ts
 *
 * Bob Stop hook entry point — session cleanup.
 *
 * Behavior:
 *  - Reads stdin (stop payload)
 *  - Finalizes session state
 *  - ALWAYS exits 0
 *
 * stdout is ignored by Bob for Stop — all output goes to stderr.
 */

import { runHook } from '../utils/errors';
import { readStdin, normalizeStop } from '../core/event-normalizer';
import { logger } from '../utils/logger';

void runHook('stop', async () => {
  const raw = await readStdin();
  const event = normalizeStop(raw);

  const sessionId = event?.sessionId ?? 'unknown';
  logger.info(`[stop] Session finalized: ${sessionId}`);

  // Phase 2 stub: session persistence wired in Phase 3 (Session Manager)

  return 0; // ALWAYS exit 0 — Stop is cleanup only
});
