# Bobtention

> **Human attention routing for IBM Bob**

**Status:** Hackathon MVP  
**Target:** IBM Bob Hackathon  
**Primary integration:** IBM Bob Hooks  
**Decision runtime:** JEV / Laya  
**Project type:** Developer tooling / Bob workflow extension

---

# 1. Product Summary

**Bobtention** is a runtime human-attention router for IBM Bob.

It runs inside Bob's hook lifecycle and observes the trajectory of an agentic coding session.

Instead of requiring the developer to continuously watch Bob, Bobtention determines whether Bob should:

- **ALLOW** — Bob can continue autonomously.
- **WATCH** — Bob can continue, but the session should receive increased monitoring.
- **BLOCK** — the next relevant action should require human attention.

The core principle is:

> **Don't make Bob smarter. Make Bob require less unnecessary human attention.**

Bob can already inspect repositories, search files, modify code, run tests, fix failures, and continue working.

The missing layer is determining **when the human actually needs to pay attention**.

Bobtention provides that layer.

---

# 2. Problem

Agentic coding changes the developer workflow.

A traditional workflow looks like:

```text
Developer
    │
    ├── write code
    ├── run tests
    ├── inspect result
    └── repeat
```

An agentic workflow can look like:

```text
Developer
    │
    │ "Implement OAuth login"
    ▼
  Bob
    │
    ├── inspect repository
    ├── search files
    ├── inspect authentication
    ├── modify OAuth service
    ├── run tests
    ├── observe failure
    ├── modify callback
    ├── run tests
    ├── fix configuration
    ├── run tests
    └── ...
```

The developer now has two undesirable choices.

## 2.1 Constant supervision

The developer watches Bob continuously.

This reduces the benefit of autonomous coding.

The agent is autonomous in execution, but the human remains manually responsible for monitoring every step.

---

## 2.2 Blind autonomy

The developer leaves Bob running and checks later.

This introduces a different problem.

Bob may:

- repeatedly fail to make progress
- begin working outside the requested task
- expand into unrelated parts of the repository
- encounter ambiguity
- perform a high-impact action
- enter an ineffective loop
- reach a point where human judgment is valuable

The missing capability is therefore not another coding agent.

It is **attention management**.

---

# 3. Product Thesis

Most agent tooling focuses on:

> **What can the agent do?**

Bobtention focuses on:

> **When does the human need to pay attention?**

Bobtention creates an attention-routing layer between Bob's autonomous execution and the developer.

```text
                    Bob is working
                         │
                         ▼
                ┌──────────────────┐
                │    Bobtention    │
                │                  │
                │ Observe session  │
                │ Evaluate signals │
                └────────┬─────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
           ALLOW       WATCH      BLOCK
              │          │          │
              ▼          ▼          ▼
          Bob keeps   Bob keeps    Human
          working     working      attention
```

The desired experience is:

```text
Normal work
     ↓
Bob works autonomously
     ↓
No interruption
     ↓
Something meaningful changes
     ↓
Bobtention notices
     ↓
Human attention is requested
```

The absence of interruptions is itself a product feature.

---

# 4. Goals

## G1 — Reduce unnecessary human supervision

Allow Bob to perform ordinary coding work without requiring the developer to monitor every action.

## G2 — Detect situations where attention matters

Identify meaningful signals such as:

- task drift
- repeated failure
- lack of progress
- unexpected scope expansion
- high-impact actions
- conflicting or uncertain session state

## G3 — Integrate directly into Bob

Bobtention should operate through Bob's supported hook lifecycle.

It should not require replacing Bob, modifying Bob itself, or moving the developer into another application.

## G4 — Make interventions explainable

When Bobtention blocks the next action, the developer should understand:

- what Bob was asked to accomplish
- what Bob has been doing
- what changed
- why attention is being requested

## G5 — Use JEV/Laya as the decision layer

JEV/Laya should evaluate session context when a decision requires intelligent interpretation.

Bobtention should not implement its own competing agent runtime.

## G6 — Preserve human authority

Bobtention is an attention router, not an autonomous authority.

The developer must remain able to override a decision.

---

# 5. Non-Goals

Bobtention is **not**:

- a coding agent
- a code-generation system
- a code-review system
- a security scanner
- a CI system
- a release-management system
- a static-analysis platform
- an MCP replacement
- an authentication provider
- a repository graph database
- a replacement for IBM Bob
- a generic approval workflow
- a system that determines whether code is objectively "good"

The core question is:

> **Should Bob continue operating without human attention right now?**

Not:

> **Is Bob's code correct?**

---

# 6. Core Concept: Attention Routing

Bobtention evaluates the **trajectory of a session**, not just isolated events.

For example:

```text
Task:
Implement OAuth login

Session:

inspect AuthRepository
        ↓
modify OAuthService
        ↓
run tests
        ↓
test fails
        ↓
modify callback
        ↓
run tests
        ↓
test passes
```

This represents normal progress.

Decision:

```text
ALLOW
```

Compare that with:

