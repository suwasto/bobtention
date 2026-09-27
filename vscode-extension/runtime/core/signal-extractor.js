"use strict";
/**
 * src/core/signal-extractor.ts
 *
 * Signal Extractor — derives attention signals from session state + incoming event.
 *
 * ADR: dosc/adr/005-signal-extraction-strategy.md
 * PRD §8 (signal types), §30.3 (accumulation), §32–37 (scenarios)
 *
 * Signals emitted:
 *  TASK_DRIFT        — activity diverges from original intent keywords / initial scope
 *  REPEATED_FAILURE  — same test/error signature N+ times without progress
 *  SCOPE_EXPANSION   — touched directories expand beyond initial scope by threshold
 *  HIGH_IMPACT_CHANGE — file path matches a configured high-impact pattern
 *  UNCERTAINTY       — multiple unrelated modules touched rapidly / direction change
 *
 * Severity (0.0–1.0) accumulates with repeated evidence — single events start low.
 * Disabled signal types in config are never emitted.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractSignals = extractSignals;
const minimatch_1 = require("minimatch");
const session_manager_1 = require("./session-manager");
// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
/**
 * Extract signals given current session state and the latest event.
 * Returns only newly-detected signals (caller accumulates onto state.signals).
 */
function extractSignals(state, event, config) {
    const signals = [];
    if (event.kind !== 'tool' && event.kind !== 'test') {
        // Only tool and test events carry actionable signal data
        return signals;
    }
    if (config.signals.highImpactAction && event.kind === 'tool') {
        const s = detectHighImpact(event.files, config.highImpactPatterns, state);
        if (s)
            signals.push(s);
    }
    if (config.signals.repeatedFailure) {
        const s = detectRepeatedFailure(state, config);
        if (s)
            signals.push(s);
    }
    if (config.signals.scopeExpansion && event.kind === 'tool') {
        const s = detectScopeExpansion(state, config);
        if (s)
            signals.push(s);
    }
    if (config.signals.taskDrift && event.kind === 'tool') {
        const s = detectTaskDrift(state, event.files, config);
        if (s)
            signals.push(s);
    }
    if (config.signals.uncertainty && event.kind === 'tool') {
        const s = detectUncertainty(state, config);
        if (s)
            signals.push(s);
    }
    return signals;
}
// ---------------------------------------------------------------------------
// REPEATED_FAILURE detector
// ---------------------------------------------------------------------------
const REPEATED_FAILURE_THRESHOLD_DEFAULT = 3;
function detectRepeatedFailure(state, _config) {
    // Find any failure that has not been cleared and exceeds threshold
    const threshold = REPEATED_FAILURE_THRESHOLD_DEFAULT; // configurable in future
    const worst = state.failures
        .filter((f) => !f.progressing && f.count >= threshold)
        .sort((a, b) => b.count - a.count)[0];
    if (!worst)
        return null;
    // Existing signals of this type — accumulate severity
    const prior = countExistingSignals(state.signals, 'REPEATED_FAILURE');
    const severity = accumulate(prior, worst.count - threshold + 1, 0.3, 0.9);
    return {
        type: 'REPEATED_FAILURE',
        severity,
        timestamp: Date.now(),
        detail: `"${worst.signature}" failed ${worst.count}× without progress`,
    };
}
// ---------------------------------------------------------------------------
// SCOPE_EXPANSION detector
// ---------------------------------------------------------------------------
// Fraction of new dirs relative to initial scope that triggers the signal
const SCOPE_EXPANSION_RATIO_DEFAULT = 0.5;
function detectScopeExpansion(state, _config) {
    if (state.actions.length < 6) {
        // Need enough actions to establish an initial scope
        return null;
    }
    const initial = (0, session_manager_1.getInitialScope)(state);
    const current = (0, session_manager_1.getCurrentScope)(state);
    if (initial.size === 0)
        return null;
    let newDirs = 0;
    for (const dir of current) {
        if (!initial.has(dir))
            newDirs++;
    }
    const expansionRatio = newDirs / initial.size;
    if (expansionRatio < SCOPE_EXPANSION_RATIO_DEFAULT)
        return null;
    const prior = countExistingSignals(state.signals, 'SCOPE_EXPANSION');
    // step=1 on first detection so initial severity is always low; prior drives escalation
    const severity = accumulate(prior, 1, 0.2, 0.75);
    return {
        type: 'SCOPE_EXPANSION',
        severity,
        timestamp: Date.now(),
        detail: `${newDirs} new director${newDirs === 1 ? 'y' : 'ies'} beyond initial scope (${[...initial].join(', ')})`,
    };
}
// ---------------------------------------------------------------------------
// TASK_DRIFT detector
// ---------------------------------------------------------------------------
function detectTaskDrift(state, currentFiles, _config) {
    if (!state.originalIntent || currentFiles.length === 0)
        return null;
    // Extract keywords from the original intent (words ≥4 chars, lowercased)
    const intentKeywords = extractKeywords(state.originalIntent);
    if (intentKeywords.length === 0)
        return null;
    // Check if any current file aligns with intent keywords
    const allFiles = currentFiles.map((f) => f.toLowerCase());
    const anyKeywordMatch = allFiles.some((f) => intentKeywords.some((kw) => f.includes(kw)));
    if (anyKeywordMatch)
        return null; // No drift
    // Check initial scope alignment using 2-level path prefix (more granular than top-dir)
    const initial = (0, session_manager_1.getInitialScope)(state);
    const initialPaths = getInitialScopePaths(state);
    const currentTopDirs = new Set(currentFiles.map((f) => topDir(f)));
    // If none of the current top dirs are in initial scope, it's drifted
    const anyTopDirMatch = [...currentTopDirs].some((d) => initial.has(d));
    if (!anyTopDirMatch) {
        // Clear drift — different top-level directory entirely
        const prior = countExistingSignals(state.signals, 'TASK_DRIFT');
        const severity = accumulate(prior, 1, 0.25, 0.8);
        const keywordStr = intentKeywords.slice(0, 3).join(', ');
        return {
            type: 'TASK_DRIFT',
            severity,
            timestamp: Date.now(),
            detail: `Files (${allFiles.slice(0, 2).join(', ')}) don't match intent keywords (${keywordStr})`,
        };
    }
    // Same top-level dir but check 2-level prefixes for deeper drift (e.g. src/auth vs src/billing)
    const currentPrefixes = new Set(currentFiles.map((f) => twoLevelPrefix(f)));
    const anyPrefixMatch = [...currentPrefixes].some((p) => initialPaths.has(p));
    if (anyPrefixMatch)
        return null; // Files are in known sub-paths
    // Same top dir but diverged into a different module
    const prior = countExistingSignals(state.signals, 'TASK_DRIFT');
    const severity = accumulate(prior, 1, 0.25, 0.8);
    const keywordStr = intentKeywords.slice(0, 3).join(', ');
    return {
        type: 'TASK_DRIFT',
        severity,
        timestamp: Date.now(),
        detail: `Files (${allFiles.slice(0, 2).join(', ')}) don't match intent keywords (${keywordStr})`,
    };
}
// ---------------------------------------------------------------------------
// HIGH_IMPACT_CHANGE detector
// ---------------------------------------------------------------------------
function detectHighImpact(files, patterns, state) {
    for (const file of files) {
        for (const { pattern, category } of patterns) {
            // Support both glob (contains *, ?, /) and plain regex-style patterns
            const isGlob = pattern.includes('*') || pattern.includes('?');
            let matched;
            if (isGlob) {
                // Match full path OR any individual path segment (handles **/migration* patterns)
                const segments = file.replace(/\\/g, '/').split('/');
                const basePattern = pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '');
                matched =
                    (0, minimatch_1.minimatch)(file, pattern, { dot: true }) ||
                        segments.some((seg) => (0, minimatch_1.minimatch)(seg, basePattern));
            }
            else {
                matched = new RegExp(pattern, 'i').test(file);
            }
            if (matched) {
                const prior = countExistingSignals(state.signals, 'HIGH_IMPACT_CHANGE');
                const severity = accumulate(prior, 1, 0.5, 0.95);
                return {
                    type: 'HIGH_IMPACT_CHANGE',
                    severity,
                    timestamp: Date.now(),
                    detail: `File "${file}" matches high-impact pattern "${pattern}" (${category})`,
                };
            }
        }
    }
    return null;
}
// ---------------------------------------------------------------------------
// UNCERTAINTY detector
// ---------------------------------------------------------------------------
/** Window of recent actions to examine for direction changes */
const UNCERTAINTY_WINDOW = 10;
/** Minimum distinct top-level directories in the window to flag uncertainty */
const UNCERTAINTY_DIR_THRESHOLD = 4;
function detectUncertainty(state, _config) {
    const recent = state.actions.slice(-UNCERTAINTY_WINDOW);
    if (recent.length < UNCERTAINTY_WINDOW / 2)
        return null;
    const recentDirs = new Set();
    for (const action of recent) {
        for (const file of action.files) {
            recentDirs.add(topDir(file));
        }
    }
    if (recentDirs.size < UNCERTAINTY_DIR_THRESHOLD)
        return null;
    const prior = countExistingSignals(state.signals, 'UNCERTAINTY');
    const severity = accumulate(prior, recentDirs.size - UNCERTAINTY_DIR_THRESHOLD + 1, 0.2, 0.7);
    return {
        type: 'UNCERTAINTY',
        severity,
        timestamp: Date.now(),
        detail: `${recentDirs.size} distinct directories touched in last ${recent.length} actions`,
    };
}
// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
/**
 * Count how many signals of a given type already exist in the session.
 * Used to escalate severity on repeated evidence.
 */
