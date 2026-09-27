#!/usr/bin/env node
"use strict";
/**
 * scripts/override.ts
 *
 * CLI entry point for the human override command:
 *   npx bobtention override [--session <id>] [--reason <text>]
 *
 * Reads the current session state from disk, confirms what was blocked,
 * then writes a pendingOverride so the next PreToolUse will ALLOW through.
 *
 * ADR: dosc/adr/008-human-override-mechanism.md
 * PRD §24–§25 (Human Override / Override State)
 * T7.1
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const args = argv.slice(2); // strip node + script path
    let sessionId = '';
    let reason = 'developer_confirmed';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--session' && args[i + 1]) {
            sessionId = args[++i];
        }
        else if (args[i] === '--reason' && args[i + 1]) {
            reason = args[++i];
        }
    }
    return { sessionId, reason };
}
// ---------------------------------------------------------------------------
// Session discovery
// ---------------------------------------------------------------------------
const DEFAULT_STORAGE = path.join(os.homedir(), '.bobtention', 'sessions');
function findSessionFiles(storagePath) {
    try {
        if (!fs.existsSync(storagePath))
            return [];
        return fs
            .readdirSync(storagePath)
            .filter((f) => f.endsWith('.json'))
            .map((f) => path.join(storagePath, f));
    }
    catch {
        return [];
    }
}
function loadSession(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function saveSession(filePath, state) {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
    const { sessionId: argSessionId, reason } = parseArgs(process.argv);
    const storagePath = process.env.BOBTENTION_SESSION_PATH ?? DEFAULT_STORAGE;
    const files = findSessionFiles(storagePath);
    if (files.length === 0) {
        process.stderr.write('✖ bobtention override: no active sessions found.\n' +
            `  Storage path: ${storagePath}\n`);
        process.exit(1);
    }
    // Load all active sessions, filter to blocked or the requested session
    const sessions = files
        .map((f) => ({ file: f, state: loadSession(f) }))
        .filter(({ state }) => state !== null);
    let target;
    if (argSessionId) {
        target = sessions.find(({ state }) => state.sessionId === argSessionId);
        if (!target) {
            process.stderr.write(`✖ bobtention override: session "${argSessionId}" not found.\n`);
            process.exit(1);
        }
    }
    else {
        // Find the most-recently-modified session file that has a blockedAction
        const blocked = sessions.filter(({ state }) => state.blockedAction);
        if (blocked.length === 0) {
            // Fall back to the most recent session regardless of blocked state
            const sorted = [...sessions].sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs);
            target = sorted[0];
        }
        else {
            const sorted = [...blocked].sort((a, b) => fs.statSync(b.file).mtimeMs - fs.statSync(a.file).mtimeMs);
            target = sorted[0];
        }
    }
    if (!target) {
        process.stderr.write('✖ bobtention override: could not find a session to override.\n');
        process.exit(1);
    }
    const { file, state } = target;
    // Show what was blocked
    if (state.blockedAction) {
        const blocked = state.blockedAction;
        const when = new Date(blocked.timestamp).toLocaleTimeString();
        process.stderr.write(`\n  Session:  ${state.sessionId}\n` +
            `  Intent:   ${state.originalIntent}\n` +
            `  Blocked:  ${blocked.tool}(${blocked.files.join(', ')}) at ${when}\n` +
            `  Reason:   ${blocked.reason}\n\n`);
    }
    else {
        process.stderr.write(`\n  Session: ${state.sessionId}\n` +
            `  Intent:  ${state.originalIntent}\n` +
            `  (no blocked action recorded — override will apply to next action)\n\n`);
    }
    // Write the override
    state.pendingOverride = {
        active: true,
        reason,
        scope: 'next_action',
    };
    saveSession(file, state);
    process.stderr.write(`✓ Override written — Bob will be allowed to continue on the next action.\n` +
        `  Reason: ${reason}\n\n` +
        `  Re-run Bob or retry the blocked action to resume.\n`);
}
main();
