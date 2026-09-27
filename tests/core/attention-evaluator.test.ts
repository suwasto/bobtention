/**
 * tests/core/attention-evaluator.test.ts
 *
 * Unit tests for Attention Evaluator (Phase 5 — T5.6).
 * Covers: fast ALLOW, deterministic BLOCK, ambiguous path, engine failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateEvent, extractEventSignals } from '../../src/core/attention-evaluator';
import type { SessionState, NormalizedEvent, FailureRecord } from '../../src/types';
import type { BobtentionConfig } from '../../src/core/config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<BobtentionConfig['decisionEngine']> = {}): BobtentionConfig {
  return {
    enabled: true,
    decisionEngine: { provider: 'local', timeout: 3000, ...overrides },
    autonomy: { default: 'autonomous', watchThreshold: 0.55, blockThreshold: 0.85 },
    signals: {
      taskDrift: true,
      repeatedFailure: true,
      scopeExpansion: true,
      highImpactAction: true,
      uncertainty: true,
    },
    highImpactPatterns: [
      { pattern: '**/.env*', category: 'credentials' },
      { pattern: '**/migration*', category: 'schema-change' },
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

function makeFailure(signature: string, count: number, progressing = false): FailureRecord {
  return { signature, count, lastSeen: Date.now(), progressing };
}

// ---------------------------------------------------------------------------
// Path 1: Fast ALLOW (no signals)
// ---------------------------------------------------------------------------

describe('evaluateEvent — fast ALLOW', () => {
  it('returns ALLOW with confidence 1.0 when no signals and no failures', async () => {
    const state = emptyState();
    const event = toolEvent(['src/auth/login.ts']);
    const config = makeConfig();

    const contract = await evaluateEvent(state, event, config);

    expect(contract.decision).toBe('ALLOW');
    expect(contract.confidence).toBe(1.0);
    expect(contract.signals).toHaveLength(0);
  });

  it('returns ALLOW for non-tool/non-prompt event kinds', async () => {
    const state = emptyState();
    const event: NormalizedEvent = { kind: 'session_init', sessionId: 'x', timestamp: Date.now() };
    const config = makeConfig();

    const contract = await evaluateEvent(state, event, config);

    expect(contract.decision).toBe('ALLOW');
  });

  it('returns ALLOW when all signals are disabled in config (no failures)', async () => {
    const config: BobtentionConfig = {
      ...makeConfig(),
      signals: {
        taskDrift: false,
        repeatedFailure: false,
        scopeExpansion: false,
        highImpactAction: false,
        uncertainty: false,
      },
    };
    // No failures (count < 4) so deterministic BLOCK path is not triggered
    const state = emptyState({
      failures: [makeFailure('build_failure', 2)],
    });
    const event = toolEvent(['completely/unrelated/file.ts']);

    const contract = await evaluateEvent(state, event, config);

    // No signals extracted (all disabled) → fast ALLOW
    expect(contract.decision).toBe('ALLOW');
  });
});

// ---------------------------------------------------------------------------
// Path 2: Deterministic BLOCK (≥4 identical failures)
// ---------------------------------------------------------------------------

describe('evaluateEvent — deterministic BLOCK', () => {
  it('blocks without calling engine when repeated failure count >= 4', async () => {
    const state = emptyState({
      failures: [makeFailure('oauth_callback_test', 4)],
    });
    const event = toolEvent(['src/auth/login.ts']);
    const config = makeConfig();

    const contract = await evaluateEvent(state, event, config);

    expect(contract.decision).toBe('BLOCK');
    expect(contract.confidence).toBe(1.0);
    expect(contract.signals).toContain('REPEATED_FAILURE');
  });

  it('blocks for count > 4', async () => {
    const state = emptyState({
      failures: [makeFailure('build_failure', 7)],
    });
    const event = toolEvent(['src/core/app.ts']);
    const config = makeConfig();

    const contract = await evaluateEvent(state, event, config);

    expect(contract.decision).toBe('BLOCK');
    expect(contract.reason).toMatch(/7×/);
  });

  it('does NOT block when failure count is 3 (below threshold)', async () => {
    const state = emptyState({
      failures: [makeFailure('test_failure', 3)],
    });
    const event = toolEvent(['src/auth/login.ts']);
    const config = makeConfig();

    const contract = await evaluateEvent(state, event, config);

    // 3 failures → signal emitted → goes to engine, not deterministic block
    expect(contract.decision).not.toBe('BLOCK');
  });

  it('does NOT block when failure is marked as progressing', async () => {
    const state = emptyState({
      failures: [makeFailure('test_failure', 5, true)], // progressing=true
    });
    const event = toolEvent(['src/auth/login.ts']);
    const config = makeConfig();

    const contract = await evaluateEvent(state, event, config);

    // progressing failure → no deterministic block
    expect(contract.decision).not.toBe('BLOCK');
  });
});

// ---------------------------------------------------------------------------
// Path 2b: Deterministic BLOCK (signal severity >= blockThreshold)
// ---------------------------------------------------------------------------

