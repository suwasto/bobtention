# Bobtention

> **Human attention router for IBM Bob.** Lets Bob work autonomously and interrupts you only when the session gives a meaningful reason to pay attention.

Bobtention runs as a set of [IBM Bob](https://www.ibm.com/bob) hook scripts. It tracks the trajectory of every Bob coding session — task alignment, progress, scope, action impact, and uncertainty — and routes attention using an **Allow / Watch / Block** decision model. When Bob is working normally Bobtention stays invisible. When Bob gets stuck, drifts off task, or reaches a high-impact action, Bobtention stops Bob and explains why.

---

## How It Works

```
Developer prompt
      │
      ▼
 UserPromptSubmit ──→ capture intent
      │
      ▼ (for each tool use)
  PreToolUse ──→ evaluate ──→ ALLOW → continue
                          └──→ WATCH → continue + log
                          └──→ BLOCK → stop + explain
      │
  PostToolUse ──→ observe outcome, accumulate signals
      │
    Stop ──→ finalize session
```

**Decision model**

| Decision | Meaning |
|----------|---------|
| `ALLOW`  | No concern — Bob continues uninterrupted |
| `WATCH`  | Low concern — logged, no interruption |
| `BLOCK`  | Action stopped, human attention required |

**Attention signals detected**

| Signal | Trigger |
|--------|---------|
| `TASK_DRIFT` | Activity diverges from the original intent or initial file scope |
| `REPEATED_FAILURE` | Same test/build failure ≥ N times without progress |
| `SCOPE_EXPANSION` | Touched directories expand well beyond the initial working set |
| `HIGH_IMPACT_CHANGE` | File path matches a destructive, credential, schema, or deployment pattern |
| `UNCERTAINTY` | Rapid direction changes across many unrelated modules |

---

## Installation

### Prerequisites

- Node.js ≥ 18
- An IBM Bob workspace
- `npm run build` output in `dist/` (see below)
- **Self-hosted Laya** running at `http://localhost:8000` (required for AI-powered decisions — see [Using Laya](#using-laya) below). Without it, Bobtention falls back to local threshold rules automatically.

### Quick install (any Bob workspace)

**Option A — Bob IDE plugin (recommended):**

1. Open the Bob IDE.
2. Navigate to the **Extensions / Plugins** panel.
3. Search for **Bobtention** and click **Install**.
4. Open your workspace — Bobtention hooks are applied automatically.

**Option B — shell installer:**

```bash
# From the Bobtention repo root:
./scripts/install.sh /path/to/your-workspace

# Or install into the current directory:
./scripts/install.sh
```

The installer:
1. Builds `dist/hooks/*.js`
2. Creates a default `bobtention.config.json` in the target workspace (if absent)
3. Registers all 5 hooks in `.bob/settings.json`
4. Creates `~/.bobtention/sessions/` and `~/.bobtention/logs/`

### Manual install

```bash
npm run build
```

Then add the following to `.bob/settings.json` in your workspace (adjust paths):

```json
{
  "hooks": {
    "SessionStart": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node /path/to/bobtention/dist/hooks/session-start.js", "timeout": 5 }] }],
    "UserPromptSubmit": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node /path/to/bobtention/dist/hooks/user-prompt-submit.js", "timeout": 5 }] }],
    "PreToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node /path/to/bobtention/dist/hooks/pre-tool-use.js", "timeout": 10 }] }],
    "PostToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node /path/to/bobtention/dist/hooks/post-tool-use.js", "timeout": 5 }] }],
    "Stop": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "node /path/to/bobtention/dist/hooks/stop.js", "timeout": 5 }] }]
  }
}
```

---

## Configuration

Create `bobtention.config.json` in the workspace root. All fields are optional — the defaults shown below are applied automatically.

```json
{
  "enabled": true,
  "decisionEngine": {
    "provider": "laya",
    "endpoint": "http://localhost:8000/v1/systemone",
    "timeout": 3000
  },
  "autonomy": {
    "watchThreshold": 0.55,
    "blockThreshold": 0.85
  },
  "signals": {
    "taskDrift": true,
    "repeatedFailure": true,
    "scopeExpansion": true,
    "highImpactAction": true,
    "uncertainty": true
  },
  "highImpactPatterns": [
    { "pattern": "delete|remove|drop|truncate", "category": "destructive" },
    { "pattern": "migration|schema",             "category": "schema-change" },
    { "pattern": "\\.env|secret|credential|password|token|key", "category": "credentials" },
    { "pattern": "deploy|release|publish",       "category": "deployment" }
  ],
  "humanOverride": { "enabled": true },
  "session": {
    "maxActions": 50,
    "storagePath": "~/.bobtention/sessions"
  }
}
```

### Using Laya

Bobtention integrates with a **self-hosted Laya** instance for AI-powered attention decisions.

**Start Laya locally before using Bobtention:**

https://laya-ai.com/guides/self-host-laya

Bobtention uses Laya's **multi-question guardrail pattern** (`POST /v1/systemone`). Each evaluation sends a compact `state` body (task intent, current action, recent action history, failure summary — no raw file contents) together with a set of focused `choice` questions, one per concern:

| Question | What Laya reasons about |
|---|---|
| `intent_alignment` | Does the current tool + files match the stated task? |
| `guardrail_high_impact_change` | Is this specific file change routine or must-review? |
| `guardrail_task_drift` | Is this drift acceptable exploration or off-course? |
| `guardrail_repeated_failure` | Is the agent still making progress or looping? |
| `guardrail_scope_expansion` | Is the expanded scope justified by the task? |
| `guardrail_uncertainty` | Is the agent legitimately exploring or thrashing? |

Each guardrail question includes the signal's **detail text** (e.g. `File "prod.env" matches pattern ".env|secret"`) so Laya reasons about the actual evidence, not a generic label. This lets Laya override a signal when context makes it safe — a `HIGH_IMPACT_CHANGE` on a test fixture is not the same as one on a production schema.

Answers are aggregated: worst-case decision wins (`BLOCK > WATCH > ALLOW`), confidence is a weighted average biased toward the worst-case answer, and the `reason` field lists every non-ALLOW concern.

Set `decisionEngine.provider` to `"laya"` and confirm the `endpoint` points to your running instance. If Laya is unavailable or returns an error, Bobtention automatically falls back to the local threshold rule engine — Bob is never blocked by a down Laya instance.

To use only the local rule engine (no Laya required):

```json
{
  "decisionEngine": {
    "provider": "local"
  }
}
```

### Configuration resolution order

Last wins:
1. Built-in defaults
2. `~/.bobtention/config.json` (global)
3. `bobtention.config.json` in the current workspace

---

## Human Override

When Bobtention blocks an action, Bob stops and prints an explanation to stderr:

```
⚠ Bobtention — human attention required
────────────────────────────────────────
Possible task drift.

Task:    Implement OAuth login
Current: src/payment/PaymentService.kt

Signals: Task drift, Scope expansion
────────────────────────────────────────
Run `npx bobtention override` to continue.
```

To unblock, run from any terminal in your workspace:

```bash
npx bobtention override
# or, targeting a specific session:
npx bobtention override --session <session-id>
# with a custom reason:
npx bobtention override --session <session-id> --reason "payment work is intentional"
```

The override is **single-use** — it authorises exactly one action, then Bobtention resumes normal monitoring.

---

## Architecture

```
src/
├── hooks/          # Bob entry points (session-start, user-prompt-submit,
│                   #   pre-tool-use, post-tool-use, stop)
├── core/
│   ├── config.ts              # Config loader (3-level merge)
│   ├── event-normalizer.ts    # Bob raw payloads → NormalizedEvent
│   ├── session-manager.ts     # Session state: init, update, persist, finalize
│   ├── signal-extractor.ts    # 5 attention signal detectors (with detail text)
│   ├── context-builder.ts     # Builds DecisionContext; preserves signal detail
│   ├── attention-evaluator.ts # Fast ALLOW / deterministic BLOCK / engine path
│   ├── enforcement.ts         # Decision → exit code + deferredBlock
│   └── notification.ts        # stderr message formatting
├── adapters/
│   └── decision-adapter.ts    # LayaAdapter (multi-question guardrails) +
│                              #   LocalRuleAdapter (threshold fallback)
├── types/
│   └── index.ts               # All shared TS types
└── utils/
    ├── errors.ts              # Fail-open hook wrapper (runHook)
    └── logger.ts              # Structured stderr logger

scripts/
├── override.ts    # `npx bobtention override` CLI
├── install.sh     # Workspace installer
└── demo.sh        # Interactive demo (5 acts)

tests/
├── integration/
│   └── e2e-lifecycle.test.ts  # Full hook lifecycle + 5 demo scenarios
├── core/                      # Unit tests per module
├── adapters/                  # Decision adapter tests
└── utils/                     # Error wrapper tests
```

### Key invariants

- **Fail-open:** Every hook is wrapped in try/catch. Internal errors → exit 0 + stderr log. Bob never sees a spurious BLOCK from an internal failure.
- **stdout / stderr separation:** Only `SessionStart` and `UserPromptSubmit` write to stdout (context injected by Bob). All notification messages go to stderr.
- **PostToolUse never exits 2.** Concerns detected after an action are written as `deferredBlock` and enforced by the *next* `PreToolUse`.
- **Signals accumulate.** Existing signals are never cleared on a new event — severity escalates with repeated evidence.
- **Override is single-use.** `pendingOverride` is removed from session state immediately after the first PreToolUse consumes it.

---

## Demo

Run the 5-act demo script (requires a built `dist/`):

```bash
npm run build
./scripts/demo.sh          # all 5 acts
./scripts/demo.sh 1        # Act 1: Normal work — no interruption
./scripts/demo.sh 2        # Act 2: Stuck (repeated test failure → BLOCK)
./scripts/demo.sh 3        # Act 3: Task drift (OAuth → PaymentService → BLOCK)
./scripts/demo.sh 4        # Act 4: Human override → continue
./scripts/demo.sh 5        # Act 5: High-impact change (migration file → WATCH/BLOCK)
```

Each act pipes simulated Bob hook JSON payloads through the compiled hook scripts, printing all `⚠ BLOCK` and `◐ WATCH` messages as Bob would see them.

---

## Development

```bash
npm run build        # compile src/ → dist/
npm test             # vitest (161 tests)
npm run typecheck    # tsc --noEmit (both tsconfigs)
npm run lint         # eslint
npm run format       # prettier
```

Session files are written to `~/.bobtention/sessions/<session-id>.json`.  
Logs go to `~/.bobtention/logs/`.

---

## License

MIT — see [LICENSE](LICENSE).