```text
Task:
Implement OAuth login

Session:

modify AuthService
        ↓
modify OAuthCallback
        ↓
modify PaymentService
        ↓
modify BillingConfig
        ↓
modify unrelated API
```

This may indicate expanding scope or task drift.

Decision:

```text
BLOCK
```

Another example:

```text
test fails
    ↓
fix
    ↓
same test fails
    ↓
fix
    ↓
same test fails
    ↓
fix
    ↓
same test fails
```

The individual actions may all look reasonable.

The **sequence** indicates a lack of progress.

Decision:

```text
BLOCK
```

Therefore:

> Drift and stuck behavior are signals within the attention router, not separate products.

---

# 7. Decision Model

The internal decision model uses three states.

## 7.1 ALLOW

Bob is operating within the expected task trajectory.

Bobtention does not require human attention.

Examples:

- reading files
- searching the repository
- inspecting related code
- making small task-related edits
- running tests
- fixing a normal test failure
- updating clearly related configuration

Result:

```text
Allow the workflow to continue.
```

---

# 7.2 WATCH

Bobtention sees an unusual or uncertain signal, but there is insufficient evidence that human intervention is required.

Examples:

- more files are being touched than expected
- Bob moves into an adjacent module
- a test fails once
- Bob explores multiple implementation paths
- a high-impact action is approaching but context remains plausible
- task alignment is uncertain

Result:

```text
Allow the workflow to continue.

Increase monitoring sensitivity.

Record the signal in session state.
```

WATCH is important because Bobtention should not become an approval system that interrupts too aggressively.

---

# 7.3 BLOCK

Bobtention determines that human attention is required before allowing the next relevant action.

Examples:

- strong task drift
- repeated failure without observable progress
- destructive or high-impact operation
- major unexpected scope expansion
- contradictory session evidence
- prolonged autonomous loop
- decision requiring human judgment

Result:

```text
Block the relevant next action.

Explain why.

Wait for human resolution.
```

The implementation should rely on Bob's hook enforcement mechanism rather than assuming Bobtention can implement an arbitrary pause/resume UI inside Bob.

---

# 8. Attention Signals

Bobtention evaluates several signals.

## 8.1 Task Alignment

Compare:

```text
Original user intent
        ↓
Current session activity
```

Example:

```text
Intent:

"Implement OAuth login"

Current:

Editing PaymentService.kt
```

This does not automatically prove that the action is wrong.

Payment code could legitimately be involved in an authentication workflow.

Therefore the signal is:

```text
POSSIBLE_TASK_DRIFT
```

The decision layer determines whether the accumulated evidence is strong enough to BLOCK.

---

# 8.2 Progress

Bobtention tracks whether Bob is making meaningful progress.

Example:

```text
Test failure
    ↓
Fix A
    ↓
Partial improvement
    ↓
Fix B
    ↓
Test passes
```

This indicates progress.

Compare:

```text
Test failure
    ↓
Fix A
    ↓
Same failure
    ↓
Fix B
    ↓
Same failure
    ↓
Fix C
    ↓
Same failure
```

This indicates repeated failure without progress.

---

# 8.3 Action Impact

Some actions deserve more scrutiny.

Potential examples:

- database migrations
- authentication configuration
- security configuration
- deployment configuration
- infrastructure changes
- broad repository modifications
- deletion of substantial code
- destructive filesystem operations

Bobtention does **not** automatically declare these actions unsafe.

Instead:

> High-impact actions increase the amount of attention the router assigns to the current state.

---

# 8.4 Scope Expansion

Track how the current activity compares with the expected task scope.

Example:

```text
Expected:

Auth/
OAuth/
Callback/

Actual:

Auth/
OAuth/
Callback/
Payments/
Billing/
Infrastructure/
```

Scope expansion can move a session from:

```text
ALLOW
```

to:

```text
WATCH
```

and eventually:

```text
BLOCK
```

if additional evidence indicates genuine drift.

---

# 8.5 Uncertainty

Bobtention should increase monitoring when:

- multiple competing directions appear
- current actions are difficult to relate to the original intent
- the session contains contradictory evidence
- the next action has materially greater impact
- Bob repeatedly changes direction

Uncertainty is a reason to gather more context, not necessarily to immediately stop Bob.

---

# 8.6 Session History

The router must consider action sequences.

For example:

```text
Edit
→ Test failure
→ Edit
→ Test failure
→ Edit
→ Test failure
```

is materially different from:

```text
Edit
→ Test failure
→ Edit
→ Test passes
```

The same action can have a different meaning depending on what happened immediately before it.

---

# 9. JEV / Laya

## 9.1 Role

**JEV/Laya is the decision runtime provided by the hackathon environment.**

Bobtention should treat JEV/Laya as an external decision component rather than implementing or owning the decision engine itself.

Conceptually:

```text
IBM Bob
   │
   │ hook event
   ▼
Bobtention
   │
   ├── normalize event
   ├── update session state
   ├── derive signals
   │
   ▼
JEV / Laya
   │
   │ decision contract
   ▼
Bobtention
   │
   ├── ALLOW
   ├── WATCH
   └── BLOCK
```

