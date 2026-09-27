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

import type { DecisionContract, SessionState, NormalizedEvent } from '../types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type NotificationSource = 'pre-action' | 'post-action';

/**
 * Emit the appropriate notification for a decision to stderr.
 * No-op for ALLOW (silent by default, PRD §27).
 */
export function notify(
  contract: DecisionContract,
  state: SessionState,
  event: NormalizedEvent,
  source: NotificationSource,
): void {
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
export function formatWatch(contract: DecisionContract, source: NotificationSource): string {
  const prefix = source === 'post-action' ? 'observed after action' : 'watching';
  const reason = contract.reason || 'attention signals present';
  return `◐ Bobtention: ${prefix} — ${reason}`;
}

/**
 * Format a BLOCK message string (exported for tests).
 * PRD §29 exact format.
 */
export function formatBlock(
  contract: DecisionContract,
  state: SessionState,
  event: NormalizedEvent,
  source: NotificationSource,
): string {
  const lines: string[] = [];

  if (source === 'post-action') {
    lines.push('⚠ Bobtention: concern detected after action — next action has been blocked');
  } else {
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
    lines.push('The next action has been blocked. Please ask the human whether to proceed before continuing.');
  } else {
    lines.push('Action paused — please ask the human to confirm whether to proceed.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emitWatch(contract: DecisionContract, source: NotificationSource): void {
  process.stderr.write(formatWatch(contract, source) + '\n');
}

function emitBlock(
  contract: DecisionContract,
  state: SessionState,
  event: NormalizedEvent,
  source: NotificationSource,
): void {
  process.stderr.write(formatBlock(contract, state, event, source) + '\n');
}

function describeEvent(event: NormalizedEvent): string {
  if (event.kind === 'tool') {
    const files = event.files.length > 0 ? ` (${event.files.slice(0, 3).join(', ')})` : '';
    return `${event.tool}${files}`;
  }
  if (event.kind === 'prompt') {
    return `user prompt: "${event.text.slice(0, 60)}${event.text.length > 60 ? '…' : ''}"`;
  }
  return event.kind;
}

function signalLabel(signal: string): string {
  const labels: Record<string, string> = {
    TASK_DRIFT: 'Task drift — activity diverges from stated intent',
    REPEATED_FAILURE: 'Repeated failure — same error recurs without progress',
    SCOPE_EXPANSION: 'Scope expansion — touching files outside initial scope',
    HIGH_IMPACT_CHANGE: 'High-impact change — destructive/sensitive operation',
    UNCERTAINTY: 'Uncertainty — agent appears to be changing direction frequently',
  };
  return labels[signal] ?? signal;
}
