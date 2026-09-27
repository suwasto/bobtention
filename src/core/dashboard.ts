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

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import type { SessionState } from '../types';
import { DASHBOARD_HTML } from './dashboard-template';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Regenerate the dashboard HTML for the given storage directory.
 * Reads all session files in the directory, merges them, writes dashboard.html.
 *
 * Called by session-manager after every persistState.
 */
export function regenerateDashboard(storageDir: string, currentState: SessionState): void {
  try {
    const sessions = loadAllSessions(storageDir, currentState);
    const html = DASHBOARD_HTML.replace(
      '__SESSION_DATA__',
      JSON.stringify(sessions).replace(/</g, '\\u003c'),
    );

    const outPath = path.resolve(storageDir, '..', 'dashboard.html');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[dashboard] Could not regenerate dashboard: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadAllSessions(storageDir: string, currentState: SessionState): SessionState[] {
  const sessions: SessionState[] = [];

  // Always include current in-memory state (most up-to-date)
  sessions.push(currentState);

  try {
    if (!fs.existsSync(storageDir)) return sessions;
    const files = fs.readdirSync(storageDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const sid = file.replace(/\.json$/, '');
      if (sid === currentState.sessionId) continue; // already included above
      try {
        const raw = fs.readFileSync(path.join(storageDir, file), 'utf-8');
        sessions.push(JSON.parse(raw) as SessionState);
      } catch {
        // skip corrupt session files
      }
    }
  } catch {
    // storageDir unreadable — return what we have
  }

  // Sort newest-first by startTime
  sessions.sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
  return sessions;
}
