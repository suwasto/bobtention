/**
 * src/types/index.ts
 *
 * All shared TypeScript types for Bobtention.
 * Covers PRD §11-12 (decision context/contract), §17 (session state),
 * §19 (events), §22 (high-impact), §25 (override).
 */
export type AttentionDecision = 'ALLOW' | 'WATCH' | 'BLOCK';
export type SignalType = 'TASK_DRIFT' | 'REPEATED_FAILURE' | 'SCOPE_EXPANSION' | 'HIGH_IMPACT_CHANGE' | 'UNCERTAINTY';
export interface Signal {
    type: SignalType;
    /** 0.0–1.0 */
    severity: number;
    timestamp: number;
    detail?: string;
}
export interface Override {
    /** Whether there is an active unconsumed override */
    active: boolean;
    reason: string;
    /** MVP only supports next_action scope */
    scope: 'next_action';
}
export interface DecisionContract {
    decision: AttentionDecision;
    /** 0.0–1.0 */
    confidence: number;
    reason: string;
    signals: SignalType[];
    summary?: string;
    /** Which engine produced this contract */
    engine?: 'laya' | 'local' | 'deterministic' | 'override';
    /** Tool and files that triggered this evaluation */
    trigger?: {
        tool: string;
        files: string[];
    };
    /** Raw Laya per-question answers — only present when engine === 'laya' */
    layaDetail?: Array<{
        question: string;
        choice: string;
        decision: AttentionDecision;
        confidence: number;
    }>;
}
export interface DecisionContext {
    intent: string;
    currentAction: {
        tool: string;
        files: string[];
    };
    recentActions: Array<{
        type: string;
        files: string[];
    }>;
    failures: Array<{
        signature: string;
        count: number;
        progressing: boolean;
    }>;
    /**
     * Full Signal objects — type + severity + detail — so the decision engine
     * receives the human-readable reason for each signal, not just an enum label.
     */
    signals: Signal[];
}
export type SessionStatus = 'active' | 'blocked' | 'completed' | 'error';
export interface ActionRecord {
    tool: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    files: string[];
    timestamp: number;
}
export interface TestRecord {
    name: string;
    result: 'passed' | 'failed' | 'skipped';
    timestamp: number;
}
export interface FailureRecord {
    signature: string;
    count: number;
    lastSeen: number;
    progressing: boolean;
}
export interface DecisionRecord {
    decision: AttentionDecision;
    reason: string;
    confidence: number;
    timestamp: number;
    /**
     * Which engine produced this decision.
     * 'deterministic' = hard threshold fired without calling any engine.
     * 'laya'          = LayaAdapter responded.
     * 'local'         = LocalRuleAdapter (primary or fallback).
     * 'override'      = human override consumed.
     */
    engine?: 'laya' | 'local' | 'deterministic' | 'override';
    /** Tool and files that triggered this evaluation */
    trigger?: {
        tool: string;
        files: string[];
    };
    /**
     * Raw Laya Q&A detail: each question key → { choice, decision, confidence }.
     * Present only when engine === 'laya'.
     */
    layaDetail?: Array<{
        question: string;
        choice: string;
        decision: AttentionDecision;
        confidence: number;
    }>;
}
export interface SessionState {
    sessionId: string;
    originalIntent: string;
    startTime: number;
    status: SessionStatus;
    actions: ActionRecord[];
    tests: TestRecord[];
    failures: FailureRecord[];
    signals: Signal[];
    decisions: DecisionRecord[];
    overrides: Override[];
    /** Deferred BLOCK set by PostToolUse, consumed by next PreToolUse */
    deferredBlock?: {
        reason: string;
        signals: SignalType[];
    };
    /** Set when a BLOCK fires — records the blocked action context */
    blockedAction?: {
        tool: string;
        files: string[];
        reason: string;
        timestamp: number;
    };
    /** Active human override pending consumption by the next PreToolUse */
    pendingOverride?: Override;
}
export interface ToolEvent {
    kind: 'tool';
    tool: string;
    files: string[];
    input: Record<string, unknown>;
    output?: Record<string, unknown>;
    timestamp: number;
}
export interface TestResultEvent {
    kind: 'test';
    name: string;
    result: 'passed' | 'failed' | 'skipped';
    timestamp: number;
}
export interface PromptEvent {
    kind: 'prompt';
    text: string;
    timestamp: number;
}
export interface SessionInitEvent {
    kind: 'session_init';
    sessionId: string;
    timestamp: number;
}
export interface LifecycleEvent {
    kind: 'stop';
    sessionId: string;
    timestamp: number;
}
export type NormalizedEvent = ToolEvent | TestResultEvent | PromptEvent | SessionInitEvent | LifecycleEvent;
/** Raw stdin payload delivered by Bob for SessionStart */
export interface BobSessionStartPayload {
    session_id?: string;
    [key: string]: unknown;
}
/** Raw stdin payload delivered by Bob for UserPromptSubmit */
export interface BobUserPromptPayload {
    prompt?: string;
    session_id?: string;
    [key: string]: unknown;
}
/** Raw stdin payload for PreToolUse / PostToolUse */
export interface BobToolUsePayload {
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_response?: {
        output?: string;
        error?: string;
        [key: string]: unknown;
    };
    session_id?: string;
    [key: string]: unknown;
}
/** Raw stdin payload for Stop */
export interface BobStopPayload {
    session_id?: string;
    [key: string]: unknown;
}
//# sourceMappingURL=index.d.ts.map