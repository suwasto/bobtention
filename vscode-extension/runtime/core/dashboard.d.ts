/**
 * src/core/dashboard.ts
 *
 * Dashboard generator — writes .bobtention/dashboard.html next to the session
 * JSON files after every persistState call.
 *
 * The HTML is fully self-contained (no external deps). It reads the session
 * data embedded as a JSON literal in a <script> tag so it works as a plain
 * file:// URL with no server.
 *
 * Design:
 *  - One HTML file per workspace, auto-regenerated on every state mutation.
 *  - Atomic write (temp + rename) — same pattern as session-manager.
 *  - Never throws — dashboard generation failure must not break the hook.
 */
import type { SessionState } from '../types';
/**
 * Regenerate the dashboard HTML for the given storage directory.
 * Reads all session files in the directory, merges them, writes dashboard.html.
 *
 * Called by session-manager after every persistState.
 */
export declare function regenerateDashboard(storageDir: string, currentState: SessionState): void;
//# sourceMappingURL=dashboard.d.ts.map