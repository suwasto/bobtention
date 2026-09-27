/**
 * src/core/event-normalizer.ts
 *
 * Parses raw Bob hook JSON payloads from stdin and produces typed NormalizedEvents.
 * Handles malformed input gracefully (fail-open — returns null instead of throwing).
 *
 * PRD §19: Event Tracking — normalized representation decouples the rest
 * of Bobtention from raw hook payload formats.
 */

import { logger } from '../utils/logger';
import type {
  NormalizedEvent,
  ToolEvent,
  TestResultEvent,
  PromptEvent,
  SessionInitEvent,
  LifecycleEvent,
  BobSessionStartPayload,
  BobUserPromptPayload,
  BobToolUsePayload,
  BobStopPayload,
} from '../types';

// ---------------------------------------------------------------------------
// Stdin reader
// ---------------------------------------------------------------------------

/**
 * Read all of stdin into a string.
 * Returns empty string if stdin is not a pipe (e.g., during dev/test with no pipe).
 */
export async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      let data = '';
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', (chunk) => {
        data += chunk;
      });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', () => resolve(''));
    } else {
      resolve('');
    }
  });
}

// ---------------------------------------------------------------------------
// Generic JSON parse helper
// ---------------------------------------------------------------------------

function parseJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-hook normalizers
// ---------------------------------------------------------------------------

export function normalizeSessionStart(
  raw: string,
): SessionInitEvent | null {
  const payload = parseJson(raw) as BobSessionStartPayload | null;
  if (!payload) {
    logger.warn('[event-normalizer] SessionStart: could not parse payload, using fallback');
  }
  return {
    kind: 'session_init',
    sessionId: (payload?.session_id as string | undefined) ?? generateFallbackId(),
    timestamp: Date.now(),
  };
}

export function normalizeUserPrompt(raw: string): PromptEvent | null {
  const payload = parseJson(raw) as BobUserPromptPayload | null;
  if (!payload) {
    logger.warn('[event-normalizer] UserPromptSubmit: could not parse payload');
    return null;
  }
  const text = (payload.prompt as string | undefined) ?? '';
  if (!text) {
    logger.warn('[event-normalizer] UserPromptSubmit: prompt field missing or empty');
  }
  return {
    kind: 'prompt',
    text,
    timestamp: Date.now(),
  };
}

export function normalizePreToolUse(raw: string): ToolEvent | null {
  const payload = parseJson(raw) as BobToolUsePayload | null;
  if (!payload) {
    logger.warn('[event-normalizer] PreToolUse: could not parse payload');
    return null;
  }
  return buildToolEvent(payload);
}

export function normalizePostToolUse(raw: string): ToolEvent | null {
  const payload = parseJson(raw) as BobToolUsePayload | null;
  if (!payload) {
    logger.warn('[event-normalizer] PostToolUse: could not parse payload');
    return null;
  }
  const event = buildToolEvent(payload);
  // Attach output if present
  if (payload.tool_response) {
    event.output = payload.tool_response as Record<string, unknown>;
  }

  // Check for test result embedded in output
  const testEvent = extractTestResult(payload);
  if (testEvent) {
    // Return tool event; caller can separately check for embedded test result
    event.output = { ...event.output, _testResult: testEvent };
  }

  return event;
}

export function normalizeStop(raw: string): LifecycleEvent | null {
  const payload = parseJson(raw) as BobStopPayload | null;
  return {
    kind: 'stop',
    sessionId: (payload?.session_id as string | undefined) ?? '',
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildToolEvent(payload: BobToolUsePayload): ToolEvent {
  const tool = (payload.tool_name as string | undefined) ?? 'unknown';
  const input = (payload.tool_input as Record<string, unknown> | undefined) ?? {};
  const files = extractFiles(tool, input);

  return {
    kind: 'tool',
    tool,
    files,
    input,
    timestamp: Date.now(),
  };
}

/**
 * Extract file paths from tool input based on common tool conventions.
 */
function extractFiles(tool: string, input: Record<string, unknown>): string[] {
  const candidates: string[] = [];

  // Common field names across Bob tools
  const fileFields = ['path', 'file_path', 'file', 'filename', 'paths', 'files'];
  for (const field of fileFields) {
    const val = input[field];
    if (typeof val === 'string' && val) {
      candidates.push(val);
    } else if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === 'string' && v) candidates.push(v);
      }
    }
  }

  // Tool-specific extraction
  if (tool === 'edit' || tool === 'write_file' || tool === 'apply_diff') {
    const p = input['path'];
    if (typeof p === 'string' && p && !candidates.includes(p)) candidates.push(p);
  }

  // Deduplicate
  return [...new Set(candidates)];
}

/**
 * Attempt to extract a test result from tool output (e.g., bash running tests).
 * This is heuristic — proper test detection happens in the signal extractor.
 */
function extractTestResult(payload: BobToolUsePayload): TestResultEvent | null {
  const output = payload.tool_response?.output;
  if (typeof output !== 'string') return null;

  // Look for common test runner patterns
  const passPattern = /(\d+ tests? passed|✓|PASS|all tests passed)/i;
  const failPattern = /(\d+ tests? failed|✗|FAIL|test failed)/i;

  if (failPattern.test(output)) {
    // Try to extract test name
    const nameMatch = output.match(/(?:FAIL|✗|×)\s+(.+?)(?:\n|$)/);
    return {
      kind: 'test',
      name: nameMatch?.[1]?.trim() ?? 'unknown',
      result: 'failed',
      timestamp: Date.now(),
    };
  }

  if (passPattern.test(output)) {
    return {
      kind: 'test',
      name: 'test-suite',
      result: 'passed',
      timestamp: Date.now(),
    };
  }

  return null;
}

function generateFallbackId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Export extracted test result from a normalized PostToolUse event
// ---------------------------------------------------------------------------

export function extractEmbeddedTestResult(event: ToolEvent): TestResultEvent | null {
  const testResult = event.output?._testResult;
  if (
    testResult &&
    typeof testResult === 'object' &&
    (testResult as Record<string, unknown>).kind === 'test'
  ) {
    return testResult as TestResultEvent;
  }
  return null;
}

// Re-export NormalizedEvent for convenience
export type { NormalizedEvent };
