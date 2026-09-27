import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig, resetConfigCache } from '../../src/core/config';
import type { BobtentionConfig } from '../../src/core/config';

describe('loadConfig', () => {
  beforeEach(() => {
    resetConfigCache();
  });

  it('returns a complete typed config when no config file exists', () => {
    const config = loadConfig();
    expect(config.enabled).toBe(true);
    expect(config.decisionEngine.provider).toBe('laya');
    expect(config.decisionEngine.endpoint).toBe('http://localhost:8000/v1/systemone');
    expect(config.decisionEngine.timeout).toBe(3000);
    expect(config.autonomy.watchThreshold).toBe(0.55);
    expect(config.autonomy.blockThreshold).toBe(0.85);
    expect(config.signals.taskDrift).toBe(true);
    expect(config.session.maxActions).toBe(50);
    expect(config.session.storagePath).toContain('.bobtention');
    expect(config.highImpactPatterns.length).toBeGreaterThan(0);
    expect(config.humanOverride.enabled).toBe(true);
  });

  it('returns the same object on repeated calls (cached)', () => {
    const a = loadConfig();
    const b = loadConfig();
    expect(a).toBe(b);
  });

  it('returns a fresh object after resetConfigCache()', () => {
    const a = loadConfig();
    resetConfigCache();
    const b = loadConfig(true);
    expect(a).not.toBe(b);
  });

  it('autonomy.default is always "autonomous"', () => {
    const config = loadConfig();
    expect(config.autonomy.default).toBe('autonomous');
  });

  it('all signal flags are present and boolean', () => {
    const config = loadConfig();
    const { signals } = config;
    const flags: (keyof typeof signals)[] = [
      'taskDrift',
      'repeatedFailure',
      'scopeExpansion',
      'highImpactAction',
      'uncertainty',
    ];
    for (const flag of flags) {
      expect(typeof signals[flag]).toBe('boolean');
    }
  });

  it('highImpactPatterns each have pattern and category strings', () => {
    const { highImpactPatterns } = loadConfig();
    for (const entry of highImpactPatterns) {
      expect(typeof entry.pattern).toBe('string');
      expect(typeof entry.category).toBe('string');
    }
  });
});

describe('Type shape verification', () => {
  it('DecisionContract fields compile and are assignable', () => {
    // Compile-time check: if this file compiles, the types are correct.
    const contract: import('../../src/types').DecisionContract = {
      decision: 'BLOCK',
      confidence: 0.9,
      reason: 'Test reason',
      signals: ['TASK_DRIFT'],
      summary: 'Optional summary',
    };
    expect(contract.decision).toBe('BLOCK');
    expect(contract.signals).toContain('TASK_DRIFT');
  });

  it('SessionState has all required fields', () => {
    const state: import('../../src/types').SessionState = {
      sessionId: 'test-session',
      originalIntent: 'Implement feature X',
      startTime: Date.now(),
      status: 'active',
      actions: [],
      tests: [],
      failures: [],
      signals: [],
      decisions: [],
      overrides: [],
    };
    expect(state.originalIntent).toBe('Implement feature X');
    expect(state.status).toBe('active');
  });

  it('Override scope is always next_action', () => {
    const override: import('../../src/types').Override = {
      active: true,
      reason: 'Human approved',
      scope: 'next_action',
    };
    expect(override.scope).toBe('next_action');
  });

  it('DecisionContext shape is assignable', () => {
    const ctx: import('../../src/types').DecisionContext = {
      intent: 'Fix authentication',
      currentAction: { tool: 'edit', files: ['auth.ts'] },
      recentActions: [{ type: 'read', files: ['auth.ts'] }],
      failures: [{ signature: 'AuthError', count: 3, progressing: false }],
      signals: [{ type: 'REPEATED_FAILURE', severity: 0.75, timestamp: Date.now(), detail: 'AuthError failed 3×' }],
    };
    expect(ctx.intent).toBeTruthy();
    expect(ctx.failures[0].count).toBe(3);
    expect(ctx.signals[0].type).toBe('REPEATED_FAILURE');
  });
});