This separation is important.

### Bobtention owns

- Bob hook integration
- event normalization
- session state
- signal extraction
- decision context
- decision contract
- enforcement
- developer-facing explanation
- local configuration

### JEV/Laya owns

- intelligent interpretation of the supplied context
- configurable decision logic
- confidence/reasoning according to the available runtime
- returning the structured decision

Bobtention should not assume undocumented JEV/Laya APIs.

Instead, it should define an adapter boundary.

---

# 10. JEV/Laya Configuration

JEV/Laya should be configurable according to the capabilities and configuration model provided by the IBM Bob hackathon environment.

Bobtention should expose a small, stable policy layer rather than coupling the entire application to a specific JEV/Laya implementation.

Conceptually:

```yaml
bobtention:
  decision_engine:
    provider: laya

    signals:
      task_drift: true
      repeated_failure: true
      scope_expansion: true
      high_impact_action: true
      uncertainty: true

    autonomy:
      default: allow

      watch_threshold: 0.55
      block_threshold: 0.85
```

The exact configuration syntax is implementation-dependent.

The PRD does **not** require these exact fields to exist in JEV/Laya.

The requirement is:

> Bobtention must be able to supply structured session context to the provided JEV/Laya runtime and receive a structured attention decision.

---

# 11. Decision Context

Bobtention should not send every raw hook event blindly to JEV/Laya.

Instead it builds a compact decision context.

Example:

```json
{
  "intent": "Implement OAuth login",
  "current_action": {
    "tool": "edit",
    "files": [
      "PaymentService.kt"
    ]
  },
  "recent_actions": [
    {
      "type": "edit",
      "files": [
        "AuthService.kt"
      ]
    },
    {
      "type": "test",
      "result": "failed"
    }
  ],
  "failures": [
    {
      "signature": "oauth_callback_test",
      "count": 3
    }
  ],
  "signals": [
    "possible_task_drift",
    "repeated_failure"
  ]
}
```

JEV/Laya then returns a stable decision.

---

# 12. Decision Contract

Bobtention should define a stable internal decision contract.

Example:

```json
{
  "decision": "ALLOW",
  "confidence": 0.94,
  "reason": null,
  "signals": []
}
```

WATCH:

```json
{
  "decision": "WATCH",
  "confidence": 0.67,
  "reason": "EXPANDING_SCOPE",
  "signals": [
    "more_files_touched_than_expected"
  ]
}
```

BLOCK:

```json
{
  "decision": "BLOCK",
  "confidence": 0.91,
  "reason": "TASK_DRIFT",
  "signals": [
    "unrelated_file_activity"
  ],
  "summary": "Bob is modifying payment code while the active task concerns OAuth authentication."
}
```

The contract isolates Bobtention from the implementation details of JEV/Laya.

---

# 13. Decision Evaluation Strategy

Bobtention should not necessarily invoke JEV/Laya for every single event.

The preferred architecture is:

```text
Hook event
    ↓
Deterministic state update
    ↓
Simple signal evaluation
    ↓
Is intelligent evaluation necessary?
    │
    ├── No ──→ ALLOW
    │
    └── Yes
          ↓
       JEV/Laya
          ↓
       Decision
```

Examples of obvious low-risk events:

```text
file read
repository search
test execution
inspection of related source
```

These can normally remain on the lightweight path.

Potentially ambiguous events can invoke JEV/Laya.

This provides:

- lower latency
- lower compute cost
- simpler architecture
- less unnecessary decision-runtime usage
- clearer separation of responsibilities

---

# 14. Architecture

```text
                         IBM Bob
                            │
                            │ Hook events
                            ▼
                 ┌──────────────────────┐
                 │      Bobtention      │
                 │                      │
                 │    Hook Adapter      │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │    Event Normalizer  │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │    Session Manager   │
                 │                      │
                 │ • intent             │
                 │ • actions            │
                 │ • files              │
                 │ • tests              │
                 │ • failures           │
                 │ • signals            │
                 │ • decisions          │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │ Attention Evaluator  │
                 └──────────┬───────────┘
                            │
                 ┌──────────┴──────────┐
                 │                     │
          deterministic            ambiguous
                 │                     │
                 │                     ▼
                 │               JEV / Laya
                 │                     │
                 └──────────┬──────────┘
                            ▼
                 ┌──────────────────────┐
                 │  Decision Contract  │
                 └──────────┬───────────┘
                            │
                ┌───────────┼───────────┐
                ▼           ▼           ▼
              ALLOW        WATCH       BLOCK
                │           │           │
                ▼           ▼           ▼
               Bob         Bob        Human
             continues    continues   attention
```

---

# 15. Bob Hook Lifecycle

Bobtention should integrate through Bob's supported hook lifecycle.

Conceptually:

```text
SessionStart
     │
     ▼
Initialize session
     │
     ▼
UserPromptSubmit
     │
     ▼
Capture original intent
     │
     ▼
PreToolUse
     │
     ├── evaluate current state
     │
     ├── ALLOW
     │
     ├── WATCH
     │
     └── BLOCK
     │
     ▼
Tool executes
     │
     ▼
PostToolUse
     │
     └── update session state
     │
     ▼
Next action
     │
     ▼
PreToolUse
     │
     └── evaluate again
     │
     ▼
Stop
     │
     ▼
Finalize session
```

The exact hook event payloads and configuration should follow the Bob version used by the hackathon.

Bobtention should not depend on undocumented behavior.

---

# 16. Important Enforcement Constraint

Bobtention should distinguish between **observation** and **enforcement**.

For example:

```text
PostToolUse
```

can observe what happened and update state.

It cannot retroactively undo an action that already happened.

Therefore high-impact decisions should be evaluated at the earliest applicable enforcement point.

Conceptually:

```text
Before action
     ↓
PreToolUse
     ↓
Bobtention evaluation
     ↓
ALLOW / WATCH / BLOCK
     ↓
If allowed:
     action executes
```

If a concerning signal is discovered only after an action:

```text
Action
     ↓
PostToolUse
     ↓
Bobtention discovers concern
     ↓
state becomes BLOCK
     ↓
next relevant action is blocked
```

This is a critical architectural constraint.

Bobtention should not claim to "undo" actions it can only observe after execution.

---

# 17. Session State

The MVP uses bounded local session state.

```text
Session
├── sessionId
├── originalIntent
├── startTime
├── status
│
├── actions[]
│   ├── tool
│   ├── input
│   ├── output
│   ├── files
│   └── timestamp
│
├── tests[]
│   ├── name
│   ├── result
│   └── timestamp
│
├── failures[]
│   ├── signature
│   ├── count
│   └── lastSeen
│
├── signals[]
│   ├── type
│   ├── severity
│   └── timestamp
│
└── decisions[]
    ├── decision
    ├── reason
    ├── confidence
    └── timestamp
```

The implementation should retain only the amount of history required for meaningful routing.

The MVP does not require a remote database.

Local memory or lightweight local persistence is sufficient.

---

# 18. Task Intent Capture

At the beginning of a session, Bobtention captures the developer's task.

Example:

```text
Implement OAuth login with Google.
```

State:

```json
{
  "intent": "Implement OAuth login with Google"
}
```

The original intent should remain stable throughout the session.

Later actions are evaluated against this original context.

Bobtention should not continuously rewrite the user's intent merely because Bob has changed direction.

If the user intentionally changes the task, that should create a new or explicitly updated task context.

---

# 19. Event Tracking

Bobtention should normalize relevant Bob events into a common representation.

Example:

```json
{
  "type": "tool_use",
  "tool": "edit",
  "files": [
    "OAuthService.kt"
  ],
  "timestamp": 1758890000
}
```

Test result:

```json
{
  "type": "test",
  "name": "OAuthCallbackTest",
  "result": "failed",
  "timestamp": 1758890020
}
```

The normalized representation allows the rest of Bobtention to remain independent of raw hook payload formats.

---

# 20. Failure Tracking

Failures should be grouped into signatures.

Example:

```text
Failure:
OAuthCallbackTest

Occurrences:
4

Latest:
FAIL
```

A simplistic counter is insufficient.

Bobtention should consider whether Bob is actually making progress.

Example:

```text
FAIL
→ different implementation
→ FAIL
→ different implementation
→ PASS
```

should not produce the same state as:

```text
FAIL
→ similar change
→ same failure
→ similar change
→ same failure
→ similar change
→ same failure
```

The decision layer should receive both the failure count and relevant progression context.

---

# 21. Scope Tracking

Bobtention should maintain a lightweight view of touched areas.

For example:

```text
Initial activity:

Auth/
OAuth/

Later:

Auth/
OAuth/
UserSession/
API/

Later:

Auth/
OAuth/
UserSession/
API/
Payments/
Billing/
```

The system does not need to construct a full repository dependency graph for the MVP.

Instead, it can track:

- files
- directories
- modules
- action frequency
- recently touched areas

This provides enough context for the initial scope-expansion signal.

---

# 22. High-Impact Action Detection

High-impact actions should be represented as signals.

Example:

```text
database migration modified
```

becomes:

```text
HIGH_IMPACT_CHANGE
```

Potential categories:

```text
DATABASE
AUTHENTICATION
SECURITY
DEPLOYMENT
INFRASTRUCTURE
DESTRUCTIVE_OPERATION
BROAD_REPOSITORY_CHANGE
```

These categories should be configurable.

The purpose is not to enforce universal rules.

Different developers and projects have different acceptable autonomy levels.

---

# 23. Intervention Flow

When the decision is BLOCK:

```text
PreToolUse
    ↓
Bobtention
    ↓
BLOCK
    ↓
Hook enforcement
    ↓
Human notification
```

Example notification:

```text
⚠ Bobtention: HUMAN ATTENTION REQUIRED

Reason:
Possible task drift

Task:
Implement OAuth login

Current activity:
PaymentService.kt

Signals:
• authentication task
• payment module modified
• previous actions stayed within Auth/

The next action was blocked.

[Continue] [Stop]
```

The exact UI depends on the available Bob hook/terminal capabilities.

Bobtention should not require a custom graphical dashboard for the MVP.

---

# 24. Human Override

Human override is fundamental.

The system must never become an opaque authority that permanently prevents Bob from continuing.

Conceptually:

```text
BLOCK
  │
  ▼
Human sees explanation
  │
  ├── Stop
  │
  └── Continue
          │
          ▼
      Override recorded
          │
          ▼
      Bob continues
```

The exact resume mechanism should use the capabilities available in the Bob hook environment.

Bobtention should not assume a native pause/resume API if one is not provided.

A practical implementation may use:

```text
BLOCK
↓
record blocked state
↓
developer explicitly overrides
↓
mark next matching action as approved
↓
Bob retries/continues
```

---

# 25. Override State

An override should be explicit and scoped.

Example:

```json
{
  "override": {
    "active": true,
    "reason": "developer_confirmed",
    "scope": "next_action"
  }
}
```

Possible scopes for future versions:

```text
next_action
current_signal
current_session
project_policy
```

The MVP only needs a narrow override mechanism.

---

# 26. Developer Experience

Bobtention should be nearly invisible during normal operation.

Desired workflow:

```text
Developer:

"Implement OAuth login."

        ↓

Bob works

        ↓

Developer works on something else

        ↓

Bobtention:

[no interruption]

        ↓

Bob finishes
```

The developer should not have to constantly interact with Bobtention.

---

# 27. Normal UI

Normal operation should be quiet.

Optional terminal output:

```text
✓ Bobtention: allow
```

However, excessive normal-status logging should be avoided.

The ideal default experience may produce no output unless the state changes meaningfully.

---

# 28. Watch UI

Example:

```text
◐ Bobtention: watching

Bob is expanding into related modules.

No action is required yet.
```

WATCH is informational.

It should not unnecessarily interrupt Bob.

---

# 29. Block UI

Example:

```text
⚠ Bobtention: human attention required

Reason:
Repeated failure

Task:
Implement OAuth login

Observed:
OAuthCallbackTest failed 4 times
without observable progress.

The next action has been blocked.

[Continue] [Stop]
```

Another example:

```text
⚠ Bobtention: human attention required

Reason:
Possible task drift

Task:
Implement OAuth login

Current:
Editing PaymentService.kt

Recent activity:
AuthService.kt
OAuthCallback.kt
PaymentService.kt

The next action has been blocked.
```

---

# 30. Safety Principles

## 30.1 Human authority

The developer remains the final decision-maker.

---

## 30.2 Explainability

Every BLOCK decision must provide a reason.

Bad:

```text
Bob blocked.
```

Good:

```text
Bobtention blocked the next action because
the same integration test has failed four times
without observable progress.
```

---

## 30.3 Conservative enforcement

Bobtention should avoid blocking based on weak evidence.

A single unusual file does not necessarily mean task drift.

A single test failure does not necessarily mean Bob is stuck.

Signals should accumulate.

---

## 30.4 No retroactive claims

Bobtention should clearly distinguish:

```text
Detected before action
```

from:

```text
Detected after action
```

It must not imply that it prevented an action when it only detected the problem afterward.

---

## 30.5 Alert fatigue prevention

The product should optimize for:

```text
Useful interventions
─────────────────────
Total interventions
```

rather than:

```text
Maximum detected anomalies
```

Too many interruptions destroy the value of autonomous operation.

---

# 31. Intelligent Evaluation Policy

A useful MVP policy is:

```text
                 Event
                   │
                   ▼
          Update session state
                   │
                   ▼
         Calculate basic signals
                   │
          ┌────────┴────────┐
          │                 │
      Clearly safe      Ambiguous /
          │             significant
          │                 │
          ▼                 ▼
        ALLOW           JEV / Laya
                            │
                            ▼
                    ALLOW / WATCH / BLOCK
```

Potential deterministic conditions:

```text
No concerning signals
        → ALLOW

Repeated identical failure
        → likely BLOCK

Explicit destructive operation
        → high-impact signal

Scope expansion
        → WATCH or JEV/Laya
```

The final architecture should remain configurable rather than hard-coding every policy.

---

# 32. Example Scenarios

## Scenario A — Normal Work

User:

```text
Implement OAuth login.
```

Bob:

```text
inspect repository
→ inspect auth module
→ edit OAuth service
→ run tests
→ fix callback
→ run tests
→ tests pass
```

Bobtention:

```text
ALLOW
```

No interruption.

---

# 33. Scenario B — Uncertainty

Bob:

```text
edit OAuth
→ inspect user model
→ modify session handling
→ modify API client
```

Bobtention:

```text
WATCH
```

Reason:

```text
Bob is expanding into related modules,
but current activity remains plausibly
related to the task.
```