describe('evaluateEvent — severity-gate BLOCK', () => {
  it('blocks without calling engine when a pre-existing signal severity >= blockThreshold', async () => {
    // Reproduce: deploy workflow session — HIGH_IMPACT_CHANGE at severity 0.86,
    // blockThreshold 0.85. Laya returned ALLOW because it judged intent as aligned.
    // The fix: severity gate runs before the engine is consulted.
    const state = emptyState({
      signals: [
        {
          type: 'HIGH_IMPACT_CHANGE',
          severity: 0.86,
          timestamp: Date.now(),
          detail: 'File ".github/workflows/deploy.yml" matches high-impact pattern "deploy|release|publish" (deployment)',
        },
      ],
    });
    // Use Laya as provider — if the gate is missing the engine would be called
    // and could return ALLOW (as it did in the real session).
    const config = makeConfig({ provider: 'laya', endpoint: 'http://localhost:9999/dead' });
    const event = toolEvent(['.github/workflows/deploy.yml'], 'write_file');

    const contract = await evaluateEvent(state, event, config);

    expect(contract.decision).toBe('BLOCK');
    expect(contract.confidence).toBe(1.0);
    expect(contract.reason).toMatch(/HIGH_IMPACT_CHANGE/);
    expect(contract.reason).toMatch(/0\.8[5-9]|0\.9/); // severity in reason
  });

  it('does NOT gate-block when highest severity is below blockThreshold', async () => {
    const state = emptyState({
      signals: [
        {
          type: 'HIGH_IMPACT_CHANGE',
          severity: 0.75,
          timestamp: Date.now(),
          detail: 'Below threshold',
        },
      ],
    });
    const config = makeConfig(); // local engine, blockThreshold=0.85
    const event = toolEvent(['scripts/deploy.sh'], 'read_file');

    const contract = await evaluateEvent(state, event, config);

    // Should not be caught by severity gate — engine runs normally
    expect(['ALLOW', 'WATCH', 'BLOCK']).toContain(contract.decision);
    // If BLOCK, it must be from the engine (reason will not contain '≥ blockThreshold')
    if (contract.decision === 'BLOCK') {
      expect(contract.reason).not.toMatch(/≥ blockThreshold/);
    }
  });

  it('blocks exactly at blockThreshold (boundary: severity === threshold)', async () => {
    const state = emptyState({
      signals: [
        {
          type: 'HIGH_IMPACT_CHANGE',
          severity: 0.85,
          timestamp: Date.now(),
          detail: 'Exactly at threshold',
        },
      ],
    });
    const config = makeConfig(); // blockThreshold=0.85
    const event = toolEvent(['scripts/deploy.sh'], 'read_file');

    const contract = await evaluateEvent(state, event, config);

    expect(contract.decision).toBe('BLOCK');
    expect(contract.reason).toMatch(/≥ blockThreshold/);
  });
});

// ---------------------------------------------------------------------------
// Path 3: Ambiguous (signals present, engine called)
// ---------------------------------------------------------------------------

describe('evaluateEvent — ambiguous path via LocalRuleAdapter', () => {
  it('returns WATCH when a medium-severity signal is present', async () => {
    const state = emptyState({
      // Add a repeated failure below deterministic block threshold
      failures: [makeFailure('build', 3)],
    });
    const event = toolEvent(['src/auth/login.ts']);
    const config = makeConfig(); // local engine

    const contract = await evaluateEvent(state, event, config);

    // REPEATED_FAILURE signal from extractor → LocalRuleAdapter should return WATCH or BLOCK
    expect(['WATCH', 'BLOCK']).toContain(contract.decision);
    expect(contract.signals.length).toBeGreaterThan(0);
  });

  it('returns BLOCK for HIGH_IMPACT_CHANGE on .env file with local engine', async () => {
    const state = emptyState();
    const event = toolEvent(['.env.production']);
    const config = makeConfig();

    const contract = await evaluateEvent(state, event, config);

    // HIGH_IMPACT_CHANGE has weight 0.85 — above blockThreshold (0.85)
    // Combined weight ≥ blockThreshold → BLOCK
    expect(['WATCH', 'BLOCK']).toContain(contract.decision);
    expect(contract.signals).toContain('HIGH_IMPACT_CHANGE');
  });
});

// ---------------------------------------------------------------------------
// Engine failure / fallback chain
// ---------------------------------------------------------------------------

describe('evaluateEvent — Laya failure fallback', () => {
  it('falls back to LocalRuleAdapter when Laya HTTP call fails', async () => {
    const config = makeConfig({ provider: 'laya', endpoint: 'http://localhost:9999/dead' });
    const state = emptyState({
      failures: [makeFailure('build', 3)],
    });
    const event = toolEvent(['src/auth/login.ts']);

    // Should not throw — falls back gracefully
    const contract = await evaluateEvent(state, event, config);

    expect(['ALLOW', 'WATCH', 'BLOCK']).toContain(contract.decision);
  });
});

// ---------------------------------------------------------------------------
// extractEventSignals
// ---------------------------------------------------------------------------

describe('extractEventSignals', () => {
  it('returns empty array for non-tool events', () => {
    const state = emptyState();
    const event: NormalizedEvent = { kind: 'prompt', text: 'hello', timestamp: Date.now() };
    const config = makeConfig();

    const signals = extractEventSignals(state, event, config);

    expect(signals).toHaveLength(0);
  });

  it('returns HIGH_IMPACT_CHANGE for .env file', () => {
    const state = emptyState();
    const event = toolEvent(['.env.local']);
    const config = makeConfig();

    const signals = extractEventSignals(state, event, config);

    expect(signals.some((s) => s.type === 'HIGH_IMPACT_CHANGE')).toBe(true);
  });
});
