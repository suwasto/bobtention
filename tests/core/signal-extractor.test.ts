/**
 * tests/core/signal-extractor.test.ts
 *
 * Unit tests for Signal Extractor (Phase 4).
 * Covers: T4.1–T4.7 including the 6 PRD scenarios (§32–37).
 */

import { describe, it, expect } from 'vitest';
import { extractSignals } from '../../src/core/signal-extractor';
import type { SessionState, NormalizedEvent, Signal } from '../../src/types';
import type { BobtentionConfig } from '../../src/core/config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<BobtentionConfig['signals']> = {}): BobtentionConfig {
  return {
    enabled: true,
    decisionEngine: { provider: 'local', timeout: 3000 },
    autonomy: { default: 'autonomous', watchThreshold: 0.55, blockThreshold: 0.85 },
    signals: {
      taskDrift: true,
      repeatedFailure: true,
      scopeExpansion: true,
      highImpactAction: true,
      uncertainty: true,
      ...overrides,
    },
    highImpactPatterns: [
      { pattern: '**/migration*', category: 'DATABASE' },
      { pattern: '**/auth*', category: 'AUTHENTICATION' },
      { pattern: '**/*deploy*', category: 'DEPLOYMENT' },
      { pattern: '**/Dockerfile*', category: 'INFRASTRUCTURE' },
      { pattern: '**/.env*', category: 'SECURITY' },
      { pattern: '**/security*', category: 'SECURITY' },
    ],
    humanOverride: { enabled: true },
    session: { maxActions: 50, storagePath: '/tmp/test-sessions' },
  };
}

function emptyState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'test',
    originalIntent: 'fix the login bug',
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

function toolEvent(files: string[], tool = 'edit'): NormalizedEvent {
  return {
    kind: 'tool',
    tool,
    files,
    input: {},
    timestamp: Date.now(),
  };
}

function makeActions(files: string[][], tool = 'edit') {
  return files.map((f) => ({
    tool,
    files: f,
    input: {},
    output: {},
    timestamp: Date.now(),
  }));
}

// ---------------------------------------------------------------------------
// T4.1 — extractSignals only returns enabled types
// ---------------------------------------------------------------------------

