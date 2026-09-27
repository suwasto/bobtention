# Bobtention — Execution Plan

> Derived from [PRD.md](file:///Users/macbookpro/ongoing-project/bobtention/dosc/PRD.md)  
> Each phase produces one or more ADR entries in `dosc/adr/`

**Tech stack:** TypeScript / Node.js (lightweight, low-token, runs as shell command in Bob hooks)  
**Runtime:** Local-first, no cloud backend, no separate accounts  
**Decision engine:** Abstracted adapter — user supplies JEV/Laya endpoint  
**Hackathon target:** IBM Bob Hackathon MVP

---

## Phase Dependencies

```
Phase 0 (Scaffolding)
  └─► Phase 1 (Types & Config)
        └─► Phase 2 (Hook Adapter & Normalizer)
              └─► Phase 3 (Session Manager)
                    └─► Phase 4 (Signal Extractor)
                          └─► Phase 5 (Attention Evaluator & Decision Adapter)
                                └─► Phase 6 (Enforcement & Notification)
                                      └─► Phase 7 (Human Override)
                                            └─► Phase 8 (End-to-End Integration & Demo)
```

**Cross-cutting:** Error handling & safety (previously Phase 9) is now embedded
into every phase as a constraint, not deferred to the end.

---

## Phase 0 — Project Scaffolding & Foundational Decisions ✅

> **ADR:** `dosc/adr/001-tech-stack-and-project-structure.md`
> **Status: DONE** — 2025-07-28

### Tasks

- [x] **T0.1** Initialize Node.js/TypeScript project (`package.json`, `tsconfig.json`)
- [x] **T0.2** Set up project directory structure:
  ```
  src/
  ├── hooks/           # Bob hook entry points
  ├── core/            # Session, signals, decisions
  ├── adapters/        # Hook adapter, decision adapter
  ├── types/           # Shared TypeScript types
  └── utils/           # Helpers, logging, error handling
  tests/
  dosc/
  ├── PRD.md
  ├── PLAN.md
  └── adr/
  ```
- [x] **T0.3** Add dev tooling (ESLint, Prettier, Vitest)
- [x] **T0.4** Create `src/utils/errors.ts` — global error wrapper for hook entry points:
  - Wraps any hook in try/catch
  - Internal error → exit 0 (fail-open) + log to stderr
  - Never surfaces an internal crash as exit 2 (BLOCK)
- [x] **T0.5** Create `src/utils/logger.ts` — structured logging to stderr and optional file log
- [x] **T0.6** Create Bob hook registration config (`.bob/settings.json`) skeleton
- [x] **T0.7** Create initial `dosc/adr/001-tech-stack-and-project-structure.md`

### Acceptance Criteria

- [x] `npm run build` compiles without errors
- [x] Directory structure matches layout above
- [x] Error wrapper tested: thrown exception → exit 0 + stderr message (4 tests passing)
- [x] ADR 001 documents tech-stack rationale and fail-open decision

---

## Phase 1 — Types, Event Model & Configuration ✅

> **ADR:** `dosc/adr/002-event-model-types-and-config.md`
> **Status: DONE** — 2025-07-28

Configuration is defined here (not in a late phase) because every subsequent
phase depends on config values — thresholds, patterns, enabled signals, storage
paths, decision engine endpoint.

### Tasks

- [x] **T1.1** Define core types:
  - `AttentionDecision` — `'ALLOW' | 'WATCH' | 'BLOCK'`
  - `DecisionContract` — `{ decision, confidence, reason, signals, summary? }`
  - `NormalizedEvent` — discriminated union: `ToolEvent | TestEvent | PromptEvent | SessionEvent | LifecycleEvent`
  - `SessionState` — `{ sessionId, originalIntent, startTime, status, actions[], tests[], failures[], signals[], decisions[], overrides[] }`
  - `Signal` — `{ type: SignalType, severity, timestamp, detail? }`
  - `SignalType` — `'TASK_DRIFT' | 'REPEATED_FAILURE' | 'SCOPE_EXPANSION' | 'HIGH_IMPACT_CHANGE' | 'UNCERTAINTY'`
  - `Override` — `{ active, reason, scope: 'next_action' }`
- [x] **T1.2** Define `DecisionContext` shape (compact payload sent to JEV/Laya):
  ```typescript
  interface DecisionContext {
    intent: string;
    currentAction: { tool: string; files: string[] };
    recentActions: Array<{ type: string; files: string[] }>;
    failures: Array<{ signature: string; count: number; progressing: boolean }>;
    signals: SignalType[];
  }
  ```
- [x] **T1.3** Define Bob hook input/output types per official Hooks API:
  - **SessionStart:** non-blocking, stdout injected as context into session
  - **UserPromptSubmit:** blocking (exit 2 = block), stdout injected as context
  - **PreToolUse:** blocking (exit 2 = block), stdout ignored, uses `matcher` regex for tool targeting
  - **PostToolUse:** non-blocking, stdout ignored, uses `matcher` regex for tool targeting
  - **Stop:** non-blocking, stdout ignored
- [x] **T1.4** Define `BobtentionConfig` type and implement config loader (`src/core/config.ts`):
  ```typescript
  interface BobtentionConfig {
    enabled: boolean;
    decisionEngine: {
      provider: 'jev-laya' | 'local';
      endpoint?: string;     // required when provider is 'jev-laya'
      timeout: number;       // ms, default 3000
    };
    autonomy: {
      default: 'autonomous';
      watchThreshold: number; // default 0.55
      blockThreshold: number; // default 0.85
    };
    signals: {
      taskDrift: boolean;
      repeatedFailure: boolean;
      scopeExpansion: boolean;
      highImpactAction: boolean;
      uncertainty: boolean;
    };
    highImpactPatterns: Array<{ pattern: string; category: string }>;
    humanOverride: { enabled: boolean };
    session: {
      maxActions: number;    // default 50
      storagePath: string;   // default ~/.bobtention/sessions
    };
  }
  ```
- [x] **T1.5** Config resolution: merge workspace (`./bobtention.config.json`) over global (`~/.bobtention/config.json`), fall back to sensible defaults for every field
- [x] **T1.6** Write ADR 002

### Acceptance Criteria

- [x] All types compile
- [x] Types cover PRD §11–12 (decision context/contract), §17 (session state), §19 (events), §22 (high-impact), §25 (override)
- [x] Config loader returns complete typed config even when file is missing or partial (10 tests passing)
- [x] ADR 002 documents event taxonomy, config model, and blocking semantics per hook type

---

## Phase 2 — Hook Adapter & Event Normalizer ✅

> **ADR:** `dosc/adr/003-hook-integration-strategy.md`
> **Status: DONE** — 2025-07-28

### Tasks

- [x] **T2.1** Build **Hook Adapter** — entry-point scripts for each Bob hook:
  - `hooks/session-start.ts` — reads stdin, initializes session, **stdout = context string** (injected into Bob session per Hooks API)
  - `hooks/user-prompt-submit.ts` — captures original intent from stdin; if intent changes mid-session, updates task context (PRD §52: "Allows explicit task changes to establish new context"); stdout = acknowledgment context; supports exit 2 if needed
  - `hooks/pre-tool-use.ts` — main evaluation entry point, exit 0 (allow) or exit 2 (block)
  - `hooks/post-tool-use.ts` — observation only, updates session state, always exit 0
  - `hooks/stop.ts` — finalizes session, cleanup, always exit 0
- [x] **T2.2** Build **Event Normalizer** (`core/event-normalizer.ts`):
  - Parses raw Bob hook JSON payloads (stdin)
  - Produces typed `NormalizedEvent` instances
  - Extracts: tool name, file paths, test results, prompt text
  - Handles malformed input gracefully (fail-open)
- [x] **T2.3** Register hooks in `.bob/settings.json` with correct structure per Bob API:
  ```json
  {
    "hooks": {
      "SessionStart": [
        {
          "type": "command",
          "command": "node dist/hooks/session-start.js",
          "timeout": 5
        }
      ],
      "UserPromptSubmit": [
        {
          "type": "command",
          "command": "node dist/hooks/user-prompt-submit.js",
          "timeout": 5
        }
      ],
      "PreToolUse": [
        {
          "matcher": ".*",
          "hooks": [
            {
              "type": "command",
              "command": "node dist/hooks/pre-tool-use.js",
              "timeout": 10
            }
          ]
        }
      ],
      "PostToolUse": [
        {
          "matcher": ".*",
          "hooks": [
            {
              "type": "command",
              "command": "node dist/hooks/post-tool-use.js",
              "timeout": 5
            }
          ]
        }
      ],
      "Stop": [
        {
          "type": "command",
          "command": "node dist/hooks/stop.js",
          "timeout": 5
        }
      ]
    }
  }
  ```
- [x] **T2.4** All hook entry points wrapped with error handler from T0.4
- [x] **T2.5** Unit tests: parse sample hook payloads → normalized events, malformed input → fail-open (22 tests passing)
- [x] **T2.6** Write ADR 003

### Acceptance Criteria

- [x] Each hook reads stdin, parses JSON, produces typed `NormalizedEvent`
- [x] PreToolUse can return exit 0 (allow) or exit 2 (block)
- [x] UserPromptSubmit can return exit 0 (allow) or exit 2 (block)
- [x] PostToolUse and Stop always return exit 0
- [x] SessionStart stdout provides context string to Bob
- [x] PreToolUse/PostToolUse use `matcher` field per Bob Hooks API
- [x] Malformed stdin → exit 0 (fail-open) + stderr warning
- [x] ADR 003 documents hook structure, matcher strategy, and stdout/exit-code semantics per hook type

---

## Phase 3 — Session Manager ✅

> **ADR:** `dosc/adr/004-session-state-management.md`

### Tasks

- [x] **T3.1** Build **Session Manager** (`core/session-manager.ts`):
  - `initSession(sessionId: string, intent: string): SessionState`
  - `updateSession(sessionId: string, event: NormalizedEvent): SessionState`
  - `getSession(sessionId: string): SessionState | null`
  - `updateIntent(sessionId: string, newIntent: string): SessionState` — explicit task change (PRD §18, §52: "Allows explicit task changes")
  - `finalizeSession(sessionId: string): void`
- [x] **T3.2** Implement bounded local persistence:
  - Store session as JSON file at configured `storagePath` (default `~/.bobtention/sessions/`)
  - Bounded action history (last N actions, configurable via `session.maxActions`, default 50)
  - Auto-cleanup on session finalize (configurable retention)
- [x] **T3.3** Implement failure tracking:
  - Group failures by signature (test name / error key)
  - Track count + progression context (did output/error change between attempts?)
  - Distinguish "same failure repeated without progress" vs "different failures" vs "progressing" (PRD §20)
- [x] **T3.4** Implement scope tracking:
  - Track touched files/directories per action
  - Maintain `initialScope` (first N actions) vs `currentScope`
  - Detect scope expansion as delta between initial and current
- [x] **T3.5** Original intent is immutable unless explicitly changed via `updateIntent()`
- [x] **T3.6** Session state read/write is atomic (write-to-temp + rename)
- [x] **T3.7** Unit tests for state transitions, failure grouping, scope tracking, intent immutability, explicit task change
- [x] **T3.8** Write ADR 004

### Acceptance Criteria

- Session creates, updates, persists, and loads correctly
- Failure signatures group correctly with progression detection
- Scope expansion is detectable
- Original intent never overwritten by agent activity, but updatable via explicit call
- Bounded history stays within limits
- File I/O errors → fail-open (return last known state or empty)
- ADR 004 documents persistence, bounding, failure-grouping, and intent-change decisions

---

## Phase 4 — Signal Extractor ✅

> **ADR:** `dosc/adr/005-signal-extraction-strategy.md`

### Tasks

- [x] **T4.1** Build **Signal Extractor** (`core/signal-extractor.ts`):
  - `extractSignals(state: SessionState, event: NormalizedEvent, config: BobtentionConfig): Signal[]`
  - Only extracts signals for types enabled in config
- [x] **T4.2** Implement signal detectors:
  - **TASK_DRIFT** — compare current file/module activity against original intent keywords and initial scope
  - **REPEATED_FAILURE** — same test failing N+ times without progress (configurable N, default 3)
  - **SCOPE_EXPANSION** — touched directories growing beyond initial scope by more than threshold
  - **HIGH_IMPACT_CHANGE** — file paths matching patterns from `config.highImpactPatterns`
  - **UNCERTAINTY** — competing directions (e.g., multiple unrelated modules touched rapidly), direction changes
- [x] **T4.3** Default high-impact patterns shipped with sensible defaults:
  ```json
  [
    { "pattern": "**/migration*", "category": "DATABASE" },
    { "pattern": "**/auth*", "category": "AUTHENTICATION" },
    { "pattern": "**/*deploy*", "category": "DEPLOYMENT" },
    { "pattern": "**/Dockerfile*", "category": "INFRASTRUCTURE" },
    { "pattern": "**/.env*", "category": "SECURITY" },
    { "pattern": "**/security*", "category": "SECURITY" }
  ]
  ```
- [x] **T4.4** Implement signal severity levels (`low | medium | high`) based on accumulated evidence, not single events (PRD §30.3: signals should accumulate)
- [x] **T4.5** Signals are additive within a session — new signals don't erase prior ones
- [x] **T4.6** Unit tests with PRD scenarios (§32–§37):
  - Scenario A (normal work) → no concerning signals
  - Scenario B (uncertainty) → UNCERTAINTY signal, low severity
  - Scenario C (task drift) → TASK_DRIFT signal
  - Scenario D (stuck) → REPEATED_FAILURE signal
  - Scenario E (high-impact) → HIGH_IMPACT_CHANGE signal
  - Scenario F (legitimate scope expansion) → SCOPE_EXPANSION signal at low severity initially
- [x] **T4.7** Write ADR 005

### Acceptance Criteria

- All 5 signal types fire correctly for matching scenarios
- All 6 PRD scenarios produce expected signals
- Disabled signals in config are never emitted
- Signals accumulate severity over repeated evidence
- High-impact patterns are configurable and have sensible defaults
- ADR 005 documents signal detection heuristics and accumulation model

---

## Phase 5 — Attention Evaluator & Decision Adapter ✅

> **ADR:** `dosc/adr/006-decision-architecture.md`

### Tasks

- [x] **T5.1** Build **Attention Evaluator** (`core/attention-evaluator.ts`):
  - Fast deterministic path: no signals → ALLOW immediately (PRD §13, §31)
  - Deterministic BLOCK path: repeated identical failure above threshold → BLOCK without calling external engine
  - Ambiguous path: signals present but not deterministic → build `DecisionContext` → invoke Decision Adapter
- [x] **T5.2** Build **Decision Adapter** interface + implementations (`adapters/decision-adapter.ts`):
  - Interface:
    ```typescript
    interface DecisionEngine {
      evaluate(context: DecisionContext): Promise<DecisionContract>;
    }
    ```
  - `JevLayaAdapter`: HTTP POST to user-configured `config.decisionEngine.endpoint`, respects `timeout`
  - `LocalRuleAdapter` (fallback): threshold-based rules using `config.autonomy.watchThreshold` / `blockThreshold` against signal severity
- [x] **T5.3** Build `DecisionContext` builder (`core/context-builder.ts`):
  - Compact context from session state + current signals (PRD §11)
  - Include: intent, current action, recent actions (bounded), failure summary, active signals
  - Minimize data sent to external engine (PRD §49: privacy, minimum context)
- [x] **T5.4** Decision engine selection based on `config.decisionEngine.provider`
- [x] **T5.5** Handle decision-engine failure safely:
  - HTTP error / timeout → fall back to `LocalRuleAdapter`
  - If both fail → ALLOW with warning logged (fail-open)
- [x] **T5.6** Unit tests: deterministic path, ambiguous path, engine failure, timeout, fallback chain
- [x] **T5.7** Write ADR 006

### Acceptance Criteria

- Low-risk events (no signals) bypass decision engine entirely (< 100ms path)
- Deterministic BLOCK cases (e.g., 4+ identical failures) don't call external engine
- Decision adapter is swappable via config
- Engine failure → LocalRuleAdapter fallback → if that fails → ALLOW with warning
- `DecisionContract` always has `{ decision, confidence, reason, signals }`
- Context sent to JEV/Laya is minimal (no raw code, no full file contents)
- ADR 006 documents decision architecture, deterministic shortcuts, and fallback chain

---

## Phase 6 — Enforcement & Notification Layer ✅

> **ADR:** `dosc/adr/007-enforcement-and-notification.md`

### Tasks

- [x] **T6.1** Build **Enforcement Layer** (`core/enforcement.ts`):
  - ALLOW → exit 0 (Bob continues)
  - WATCH → exit 0 + record signal in session state + optional stderr message
  - BLOCK → exit 2 (Bob blocks) + stderr explanation
  - Only enforced in **PreToolUse** and **UserPromptSubmit** (the only blocking hooks)
  - PostToolUse discovers concern → write BLOCK state to session → *next* PreToolUse enforces it (PRD §16)
- [x] **T6.2** Build **Notification Layer** (`core/notification.ts`):
  - Format BLOCK messages per PRD §29:
    ```
    ⚠ Bobtention: human attention required

    Reason: <reason>
    Task: <original intent>
    Current: <current activity>
    Signals:
    • <signal 1>
    • <signal 2>

    The next action has been blocked.
    ```
  - Format WATCH messages per PRD §28 (informational, non-blocking):
    ```
    ◐ Bobtention: watching — <brief reason>
    ```
  - Format ALLOW as silent by default (PRD §27)
  - All messages to stderr (stdout is reserved for Bob context injection in SessionStart/UserPromptSubmit)
- [x] **T6.3** Clearly distinguish pre-action detection vs post-action detection in messages (PRD §30.4: no retroactive claims)
- [x] **T6.4** Record enforcement decision + timestamp in session state
- [x] **T6.5** Unit tests: output format, exit codes per hook type, PostToolUse-then-PreToolUse BLOCK flow
- [x] **T6.6** Write ADR 007

### Acceptance Criteria

- PreToolUse BLOCK → exit code 2, human-readable stderr
- PreToolUse ALLOW → exit code 0, silent
- PostToolUse → always exit 0, even when concern is discovered (deferred to next PreToolUse)
- UserPromptSubmit → can BLOCK with exit 2 if needed
- Every BLOCK includes reason, task, current activity, signal list
- Messages go to stderr, never stdout (stdout semantics are Bob-owned)
- ADR 007 documents enforcement constraints, pre/post distinction, and stdout/stderr separation

---

## Phase 7 — Human Override ✅

> **ADR:** `dosc/adr/008-human-override-mechanism.md`

### Tasks

- [x] **T7.1** Implement override state management:
  - After BLOCK, session state gets `{ blockedAction: {...} }` and `pendingOverride` written by CLI
  - Developer can approve the blocked action via a helper script:
    ```
    npx bobtention override
    ```
    which writes `{ active: true, reason: "developer_confirmed", scope: "next_action" }` to session
- [x] **T7.2** On next PreToolUse: if override is active → consume override → ALLOW → exit 0
- [x] **T7.3** Override is consumed after use — does not persist beyond `next_action` scope (PRD §25)
- [x] **T7.4** Record override in session decisions history with timestamp
- [x] **T7.5** If `config.humanOverride.enabled` is false, BLOCK is advisory only (exit 0 + warning message instead of exit 2)
- [x] **T7.6** Unit tests: full override lifecycle — BLOCK → override command → next PreToolUse ALLOW → override consumed → subsequent PreToolUse evaluates normally
- [x] **T7.7** Write ADR 008

### Acceptance Criteria

- BLOCK → developer runs override command → next action ALLOWED → override consumed
- Override is recorded in session state with reason and timestamp
- Override does not persist beyond its scope (`next_action`)
- Disabled override config → BLOCK becomes advisory (warn-only, exit 0)
- ADR 008 documents override mechanism and advisory mode

---

## Phase 8 — End-to-End Integration & Demo ✅

> **ADR:** `dosc/adr/009-integration-and-validation.md`

### Tasks

- [x] **T8.1** Build script: `npm run build` → `dist/hooks/*.js` ready for Bob to invoke
- [x] **T8.2** Create install script (`scripts/install.sh`) that:
  - Runs `npm run build`
  - Copies/merges hook config into `.bob/settings.json` (workspace-level)
  - Creates default `bobtention.config.json` if not present
- [x] **T8.3** End-to-end integration test: simulate full hook lifecycle
  - SessionStart → UserPromptSubmit → (PreToolUse → PostToolUse) × N → Stop
  - Verify session state file created, updated, finalized
- [x] **T8.4** Implement demo scenarios from PRD §38–§41:
  - **Demo Act 1** — Normal OAuth work → ALLOW throughout, no interruption
  - **Demo Act 2** — Stuck (repeated test failure × 4) → BLOCK with explanation
  - **Demo Act 3** — Task drift (Auth → Payment code) → BLOCK with explanation
  - **Demo Act 4** — Human override → `npx bobtention override` → Continue
  - **Demo Act 5** — High-impact action (migration file edit) → WATCH or BLOCK based on config
- [x] **T8.5** Create demo script (`scripts/demo.sh`) that pipes simulated hook JSON payloads through each hook script
- [x] **T8.6** Create `README.md` with:
  - Project overview (one-sentence pitch from PRD §57)
  - Installation instructions
  - Configuration guide (`bobtention.config.json` reference)
  - How it works (architecture diagram)
  - Demo instructions
  - Override usage
- [x] **T8.7** Verify all MVP acceptance criteria from PRD §52:
  - **Installation:** ✓ installed into workspace, ✓ invoked via hooks, ✓ no Bob modification
  - **Intent:** ✓ captures, ✓ maintains, ✓ allows explicit changes
  - **Observation:** ✓ receives events, ✓ normalizes, ✓ bounded history, ✓ tracks files/tests/failures
  - **Signals:** ✓ task drift, ✓ repeated failure, ✓ scope expansion, ✓ high-impact
  - **Decision:** ✓ ALLOW/WATCH/BLOCK, ✓ JEV/Laya, ✓ stable contract, ✓ skips trivial, ✓ handles failure
  - **Enforcement:** ✓ ALLOW continues, ✓ WATCH records, ✓ BLOCK prevents, ✓ BLOCK explains
  - **Human interaction:** ✓ override, ✓ recorded, ✓ Bob continues
  - **Demo:** ✓ normal, ✓ stuck, ✓ drift, ✓ high-impact, ✓ override, ✓ understandable
- [x] **T8.8** Write ADR 009

### Acceptance Criteria

- All 5 demo acts produce correct behavior
- All PRD §52 acceptance criteria pass (28 items)
- README is sufficient for hackathon judges to understand and run
- `scripts/install.sh` → working Bobtention in any Bob workspace
- ADR 009 documents validation results and any deviations from PRD

---

## Cross-Cutting Concern: Error Handling & Safety

These requirements apply to **every phase**, not a separate phase:

| Rule | Source | Applied In |
|------|--------|-----------|
| All hook entry points wrapped in try/catch | PRD §48 | Phase 0 (T0.4), Phase 2 (T2.4) |
| Internal error → exit 0 (fail-open) + stderr log | PRD §48 | All phases |
| Never modify repository contents on internal error | PRD §48 | All phases |
| Never corrupt Bob workflow state | PRD §48 | Phase 3 (T3.6 atomic writes) |
| Log decisions and errors to `~/.bobtention/logs/` | PRD §48 | Phase 0 (T0.5), All phases |
| Timeout protection (hooks respond within Bob timeout) | PRD §47 | Phase 2 (T2.3 timeout configs) |
| Decision engine timeout → fallback → fail-open | PRD §48 | Phase 5 (T5.5) |
| Messages to stderr, not stdout | Bob API | Phase 6 (T6.2) |
| No retroactive claims | PRD §30.4 | Phase 6 (T6.3) |
| Conservative enforcement — signals accumulate | PRD §30.3 | Phase 4 (T4.4) |
| Alert fatigue prevention | PRD §30.5 | Phase 4, Phase 5 |

---

## Summary Table

| Phase | Focus | ADR | Key Deliverable |
|-------|-------|-----|-----------------|
| 0 | Scaffolding + error foundation | 001 | Project structure, error wrapper, logger |
| 1 | Types + config + event model | 002 | All TS types, config loader |
| 2 | Hook Adapter + Normalizer | 003 | Bob hook entry points, event normalizer |
| 3 | Session Manager | 004 | State management, failure/scope tracking |
| 4 | Signal Extractor | 005 | 5 signal detectors |
| 5 | Decision Engine | 006 | Evaluator + JEV/Laya adapter + fallback |
| 6 | Enforcement + Notification | 007 | Exit codes, formatted messages |
| 7 | Human Override | 008 | Override command, advisory mode |
| 8 | Integration + Demo | 009 | E2E tests, demo, README, install script |

**Total: 9 phases, 9 ADRs, 52 tasks**

---

## ADR Convention

Each ADR follows this template:

```markdown
# ADR-NNN: <Title>

**Status:** Accepted
**Date:** YYYY-MM-DD
**Phase:** N

## Context
<What problem or decision this addresses>

## Decision
<What we decided>

## Rationale
<Why this choice>

## Consequences
<What this means going forward>

## Alternatives Considered
<Other options and why they were rejected>
```

All ADRs live in `dosc/adr/` and are numbered sequentially.
