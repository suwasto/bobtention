/**
 * tests/integration/e2e-lifecycle.test.ts
 *
 * End-to-end integration tests — Phase 8 T8.3.
 *
 * Simulates the full hook lifecycle:
 *   SessionStart → UserPromptSubmit → (PreToolUse → PostToolUse) × N → Stop
 *
 * Tests verify:
 *   - Session state created, updated, and finalized across the cycle
 *   - Signals accumulate correctly across events
 *   - Deferred BLOCK from PostToolUse enforced by next PreToolUse
 *   - Human override round-trip unblocks the session
 *   - All 5 demo scenarios produce correct outcomes
 *   - Fail-open: no crashes on missing or invalid payloads
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initSession, updateSession, appendSignal, getSession, resetSessionCache, setOverride, persistState } from '../../src/core/session-manager';
import { evaluateEvent, extractEventSignals } from '../../src/core/attention-evaluator';
import { enforcePreAction, enforcePostAction, checkAndConsumeOverride } from '../../src/core/enforcement';
import { loadConfig, resetConfigCache } from '../../src/core/config';
import type { NormalizedEvent, SessionState, ToolEvent } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToolEvent(tool: string, files: string[]): ToolEvent {
  return { kind: 'tool', tool, files, input: {}, timestamp: Date.now() };
}

// Each test gets an isolated temp directory for session storage so disk state
// never leaks between tests regardless of execution order.
let tmpDir: string;

function withTestConfig() {
  const config = loadConfig(true);
  // Override storage path to the per-test temp dir
  config.session.storagePath = tmpDir;
  // Always use local rule engine in tests — Laya is not available in CI
  config.decisionEngine.provider = 'local';
  return config;
}

// Counter to ensure session IDs are unique per test even within the same ms
let _sessionCounter = 0;
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++_sessionCounter}`;
}

// Suppress stderr noise during tests
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bobtention-e2e-'));
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  resetSessionCache();
  resetConfigCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSessionCache();
  // Clean up temp directory
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Act 1 — Normal Work: ALLOW throughout
// "Implement OAuth login with Google."
// ---------------------------------------------------------------------------

describe('Act 1 — Normal Work (ALLOW throughout)', () => {
  it('SessionStart → UserPromptSubmit → multiple PreToolUse → Stop: all ALLOW, no BLOCK', async () => {
    const config = withTestConfig();
    const sessionId = uniqueId('act1-normal');

    // SessionStart: init session
    const state = initSession(sessionId, 'Implement OAuth login with Google', config);
    expect(state.sessionId).toBe(sessionId);
    expect(state.status).toBe('active');

    // UserPromptSubmit: intent captured
    expect(state.originalIntent).toBe('Implement OAuth login with Google');

    // PreToolUse sequence — all auth-related files: should stay ALLOW
    const actions: Array<[string, string[]]> = [
      ['read', ['src/auth/oauth.ts']],
      ['edit', ['src/auth/google-oauth.ts']],
      ['edit', ['src/auth/callback.ts']],
      ['bash', ['tests/auth/oauth.test.ts']],
      ['edit', ['src/auth/google-oauth.ts']],
      ['bash', ['tests/auth/oauth.test.ts']],
    ];

    let finalState = state;
    for (const [tool, files] of actions) {
      const event = makeToolEvent(tool, files);
      finalState = updateSession(sessionId, event, config);
      const signals = extractEventSignals(finalState, event, config);
      for (const signal of signals) {
        finalState = appendSignal(sessionId, signal, config);
      }
      const contract = await evaluateEvent(finalState, event, config);
      const result = enforcePreAction(contract, finalState, event, 'pre-tool-use', config);
      expect(result.exitCode).toBe(0);
      finalState = result.state;
      persistState(finalState, config);
    }

    // After 6 normal auth actions: no BLOCK decisions
    const blockDecisions = finalState.decisions.filter(d => d.decision === 'BLOCK');
    expect(blockDecisions).toHaveLength(0);

    // Stop: finalize
    const stopEvent: NormalizedEvent = { kind: 'stop', sessionId, timestamp: Date.now() };
    finalState = updateSession(sessionId, stopEvent, config);
    expect(finalState.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// Act 2 — Stuck: repeated test failure → deterministic BLOCK
// ---------------------------------------------------------------------------

describe('Act 2 — Stuck (repeated test failure → BLOCK)', () => {
  it('4 identical test failures → deterministic BLOCK on next PreToolUse', async () => {
    const config = withTestConfig();
    const sessionId = uniqueId('act2-stuck');

    let state = initSession(sessionId, 'Fix OAuth callback test', config);

    // Record 4 identical failures in session state (simulate PostToolUse test failure reporting)
    for (let i = 0; i < 4; i++) {
      const testEvent: NormalizedEvent = {
        kind: 'test',
        name: 'oauth_callback_should_return_token',
        result: 'failed',
        timestamp: Date.now() + i,
      };
      state = updateSession(sessionId, testEvent, config);
    }

    // Verify failure record
    const failureRecord = state.failures.find(f => f.signature === 'oauth_callback_should_return_token');
    expect(failureRecord).toBeDefined();
    expect(failureRecord!.count).toBe(4);
    expect(failureRecord!.progressing).toBe(false);

    // Next PreToolUse: attempt to fix again
    const fixEvent = makeToolEvent('edit', ['src/auth/callback.ts']);
    const contract = await evaluateEvent(state, fixEvent, config);

    // Should deterministically BLOCK (4 failures ≥ threshold)
    expect(contract.decision).toBe('BLOCK');
    expect(contract.signals).toContain('REPEATED_FAILURE');
    expect(contract.reason).toContain('oauth_callback_should_return_token');

    const result = enforcePreAction(contract, state, fixEvent, 'pre-tool-use', config);
    expect(result.exitCode).toBe(2);
    expect(result.state.blockedAction).toBeDefined();
    expect(result.state.blockedAction?.reason).toContain('oauth_callback_should_return_token');
  });
});

// ---------------------------------------------------------------------------
// Act 3 — Task Drift: Auth task, then payment code → BLOCK
// ---------------------------------------------------------------------------

describe('Act 3 — Task Drift (Auth intent → PaymentService files → BLOCK)', () => {
  it('OAuth intent + payment files → TASK_DRIFT signal → BLOCK', async () => {
    const config = withTestConfig();
    const sessionId = uniqueId('act3-drift');

    let state = initSession(sessionId, 'Implement OAuth login', config);

    // Establish auth scope with initial actions
    const authActions: Array<[string, string[]]> = [
      ['read', ['src/auth/oauth.ts']],
      ['edit', ['src/auth/google-provider.ts']],
      ['edit', ['src/auth/session.ts']],
      ['bash', ['tests/auth/login.test.ts']],
      ['edit', ['src/auth/callback.ts']],
    ];
    for (const [tool, files] of authActions) {
      const event = makeToolEvent(tool, files);
      state = updateSession(sessionId, event, config);
    }

    // Now drift to payment code
    const driftEvent = makeToolEvent('edit', ['src/payment/PaymentService.kt']);
    state = updateSession(sessionId, driftEvent, config);

    const signals = extractEventSignals(state, driftEvent, config);
    for (const signal of signals) {
      state = appendSignal(sessionId, signal, config);
    }

    // Should detect TASK_DRIFT
    const driftSignal = state.signals.find(s => s.type === 'TASK_DRIFT');
    expect(driftSignal).toBeDefined();
    expect(driftSignal?.detail).toContain('payment');

    // Evaluate: should WATCH or BLOCK on drift
    const contract = await evaluateEvent(state, driftEvent, config);
    expect(['WATCH', 'BLOCK']).toContain(contract.decision);
    expect(contract.signals).toContain('TASK_DRIFT');
  });
});

// ---------------------------------------------------------------------------
// Act 4 — Human Override: BLOCK → override → continue
// ---------------------------------------------------------------------------

describe('Act 4 — Human Override (BLOCK → override → continue)', () => {
  it('BLOCK → developer runs override → next PreToolUse exits 0 (single-use)', async () => {
    const config = withTestConfig();
    const sessionId = uniqueId('act4-override');

    let state = initSession(sessionId, 'Implement OAuth login', config);

    // Set up a failure to cause BLOCK
    for (let i = 0; i < 4; i++) {
      const failEvent: NormalizedEvent = {
        kind: 'test',
        name: 'oauth_test_fail',
        result: 'failed',
        timestamp: Date.now() + i,
      };
      state = updateSession(sessionId, failEvent, config);
    }

    // PreToolUse: BLOCKs
    const nextAction = makeToolEvent('edit', ['src/auth/oauth.ts']);
    const blockContract = await evaluateEvent(state, nextAction, config);
    expect(blockContract.decision).toBe('BLOCK');

    const blockResult = enforcePreAction(blockContract, state, nextAction, 'pre-tool-use', config);
    expect(blockResult.exitCode).toBe(2);
    state = blockResult.state;
    persistState(state, config);

    // Developer runs: npx bobtention override <session-id>
    state = setOverride(sessionId, 'developer_confirmed_proceed', config);
    expect(state.pendingOverride?.active).toBe(true);

    // Next PreToolUse: override consumed → exit 0
    const overrideCheck = checkAndConsumeOverride(state);
    expect(overrideCheck.overrideConsumed).toBe(true);
    expect(overrideCheck.state.pendingOverride).toBeUndefined();

    // Override is single-use: second action evaluates normally
    const secondCheck = checkAndConsumeOverride(overrideCheck.state);
    expect(secondCheck.overrideConsumed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Act 5 — High-Impact Change: migration file → WATCH or BLOCK
// ---------------------------------------------------------------------------

describe('Act 5 — High-Impact Change (migration file → WATCH or BLOCK)', () => {
  it('editing a migration file triggers HIGH_IMPACT_CHANGE signal', async () => {
    const config = withTestConfig();
    const sessionId = uniqueId('act5-highimpact');

    let state = initSession(sessionId, 'Add user profile fields', config);

    // Normal setup actions
    const setupActions: Array<[string, string[]]> = [
      ['read', ['src/users/profile.ts']],
      ['edit', ['src/users/profile.ts']],
    ];
    for (const [tool, files] of setupActions) {
      const event = makeToolEvent(tool, files);
      state = updateSession(sessionId, event, config);
    }

    // High-impact: editing a migration file
    const migrationEvent = makeToolEvent('edit', ['db/migrations/20240101_add_profile_fields.sql']);
    state = updateSession(sessionId, migrationEvent, config);

    const signals = extractEventSignals(state, migrationEvent, config);
    const highImpact = signals.find(s => s.type === 'HIGH_IMPACT_CHANGE');
    expect(highImpact).toBeDefined();
    expect(highImpact?.detail).toContain('migration');

    for (const signal of signals) {
      state = appendSignal(sessionId, signal, config);
    }

    const contract = await evaluateEvent(state, migrationEvent, config);
    // Should at minimum WATCH (possibly BLOCK depending on confidence)
    expect(['WATCH', 'BLOCK']).toContain(contract.decision);
    expect(contract.signals).toContain('HIGH_IMPACT_CHANGE');
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle: SessionStart → N hooks → Stop
// ---------------------------------------------------------------------------

describe('Full lifecycle — session state created, updated, finalized', () => {
  it('session file lifecycle: init → actions recorded → stop → completed', async () => {
    const config = withTestConfig();
    const sessionId = uniqueId('full-lifecycle-test');

    // SessionStart
    let state = initSession(sessionId, 'Build user registration flow', config);
    expect(state.actions).toHaveLength(0);

    // UserPromptSubmit: intent set
    expect(state.originalIntent).toBe('Build user registration flow');

    // PreToolUse × 3 + PostToolUse × 3
    const events: Array<[string, string[]]> = [
      ['read', ['src/users/registration.ts']],
      ['edit', ['src/users/registration.ts']],
      ['bash', ['tests/users/registration.test.ts']],
    ];

    for (const [tool, files] of events) {
      // PreToolUse
      const event = makeToolEvent(tool, files);
      state = updateSession(sessionId, event, config);
      const preContract = await evaluateEvent(state, event, config);
      const preResult = enforcePreAction(preContract, state, event, 'pre-tool-use', config);
      state = preResult.state;
      persistState(state, config);

      // PostToolUse
      const postContract = await evaluateEvent(state, event, config);
      const postResult = enforcePostAction(postContract, state, event);
      state = postResult.state;
      persistState(state, config);
    }

    // 3 actions recorded
    expect(state.actions).toHaveLength(3);

    // Stop
    const stopEvent: NormalizedEvent = { kind: 'stop', sessionId, timestamp: Date.now() };
    state = updateSession(sessionId, stopEvent, config);
    expect(state.status).toBe('completed');

    // Session persisted on disk
    const loaded = getSession(sessionId, config);
    expect(loaded).not.toBeNull();
    expect(loaded?.status).toBe('completed');
    expect(loaded?.actions).toHaveLength(3);
  });

  it('bounded action history: actions capped at config.session.maxActions', async () => {
    const config = { ...withTestConfig(), session: { maxActions: 5, storagePath: tmpDir } };
    const sessionId = uniqueId('bounded-history-test');

    let state = initSession(sessionId, 'Test bounded history', config);

    for (let i = 0; i < 8; i++) {
      const event = makeToolEvent('edit', [`src/file${i}.ts`]);
      state = updateSession(sessionId, event, config);
    }

    expect(state.actions.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Fail-open: invalid or missing payloads do not crash
// ---------------------------------------------------------------------------

describe('Fail-open — no crash on unexpected input', () => {
  it('evaluateEvent with empty state returns ALLOW (fail-open)', async () => {
    const config = withTestConfig();
    const state: SessionState = {
      sessionId: uniqueId('fail-open-test'),
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
    const event = makeToolEvent('edit', ['src/anything.ts']);
    const contract = await evaluateEvent(state, event, config);
    expect(contract.decision).toBe('ALLOW');
    expect(contract.decision).not.toBeUndefined();
  });

  it('extractEventSignals with stop event returns empty signals', () => {
    const config = withTestConfig();
    const sid = uniqueId('stop-signal-test');
    const state: SessionState = {
      sessionId: sid,
      originalIntent: 'test',
      startTime: Date.now(),
      status: 'active',
      actions: [],
      tests: [],
      failures: [],
      signals: [],
      decisions: [],
      overrides: [],
    };
    const stopEvent: NormalizedEvent = { kind: 'stop', sessionId: sid, timestamp: Date.now() };
    const signals = extractEventSignals(state, stopEvent, config);
    expect(signals).toHaveLength(0);
  });
});
