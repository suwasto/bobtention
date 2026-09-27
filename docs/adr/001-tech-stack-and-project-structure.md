# ADR 001 — Tech Stack & Project Structure

**Status:** Accepted  
**Date:** 2025-07-28  
**Phase:** 0 — Project Scaffolding  

---

## Context

Bobtention is an IBM Bob hackathon MVP that must run entirely as shell-invoked hook scripts. There is no web app, no cloud backend, and no separate account system. The hooks are invoked by Bob per event (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop), and must start, run, and exit within their timeout windows (5–10 s). The technology choice must be:

- Fast to start (no heavy JVM/container overhead)
- Type-safe enough to prevent runtime surprises
- Familiar to the team
- Compatible with the Node.js environment already available in Bob's execution context

---

## Decision

**Language:** TypeScript, compiled to CommonJS JavaScript via `tsc`, executed as `node dist/hooks/*.js`.

**Test framework:** Vitest (fast, native ESM/CJS, no config required for simple suites).

**Lint/Format:** ESLint + Prettier (standard TypeScript configuration).

**Directory layout:**

```
src/
├── hooks/        # Entry points — one file per Bob hook
├── core/         # Session manager, signal extractor, attention evaluator,
│                 # context builder, enforcement, notification
├── adapters/     # decision-adapter (JevLayaAdapter + LocalRuleAdapter)
├── types/        # All shared TypeScript types
└── utils/        # errors.ts (fail-open wrapper), logger.ts

tests/            # Vitest test suites mirroring src/

dosc/
├── PRD.md
├── PLAN.md
└── adr/          # Architecture decision records
```

---

## Rationale

- **TypeScript over plain JS:** Prevents class of runtime bugs (undefined property access, wrong payload shape) that would be invisible in plain JS and hard to debug in a short hook invocation.
- **CommonJS output:** Bob hooks are invoked via `node dist/hooks/…`. CommonJS avoids ESM loader complexity in Node <22.
- **No external runtime dependencies (MVP):** The fewer npm packages installed on the target machine, the more portable the hooks are. Only dev dependencies (TypeScript, ESLint, Prettier, Vitest) are needed at build time.
- **Vitest over Jest:** Faster cold starts; better TypeScript support out of the box; zero-config for this project size.

---

## Fail-Open Decision

Every hook entry point is wrapped in `runHook()` from `src/utils/errors.ts`. This wrapper:

1. Awaits the hook body function.
2. On success: exits with the returned code (0 or 2).
3. On any thrown exception: logs the error to stderr and exits 0.

**Rationale:** An internal Bobtention crash must never appear to Bob as a deliberate BLOCK (exit 2). Fail-open preserves Bob's default autonomous behavior when Bobtention malfunctions.

---

## Consequences

- All hook logic must be async-safe (no sync I/O that can throw unhandled exceptions outside the wrapper).
- `src/utils/logger.ts` is the only permitted log destination — never `console.log` (pollutes stdout).
- stdout is reserved exclusively for Bob context injection (SessionStart, UserPromptSubmit).

---

## Alternatives Considered

| Option | Rejected reason |
|--------|----------------|
| Plain JavaScript | No type safety; payload shape errors silent until runtime |
| Python | Not guaranteed on all Bob execution environments; slower startup |
| Deno | Not universally available; different module resolution |
| Bun | Fast, but not yet universally installed; adds complexity |