Bob continues.

---

# 34. Scenario C — Task Drift

User:

```text
Implement OAuth login.
```

Bob:

```text
edit AuthService
→ edit OAuthCallback
→ edit PaymentService
```

Bobtention:

```text
BLOCK
```

Explanation:

```text
Possible task drift.

Requested:
OAuth login

Current activity:
PaymentService.kt

Recent task-aligned activity:
AuthService.kt
OAuthCallback.kt
```

---

# 35. Scenario D — Stuck

Bob:

```text
run test
→ FAIL

fix
→ FAIL

fix
→ FAIL

fix
→ FAIL
```

Bobtention:

```text
BLOCK
```

Explanation:

```text
Repeated failure detected.

The same test has failed through
multiple attempted fixes without
observable progress.
```

---

# 36. Scenario E — High-Impact Change

Bob:

```text
modify migration.sql
```

Bobtention:

```text
WATCH
```

or:

```text
BLOCK
```

depending on project policy and accumulated context.

Explanation:

```text
High-impact repository change detected.

Bob is modifying database migration behavior.
```

The purpose is to route attention, not to declare that database changes are inherently bad.

---

# 37. Scenario F — Legitimate Scope Expansion

User:

```text
Implement OAuth login.
```

Bob:

```text
AuthService.kt
OAuthCallback.kt
UserSession.kt
APIClient.kt
```

A naive system could interpret this as drift.

Bobtention should instead recognize:

```text
Scope expanded
```

and potentially:

```text
WATCH
```

rather than immediately blocking.

If later activity moves into:

```text
PaymentService.kt
BillingService.kt
Infrastructure/
```

without a clear relationship, accumulated evidence can increase the decision toward:

```text
BLOCK
```

This demonstrates why session trajectory matters.

---

# 38. Demo Strategy

The hackathon demo should tell one continuous story.

## Act 1 — Autonomous Work

Developer:

```text
Implement OAuth login with Google.
```

Bob performs several actions.

Show:

```text
✓ inspect repository
✓ find authentication module
✓ inspect OAuth implementation
✓ modify OAuth service
✓ run tests
✓ fix callback
✓ run tests
```

No interruption.

Core message:

> Bobtention stays out of the way when everything looks normal.

---

# 39. Demo Act 2 — Stuck

Introduce a controlled failing test.

Bob performs:

```text
Attempt 1 → FAIL
Attempt 2 → FAIL
Attempt 3 → FAIL
Attempt 4 → FAIL
```

Bobtention:

```text
⚠ HUMAN ATTENTION REQUIRED

Repeated failure detected.

4 attempts have not produced
observable progress.

The next action is blocked.

[Continue] [Stop]
```

This demonstrates trajectory awareness.

---

# 40. Demo Act 3 — Drift

Start:

```text
Implement OAuth login.
```

Allow Bob to modify authentication code.

Then introduce activity in:

```text
PaymentService.kt
```

Bobtention:

```text
⚠ HUMAN ATTENTION REQUIRED

Possible task drift.

Requested:
OAuth login

Current:
PaymentService.kt
```

This demonstrates that Bobtention is not merely counting errors.

---

# 41. Demo Act 4 — Human Override

Developer chooses:

```text
Continue
```

Bobtention records the override.

Bob continues.

This demonstrates:

> Bobtention routes attention; it does not replace human judgment.

---

# 42. What Makes Bobtention Different

Many developer tools focus on:

- code generation
- code review
- testing
- CI
- security
- repository understanding
- change impact
- autonomous repair
- workflow automation

Bobtention focuses on a different unit:

> **Human attention.**

A code-review system asks:

> Is this code acceptable?

Bobtention asks:

> Does this situation require human attention?

A testing system asks:

> Did the test pass?

Bobtention asks:

> Is Bob making progress?

A security system asks:

> Is this action risky?

Bobtention asks:

> Does this action warrant human attention given the current session?

That distinction should remain central to the product pitch.

---

# 43. Technical MVP

Recommended architecture:

```text
IBM Bob Hooks
       │
       ▼
Bobtention Hook Runtime
       │
       ├── Hook Adapter
       ├── Event Normalizer
       ├── Session Manager
       ├── Signal Extractor
       ├── Decision Adapter
       ├── Enforcement Layer
       └── Notification Layer
                │
                ▼
             JEV/Laya
```

Recommended characteristics:

- local-first
- lightweight
- low-latency
- no mandatory cloud backend
- no separate user account
- minimal dependencies
- transparent configuration
- replaceable decision runtime
- bounded session state

---

# 44. Suggested Internal Components

## Hook Adapter

Responsible for receiving Bob hook events.

```text
Bob
 ↓
Hook Adapter
```

It should translate Bob-specific events into Bobtention's internal event model.

---

## Event Normalizer

Converts raw events into:

```text
ToolEvent
TestEvent
SessionEvent
PromptEvent
LifecycleEvent
```

---

## Session Manager

Maintains:

```text
intent
actions
files
tests
failures
signals
decisions
overrides
```

