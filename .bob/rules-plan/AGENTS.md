# Bobtention — Plan / Architecture Rules

## Enforcement is pre-action only at PreToolUse
PostToolUse can observe but cannot block. Plan any high-impact detection logic at `PreToolUse` or accept deferred enforcement (PostToolUse sets pending BLOCK → next PreToolUse enforces). Never design a feature that requires retroactive action cancellation.

## Decision path has two lanes by design
1. **Fast/deterministic** — no signals or clear-cut condition (e.g., 4+ identical failures) → no external call, immediate exit.
2. **Slow/intelligent** — ambiguous signals → build `DecisionContext` → call `DecisionEngine`.
Any new feature that calls JEV/Laya on every event violates the architecture.

## Three separate config files, three separate concerns
| File | Purpose | Location |
|------|---------|----------|
| `.bob/settings.json` | Bob hook registration | workspace root |
| `bobtention.config.json` | Bobtention policy (thresholds, signals, patterns) | workspace root or `~/.bobtention/config.json` |
| `~/.bobtention/sessions/` | Runtime session state | user home |

## Signal severity accumulates — single events do not trigger BLOCK
`low → medium → high` severity progression is required. A single unusual file never BLOCKs directly; it raises severity and may invoke JEV/Laya.

## Phases are strictly sequential with ADR gates
Each phase produces one ADR before the next begins. Phase N depends on all types/interfaces from Phase N-1. The ADR template is defined in `dosc/PLAN.md` bottom section.

## Human override scope is intentionally narrow
MVP override scope is `next_action` only. Do not expand to `current_session` or `project_policy` in the MVP — those are listed as future versions in PRD §25.

## Advisory mode is a config flag, not a separate code path
When `config.humanOverride.enabled = false`, BLOCK becomes exit 0 + warning. The same enforcement code handles both — just the exit code changes.
