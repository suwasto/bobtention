import { describe, it, expect } from 'vitest';
import {
  normalizeSessionStart,
  normalizeUserPrompt,
  normalizePreToolUse,
  normalizePostToolUse,
  normalizeStop,
  extractEmbeddedTestResult,
} from '../../src/core/event-normalizer';

// ---------------------------------------------------------------------------
// Session Start
// ---------------------------------------------------------------------------

describe('normalizeSessionStart', () => {
  it('parses a valid session start payload', () => {
    const raw = JSON.stringify({ session_id: 'abc-123' });
    const event = normalizeSessionStart(raw);
    expect(event).not.toBeNull();
    expect(event?.kind).toBe('session_init');
    expect(event?.sessionId).toBe('abc-123');
  });

  it('returns a fallback event for empty input (fail-open)', () => {
    const event = normalizeSessionStart('');
    expect(event).not.toBeNull();
    expect(event?.kind).toBe('session_init');
    expect(event?.sessionId).toMatch(/^session-/);
  });

  it('returns a fallback event for malformed JSON (fail-open)', () => {
    const event = normalizeSessionStart('{not json}');
    expect(event).not.toBeNull();
    expect(event?.kind).toBe('session_init');
  });

  it('generates a fallback session ID when session_id is missing', () => {
    const event = normalizeSessionStart(JSON.stringify({ other_field: 'x' }));
    expect(event?.sessionId).toMatch(/^session-\d+/);
  });
});

// ---------------------------------------------------------------------------
// User Prompt Submit
// ---------------------------------------------------------------------------

describe('normalizeUserPrompt', () => {
  it('parses a valid prompt payload', () => {
    const raw = JSON.stringify({ prompt: 'Implement OAuth login', session_id: 'sess-1' });
    const event = normalizeUserPrompt(raw);
    expect(event?.kind).toBe('prompt');
    expect(event?.text).toBe('Implement OAuth login');
  });

  it('returns null for malformed JSON (fail-open)', () => {
    const event = normalizeUserPrompt('{bad json}');
    expect(event).toBeNull();
  });

  it('returns null for empty input', () => {
    const event = normalizeUserPrompt('');
    expect(event).toBeNull();
  });

  it('handles missing prompt field — returns event with empty text', () => {
    const event = normalizeUserPrompt(JSON.stringify({ session_id: 'x' }));
    expect(event?.kind).toBe('prompt');
    expect(event?.text).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Pre-Tool Use
// ---------------------------------------------------------------------------

describe('normalizePreToolUse', () => {
  it('parses tool name and file path from edit tool payload', () => {
    const payload = {
      tool_name: 'write_file',
      tool_input: { path: 'src/auth.ts', content: '...' },
      session_id: 'sess-1',
    };
    const event = normalizePreToolUse(JSON.stringify(payload));
    expect(event?.kind).toBe('tool');
    expect(event?.tool).toBe('write_file');
    expect(event?.files).toContain('src/auth.ts');
  });

  it('parses multiple file paths', () => {
    const payload = {
      tool_name: 'apply_diff',
      tool_input: { path: 'src/api.ts' },
    };
    const event = normalizePreToolUse(JSON.stringify(payload));
    expect(event?.files).toContain('src/api.ts');
  });

  it('returns null for malformed JSON (fail-open)', () => {
    const event = normalizePreToolUse('{{bad}}');
    expect(event).toBeNull();
  });

  it('returns null for empty input', () => {
    const event = normalizePreToolUse('');
    expect(event).toBeNull();
  });

  it('uses "unknown" as tool name when tool_name field missing', () => {
    const event = normalizePreToolUse(JSON.stringify({ tool_input: {} }));
    expect(event?.tool).toBe('unknown');
  });

  it('returns empty files array when no path fields found', () => {
    const payload = { tool_name: 'list_files', tool_input: { directory: 'src/' } };
    const event = normalizePreToolUse(JSON.stringify(payload));
    expect(event?.files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Post-Tool Use
// ---------------------------------------------------------------------------

describe('normalizePostToolUse', () => {
  it('parses tool name and attaches output', () => {
    const payload = {
      tool_name: 'bash',
      tool_input: {},
      tool_response: { output: 'Done', error: '' },
    };
    const event = normalizePostToolUse(JSON.stringify(payload));
    expect(event?.kind).toBe('tool');
    expect(event?.tool).toBe('bash');
    expect(event?.output).toBeDefined();
  });

  it('returns null for empty input', () => {
    const event = normalizePostToolUse('');
    expect(event).toBeNull();
  });

  it('detects a failed test from bash output', () => {
    const payload = {
      tool_name: 'bash',
      tool_input: { command: 'npm test' },
      tool_response: {
        output: '✗ AuthService.test > login > should return token\n2 tests failed',
      },
    };
    const event = normalizePostToolUse(JSON.stringify(payload));
    expect(event).not.toBeNull();
    const testResult = extractEmbeddedTestResult(event!);
    expect(testResult?.kind).toBe('test');
    expect(testResult?.result).toBe('failed');
  });

  it('detects a passed test from bash output', () => {
    const payload = {
      tool_name: 'bash',
      tool_input: { command: 'npm test' },
      tool_response: { output: '5 tests passed' },
    };
    const event = normalizePostToolUse(JSON.stringify(payload));
    expect(event).not.toBeNull();
    const testResult = extractEmbeddedTestResult(event!);
    expect(testResult?.kind).toBe('test');
    expect(testResult?.result).toBe('passed');
  });

  it('returns no embedded test result when output has no test pattern', () => {
    const payload = {
      tool_name: 'write_file',
      tool_input: { path: 'foo.ts' },
      tool_response: { output: 'File written' },
    };
    const event = normalizePostToolUse(JSON.stringify(payload));
    expect(extractEmbeddedTestResult(event!)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

describe('normalizeStop', () => {
  it('parses a stop payload', () => {
    const raw = JSON.stringify({ session_id: 'sess-99' });
    const event = normalizeStop(raw);
    expect(event?.kind).toBe('stop');
    expect(event?.sessionId).toBe('sess-99');
  });

  it('returns a fallback stop event for empty input', () => {
    const event = normalizeStop('');
    expect(event?.kind).toBe('stop');
    expect(event?.sessionId).toBe('');
  });

  it('returns a fallback stop event for malformed JSON', () => {
    const event = normalizeStop('{broken}');
    expect(event?.kind).toBe('stop');
  });
});
