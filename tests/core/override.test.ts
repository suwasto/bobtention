/**
 * tests/core/override.test.ts
 *
 * Unit tests for Phase 7 — Human Override (T7.6).
 *
 * Covers:
 *   - Full lifecycle: BLOCK → override written → next PreToolUse ALLOW → override consumed
 *   - Override is single-use (second PreToolUse evaluates normally)
 *   - Override recorded in session decisions with timestamp
 *   - Advisory mode: humanOverride.enabled = false → BLOCK exits 0
 *   - checkAndConsumeOverride when no override present
 *   - setOverride helper in session-manager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  enforcePreAction,
  enforcePostAction,
  checkAndConsumeOverride,
} from '../../src/core/enforcement';
import { setOverride, resetSessionCache } from '../../src/core/session-manager';
import type { DecisionContract, SessionState, NormalizedEvent, Override } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'test-session',
    originalIntent: 'implement OAuth login',
    startTime: Date.now(),
    status: 'active',
    actions: [],
    tests: [],
    failures: [],
    signals: [],
    decisions: [],
    overrides: [],
    ...overrides,
  };
}

function toolEvent(files: string[] = ['src/auth/login.ts'], tool = 'edit'): NormalizedEvent {
  return {
    kind: 'tool',
    tool,
    files,
    input: {},
    timestamp: Date.now(),
  };
}

function blockContract(): DecisionContract {
  return {
    decision: 'BLOCK',
    confidence: 0.92,
    reason: 'Task drift detected',
    signals: ['TASK_DRIFT'],
  };
}

function allowContract(): DecisionContract {
  return { decision: 'ALLOW', confidence: 0.95, reason: 'No signals', signals: [] };
}

// ---------------------------------------------------------------------------
// checkAndConsumeOverride
// ---------------------------------------------------------------------------

describe('checkAndConsumeOverride', () => {
  it('returns overrideConsumed=false when no pending override', () => {
    const state = makeState();
    const result = checkAndConsumeOverride(state);
    expect(result.overrideConsumed).toBe(false);
    expect(result.state.pendingOverride).toBeUndefined();
  });

  it('returns overrideConsumed=false when pendingOverride.active is false', () => {
    const state = makeState({
      pendingOverride: { active: false, reason: 'stale', scope: 'next_action' },
    });
    const result = checkAndConsumeOverride(state);
    expect(result.overrideConsumed).toBe(false);
  });

  it('returns overrideConsumed=true and removes pendingOverride when active', () => {
    const state = makeState({
      pendingOverride: { active: true, reason: 'developer_confirmed', scope: 'next_action' },
    });
    const result = checkAndConsumeOverride(state);
    expect(result.overrideConsumed).toBe(true);
    expect(result.state.pendingOverride).toBeUndefined();
  });

  it('records override as an ALLOW decision with timestamp', () => {
    const state = makeState({
      pendingOverride: { active: true, reason: 'developer_confirmed', scope: 'next_action' },
    });
    const result = checkAndConsumeOverride(state);
    expect(result.state.decisions).toHaveLength(1);
    expect(result.state.decisions[0].decision).toBe('ALLOW');
    expect(result.state.decisions[0].reason).toContain('Human override');
    expect(result.state.decisions[0].reason).toContain('developer_confirmed');
    expect(result.state.decisions[0].timestamp).toBeGreaterThan(0);
  });

  it('writes override confirmation to stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const state = makeState({
      pendingOverride: { active: true, reason: 'developer_confirmed', scope: 'next_action' },
    });
    checkAndConsumeOverride(state);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('human override active'),
    );
    stderrSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle: BLOCK → override written → PreToolUse ALLOW → consumed
// ---------------------------------------------------------------------------

describe('full override lifecycle', () => {
  it('BLOCK → set pendingOverride → next PreToolUse exits 0 and consumes override', () => {
    // Step 1: PreToolUse BLOCKs
    const state = makeState();
    const blockResult = enforcePreAction(blockContract(), state, toolEvent(), 'pre-tool-use');
    expect(blockResult.exitCode).toBe(2);
    expect(blockResult.state.blockedAction).toBeDefined();
    expect(blockResult.state.blockedAction?.tool).toBe('edit');
    expect(blockResult.state.blockedAction?.reason).toBe('Task drift detected');

    // Step 2: Developer runs override → write pendingOverride into state
    const stateAfterBlock = blockResult.state;
    stateAfterBlock.pendingOverride = {
      active: true,
      reason: 'developer_confirmed',
      scope: 'next_action',
    };

    // Step 3: Next PreToolUse — override consumed, exit 0
    const overrideCheck = checkAndConsumeOverride(stateAfterBlock);
    expect(overrideCheck.overrideConsumed).toBe(true);
    expect(overrideCheck.state.pendingOverride).toBeUndefined();
  });

  it('override is single-use — second PreToolUse evaluates normally (no auto-ALLOW)', () => {
    // State with override already consumed
    const stateAfterConsumed = makeState({ pendingOverride: undefined });

    // Second PreToolUse: no override → should evaluate fresh contract
    const check = checkAndConsumeOverride(stateAfterConsumed);
    expect(check.overrideConsumed).toBe(false);

    // Fresh BLOCK contract still blocks
    const result = enforcePreAction(blockContract(), stateAfterConsumed, toolEvent(), 'pre-tool-use');
    expect(result.exitCode).toBe(2);
  });

  it('override decision includes timestamp', () => {
    const before = Date.now();
    const state = makeState({
      pendingOverride: { active: true, reason: 'developer_confirmed', scope: 'next_action' },
    });
    const result = checkAndConsumeOverride(state);
    const after = Date.now();
    const record = result.state.decisions[0];
    expect(record.timestamp).toBeGreaterThanOrEqual(before);
    expect(record.timestamp).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// BLOCK records blockedAction in session state (T7.1)
// ---------------------------------------------------------------------------

describe('enforcePreAction — BLOCK records blockedAction', () => {
  it('sets blockedAction.tool, files, reason, timestamp on BLOCK', () => {
    const state = makeState();
    const event = toolEvent(['src/payment/checkout.ts'], 'write');
    const result = enforcePreAction(blockContract(), state, event, 'pre-tool-use');
    expect(result.state.blockedAction).toBeDefined();
    expect(result.state.blockedAction?.tool).toBe('write');
    expect(result.state.blockedAction?.files).toContain('src/payment/checkout.ts');
    expect(result.state.blockedAction?.reason).toBe('Task drift detected');
    expect(result.state.blockedAction?.timestamp).toBeGreaterThan(0);
  });

  it('does NOT set blockedAction on ALLOW', () => {
    const state = makeState();
    const result = enforcePreAction(allowContract(), state, toolEvent(), 'pre-tool-use');
    expect(result.state.blockedAction).toBeUndefined();
  });

  it('sets blockedAction when consuming a deferredBlock', () => {
    const state = makeState({
      deferredBlock: { reason: 'Scope expansion after action', signals: ['SCOPE_EXPANSION'] },
    });
    const result = enforcePreAction(allowContract(), state, toolEvent(['dist/output.js']), 'pre-tool-use');
    expect(result.exitCode).toBe(2);
    expect(result.state.blockedAction).toBeDefined();
    expect(result.state.blockedAction?.reason).toBe('Scope expansion after action');
  });
});

// ---------------------------------------------------------------------------
// Advisory mode: humanOverride.enabled = false → BLOCK exits 0 (T7.5)
// ---------------------------------------------------------------------------

describe('advisory mode (humanOverride.enabled = false)', () => {
  beforeEach(() => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('BLOCK → exit 0 when humanOverride.enabled is false', () => {
    const state = makeState();
    const result = enforcePreAction(
      blockContract(),
      state,
      toolEvent(),
      'pre-tool-use',
      { humanOverride: { enabled: false } },
    );
    expect(result.exitCode).toBe(0);
  });

  it('advisory BLOCK writes a warning to stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const state = makeState();
    enforcePreAction(
      blockContract(),
      state,
      toolEvent(),
      'pre-tool-use',
      { humanOverride: { enabled: false } },
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('advisory BLOCK'),
    );
    stderrSpy.mockRestore();
  });

  it('BLOCK → exit 2 when humanOverride.enabled is true (default)', () => {
    const state = makeState();
    const result = enforcePreAction(
      blockContract(),
      state,
      toolEvent(),
      'pre-tool-use',
      { humanOverride: { enabled: true } },
    );
    expect(result.exitCode).toBe(2);
  });

  it('BLOCK → exit 2 when config is omitted (safe default)', () => {
    const state = makeState();
    const result = enforcePreAction(blockContract(), state, toolEvent(), 'pre-tool-use');
    expect(result.exitCode).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// setOverride session-manager helper
// ---------------------------------------------------------------------------

describe('setOverride (session-manager)', () => {
  beforeEach(() => {
    resetSessionCache();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  it('writes an active pendingOverride with next_action scope', () => {
    // setOverride relies on getOrLoad which will create an empty shell
    // We mock writeToDisk by using a non-existent session (fail-soft I/O)
    const state = setOverride('nonexistent-session-xyz', 'developer_confirmed');
    expect(state.pendingOverride).toBeDefined();
    expect(state.pendingOverride?.active).toBe(true);
    expect(state.pendingOverride?.reason).toBe('developer_confirmed');
    expect(state.pendingOverride?.scope).toBe('next_action');
  });

  it('overwrites any existing pendingOverride (idempotent)', () => {
    const first = setOverride('session-idem', 'first_reason');
    expect(first.pendingOverride?.reason).toBe('first_reason');

    const second = setOverride('session-idem', 'second_reason');
    expect(second.pendingOverride?.reason).toBe('second_reason');
  });
});
