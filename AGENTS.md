# PlanPal — Agent Instructions & Operational Rules

## 1. Prime Directive
**READ `memory.md` FIRST** before performing any inspection, planning, or code modifications.

## 2. Source of Truth Hierarchy
1. **Actual repository state** verified by direct inspection.
2. **Real command / test / build / audit output**.
3. **Specification documents** in repository root (`PRD.md`, `TECH_STACK.md`, `ARCHITECTURE.md`, `PROJECT_RULES.md`, etc.).
4. `memory.md`.
5. Prior AI claims. **Never trust a claim of "done" without verification.**

## 3. Core Architectural Rules
- Follow `ARCHITECTURE.md` layering strictly: Pure Domain $\to$ Schemas $\to$ Services $\to$ DB Repositories $\to$ API Routes $\to$ Frontend.
- Domain code (`src/domain/`) must remain pure: zero I/O, zero network, zero database dependencies.
- **The LLM NEVER performs arithmetic or security decisions.** All budget allocations, totals, and percentages are computed deterministically in pure TypeScript.
- All monetary amounts are stored as integers in **minor units** (e.g. cents).
- Every event query or mutation MUST be scoped by `owner_id = ?` (IDOR-proof). Foreign resources return 404.
- Every state change must be verified by running the test suite (`npm test`, `npx tsc --noEmit`).