function countExistingSignals(signals, type) {
    return signals.filter((s) => s.type === type).length;
}
/**
 * Compute severity that accumulates as evidence repeats.
 * - base:  starting severity on first detection
 * - max:   ceiling
 * - step:  extra evidence count (1 = first occurrence beyond threshold)
 *
 * Formula: base + (1 - base) * (1 - e^(-0.4 * (prior + step)))
 * Approaches max asymptotically.
 */
function accumulate(prior, step, base, max) {
    const raw = base + (max - base) * (1 - Math.exp(-0.4 * (prior + step)));
    return Math.min(Math.round(raw * 100) / 100, max);
}
/**
 * Extract meaningful keywords from intent text (words ≥ 4 chars).
 */
function extractKeywords(intent) {
    return intent
        .toLowerCase()
        .replace(/[^a-z0-9\s-_]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4);
}
/**
 * Extract top-level directory from a file path.
 * "src/core/foo.ts" → "src", "README.md" → "."
 */
function topDir(filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts.length > 1 ? parts[0] : '.';
}
/**
 * Extract 2-level path prefix for sub-module drift detection.
 * "src/auth/login.ts" → "src/auth", "src/app.ts" → "src", "README.md" → "."
 */
function twoLevelPrefix(filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    if (parts.length >= 3)
        return `${parts[0]}/${parts[1]}`;
    if (parts.length === 2)
        return parts[0];
    return '.';
}
/**
 * Return the set of 2-level path prefixes from the first N actions (initial scope paths).
 */
function getInitialScopePaths(state, n = 5) {
    const scope = new Set();
    const actions = state.actions.slice(0, n);
    for (const action of actions) {
        for (const file of action.files) {
            scope.add(twoLevelPrefix(file));
        }
    }
    return scope;
}
//# sourceMappingURL=signal-extractor.js.map