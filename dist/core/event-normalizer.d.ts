/**
 * src/core/event-normalizer.ts
 *
 * Parses raw Bob hook JSON payloads from stdin and produces typed NormalizedEvents.
 * Handles malformed input gracefully (fail-open — returns null instead of throwing).
 *
 * PRD §19: Event Tracking — normalized representation decouples the rest
 * of Bobtention from raw hook payload formats.
 */
import type { NormalizedEvent, ToolEvent, TestResultEvent, PromptEvent, SessionInitEvent, LifecycleEvent } from '../types';
/**
 * Read all of stdin into a string.
 * Returns empty string if stdin is not a pipe (e.g., during dev/test with no pipe).
 */
export declare function readStdin(): Promise<string>;
export declare function normalizeSessionStart(raw: string): SessionInitEvent | null;
export declare function normalizeUserPrompt(raw: string): PromptEvent | null;
export declare function normalizePreToolUse(raw: string): ToolEvent | null;
export declare function normalizePostToolUse(raw: string): ToolEvent | null;
export declare function normalizeStop(raw: string): LifecycleEvent | null;
export declare function extractEmbeddedTestResult(event: ToolEvent): TestResultEvent | null;
export type { NormalizedEvent };
//# sourceMappingURL=event-normalizer.d.ts.map