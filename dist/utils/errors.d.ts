/**
 * src/utils/errors.ts
 *
 * Fail-open error wrapper for all hook entry points.
 *
 * Rule (AGENTS.md): A thrown exception must produce exit 0 + stderr log — never exit 2.
 * PostToolUse / SessionStart / Stop must NEVER exit 2.
 * Only PreToolUse and UserPromptSubmit may exit 2, and only as an intentional BLOCK.
 */
/**
 * Wraps a hook body function in a try/catch.
 * On error: logs to stderr and exits 0 (fail-open).
 * Normal path: exits with whatever code the body returns (0 or 2).
 */
export declare function runHook(hookName: string, body: () => Promise<number>): Promise<void>;
//# sourceMappingURL=errors.d.ts.map