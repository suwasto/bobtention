/**
 * tests/core/enforcement.test.ts
 *
 * Unit tests for Enforcement Layer + Notification Layer (Phase 6 — T6.5).
 * Covers: exit codes per hook type, BLOCK/WATCH/ALLOW messages,
 *         PostToolUse deferred BLOCK flow, pre/post distinction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enforcePreAction, enforcePostAction } from '../../src/core/enforcement';
import { formatWatch, formatBlock } from '../../src/core/notification';
import type { DecisionContract, SessionState, NormalizedEvent } from '../../src/types';

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

function allowContract(): DecisionContract {
  return { decision: 'ALLOW', confidence: 0.95, reason: 'No signals', signals: [] };
}

function watchContract(): DecisionContract {
  return {
    decision: 'WATCH',
    confidence: 0.65,
    reason: 'Scope expanding beyond initial boundaries',
    signals: ['SCOPE_EXPANSION'],
  };
}

function blockContract(): DecisionContract {
  return {
    decision: 'BLOCK',
    confidence: 0.92,
    reason: 'Task drift detected',
    signals: ['TASK_DRIFT', 'SCOPE_EXPANSION'],
    summary: 'Bob is modifying payment code while task concerns OAuth.',
  };
}

// ---------------------------------------------------------------------------
// enforcePreAction — exit codes
// ---------------------------------------------------------------------------

describe('enforcePreAction — exit codes', () => {
  it('ALLOW → exit 0', () => {
    const result = enforcePreAction(allowContract(), makeState(), toolEvent(), 'pre-tool-use');
    expect(result.exitCode).toBe(0);
  });

  it('WATCH → exit 0', () => {
    const result = enforcePreAction(watchContract(), makeState(), toolEvent(), 'pre-tool-use');
    expect(result.exitCode).toBe(0);
  });

  it('BLOCK → exit 2', () => {
    const result = enforcePreAction(blockContract(), makeState(), toolEvent(), 'pre-tool-use');
    expect(result.exitCode).toBe(2);
  });

  it('user-prompt-submit BLOCK → exit 2', () => {
    const event: NormalizedEvent = { kind: 'prompt', text: 'do something risky', timestamp: Date.now() };
    const result = enforcePreAction(blockContract(), makeState(), event, 'user-prompt-submit');
    expect(result.exitCode).toBe(2);
  });

  it('non-blocking hook BLOCK call → ignored, exit 0', () => {
    // post-tool-use is not a blocking hook — guard prevents exit 2
    const result = enforcePreAction(blockContract(), makeState(), toolEvent(), 'post-tool-use');
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// enforcePreAction — records decision in session state
// ---------------------------------------------------------------------------

describe('enforcePreAction — decision recording', () => {
  it('appends decision record for ALLOW', () => {
    const state = makeState();
    const result = enforcePreAction(allowContract(), state, toolEvent(), 'pre-tool-use');
    expect(result.state.decisions).toHaveLength(1);
    expect(result.state.decisions[0].decision).toBe('ALLOW');
  });

  it('appends decision record for BLOCK', () => {
    const state = makeState();
    const result = enforcePreAction(blockContract(), state, toolEvent(), 'pre-tool-use');
    expect(result.state.decisions[0].decision).toBe('BLOCK');
    expect(result.state.decisions[0].timestamp).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// enforcePostAction — always exit 0, deferredBlock
// ---------------------------------------------------------------------------

describe('enforcePostAction', () => {
  it('always returns exit 0 for ALLOW', () => {
    const result = enforcePostAction(allowContract(), makeState(), toolEvent());
    expect(result.exitCode).toBe(0);
  });

  it('always returns exit 0 for BLOCK (deferred)', () => {
    const result = enforcePostAction(blockContract(), makeState(), toolEvent());
    expect(result.exitCode).toBe(0);
  });

  it('sets deferredBlock on state when BLOCK is detected', () => {
    const state = makeState();
    const result = enforcePostAction(blockContract(), state, toolEvent());
    expect(result.state.deferredBlock).toBeDefined();
    expect(result.state.deferredBlock?.reason).toBe('Task drift detected');
    expect(result.state.deferredBlock?.signals).toContain('TASK_DRIFT');
  });

  it('does NOT set deferredBlock for ALLOW', () => {
    const state = makeState();
    const result = enforcePostAction(allowContract(), state, toolEvent());
    expect(result.state.deferredBlock).toBeUndefined();
  });

  it('records decision for ALLOW', () => {
    const state = makeState();
    const result = enforcePostAction(allowContract(), state, toolEvent());
    expect(result.state.decisions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Deferred BLOCK flow: PostToolUse → next PreToolUse
// ---------------------------------------------------------------------------

describe('deferred BLOCK flow', () => {
  it('PreToolUse consumes deferredBlock and exits 2', () => {
    // Simulate PostToolUse writing deferredBlock
    const stateAfterPost = makeState({
      deferredBlock: {
        reason: 'Concern detected after file delete',
        signals: ['HIGH_IMPACT_CHANGE'],
      },
    });

    // PreToolUse should consume the deferredBlock and exit 2
    const result = enforcePreAction(allowContract(), stateAfterPost, toolEvent(), 'pre-tool-use');
    expect(result.exitCode).toBe(2);
    // deferredBlock consumed — removed from state
    expect(result.state.deferredBlock).toBeUndefined();
  });

  it('deferred BLOCK is single-use — second PreToolUse does not re-block', () => {
    const stateWithDeferred = makeState({
      deferredBlock: {
        reason: 'Scope expansion',
        signals: ['SCOPE_EXPANSION'],
      },
    });

    // First PreToolUse: consumes deferred → exit 2
    const first = enforcePreAction(allowContract(), stateWithDeferred, toolEvent(), 'pre-tool-use');
    expect(first.exitCode).toBe(2);
    expect(first.state.deferredBlock).toBeUndefined();

    // Second PreToolUse with clean state: no deferred, ALLOW contract → exit 0
    const second = enforcePreAction(allowContract(), first.state, toolEvent(), 'pre-tool-use');
    expect(second.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Notification Layer — message formatting
// ---------------------------------------------------------------------------

describe('formatWatch', () => {
  it('contains ◐ Bobtention', () => {
    const msg = formatWatch(watchContract(), 'pre-action');
    expect(msg).toContain('◐ Bobtention');
    expect(msg).toContain('watching');
  });

  it('includes the reason', () => {
    const msg = formatWatch(watchContract(), 'pre-action');
    expect(msg).toContain('Scope expanding');
  });

  it('uses "observed after action" language for post-action', () => {
    const msg = formatWatch(watchContract(), 'post-action');
    expect(msg).toContain('observed after action');
  });
});

describe('formatBlock', () => {
  it('contains ⚠ Bobtention', () => {
    const msg = formatBlock(blockContract(), makeState(), toolEvent(), 'pre-action');
    expect(msg).toContain('⚠ Bobtention');
  });

  it('includes reason, task, and current activity', () => {
    const msg = formatBlock(blockContract(), makeState(), toolEvent(['src/payment.ts']), 'pre-action');
    expect(msg).toContain('Task drift detected');
    expect(msg).toContain('implement OAuth login');
    expect(msg).toContain('src/payment.ts');
  });

  it('lists each signal (human-readable labels)', () => {
    const msg = formatBlock(blockContract(), makeState(), toolEvent(), 'pre-action');
    expect(msg).toContain('Task drift');
    expect(msg).toContain('Scope expansion');
  });

  it('includes summary when present', () => {
    const msg = formatBlock(blockContract(), makeState(), toolEvent(), 'pre-action');
    expect(msg).toContain('payment code');
  });

  it('uses deferred language for post-action source', () => {
    const msg = formatBlock(blockContract(), makeState(), toolEvent(), 'post-action');
    expect(msg).toContain('concern detected after action');
  });

  it('includes "The next action has been blocked" for both sources', () => {
    const prePre = formatBlock(blockContract(), makeState(), toolEvent(), 'pre-action');
    const prePost = formatBlock(blockContract(), makeState(), toolEvent(), 'post-action');
    expect(prePre).toContain('The next action has been blocked');
    expect(prePost).toContain('The next action has been blocked');
  });
});

// ---------------------------------------------------------------------------
// Stdout / stderr separation — ALLOW is silent
// ---------------------------------------------------------------------------

describe('notification stdout/stderr separation', () => {
  it('ALLOW produces no stderr output', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    enforcePreAction(allowContract(), makeState(), toolEvent(), 'pre-tool-use');

    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('WATCH writes to stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    enforcePreAction(watchContract(), makeState(), toolEvent(), 'pre-tool-use');

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('◐ Bobtention'));
    stderrSpy.mockRestore();
  });

  it('BLOCK writes to stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    enforcePreAction(blockContract(), makeState(), toolEvent(), 'pre-tool-use');

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('⚠ Bobtention'));
    stderrSpy.mockRestore();
  });
});
