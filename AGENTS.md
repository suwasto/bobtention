# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project

**Bobtention** — IBM Bob Hackathon MVP. Human attention router for IBM Bob, implemented as TypeScript/Node.js hook scripts. No web app, no cloud backend, no separate accounts.

## Stack

- **Language:** TypeScript / Node.js (lightweight, runs as shell commands in Bob hooks)
- **Test framework:** Vitest
- **Lint/Format:** ESLint + Prettier
- **Build output:** `dist/hooks/*.js` (compiled hook entry points invoked by Bob)

## Commands (not yet implemented — from PLAN.md)

```
npm run build          # compile src/ → dist/
npm test               # vitest
npx bobtention override  # consume a pending BLOCK — the human override CLI command
```

## Critical Architecture Rules

### Hook exit codes are enforced by Bob — they are not optional
- `PreToolUse` and `UserPromptSubmit` exit 2 = BLOCK (Bob stops). Exit 0 = ALLOW.
- `PostToolUse`, `SessionStart`, `Stop` must **always** exit 0. Never exit 2 from these.
- `PostToolUse` cannot retroactively undo an action — it only writes deferred BLOCK state to session; the *next* `PreToolUse` enforces it.

### stdout vs stderr separation
- `stdout` is reserved for Bob context injection (only `SessionStart` and `UserPromptSubmit` use it).
- All notification messages (`⚠ BLOCK`, `◐ WATCH`) go to **stderr only**. Never stdout.

### Fail-open is mandatory, not optional
- Every hook entry point must be wrapped in try/catch. Any internal error → exit 0 + log to stderr.
- Decision engine failure → fall back to `LocalRuleAdapter` → if that fails → ALLOW with warning.
- Never surface an internal crash as exit 2 (would incorrectly BLOCK Bob).

### Decision engine is abstracted
- `JevLayaAdapter` (HTTP POST to `config.decisionEngine.endpoint`) and `LocalRuleAdapter` (threshold-based fallback) implement the same `DecisionEngine` interface.
- Selection is driven by `config.decisionEngine.provider`.
- Context sent to JEV/Laya must be minimal — no raw code, no full file contents.

### Session state writes must be atomic
- Write to temp file, then rename. Prevents corrupt session on crash mid-write.
- Default storage: `~/.bobtention/sessions/`; default log: `~/.bobtention/logs/`

### Original intent is immutable except via explicit API
- `updateIntent()` is the only way to change `originalIntent`. Agent activity never rewrites it.

## Key Types (from PLAN.md §T1.1)

```
AttentionDecision   'ALLOW' | 'WATCH' | 'BLOCK'
SignalType          'TASK_DRIFT' | 'REPEATED_FAILURE' | 'SCOPE_EXPANSION' | 'HIGH_IMPACT_CHANGE' | 'UNCERTAINTY'
DecisionContract    { decision, confidence, reason, signals, summary? }
Override.scope      'next_action' (MVP only) — consumed after single use
```

## Bob Hook Registration

Hooks live in `.bob/settings.json` (workspace-level, not project root). `PreToolUse`/`PostToolUse` require a `matcher` regex field wrapping the `hooks` array — they do not take the flat `type`/`command` structure directly.

## Directory Layout (planned)

```
src/
├── hooks/        # entry points: session-start, user-prompt-submit, pre-tool-use, post-tool-use, stop
├── core/         # session-manager, signal-extractor, attention-evaluator, context-builder, enforcement, notification
├── adapters/     # decision-adapter (JevLayaAdapter + LocalRuleAdapter)
├── types/        # all shared TS types
└── utils/        # errors.ts (fail-open wrapper), logger.ts
tests/
dosc/             # PRD.md, PLAN.md, adr/ (ADRs 001–009 to be created)
scripts/          # install.sh, demo.sh
```

## ADR Convention

Each ADR in `dosc/adr/` follows the template in `dosc/PLAN.md` (Status/Date/Phase/Context/Decision/Rationale/Consequences/Alternatives). Numbered sequentially 001–009.
