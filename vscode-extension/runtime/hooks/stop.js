#!/usr/bin/env node
"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const errors_1 = require("../utils/errors");
const event_normalizer_1 = require("../core/event-normalizer");
const logger_1 = require("../utils/logger");
void (0, errors_1.runHook)('stop', async () => {
    const raw = await (0, event_normalizer_1.readStdin)();
    const event = (0, event_normalizer_1.normalizeStop)(raw);
    const sessionId = event?.sessionId ?? 'unknown';
    logger_1.logger.info(`[stop] Session finalized: ${sessionId}`);
    // Phase 2 stub: session persistence wired in Phase 3 (Session Manager)
    return 0; // ALWAYS exit 0 — Stop is cleanup only
});
//# sourceMappingURL=stop.js.map