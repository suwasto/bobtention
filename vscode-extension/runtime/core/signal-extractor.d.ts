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
import type { Signal, NormalizedEvent } from '../types';
import type { SessionState } from '../types';
import type { BobtentionConfig } from './config';
/**
 * Extract signals given current session state and the latest event.
 * Returns only newly-detected signals (caller accumulates onto state.signals).
 */
export declare function extractSignals(state: SessionState, event: NormalizedEvent, config: BobtentionConfig): Signal[];
//# sourceMappingURL=signal-extractor.d.ts.map