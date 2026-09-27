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
export type NotificationSource = 'pre-action' | 'post-action';
/**
 * Emit the appropriate notification for a decision to stderr.
 * No-op for ALLOW (silent by default, PRD §27).
 */
export declare function notify(contract: DecisionContract, state: SessionState, event: NormalizedEvent, source: NotificationSource): void;
/**
 * Format a WATCH message string (exported for tests).
 */
export declare function formatWatch(contract: DecisionContract, source: NotificationSource): string;
/**
 * Format a BLOCK message string (exported for tests).
 * PRD §29 exact format.
 */
export declare function formatBlock(contract: DecisionContract, state: SessionState, event: NormalizedEvent, source: NotificationSource): string;
//# sourceMappingURL=notification.d.ts.map