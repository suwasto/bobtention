/**
 * src/utils/errors.ts
 *
 * Fail-open error wrapper for all hook entry points.
 *
 * Rule (AGENTS.md): A thrown exception must produce exit 0 + stderr log — never exit 2.
 * PostToolUse / SessionStart / Stop must NEVER exit 2.
 * Only PreToolUse and UserPromptSubmit may exit 2, and only as an intentional BLOCK.
 */

import { logger } from './logger';

/**
 * Wraps a hook body function in a try/catch.
 * On error: logs to stderr and exits 0 (fail-open).
 * Normal path: exits with whatever code the body returns (0 or 2).
 */
export async function runHook(
  hookName: string,
  body: () => Promise<number>,
): Promise<void> {
  let exitCode = 0;
  try {
    exitCode = await body();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error(`[bobtention] Internal error in ${hookName}: ${message}`, stack);
    // Fail-open: never surface an internal crash as exit 2 (BLOCK)
    exitCode = 0;
  }
  process.exit(exitCode);
}