---

## Signal Extractor

Produces:

```text
TASK_DRIFT
REPEATED_FAILURE
SCOPE_EXPANSION
HIGH_IMPACT_CHANGE
UNCERTAINTY
```

---

## Decision Adapter

Provides the stable boundary to JEV/Laya.

```text
Bobtention Context
        ↓
Decision Adapter
        ↓
JEV/Laya
        ↓
Decision Contract
```

---

## Enforcement Layer

Maps:

```text
ALLOW
WATCH
BLOCK
```

to Bob's available hook behavior.

---

## Notification Layer

Communicates BLOCK decisions and relevant WATCH information to the developer.

---

# 45. Configuration

Conceptual configuration:

```yaml
bobtention:
  enabled: true

  decision_engine:
    provider: laya

  autonomy:
    default: autonomous

  signals:
    task_drift: true
    repeated_failure: true
    scope_expansion: true
    high_impact_action: true
    uncertainty: true

  human_override:
    enabled: true
```

The exact Bob/JEV/Laya configuration syntax should be determined by the hackathon environment.

Bobtention should avoid inventing or depending on configuration features that the runtime does not actually expose.

---

# 46. Optional Policy Configuration

Future configuration could allow:

```yaml
attention:
  database:
    level: high

  authentication:
    level: high

  tests:
    level: low

  documentation:
    level: low
```

This is intentionally future-oriented.

The MVP should prove the routing concept before building a large policy language.

---

# 47. Performance Requirements

The normal deterministic path should be lightweight.

Target:

```text
Hook event
   ↓
State update
   ↓
Basic signal calculation
   ↓
Decision
```

should generally complete in well under one second.

Where possible, ordinary low-risk events should avoid invoking JEV/Laya.

The MVP should prioritize:

1. correctness
2. reliable hook behavior
3. low interruption frequency
4. understandable decisions
5. low latency

over sophisticated analysis.

---

# 48. Failure Handling

If Bobtention itself encounters an internal error, it must fail safely.

Requirements:

- never modify repository contents because of an internal error
- never corrupt Bob's workflow state
- log the error
- avoid silently claiming that an action was blocked
- make the failure visible when necessary

The exact fail-open/fail-closed behavior should follow the semantics of the Bob hook environment.

For the hackathon MVP, the implementation should favor preserving the user's ability to work while clearly reporting Bobtention failures.

---

# 49. Privacy

The MVP should be local-first.

Session data may contain:

- user prompts
- file paths
- tool inputs
- test results
- code-related metadata

Therefore Bobtention should avoid sending unnecessary repository content to external services.

Only the minimum decision context required by JEV/Laya should be supplied.

The MVP should not require a remote database.

---

# 50. Data Retention

Default behavior:

```text
Session begins
      ↓
Local state created
      ↓
Session active
      ↓
State updated
      ↓
Session ends
      ↓
State discarded or retained locally according to configuration
```

Long-term analytics are outside MVP scope.

---

# 51. Success Metrics

## 51.1 Autonomous action rate

Measure:

```text
Actions allowed without human intervention
───────────────────────────────────────────
Total relevant actions
```

The goal is not to maximize this blindly.

A higher autonomy rate is only useful if meaningful situations are still detected.

---

## 51.2 Intervention precision

Measure how often BLOCK events correspond to situations where developers considered intervention meaningful.

---

## 51.3 False interruption rate

Measure how often Bobtention blocks a workflow that the developer would reasonably have allowed to continue.

This is especially important because excessive intervention destroys the product's value.

---

## 51.4 Detection latency

Measure how quickly Bobtention identifies:

- repeated failure
- task drift
- scope expansion
- high-impact activity

---

## 51.5 Explainability

Every BLOCK should contain enough information for the developer to understand:

```text
What happened?
Why does it matter?
What can I do?
```

---

# 52. MVP Acceptance Criteria

## Installation

- [ ] Bobtention can be installed into a Bob project/workspace.
- [ ] Bob can invoke Bobtention through the supported hook lifecycle.
- [ ] No modification to Bob itself is required.

## Intent

- [ ] Captures the user's task intent.
- [ ] Maintains the original intent throughout the session.
- [ ] Allows explicit task changes to establish new context.

## Observation

- [ ] Receives relevant Bob hook events.
- [ ] Normalizes events into an internal representation.
- [ ] Maintains bounded action history.
- [ ] Tracks relevant files.
- [ ] Tracks test results.
- [ ] Tracks repeated failures.

## Signals

- [ ] Detects task-alignment changes.
- [ ] Detects repeated failure.
- [ ] Detects scope expansion.
- [ ] Detects at least one high-impact action category.

## Decision

- [ ] Produces ALLOW / WATCH / BLOCK.
- [ ] Can use JEV/Laya as the configured decision runtime.
- [ ] Uses a stable decision contract.
- [ ] Does not require JEV/Laya for every trivial event.
- [ ] Handles decision-runtime failure safely.

## Enforcement

