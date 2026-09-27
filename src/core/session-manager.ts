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

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { regenerateDashboard } from './dashboard';
import type { SessionState, NormalizedEvent, ActionRecord, Signal } from '../types';
import type { BobtentionConfig } from './config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_STORAGE_PATH = path.join(process.cwd(), '.bobtention', 'sessions');

// ---------------------------------------------------------------------------
// In-memory cache (keyed by sessionId)
// ---------------------------------------------------------------------------

const _sessions = new Map<string, SessionState>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create and persist a new session.
 * If a session with this ID already exists on disk, it is loaded instead.
 */
export function initSession(
  sessionId: string,
  intent: string,
  config?: Pick<BobtentionConfig, 'session'>,
): SessionState {
  // Try loading existing session from disk first
  const existing = loadFromDisk(sessionId, config);
  if (existing) {
    _sessions.set(sessionId, existing);
    logger.info(`[session-manager] Resumed session: ${sessionId}`);
    return existing;
  }

  const state: SessionState = {
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
  logger.info(`[session-manager] Initialized session: ${sessionId}`);
  return state;
}

/**
 * Apply a normalized event to the session state and persist.
 * Returns the updated state (fail-open: returns last known state on I/O error).
 */
export function updateSession(
  sessionId: string,
  event: NormalizedEvent,
  config?: Pick<BobtentionConfig, 'session'>,
): SessionState {
  const state = getOrLoad(sessionId, config);

  switch (event.kind) {
    case 'tool': {
      const action: ActionRecord = {
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
      } else if (event.result === 'passed') {
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
export function getSession(
  sessionId: string,
  config?: Pick<BobtentionConfig, 'session'>,
): SessionState | null {
  const cached = _sessions.get(sessionId);
  if (cached) return cached;

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
export function updateIntent(
  sessionId: string,
  newIntent: string,
  config?: Pick<BobtentionConfig, 'session'>,
): SessionState {
  const state = getOrLoad(sessionId, config);
  state.originalIntent = newIntent;
  _sessions.set(sessionId, state);
  writeToDisk(state, config);
  logger.info(`[session-manager] Intent updated for ${sessionId}: "${newIntent}"`);
  return state;
}

/**
 * Mark session as completed and persist final state.
 */
export function finalizeSession(
  sessionId: string,
  config?: Pick<BobtentionConfig, 'session'>,
): void {
  const state = getOrLoad(sessionId, config);
  state.status = 'completed';
  _sessions.set(sessionId, state);
  writeToDisk(state, config);
  _sessions.delete(sessionId);
  logger.info(`[session-manager] Finalized session: ${sessionId}`);
}

/**
 * Append a signal to the session (signals accumulate, never replace).
 */
export function appendSignal(
  sessionId: string,
  signal: Signal,
  config?: Pick<BobtentionConfig, 'session'>,
): SessionState {
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
export function persistState(
  state: SessionState,
  config?: Pick<BobtentionConfig, 'session'>,
): void {
  _sessions.set(state.sessionId, state);
  writeToDisk(state, config);
}

/**
 * Write a pending human override into the session state.
 * Called by the `npx bobtention override` CLI (T7.1 / PRD §24–§25).
 * Idempotent — overwrites any existing pendingOverride.
 */
export function setOverride(
  sessionId: string,
  reason: string,
  config?: Pick<BobtentionConfig, 'session'>,
): SessionState {
  const state = getOrLoad(sessionId, config);
  state.pendingOverride = {
    active: true,
    reason,
    scope: 'next_action',
  };
  _sessions.set(sessionId, state);
  writeToDisk(state, config);
  logger.info(`[session-manager] Override written for session ${sessionId}: "${reason}"`);
  return state;
}

// ---------------------------------------------------------------------------
// Scope helpers (used by signal extractor)
// ---------------------------------------------------------------------------

/**
 * Return the set of directories touched in the first N actions (initial scope).
 * N defaults to 5.
 */
export function getInitialScope(state: SessionState, n = 5): Set<string> {
  const scope = new Set<string>();
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
export function getCurrentScope(state: SessionState): Set<string> {
  const scope = new Set<string>();
  for (const action of state.actions) {
    for (const file of action.files) {
      scope.add(topDir(file));
    }
  }
  return scope;
}

/** Reset in-memory cache (for testing only). */
export function resetSessionCache(): void {
  _sessions.clear();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getOrLoad(
  sessionId: string,
  config?: Pick<BobtentionConfig, 'session'>,
): SessionState {
  const cached = _sessions.get(sessionId);
  if (cached) return cached;

  const fromDisk = loadFromDisk(sessionId, config);
  if (fromDisk) {
    _sessions.set(sessionId, fromDisk);
    return fromDisk;
  }

  // Fallback: create empty shell (fail-open)
  logger.warn(`[session-manager] Session ${sessionId} not found — creating empty shell`);
  const shell: SessionState = {
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

function storagePath(config?: Pick<BobtentionConfig, 'session'>): string {
  return config?.session.storagePath ?? DEFAULT_STORAGE_PATH;
}

function sessionFilePath(sessionId: string, config?: Pick<BobtentionConfig, 'session'>): string {
  return path.join(storagePath(config), `${sessionId}.json`);
}

function writeToDisk(
  state: SessionState,
  config?: Pick<BobtentionConfig, 'session'>,
): void {
  const dir = storagePath(config);
  const filePath = sessionFilePath(state.sessionId, config);
  const tmpPath = `${filePath}.tmp`;

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    // Regenerate dashboard after every successful write
    regenerateDashboard(dir, state);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[session-manager] Failed to write session ${state.sessionId}: ${msg}`);
    // Fail-open: keep in-memory state intact
  }
}

function loadFromDisk(
  sessionId: string,
  config?: Pick<BobtentionConfig, 'session'>,
): SessionState | null {
  const filePath = sessionFilePath(sessionId, config);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as SessionState;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[session-manager] Could not load session ${sessionId} from disk: ${msg}`);
    return null;
  }
}

/**
 * Record or update a failure entry. Groups by signature and tracks progression.
 * "Progressing" = the failure signature appeared, then disappeared, then reappeared
 * (i.e., was cleared at some point). Without that, count just increments.
 */
function recordFailure(state: SessionState, signature: string): void {
  const existing = state.failures.find((f) => f.signature === signature);
  if (existing) {
    existing.count += 1;
    existing.lastSeen = Date.now();
    // Not progressing if still failing without interruption
    existing.progressing = false;
  } else {
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
function clearFailureProgression(state: SessionState, signature: string): void {
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
function topDir(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.length > 1 ? parts[0] : '.';
}
