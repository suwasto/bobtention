"use strict";
/**
 * src/core/notification.ts
 *
 * Notification Layer — formats human-readable messages for ALLOW / WATCH / BLOCK decisions.
 *
 * ADR: dosc/adr/007-enforcement-and-notification.md
 * PRD §27 (ALLOW: silent), §28 (WATCH UI), §29 (BLOCK UI), §30.4 (no retroactive claims)
 *
 * ALL output goes to stderr — stdout is reserved for Bob context injection only.
 *
 * Message formats:
 *   ALLOW  — silent by default
 *   WATCH  — ◐ Bobtention: watching — <brief reason>
 *   BLOCK  — multi-line ⚠ message with reason, task, current activity, signal list
 *
 * The `source` parameter distinguishes pre-action detection from post-action detection
 * (PRD §30.4 — no retroactive claims). Post-action messages use different language.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = notify;
exports.formatWatch = formatWatch;
exports.formatBlock = formatBlock;
/**
 * Emit the appropriate notification for a decision to stderr.
 * No-op for ALLOW (silent by default, PRD §27).
 */
function notify(contract, state, event, source) {
    switch (contract.decision) {
        case 'ALLOW':
            // Silent — PRD §27
            return;
        case 'WATCH':
            emitWatch(contract, source);
            return;
        case 'BLOCK':
            emitBlock(contract, state, event, source);
            return;
    }
}
/**
 * Format a WATCH message string (exported for tests).
 */
function formatWatch(contract, source) {
    const prefix = source === 'post-action' ? 'observed after action' : 'watching';
    const reason = contract.reason || 'attention signals present';
    return `◐ Bobtention: ${prefix} — ${reason}`;
}
/**
 * Format a BLOCK message string (exported for tests).
 * PRD §29 exact format.
 */
function formatBlock(contract, state, event, source) {
    const lines = [];
    if (source === 'post-action') {
        lines.push('⚠ Bobtention: concern detected after action — next action has been blocked');
    }
    else {
        lines.push('⚠ Bobtention: human attention required');
    }
    lines.push('');
    lines.push(`Reason: ${contract.reason || '(none)'}`);
    lines.push(`Task:   ${state.originalIntent || '(unknown)'}`);
    lines.push(`Current: ${describeEvent(event)}`);
    if (contract.signals.length > 0) {
        lines.push('Signals:');
        for (const sig of contract.signals) {
            lines.push(`  • ${signalLabel(sig)}`);
        }
    }
    if (contract.summary) {
        lines.push('');
        lines.push(contract.summary);
    }
    lines.push('');
    if (source === 'post-action') {
        lines.push('The next action has been blocked.');
    }
    else {
        lines.push('The next action has been blocked.');
    }
    return lines.join('\n');
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function emitWatch(contract, source) {
    process.stderr.write(formatWatch(contract, source) + '\n');
}
function emitBlock(contract, state, event, source) {
    process.stderr.write(formatBlock(contract, state, event, source) + '\n');
}
function describeEvent(event) {
    if (event.kind === 'tool') {
        const files = event.files.length > 0 ? ` (${event.files.slice(0, 3).join(', ')})` : '';
        return `${event.tool}${files}`;
    }
    if (event.kind === 'prompt') {
        return `user prompt: "${event.text.slice(0, 60)}${event.text.length > 60 ? '…' : ''}"`;
    }
    return event.kind;
}
function signalLabel(signal) {
    const labels = {
        TASK_DRIFT: 'Task drift — activity diverges from stated intent',
        REPEATED_FAILURE: 'Repeated failure — same error recurs without progress',
        SCOPE_EXPANSION: 'Scope expansion — touching files outside initial scope',
        HIGH_IMPACT_CHANGE: 'High-impact change — destructive/sensitive operation',
        UNCERTAINTY: 'Uncertainty — agent appears to be changing direction frequently',
    };
    return labels[signal] ?? signal;
}
//# sourceMappingURL=notification.js.map