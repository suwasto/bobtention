"use strict";
/**
 * src/core/session-manager.ts
 *
 * Session Manager — create, update, persist, and finalize Bobtention sessions.
 *
 * ADR: dosc/adr/004-session-state-management.md
 * PRD §17 (session state), §18 (intent), §20 (failure tracking), §52 (explicit task change)
 *
 * Design:
 *  - Session JSON stored at <storagePath>/<sessionId>.json
 *  - Writes are atomic: write-to-temp + rename
 *  - Action history is bounded to config.session.maxActions (last N)
 *  - Original intent is immutable unless changed via updateIntent()
 *  - File I/O errors → fail-open (return last known in-memory state or empty shell)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSession = initSession;
exports.updateSession = updateSession;
exports.getSession = getSession;
exports.updateIntent = updateIntent;
exports.finalizeSession = finalizeSession;
exports.appendSignal = appendSignal;
exports.persistState = persistState;
exports.setOverride = setOverride;
exports.getInitialScope = getInitialScope;
exports.getCurrentScope = getCurrentScope;
exports.resetSessionCache = resetSessionCache;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../utils/logger");
const dashboard_1 = require("./dashboard");
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEFAULT_STORAGE_PATH = path.join(process.cwd(), '.bobtention', 'sessions');
// ---------------------------------------------------------------------------
// In-memory cache (keyed by sessionId)
// ---------------------------------------------------------------------------
const _sessions = new Map();
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Create and persist a new session.
 * If a session with this ID already exists on disk, it is loaded instead.
 */
function initSession(sessionId, intent, config) {
    // Try loading existing session from disk first
    const existing = loadFromDisk(sessionId, config);
    if (existing) {
        _sessions.set(sessionId, existing);
        logger_1.logger.info(`[session-manager] Resumed session: ${sessionId}`);
        return existing;
    }
    const state = {
        sessionId,
        originalIntent: intent,
        startTime: Date.now(),
        status: 'active',
        actions: [],
        tests: [],
        failures: [],
        signals: [],
        decisions: [],
        overrides: [],
    };
    _sessions.set(sessionId, state);
    writeToDisk(state, config);
    logger_1.logger.info(`[session-manager] Initialized session: ${sessionId}`);
    return state;
}
/**
 * Apply a normalized event to the session state and persist.
 * Returns the updated state (fail-open: returns last known state on I/O error).
 */
function updateSession(sessionId, event, config) {
    const state = getOrLoad(sessionId, config);
    switch (event.kind) {
        case 'tool': {
            const action = {
                tool: event.tool,
                input: event.input,
                output: event.output ?? {},
                files: event.files,
                timestamp: event.timestamp,
            };
            state.actions.push(action);
            // Bound history
            const maxActions = config?.session.maxActions ?? 50;
            if (state.actions.length > maxActions) {
                state.actions = state.actions.slice(state.actions.length - maxActions);
            }
            break;
        }
        case 'test': {
            state.tests.push({
                name: event.name,
                result: event.result,
                timestamp: event.timestamp,
            });
            if (event.result === 'failed') {
                recordFailure(state, event.name);
            }
            else if (event.result === 'passed') {
                clearFailureProgression(state, event.name);
            }
            break;
        }
        case 'prompt':
            // Intent update is explicit-only (updateIntent). Prompts just observe.
            break;
        case 'session_init':
            // Already handled by initSession
            break;
        case 'stop':
            state.status = 'completed';
            break;
    }
    _sessions.set(sessionId, state);
    writeToDisk(state, config);
    return state;
}
/**
 * Retrieve current session state (in-memory first, then disk).
 * Returns null if the session is not found anywhere.
 */
function getSession(sessionId, config) {
    const cached = _sessions.get(sessionId);
    if (cached)
        return cached;
    const fromDisk = loadFromDisk(sessionId, config);
    if (fromDisk) {
        _sessions.set(sessionId, fromDisk);
        return fromDisk;
    }
    return null;
}
/**
 * Explicit intent change — the only way originalIntent may be overwritten.
 * PRD §18, §52: "Allows explicit task changes".
 */
function updateIntent(sessionId, newIntent, config) {
    const state = getOrLoad(sessionId, config);
    state.originalIntent = newIntent;
    _sessions.set(sessionId, state);
    writeToDisk(state, config);
    logger_1.logger.info(`[session-manager] Intent updated for ${sessionId}: "${newIntent}"`);
    return state;
}
/**
 * Mark session as completed and persist final state.
 */
function finalizeSession(sessionId, config) {
    const state = getOrLoad(sessionId, config);
    state.status = 'completed';
    _sessions.set(sessionId, state);
    writeToDisk(state, config);
    _sessions.delete(sessionId);
    logger_1.logger.info(`[session-manager] Finalized session: ${sessionId}`);
}
/**
 * Append a signal to the session (signals accumulate, never replace).
 */
