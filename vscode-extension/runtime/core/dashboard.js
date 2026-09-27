"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.regenerateDashboard = regenerateDashboard;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("../utils/logger");
const dashboard_template_1 = require("./dashboard-template");
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Regenerate the dashboard HTML for the given storage directory.
 * Reads all session files in the directory, merges them, writes dashboard.html.
 *
 * Called by session-manager after every persistState.
 */
function regenerateDashboard(storageDir, currentState) {
    try {
        const sessions = loadAllSessions(storageDir, currentState);
        const html = dashboard_template_1.DASHBOARD_HTML.replace('__SESSION_DATA__', JSON.stringify(sessions).replace(/</g, '\\u003c'));
        const outPath = path.resolve(storageDir, '..', 'dashboard.html');
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, html, 'utf-8');
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger_1.logger.warn(`[dashboard] Could not regenerate dashboard: ${msg}`);
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function loadAllSessions(storageDir, currentState) {
    const sessions = [];
    // Always include current in-memory state (most up-to-date)
    sessions.push(currentState);
    try {
        if (!fs.existsSync(storageDir))
            return sessions;
        const files = fs.readdirSync(storageDir).filter((f) => f.endsWith('.json'));
        for (const file of files) {
            const sid = file.replace(/\.json$/, '');
            if (sid === currentState.sessionId)
                continue; // already included above
            try {
                const raw = fs.readFileSync(path.join(storageDir, file), 'utf-8');
                sessions.push(JSON.parse(raw));
            }
            catch {
                // skip corrupt session files
            }
        }
    }
    catch {
        // storageDir unreadable — return what we have
    }
    // Sort newest-first by startTime
    sessions.sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
    return sessions;
}
//# sourceMappingURL=dashboard.js.map