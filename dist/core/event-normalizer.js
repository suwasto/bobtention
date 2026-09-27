"use strict";
/**
 * src/core/event-normalizer.ts
 *
 * Parses raw Bob hook JSON payloads from stdin and produces typed NormalizedEvents.
 * Handles malformed input gracefully (fail-open — returns null instead of throwing).
 *
 * PRD §19: Event Tracking — normalized representation decouples the rest
 * of Bobtention from raw hook payload formats.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readStdin = readStdin;
exports.normalizeSessionStart = normalizeSessionStart;
exports.normalizeUserPrompt = normalizeUserPrompt;
exports.normalizePreToolUse = normalizePreToolUse;
exports.normalizePostToolUse = normalizePostToolUse;
exports.normalizeStop = normalizeStop;
exports.extractEmbeddedTestResult = extractEmbeddedTestResult;
const logger_1 = require("../utils/logger");
// ---------------------------------------------------------------------------
// Stdin reader
// ---------------------------------------------------------------------------
/**
 * Read all of stdin into a string.
 * Returns empty string if stdin is not a pipe (e.g., during dev/test with no pipe).
 */
async function readStdin() {
    return new Promise((resolve) => {
        if (!process.stdin.isTTY) {
            let data = '';
            process.stdin.setEncoding('utf-8');
            process.stdin.on('data', (chunk) => {
                data += chunk;
            });
            process.stdin.on('end', () => resolve(data));
            process.stdin.on('error', () => resolve(''));
        }
        else {
            resolve('');
        }
    });
}
// ---------------------------------------------------------------------------
// Generic JSON parse helper
// ---------------------------------------------------------------------------
function parseJson(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// Per-hook normalizers
// ---------------------------------------------------------------------------
function normalizeSessionStart(raw) {
    const payload = parseJson(raw);
    if (!payload) {
        logger_1.logger.warn('[event-normalizer] SessionStart: could not parse payload, using fallback');
    }
    return {
        kind: 'session_init',
        sessionId: payload?.session_id ?? generateFallbackId(),
        timestamp: Date.now(),
    };
}
function normalizeUserPrompt(raw) {
    const payload = parseJson(raw);
    if (!payload) {
        logger_1.logger.warn('[event-normalizer] UserPromptSubmit: could not parse payload');
        return null;
    }
    const text = payload.prompt ?? '';
    if (!text) {
        logger_1.logger.warn('[event-normalizer] UserPromptSubmit: prompt field missing or empty');
    }
    return {
        kind: 'prompt',
        text,
        timestamp: Date.now(),
    };
}
function normalizePreToolUse(raw) {
    const payload = parseJson(raw);
    if (!payload) {
        logger_1.logger.warn('[event-normalizer] PreToolUse: could not parse payload');
        return null;
    }
    return buildToolEvent(payload);
}
function normalizePostToolUse(raw) {
    const payload = parseJson(raw);
    if (!payload) {
        logger_1.logger.warn('[event-normalizer] PostToolUse: could not parse payload');
        return null;
    }
    const event = buildToolEvent(payload);
    // Attach output if present
    if (payload.tool_response) {
        event.output = payload.tool_response;
    }
    // Check for test result embedded in output
    const testEvent = extractTestResult(payload);
    if (testEvent) {
        // Return tool event; caller can separately check for embedded test result
        event.output = { ...event.output, _testResult: testEvent };
    }
    return event;
}
function normalizeStop(raw) {
    const payload = parseJson(raw);
    return {
        kind: 'stop',
        sessionId: payload?.session_id ?? '',
        timestamp: Date.now(),
    };
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildToolEvent(payload) {
    const tool = payload.tool_name ?? 'unknown';
    const input = payload.tool_input ?? {};
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
function extractFiles(tool, input) {
    const candidates = [];
    // Common field names across Bob tools
    const fileFields = ['path', 'file_path', 'file', 'filename', 'paths', 'files'];
    for (const field of fileFields) {
        const val = input[field];
        if (typeof val === 'string' && val) {
            candidates.push(val);
        }
        else if (Array.isArray(val)) {
            for (const v of val) {
                if (typeof v === 'string' && v)
                    candidates.push(v);
            }
        }
    }
    // Tool-specific extraction
    if (tool === 'edit' || tool === 'write_file' || tool === 'apply_diff') {
        const p = input['path'];
        if (typeof p === 'string' && p && !candidates.includes(p))
            candidates.push(p);
    }
    // Deduplicate
    return [...new Set(candidates)];
}
/**
 * Attempt to extract a test result from tool output (e.g., bash running tests).
 * This is heuristic — proper test detection happens in the signal extractor.
 */
function extractTestResult(payload) {
    const output = payload.tool_response?.output;
    if (typeof output !== 'string')
        return null;
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
function generateFallbackId() {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
// ---------------------------------------------------------------------------
// Export extracted test result from a normalized PostToolUse event
// ---------------------------------------------------------------------------
function extractEmbeddedTestResult(event) {
    const testResult = event.output?._testResult;
    if (testResult &&
        typeof testResult === 'object' &&
        testResult.kind === 'test') {
        return testResult;
    }
    return null;
}
//# sourceMappingURL=event-normalizer.js.map