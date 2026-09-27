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
import type { SessionState, NormalizedEvent, Signal } from '../types';
import type { BobtentionConfig } from './config';
/**
 * Create and persist a new session.
 * If a session with this ID already exists on disk, it is loaded instead.
 */
export declare function initSession(sessionId: string, intent: string, config?: Pick<BobtentionConfig, 'session'>): SessionState;
/**
 * Apply a normalized event to the session state and persist.
 * Returns the updated state (fail-open: returns last known state on I/O error).
 */
export declare function updateSession(sessionId: string, event: NormalizedEvent, config?: Pick<BobtentionConfig, 'session'>): SessionState;
/**
 * Retrieve current session state (in-memory first, then disk).
 * Returns null if the session is not found anywhere.
 */
export declare function getSession(sessionId: string, config?: Pick<BobtentionConfig, 'session'>): SessionState | null;
/**
 * Explicit intent change — the only way originalIntent may be overwritten.
 * PRD §18, §52: "Allows explicit task changes".
 */
export declare function updateIntent(sessionId: string, newIntent: string, config?: Pick<BobtentionConfig, 'session'>): SessionState;
/**
 * Mark session as completed and persist final state.
 */
export declare function finalizeSession(sessionId: string, config?: Pick<BobtentionConfig, 'session'>): void;
/**
 * Append a signal to the session (signals accumulate, never replace).
 */
export declare function appendSignal(sessionId: string, signal: Signal, config?: Pick<BobtentionConfig, 'session'>): SessionState;
/**
 * Persist an already-mutated state back to disk and update the in-memory cache.
 * Used by enforcement layer after consuming deferredBlock or recording decisions.
 */
export declare function persistState(state: SessionState, config?: Pick<BobtentionConfig, 'session'>): void;
/**
 * Write a pending human override into the session state.
 * Called by the `npx bobtention override` CLI (T7.1 / PRD §24–§25).
 * Idempotent — overwrites any existing pendingOverride.
 */
export declare function setOverride(sessionId: string, reason: string, config?: Pick<BobtentionConfig, 'session'>): SessionState;
/**
 * Return the set of directories touched in the first N actions (initial scope).
 * N defaults to 5.
 */
export declare function getInitialScope(state: SessionState, n?: number): Set<string>;
/**
 * Return the set of all directories touched across all actions (current scope).
 */
export declare function getCurrentScope(state: SessionState): Set<string>;
/** Reset in-memory cache (for testing only). */
export declare function resetSessionCache(): void;
//# sourceMappingURL=session-manager.d.ts.map