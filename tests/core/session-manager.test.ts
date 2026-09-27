/**
 * tests/core/session-manager.test.ts
 *
 * Unit tests for Session Manager (Phase 3).
 * Covers: state transitions, failure grouping, scope tracking,
 * intent immutability, explicit task change, bounded history, file I/O fail-open.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initSession,
  updateSession,
  getSession,
  updateIntent,
  finalizeSession,
  appendSignal,
  getInitialScope,
  getCurrentScope,
  resetSessionCache,
} from '../../src/core/session-manager';
import type { BobtentionConfig } from '../../src/core/config';
import type { NormalizedEvent } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpConfig(dir: string): Pick<BobtentionConfig, 'session'> {
  return { session: { maxActions: 50, storagePath: dir } };
}

function toolEvent(tool: string, files: string[]): NormalizedEvent {
  return {
    kind: 'tool',
    tool,
    files,
    input: {},
    output: {},
    timestamp: Date.now(),
  };
}

function testEvent(name: string, result: 'passed' | 'failed'): NormalizedEvent {
  return { kind: 'test', name, result, timestamp: Date.now() };
}

let tmpDir: string;
let cfg: Pick<BobtentionConfig, 'session'>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bobtention-test-'));
  cfg = tmpConfig(tmpDir);
  resetSessionCache();
});

afterEach(() => {
  resetSessionCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// T3.1 — Basic lifecycle
// ---------------------------------------------------------------------------

describe('initSession', () => {
  it('creates a new session with the given intent', () => {
    const state = initSession('s1', 'fix the login bug', cfg);
    expect(state.sessionId).toBe('s1');
    expect(state.originalIntent).toBe('fix the login bug');
    expect(state.status).toBe('active');
    expect(state.actions).toHaveLength(0);
    expect(state.failures).toHaveLength(0);
  });

  it('persists to disk', () => {
    initSession('s2', 'add tests', cfg);
    const filePath = path.join(tmpDir, 's2.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const loaded = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(loaded.originalIntent).toBe('add tests');
  });

  it('resumes existing session from disk if found', () => {
    const state1 = initSession('s3', 'first intent', cfg);
    state1.actions.push({ tool: 'bash', input: {}, output: {}, files: [], timestamp: Date.now() });
    // Write manually to disk by re-calling initSession (which re-persists via update)
    updateSession('s3', toolEvent('bash', ['src/app.ts']), cfg);
    resetSessionCache();

    const state2 = initSession('s3', 'second intent (should be ignored)', cfg);
    // Intent from disk wins, new intent argument ignored
    expect(state2.originalIntent).toBe('first intent');
  });
});

describe('getSession', () => {
  it('returns null for unknown session', () => {
    expect(getSession('unknown', cfg)).toBeNull();
  });

  it('loads from disk if not in cache', () => {
    initSession('s4', 'some intent', cfg);
    resetSessionCache();
    const loaded = getSession('s4', cfg);
    expect(loaded).not.toBeNull();
    expect(loaded?.originalIntent).toBe('some intent');
  });
});

describe('finalizeSession', () => {
  it('sets status to completed and removes from cache', () => {
    initSession('s5', 'refactor auth', cfg);
    finalizeSession('s5', cfg);
    // After finalize the in-memory cache is cleared; disk should have completed status
    resetSessionCache();
    const loaded = getSession('s5', cfg);
    expect(loaded?.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// T3.2 — Bounded action history
// ---------------------------------------------------------------------------

describe('bounded action history', () => {
  it('trims actions to maxActions', () => {
    const limitedCfg: Pick<BobtentionConfig, 'session'> = {
      session: { maxActions: 5, storagePath: tmpDir },
    };
    initSession('s6', 'task', limitedCfg);

    for (let i = 0; i < 8; i++) {
      updateSession('s6', toolEvent('bash', [`file${i}.ts`]), limitedCfg);
    }

    const state = getSession('s6', limitedCfg)!;
    expect(state.actions.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// T3.3 — Failure tracking & progression
// ---------------------------------------------------------------------------

describe('failure tracking', () => {
  it('groups failures by signature and increments count', () => {
    initSession('sf1', 'fix tests', cfg);
    updateSession('sf1', testEvent('auth.test', 'failed'), cfg);
    updateSession('sf1', testEvent('auth.test', 'failed'), cfg);
    updateSession('sf1', testEvent('auth.test', 'failed'), cfg);

    const state = getSession('sf1', cfg)!;
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0].signature).toBe('auth.test');
    expect(state.failures[0].count).toBe(3);
    expect(state.failures[0].progressing).toBe(false);
  });

  it('marks failure as progressing when it passes', () => {
    initSession('sf2', 'fix tests', cfg);
    updateSession('sf2', testEvent('login.test', 'failed'), cfg);
    updateSession('sf2', testEvent('login.test', 'passed'), cfg);

    const state = getSession('sf2', cfg)!;
    const failure = state.failures.find((f) => f.signature === 'login.test');
    expect(failure?.progressing).toBe(true);
  });

  it('distinguishes different failure signatures', () => {
    initSession('sf3', 'fix tests', cfg);
    updateSession('sf3', testEvent('auth.test', 'failed'), cfg);
    updateSession('sf3', testEvent('login.test', 'failed'), cfg);

    const state = getSession('sf3', cfg)!;
    expect(state.failures).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// T3.4 — Scope tracking
// ---------------------------------------------------------------------------

describe('scope tracking', () => {
  it('getInitialScope returns top-level dirs from first N actions', () => {
    initSession('ss1', 'task', cfg);
    updateSession('ss1', toolEvent('edit', ['src/core/foo.ts']), cfg);
    updateSession('ss1', toolEvent('edit', ['src/utils/bar.ts']), cfg);
    updateSession('ss1', toolEvent('edit', ['tests/foo.test.ts']), cfg);

    const state = getSession('ss1', cfg)!;
    const initial = getInitialScope(state, 5);
    expect(initial.has('src')).toBe(true);
    expect(initial.has('tests')).toBe(true);
  });

  it('getCurrentScope includes all touched dirs', () => {
    initSession('ss2', 'task', cfg);
    for (let i = 0; i < 8; i++) {
      updateSession('ss2', toolEvent('edit', [`dir${i}/file.ts`]), cfg);
    }
    const state = getSession('ss2', cfg)!;
    const current = getCurrentScope(state);
    expect(current.size).toBe(8);
  });

  it('detects scope expansion beyond initial', () => {
    initSession('ss3', 'task', cfg);
    // First 5 actions in src/
    for (let i = 0; i < 5; i++) {
      updateSession('ss3', toolEvent('edit', ['src/file.ts']), cfg);
    }
    // Then drift into unrelated dirs
    updateSession('ss3', toolEvent('edit', ['infra/deploy.sh']), cfg);
    updateSession('ss3', toolEvent('edit', ['docs/README.md']), cfg);

    const state = getSession('ss3', cfg)!;
    const initial = getInitialScope(state);
    const current = getCurrentScope(state);
    const newDirs = [...current].filter((d) => !initial.has(d));
    expect(newDirs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// T3.5 — Intent immutability
// ---------------------------------------------------------------------------

describe('intent immutability', () => {
  it('agent activity (tool events) never changes originalIntent', () => {
    initSession('si1', 'fix login', cfg);
    updateSession('si1', toolEvent('edit', ['src/auth.ts']), cfg);
    updateSession('si1', toolEvent('bash', ['Makefile']), cfg);

    const state = getSession('si1', cfg)!;
    expect(state.originalIntent).toBe('fix login');
  });

  it('updateIntent is the only way to change intent', () => {
    initSession('si2', 'fix login', cfg);
    const updated = updateIntent('si2', 'refactor auth module', cfg);
    expect(updated.originalIntent).toBe('refactor auth module');

    const loaded = getSession('si2', cfg)!;
    expect(loaded.originalIntent).toBe('refactor auth module');
  });
});

// ---------------------------------------------------------------------------
// T3.6 — Atomic writes (write-to-temp + rename)
// ---------------------------------------------------------------------------

describe('atomic session writes', () => {
  it('writes final file and cleans up .tmp file', () => {
    initSession('sa1', 'some task', cfg);
    const filePath = path.join(tmpDir, 'sa1.json');
    const tmpPath = `${filePath}.tmp`;
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(tmpPath)).toBe(false); // tmp must be renamed away
  });
});

// ---------------------------------------------------------------------------
// T3.7 — Fail-open on I/O errors
// ---------------------------------------------------------------------------

describe('fail-open on I/O errors', () => {
  it('getSession returns null (not throw) for unreadable session file', () => {
    // Write corrupt JSON to disk
    const filePath = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(filePath, '{ bad json', 'utf-8');
    expect(() => getSession('corrupt', cfg)).not.toThrow();
    expect(getSession('corrupt', cfg)).toBeNull();
  });

  it('updateSession returns shell state when session not found', () => {
    // No initSession — should fail-open with empty shell
    const state = updateSession('ghost', toolEvent('bash', ['a.ts']), cfg);
    expect(state.sessionId).toBe('ghost');
    expect(state.actions.length).toBeGreaterThan(0); // the event was applied
  });
});

// ---------------------------------------------------------------------------
// appendSignal — accumulates, never replaces
// ---------------------------------------------------------------------------

describe('appendSignal', () => {
  it('signals accumulate on the session', () => {
    initSession('ssg1', 'task', cfg);
    appendSignal('ssg1', { type: 'TASK_DRIFT', severity: 0.3, timestamp: Date.now() }, cfg);
    appendSignal('ssg1', { type: 'REPEATED_FAILURE', severity: 0.5, timestamp: Date.now() }, cfg);

    const state = getSession('ssg1', cfg)!;
    expect(state.signals).toHaveLength(2);
    expect(state.signals[0].type).toBe('TASK_DRIFT');
    expect(state.signals[1].type).toBe('REPEATED_FAILURE');
  });

  it('new signals do not erase prior signals', () => {
    initSession('ssg2', 'task', cfg);
    appendSignal('ssg2', { type: 'TASK_DRIFT', severity: 0.3, timestamp: Date.now() }, cfg);
    appendSignal('ssg2', { type: 'TASK_DRIFT', severity: 0.5, timestamp: Date.now() }, cfg);

    const state = getSession('ssg2', cfg)!;
    expect(state.signals).toHaveLength(2);
  });
});
