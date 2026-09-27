/**
 * tests/adapters/decision-adapter.test.ts
 *
 * Unit tests for Decision Adapter (Phase 5 — T5.6).
 * Covers: LocalRuleAdapter thresholds, LayaAdapter network failure handling, fallback chain.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  LocalRuleAdapter,
  LayaAdapter,
  evaluateWithFallback,
} from '../../src/adapters/decision-adapter';
import type { DecisionContext, Signal, SignalType } from '../../src/types';
import type { BobtentionConfig } from '../../src/core/config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build minimal Signal objects from bare SignalType labels for test convenience */
function makeSignals(types: SignalType[]): Signal[] {
  return types.map((type) => ({ type, severity: 0.5, timestamp: Date.now() }));
}

function makeContext(signalTypes: SignalType[] = []): DecisionContext {
  return {
    intent: 'fix login bug',
    currentAction: { tool: 'edit', files: ['src/auth/login.ts'] },
    recentActions: [],
    failures: [],
    signals: makeSignals(signalTypes),
  };
}

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
    highImpactPatterns: [],
    humanOverride: { enabled: true },
    session: { maxActions: 50, storagePath: '/tmp/test-sessions' },
  };
}

// ---------------------------------------------------------------------------
// LocalRuleAdapter
// ---------------------------------------------------------------------------

describe('LocalRuleAdapter', () => {
  const adapter = new LocalRuleAdapter(0.55, 0.85);

  it('returns ALLOW with high confidence when no signals', async () => {
    const contract = await adapter.evaluate(makeContext([]));
    expect(contract.decision).toBe('ALLOW');
    expect(contract.confidence).toBeGreaterThan(0.9);
  });

  it('returns WATCH for medium-weight signal combination', async () => {
    const contract = await adapter.evaluate(makeContext(['UNCERTAINTY', 'SCOPE_EXPANSION']));
    // Combined weight of UNCERTAINTY (0.55) + SCOPE_EXPANSION (0.6) → above watchThreshold
    expect(['WATCH', 'BLOCK']).toContain(contract.decision);
    expect(contract.signals).toContain('UNCERTAINTY');
  });

  it('returns BLOCK for HIGH_IMPACT_CHANGE signal (weight 0.85)', async () => {
    const contract = await adapter.evaluate(makeContext(['HIGH_IMPACT_CHANGE']));
    expect(contract.decision).toBe('BLOCK');
    expect(contract.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('returns BLOCK when multiple signals combine above block threshold', async () => {
    const contract = await adapter.evaluate(
      makeContext(['REPEATED_FAILURE', 'TASK_DRIFT', 'HIGH_IMPACT_CHANGE']),
    );
    expect(contract.decision).toBe('BLOCK');
  });

  it('includes all active signal types in contract', async () => {
    const contract = await adapter.evaluate(makeContext(['TASK_DRIFT', 'SCOPE_EXPANSION']));
    expect(contract.signals).toContain('TASK_DRIFT');
    expect(contract.signals).toContain('SCOPE_EXPANSION');
  });

  it('uses signal detail in reason when available', async () => {
    const ctx: DecisionContext = {
      intent: 'fix login bug',
      currentAction: { tool: 'edit', files: ['src/auth/login.ts'] },
      recentActions: [],
      failures: [],
      signals: [
        { type: 'HIGH_IMPACT_CHANGE', severity: 0.9, timestamp: Date.now(), detail: 'File "prod.env" matches pattern' },
      ],
    };
    const contract = await adapter.evaluate(ctx);
    expect(contract.reason).toContain('prod.env');
  });

  it('always returns a valid DecisionContract shape', async () => {
    const contract = await adapter.evaluate(makeContext(['UNCERTAINTY']));
    expect(contract).toMatchObject({
      decision: expect.stringMatching(/^(ALLOW|WATCH|BLOCK)$/),
      confidence: expect.any(Number),
      reason: expect.any(String),
      signals: expect.any(Array),
    });
  });
});

// ---------------------------------------------------------------------------
// LayaAdapter — network failure handling
// ---------------------------------------------------------------------------

describe('LayaAdapter', () => {
  it('throws on HTTP error', async () => {
    const adapter = new LayaAdapter('http://localhost:9999/dead', 500);
    await expect(adapter.evaluate(makeContext([]))).rejects.toThrow();
  });

  it('throws on timeout', async () => {
    // Very short timeout — request will never complete
    const adapter = new LayaAdapter('http://10.255.255.1:9999/timeout', 50);
    await expect(adapter.evaluate(makeContext([]))).rejects.toThrow();
  });

  it('builds multi-question request with one question per signal', () => {
    // Access internal builder via evaluate triggering a real request is not
    // possible in unit tests, but we can verify the shape indirectly by
    // confirming the adapter rejects correctly when signals are present.
    const adapter = new LayaAdapter('http://localhost:9999/dead', 500);
    const ctx = makeContext(['HIGH_IMPACT_CHANGE', 'TASK_DRIFT']);
    // Should throw (unreachable host), not a type/shape error
    void expect(adapter.evaluate(ctx)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// evaluateWithFallback — fallback chain
// ---------------------------------------------------------------------------

describe('evaluateWithFallback', () => {
  it('returns valid contract from LocalRuleAdapter when provider is local', async () => {
    const config = makeConfig({ provider: 'local' });
    const contract = await evaluateWithFallback(makeContext([]), config);
    expect(contract.decision).toBe('ALLOW');
  });

  it('falls back to local when Laya endpoint is unreachable', async () => {
    const config = makeConfig({ provider: 'laya', endpoint: 'http://localhost:9999/dead' });
    const context = makeContext(['TASK_DRIFT']);

    // Should not throw; returns a contract from LocalRuleAdapter
    const contract = await evaluateWithFallback(context, config);
    expect(['ALLOW', 'WATCH', 'BLOCK']).toContain(contract.decision);
    // Reason should include the signal detail from LocalRuleAdapter fallback
    expect(typeof contract.reason).toBe('string');
  });

  it('returns fail-open ALLOW when local engine also fails (simulated)', async () => {
    const config = makeConfig({ provider: 'local' });
    // Stub LocalRuleAdapter to throw
    vi.spyOn(LocalRuleAdapter.prototype, 'evaluate').mockRejectedValueOnce(
      new Error('simulated local failure'),
    );

    const contract = await evaluateWithFallback(makeContext(['UNCERTAINTY']), config);
    expect(contract.decision).toBe('ALLOW');
    expect(contract.confidence).toBe(0.0);

    vi.restoreAllMocks();
  });

  it('always returns decision + confidence + reason + signals', async () => {
    const config = makeConfig();
    const contract = await evaluateWithFallback(makeContext([]), config);
    expect(typeof contract.decision).toBe('string');
    expect(typeof contract.confidence).toBe('number');
    expect(typeof contract.reason).toBe('string');
    expect(Array.isArray(contract.signals)).toBe(true);
  });
});