function appendSignal(sessionId, signal, config) {
    const state = getOrLoad(sessionId, config);
    state.signals.push(signal);
    _sessions.set(sessionId, state);
    writeToDisk(state, config);
    return state;
}
/**
 * Persist an already-mutated state back to disk and update the in-memory cache.
 * Used by enforcement layer after consuming deferredBlock or recording decisions.
 */
function persistState(state, config) {
    _sessions.set(state.sessionId, state);
    writeToDisk(state, config);
}
/**
 * Write a pending human override into the session state.
 * Called by the `npx bobtention override` CLI (T7.1 / PRD §24–§25).
 * Idempotent — overwrites any existing pendingOverride.
 */
function setOverride(sessionId, reason, config) {
    const state = getOrLoad(sessionId, config);
    state.pendingOverride = {
        active: true,
        reason,
        scope: 'next_action',
    };
    _sessions.set(sessionId, state);
    writeToDisk(state, config);
    logger_1.logger.info(`[session-manager] Override written for session ${sessionId}: "${reason}"`);
    return state;
}
// ---------------------------------------------------------------------------
// Scope helpers (used by signal extractor)
// ---------------------------------------------------------------------------
/**
 * Return the set of directories touched in the first N actions (initial scope).
 * N defaults to 5.
 */
function getInitialScope(state, n = 5) {
    const scope = new Set();
    const actions = state.actions.slice(0, n);
    for (const action of actions) {
        for (const file of action.files) {
            scope.add(topDir(file));
        }
    }
    return scope;
}
/**
 * Return the set of all directories touched across all actions (current scope).
 */
function getCurrentScope(state) {
    const scope = new Set();
    for (const action of state.actions) {
        for (const file of action.files) {
            scope.add(topDir(file));
        }
    }
    return scope;
}
/** Reset in-memory cache (for testing only). */
function resetSessionCache() {
    _sessions.clear();
}
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function getOrLoad(sessionId, config) {
    const cached = _sessions.get(sessionId);
    if (cached)
        return cached;
    const fromDisk = loadFromDisk(sessionId, config);
    if (fromDisk) {
        _sessions.set(sessionId, fromDisk);
        return fromDisk;
    }
    // Fallback: create empty shell (fail-open)
    logger_1.logger.warn(`[session-manager] Session ${sessionId} not found — creating empty shell`);
    const shell = {
        sessionId,
        originalIntent: '',
        startTime: Date.now(),
        status: 'active',
        actions: [],
        tests: [],
        failures: [],
        signals: [],
        decisions: [],
        overrides: [],
    };
    _sessions.set(sessionId, shell);
    return shell;
}
function storagePath(config) {
    return config?.session.storagePath ?? DEFAULT_STORAGE_PATH;
}
function sessionFilePath(sessionId, config) {
    return path.join(storagePath(config), `${sessionId}.json`);
}
function writeToDisk(state, config) {
    const dir = storagePath(config);
    const filePath = sessionFilePath(state.sessionId, config);
    const tmpPath = `${filePath}.tmp`;
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
        fs.renameSync(tmpPath, filePath);
        // Regenerate dashboard after every successful write
        (0, dashboard_1.regenerateDashboard)(dir, state);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger_1.logger.error(`[session-manager] Failed to write session ${state.sessionId}: ${msg}`);
        // Fail-open: keep in-memory state intact
    }
}
function loadFromDisk(sessionId, config) {
    const filePath = sessionFilePath(sessionId, config);
    try {
        if (!fs.existsSync(filePath))
            return null;
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger_1.logger.warn(`[session-manager] Could not load session ${sessionId} from disk: ${msg}`);
        return null;
    }
}
/**
 * Record or update a failure entry. Groups by signature and tracks progression.
 * "Progressing" = the failure signature appeared, then disappeared, then reappeared
 * (i.e., was cleared at some point). Without that, count just increments.
 */
function recordFailure(state, signature) {
    const existing = state.failures.find((f) => f.signature === signature);
    if (existing) {
        existing.count += 1;
        existing.lastSeen = Date.now();
        // Not progressing if still failing without interruption
        existing.progressing = false;
    }
    else {
        state.failures.push({
            signature,
            count: 1,
            lastSeen: Date.now(),
            progressing: false,
        });
    }
}
/**
 * Mark a failure as cleared (progressing toward resolution).
 * If the same failure re-fires after being cleared, it will be treated as fresh.
 */
function clearFailureProgression(state, signature) {
    const existing = state.failures.find((f) => f.signature === signature);
    if (existing) {
        existing.progressing = true;
    }
}
/**
 * Extract the top-level directory from a file path (for scope tracking).
 * e.g., "src/core/session-manager.ts" → "src"
 *       "README.md" → "."
 */
function topDir(filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts.length > 1 ? parts[0] : '.';
}
//# sourceMappingURL=session-manager.js.map