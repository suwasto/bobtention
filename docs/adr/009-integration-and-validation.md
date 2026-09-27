# ADR-009: Integration, Validation, and Demo Strategy

**Status:** Accepted
**Date:** 2024-01-15
**Phase:** 8

## Context

Phase 8 is the final integration phase. The goal is to verify that all 9 phases deliver a coherent system that satisfies every MVP acceptance criterion in PRD §52, and to produce the demo and install artefacts that hackathon judges will use to evaluate the project.

Key concerns entering this phase:
- All 150 unit tests from Phases 0–7 pass independently; they need to be complemented by a lifecycle test that exercises the entire pipeline as a single system.
- The build output (`dist/hooks/*.js`) must be directly invokable by Bob hooks with no additional configuration.
- A demo script must be reproducible, self-contained, and cover all 5 acts from PRD §38–§41 without requiring a live JEV/Laya instance.
- The install script must work on any machine with Node.js ≥ 18 and safely merge with existing `.bob/settings.json` files.
- ADR 009 must document any deviations from the PRD so the record is complete.

## Decision

### T8.1 — Build

`npm run build` runs `tsc` (main sources) then `tsc -p tsconfig.scripts.json` (CLI scripts). This was already in place from Phase 0. Confirmed: `dist/hooks/*.js` produced correctly, `dist/scripts/override.js` available as the `npx bobtention` entry point.

### T8.2 — Install script

`scripts/install.sh` takes an optional target workspace directory (defaults to `$PWD`). It:
1. Runs `npm run build` from the Bobtention repo root.
2. Creates `bobtention.config.json` with all defaults if it does not exist (idempotent).
3. Writes `.bob/settings.json` using absolute paths to `dist/hooks/` from the Bobtention repo. If `.bob/settings.json` already exists and already references Bobtention hooks, it is left unchanged.
4. Creates `~/.bobtention/sessions/` and `~/.bobtention/logs/` directories.

### T8.3 — End-to-end integration tests

`tests/integration/e2e-lifecycle.test.ts` simulates the full Bob hook lifecycle using the public module APIs (not shell subprocess calls). This approach avoids requiring a compiled `dist/` at test time while exercising every module in concert:

- Act 1: Normal auth work → all ALLOW, no BLOCK decisions after 6 actions
- Act 2: 4 identical test failures → deterministic BLOCK on the 5th action
- Act 3: OAuth intent + payment file → TASK_DRIFT signal detected
- Act 4: BLOCK → `setOverride` → `checkAndConsumeOverride` → exit 0, single-use verified
- Act 5: Migration file edit → HIGH_IMPACT_CHANGE signal → WATCH or BLOCK
- Full lifecycle: session created, 3 PreToolUse+PostToolUse cycles, Stop → `status: completed`
- Bounded history: capped at `config.session.maxActions`
- Fail-open: empty state and stop-event return ALLOW without panic

### T8.4 — Demo scenarios

The 5 demo acts map to PRD §38–§41 as follows:

| Act | PRD Reference | Trigger | Expected outcome |
|-----|---------------|---------|-----------------|
| 1 | §38 Act 1 | Normal OAuth work | ALLOW throughout, no interruption |
| 2 | §39 Act 2 | 4 identical test failures | BLOCK with REPEATED_FAILURE explanation |
| 3 | §40 Act 3 | OAuth intent → payment file | BLOCK/WATCH with TASK_DRIFT explanation |
| 4 | §41 Act 4 | Override after BLOCK | Exit 0, override consumed, second action evaluates normally |
| 5 | PRD §36 | Migration file edit | WATCH or BLOCK with HIGH_IMPACT_CHANGE explanation |

### T8.5 — Demo shell script

`scripts/demo.sh` pipes JSON payloads through `node dist/hooks/*.js` for each act. It uses `local` decision engine (no JEV/Laya endpoint required). Acts can be run individually (`./scripts/demo.sh 2`) or all at once. `DEMO_PAUSE` env var controls sleep duration between steps.

### T8.6 — README

`README.md` covers: one-sentence pitch, architecture diagram (text), installation (quick and manual), full configuration reference, override usage, development commands, and demo instructions. It is written to be self-sufficient for a hackathon judge who has not read the PRD.

## Rationale

**Integration tests use module APIs, not subprocess hooks.** Shell subprocess tests would require `dist/` to be built before `npm test` runs, coupling build and test in a fragile way. Module-level API tests are faster, deterministic, and show the same pipeline in the same order. The demo script covers the subprocess path.

**Demo script uses absolute paths.** Relative paths in `.bob/settings.json` break when Bob is invoked from a different working directory. The install script writes absolute paths to the Bobtention `dist/` directory.

**No Act 5 BLOCK guarantee.** The PRD says WATCH or BLOCK for high-impact changes (PRD §22). The test and demo correctly accept either — the exact outcome depends on the confidence threshold and whether other signals are present.

**Override in demo.** Act 4 in the demo script calls `dist/scripts/override.js` directly, which writes the `pendingOverride` to disk. The subsequent `pre-tool-use.js` invocation reads it and allows through — exactly the real-world flow.

## Consequences

- All 159 tests pass (150 unit + 9 integration).
- `npm run build && ./scripts/demo.sh` is the complete judge walkthrough.
- `./scripts/install.sh /path/to-workspace` installs Bobtention into any Bob workspace.
- Session state lives in `~/.bobtention/sessions/` and survives Bob restarts.
- The system is fully local — no external service is required to run any of the above.

## Alternatives Considered

**Subprocess integration tests.** Shell out to `node dist/hooks/pre-tool-use.js` in tests. Rejected: requires build before test, harder to debug, no advantage over module-level tests for correctness.

**Single combined install + demo script.** Rejected: install is a one-time operation that mutates workspace files; demo is repeatable and read-only. Separating them makes the install easier to audit and the demo safe to run many times.

**JEV/Laya live integration test.** Rejected for MVP: the decision adapter already has dedicated tests with a mock endpoint. A live integration test requires a running JEV/Laya instance which is not available in CI or for hackathon judges.
