#!/usr/bin/env node
"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const errors_1 = require("../utils/errors");
const event_normalizer_1 = require("../core/event-normalizer");
const config_1 = require("../core/config");
const session_manager_1 = require("../core/session-manager");
const logger_1 = require("../utils/logger");
void (0, errors_1.runHook)('session-start', async () => {
    const raw = await (0, event_normalizer_1.readStdin)();
    const event = (0, event_normalizer_1.normalizeSessionStart)(raw);
    if (!event) {
        logger_1.logger.warn('[session-start] Failed to parse session payload, proceeding with empty session');
    }
    const config = (0, config_1.loadConfig)();
    const sessionId = event?.sessionId ?? `session-${Date.now()}`;
    // Initialize (or resume) session on disk so it exists before any tool use
    (0, session_manager_1.initSession)(sessionId, '', config);
    logger_1.logger.info(`[session-start] Session initialized: ${sessionId}`);
    // Write context string to stdout — Bob injects this into the session
    const context = [
        'Bobtention is active for this session.',
        'Human attention routing is enabled.',
        'All tool use is being evaluated for task alignment, risk, and progress.',
    ].join('\n');
    process.stdout.write(context + '\n');
    return 0;
});
//# sourceMappingURL=session-start.js.map