describe('extractSignals — respects config.signals flags', () => {
  it('returns no signals when all signal types disabled', () => {
    const state = emptyState({
      failures: [{ signature: 'auth.test', count: 5, lastSeen: Date.now(), progressing: false }],
    });
    const config = makeConfig({
      taskDrift: false,
      repeatedFailure: false,
      scopeExpansion: false,
      highImpactAction: false,
      uncertainty: false,
    });
    const signals = extractSignals(state, toolEvent(['src/auth.ts']), config);
    expect(signals).toHaveLength(0);
  });

  it('skips prompt events', () => {
    const state = emptyState();
    const config = makeConfig();
    const event: NormalizedEvent = { kind: 'prompt', text: 'hello', timestamp: Date.now() };
    const signals = extractSignals(state, event, config);
    expect(signals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T4.2 — REPEATED_FAILURE
// ---------------------------------------------------------------------------

describe('REPEATED_FAILURE detector', () => {
  it('fires when a failure exceeds threshold (default 3)', () => {
    const state = emptyState({
      failures: [{ signature: 'login.test', count: 3, lastSeen: Date.now(), progressing: false }],
    });
    const signals = extractSignals(state, toolEvent(['src/login.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'REPEATED_FAILURE')).toBe(true);
  });

  it('does not fire below threshold', () => {
    const state = emptyState({
      failures: [{ signature: 'login.test', count: 2, lastSeen: Date.now(), progressing: false }],
    });
    const signals = extractSignals(state, toolEvent(['src/login.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'REPEATED_FAILURE')).toBe(false);
  });

  it('does not fire when failure is progressing', () => {
    const state = emptyState({
      failures: [{ signature: 'login.test', count: 5, lastSeen: Date.now(), progressing: true }],
    });
    const signals = extractSignals(state, toolEvent(['src/login.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'REPEATED_FAILURE')).toBe(false);
  });

  it('severity increases with more evidence', () => {
    const makeState = (count: number, priorSignals: Signal[]): SessionState =>
      emptyState({
        failures: [{ signature: 'x.test', count, lastSeen: Date.now(), progressing: false }],
        signals: priorSignals,
      });

    const s1 = extractSignals(makeState(3, []), toolEvent(['a.ts']), makeConfig());
    const s2 = extractSignals(
      makeState(5, [{ type: 'REPEATED_FAILURE', severity: 0.3, timestamp: Date.now() }]),
      toolEvent(['a.ts']),
      makeConfig(),
    );

    const sev1 = s1.find((s) => s.type === 'REPEATED_FAILURE')!.severity;
    const sev2 = s2.find((s) => s.type === 'REPEATED_FAILURE')!.severity;
    expect(sev2).toBeGreaterThan(sev1);
  });
});

// ---------------------------------------------------------------------------
// T4.2 — SCOPE_EXPANSION
// ---------------------------------------------------------------------------

describe('SCOPE_EXPANSION detector', () => {
  it('fires when new directories exceed initial scope by threshold', () => {
    const initialFiles = [['src/core/a.ts'], ['src/utils/b.ts'], ['src/hooks/c.ts'], ['src/types/d.ts'], ['src/core/e.ts']];
    const extraFiles = [['infra/deploy.sh'], ['docs/README.md'], ['scripts/build.sh']];
    const state = emptyState({
      actions: makeActions([...initialFiles, ...extraFiles]),
    });
    const signals = extractSignals(state, toolEvent(['infra/new.sh']), makeConfig());
    expect(signals.some((s) => s.type === 'SCOPE_EXPANSION')).toBe(true);
  });

  it('does not fire when scope is stable', () => {
    const files = Array(8).fill(['src/core/file.ts']);
    const state = emptyState({ actions: makeActions(files) });
    const signals = extractSignals(state, toolEvent(['src/core/new.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'SCOPE_EXPANSION')).toBe(false);
  });

  it('does not fire with fewer than 6 actions (insufficient baseline)', () => {
    const state = emptyState({
      actions: makeActions([['src/a.ts'], ['tests/b.ts'], ['infra/c.sh']]),
    });
    const signals = extractSignals(state, toolEvent(['docs/d.md']), makeConfig());
    expect(signals.some((s) => s.type === 'SCOPE_EXPANSION')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T4.2 — HIGH_IMPACT_CHANGE
// ---------------------------------------------------------------------------

describe('HIGH_IMPACT_CHANGE detector', () => {
  it('fires on migration file', () => {
    const state = emptyState();
    const signals = extractSignals(state, toolEvent(['db/migrations/001_add_user.sql']), makeConfig());
    expect(signals.some((s) => s.type === 'HIGH_IMPACT_CHANGE')).toBe(true);
  });

  it('fires on .env file', () => {
    const state = emptyState();
    const signals = extractSignals(state, toolEvent(['.env.production']), makeConfig());
    expect(signals.some((s) => s.type === 'HIGH_IMPACT_CHANGE')).toBe(true);
  });

  it('fires on Dockerfile', () => {
    const state = emptyState();
    const signals = extractSignals(state, toolEvent(['Dockerfile']), makeConfig());
    expect(signals.some((s) => s.type === 'HIGH_IMPACT_CHANGE')).toBe(true);
  });

  it('does not fire on regular source files', () => {
    const state = emptyState();
    const signals = extractSignals(state, toolEvent(['src/core/session-manager.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'HIGH_IMPACT_CHANGE')).toBe(false);
  });

  it('fires on regex-style pattern (credentials)', () => {
    const config = makeConfig();
    config.highImpactPatterns = [
      { pattern: '\\.env|secret|credential|password|token|key', category: 'credentials' },
    ];
    const state = emptyState();
    const signals = extractSignals(state, toolEvent(['src/config/secret_keys.ts']), config);
    expect(signals.some((s) => s.type === 'HIGH_IMPACT_CHANGE')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T4.2 — TASK_DRIFT
// ---------------------------------------------------------------------------

describe('TASK_DRIFT detector', () => {
  it('fires when files have no relation to intent keywords or initial scope', () => {
    const state = emptyState({
      originalIntent: 'fix the login authentication bug',
      actions: makeActions([
        ['src/auth/login.ts'], ['src/auth/session.ts'], ['src/auth/token.ts'],
        ['src/auth/middleware.ts'], ['tests/auth.test.ts'],
      ]),
    });
    // Now touching unrelated billing module
    const signals = extractSignals(state, toolEvent(['src/billing/invoice.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'TASK_DRIFT')).toBe(true);
  });

  it('does not fire when files align with intent keywords', () => {
    const state = emptyState({
      originalIntent: 'fix the login authentication bug',
    });
    const signals = extractSignals(state, toolEvent(['src/auth/login.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'TASK_DRIFT')).toBe(false);
  });

  it('does not fire when files are in initial scope', () => {
    const state = emptyState({
      originalIntent: 'improve performance of data processing pipeline',
      actions: makeActions([['src/pipeline/processor.ts'], ['src/pipeline/queue.ts']]),
    });
    const signals = extractSignals(state, toolEvent(['src/pipeline/new.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'TASK_DRIFT')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T4.2 — UNCERTAINTY
// ---------------------------------------------------------------------------

describe('UNCERTAINTY detector', () => {
  it('fires when recent actions span many distinct directories', () => {
    const manyDirActions = makeActions([
      ['src/core/a.ts'], ['tests/b.ts'], ['docs/c.md'], ['infra/d.sh'],
      ['scripts/e.sh'], ['src/utils/f.ts'], ['db/g.sql'], ['config/h.json'],
      ['public/i.html'], ['migrations/j.sql'],
    ]);
    const state = emptyState({ actions: manyDirActions });
    const signals = extractSignals(state, toolEvent(['src/core/x.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'UNCERTAINTY')).toBe(true);
  });

  it('does not fire when recent actions are focused', () => {
    const focusedActions = makeActions(
      Array(10).fill(['src/core/auth.ts']),
    );
    const state = emptyState({ actions: focusedActions });
    const signals = extractSignals(state, toolEvent(['src/core/new.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'UNCERTAINTY')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T4.4–T4.5 — Severity accumulates, signals are additive
// ---------------------------------------------------------------------------

describe('signal accumulation', () => {
  it('severity increases as more REPEATED_FAILURE signals accumulate', () => {
    const base = emptyState({
      failures: [{ signature: 'x', count: 3, lastSeen: Date.now(), progressing: false }],
    });
    const first = extractSignals(base, toolEvent(['a.ts']), makeConfig());

    const withPrior = emptyState({
      failures: [{ signature: 'x', count: 4, lastSeen: Date.now(), progressing: false }],
      signals: [{ type: 'REPEATED_FAILURE', severity: first[0]?.severity ?? 0.3, timestamp: Date.now() }],
    });
    const second = extractSignals(withPrior, toolEvent(['a.ts']), makeConfig());

    expect(second[0]?.severity).toBeGreaterThan(first[0]?.severity ?? 0);
  });

  it('extractSignals returns new signals without modifying state.signals', () => {
    const state = emptyState({
      failures: [{ signature: 'y', count: 3, lastSeen: Date.now(), progressing: false }],
    });
    const before = state.signals.length;
    extractSignals(state, toolEvent(['a.ts']), makeConfig());
    expect(state.signals.length).toBe(before); // caller accumulates
  });
});

// ---------------------------------------------------------------------------
// T4.6 — PRD Scenarios §32–37
// ---------------------------------------------------------------------------

describe('PRD scenarios', () => {
  /**
   * Scenario A (§32): Normal work — agent edits files related to intent.
   * Expected: no concerning signals.
   */
  it('Scenario A — normal work → no concerning signals', () => {
    const state = emptyState({
      originalIntent: 'add rate limiting to the API',
      actions: makeActions([
        ['src/api/rate-limit.ts'],
        ['src/api/middleware.ts'],
        ['tests/rate-limit.test.ts'],
      ]),
    });
    const signals = extractSignals(state, toolEvent(['src/api/rate-limit.ts']), makeConfig());
    const concerning = signals.filter((s) => s.severity > 0.5);
    expect(concerning).toHaveLength(0);
  });

  /**
   * Scenario B (§33): Uncertainty — agent jumps between unrelated modules.
   * Expected: UNCERTAINTY signal, low severity.
   */
  it('Scenario B — uncertainty → UNCERTAINTY signal', () => {
    const manyDirActions = makeActions([
      ['src/api/a.ts'], ['db/schema.sql'], ['infra/deploy.sh'], ['docs/api.md'],
      ['scripts/build.sh'], ['tests/e2e/login.ts'], ['config/env.ts'], ['src/auth/b.ts'],
      ['frontend/App.tsx'], ['src/billing/c.ts'],
    ]);
    const state = emptyState({ actions: manyDirActions });
    const signals = extractSignals(state, toolEvent(['src/notifications/d.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'UNCERTAINTY')).toBe(true);
    const sig = signals.find((s) => s.type === 'UNCERTAINTY')!;
    expect(sig.severity).toBeLessThan(0.7); // low-to-medium on first detection
  });

  /**
   * Scenario C (§34): Task drift — agent working on billing when intent is auth fix.
   * Expected: TASK_DRIFT signal.
   */
  it('Scenario C — task drift → TASK_DRIFT signal', () => {
    const state = emptyState({
      originalIntent: 'fix authentication token expiry bug',
      actions: makeActions([
        ['src/auth/token.ts'], ['src/auth/session.ts'], ['tests/auth.test.ts'],
        ['src/auth/middleware.ts'], ['src/auth/verify.ts'],
      ]),
    });
    // Agent starts touching billing
    const signals = extractSignals(state, toolEvent(['src/billing/payment.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'TASK_DRIFT')).toBe(true);
  });

  /**
   * Scenario D (§35): Stuck — same test failing repeatedly.
   * Expected: REPEATED_FAILURE signal.
   */
  it('Scenario D — stuck → REPEATED_FAILURE signal', () => {
    const state = emptyState({
      failures: [
        { signature: 'auth-token-expiry.test', count: 4, lastSeen: Date.now(), progressing: false },
      ],
    });
    const signals = extractSignals(state, toolEvent(['src/auth/token.ts']), makeConfig());
    expect(signals.some((s) => s.type === 'REPEATED_FAILURE')).toBe(true);
    const sig = signals.find((s) => s.type === 'REPEATED_FAILURE')!;
    expect(sig.detail).toContain('auth-token-expiry.test');
  });

  /**
   * Scenario E (§36): High-impact change — agent touches auth or migration files.
   * Expected: HIGH_IMPACT_CHANGE signal.
   */
  it('Scenario E — high-impact change → HIGH_IMPACT_CHANGE signal', () => {
    const state = emptyState();
    const signals = extractSignals(state, toolEvent(['db/migrations/020_drop_users.sql']), makeConfig());
    expect(signals.some((s) => s.type === 'HIGH_IMPACT_CHANGE')).toBe(true);
  });

  /**
   * Scenario F (§37): Legitimate scope expansion — agent touches new dirs after initial phase.
   * Expected: SCOPE_EXPANSION signal at low severity initially.
   */
  it('Scenario F — scope expansion → SCOPE_EXPANSION signal at low initial severity', () => {
    const initial = makeActions([
      ['src/api/a.ts'], ['src/api/b.ts'], ['src/api/c.ts'], ['src/api/d.ts'], ['src/api/e.ts'],
    ]);
    const expanded = makeActions([
      ['tests/api/a.test.ts'], ['docs/api.md'], ['infra/deploy.sh'],
    ]);
    const state = emptyState({
      actions: [...initial, ...expanded],
    });
    const signals = extractSignals(state, toolEvent(['scripts/setup.sh']), makeConfig());
    const scopeSig = signals.find((s) => s.type === 'SCOPE_EXPANSION');
    expect(scopeSig).toBeDefined();
    expect(scopeSig!.severity).toBeLessThan(0.5); // low on first detection
  });
});