- [ ] ALLOW permits the relevant workflow to continue.
- [ ] WATCH allows continuation while recording increased monitoring.
- [ ] BLOCK prevents the applicable next action where Bob's hook semantics allow enforcement.
- [ ] BLOCK includes a human-readable explanation.

## Human interaction

- [ ] Developer can explicitly override a BLOCK.
- [ ] Override is recorded.
- [ ] Bob can continue through the supported Bob workflow after override.

## Demo

- [ ] Normal OAuth task proceeds without unnecessary interruption.
- [ ] Stuck scenario produces BLOCK.
- [ ] Drift scenario produces BLOCK.
- [ ] High-impact action produces a meaningful attention signal.
- [ ] Human override works.
- [ ] Explanation is understandable without inspecting internal logs.

---

# 53. Explicit MVP Non-Requirements

The following should **not** be built for the hackathon MVP unless implementation becomes trivial:

- full repository dependency graph
- semantic code graph
- long-term developer profiling
- team analytics
- remote dashboard
- cloud database
- custom web application
- autonomous code repair
- custom LLM
- custom agent runtime
- complex policy language
- automatic pull-request management
- CI integration
- release automation
- comprehensive security analysis
- perfect task-intent understanding

The MVP should prove one thing:

> **Bob can work autonomously while Bobtention identifies moments that deserve human attention.**

---

# 54. Future Extensions

## 54.1 Adaptive autonomy

Learn project-specific preferences.

Example:

```text
Developer usually allows:

tests
documentation
small refactors

Developer usually wants attention for:

database changes
authentication
deployment
```

---

## 54.2 Project policies

Projects can define:

```text
authentication → high attention
database → high attention
tests → low attention
documentation → low attention
```

---

## 54.3 Attention budget

Developer could configure:

```text
Only interrupt me when
confidence of required intervention > 90%.
```

---

## 54.4 Session analytics

Example:

```text
Bob worked for 42 minutes.

23 relevant actions
18 automatically allowed
3 monitored
2 human interventions

Attention requested:
4 minutes

Autonomous time:
38 minutes
```

---

## 54.5 Team policies

Organizations could define shared attention policies for Bob.

Example:

```text
Production infrastructure:
always require attention

Database migrations:
require attention

Unit tests:
autonomous

Documentation:
autonomous
```

---

# 55. Product Boundary

The architecture should maintain three distinct responsibilities.

```text
┌─────────────────────────────────────┐
│             IBM Bob                 │
│                                     │
│      Executes the coding task       │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│           Bobtention                │
│                                     │
│    Observes and routes attention     │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│           JEV / Laya                │
│                                     │
│     Interprets decision context     │
└─────────────────────────────────────┘
```

This separation keeps the project small and makes the architecture easy to explain.

---

# 56. Core Product Loop

The entire product can be summarized as:

```text
                    USER INTENT
                        │
                        ▼
                       BOB
                        │
                        ▼
                 HOOK EVENT
                        │
                        ▼
                  BOBTENTION
                        │
             ┌──────────┴──────────┐
             │                     │
        Update state          Extract signals
             │                     │
             └──────────┬──────────┘
                        ▼
                 Need reasoning?
                    /       \
                  No         Yes
                  │           │
                  ▼           ▼
                ALLOW     JEV / LAYA
                              │
                              ▼
                         DECISION
                              │
                 ┌────────────┼────────────┐
                 ▼            ▼            ▼
               ALLOW         WATCH        BLOCK
                 │            │            │
                 ▼            ▼            ▼
                BOB          BOB         HUMAN
             continues     continues    attention
```

---

# 57. One-Sentence Pitch

> **Bobtention is a human-attention router for IBM Bob that lets Bob work autonomously and interrupts you only when the session gives a meaningful reason to pay attention.**

---

# 58. Short Hackathon Description

> Coding agents can work autonomously, but developers still have to watch them. Bobtention runs as a Bob hook and tracks the trajectory of a Bob coding session. It combines session state, task alignment, progress, scope, and action-impact signals with the hackathon-provided JEV/Laya decision runtime to determine whether Bob should **Allow, Watch, or Block**. When Bob is working normally, Bobtention stays invisible. When Bob gets stuck, drifts from the task, or reaches a situation requiring human judgment, Bobtention routes the developer's attention back to the session.

---

# 59. Product Identity

**Name:** Bobtention

**Expansion:**

```text
Bob + Attention
```

**Category:**

```text
Human Attention Router
```

**Primary positioning:**

```text
The human-in-the-loop layer for IBM Bob.
```

**Primary tagline:**

> **Bob works. Bobtention watches when you don't have to.**

Alternative:

> **Let Bob work. Get interrupted only when it matters.**

---

# 60. Final Product Principle

Bobtention should always optimize for one question:

> **Can Bob keep working without the human needing to look right now?**

If yes:

```text
ALLOW
```

If uncertain:

```text
WATCH
```

If human judgment is needed:

```text
BLOCK
```

Everything else in the system exists to answer that question reliably, quickly, and transparently.