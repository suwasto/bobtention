# Bobtention — Ask / Documentation Context

## Source of truth is dosc/
- `dosc/PRD.md` — product requirements, decision model, all signal definitions, all demo scenarios (§32–§41)
- `dosc/PLAN.md` — 9-phase execution plan, all exact TypeScript type definitions, `.bob/settings.json` hook registration structure
- `dosc/adr/` — ADRs 001–009 (to be created as phases complete)

## No source code exists yet
The repo is pre-implementation. All architecture, types, config shapes, and hook structures are defined only in `dosc/PLAN.md`.

## "JEV/Laya" is the hackathon-supplied decision runtime
It is not a public product. Treat it as a user-configured HTTP endpoint behind the `DecisionEngine` adapter interface.

## `.bob/settings.json` is workspace-level Bob config
It is not a project config file — it configures Bob's hook lifecycle for this workspace. The hook registration format for `PreToolUse`/`PostToolUse` differs from other hooks (uses a nested `matcher` + `hooks` array).

## `bobtention.config.json` is user-facing config
Lives at workspace root (or `~/.bobtention/config.json` for global). Not the same as `.bob/settings.json`.
