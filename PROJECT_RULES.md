# PlanPal — Permanent Project Rules & Engineering Constraints

1. **Layering & Separation of Concerns**:
   - `src/domain/`: Pure domain logic with zero external I/O or database dependencies.
   - `src/schemas/`: Single source of truth for validation schemas and TypeScript types.
   - `src/services/`: Use-case workflows, transaction management, and owner-scoping checks.
   - `src/db/`: Database connection, migrations, foreign keys, and indexes.
   - `src/ai/`: Swappable LLM adapters with mock fallbacks.
   - `public/`: UI templates, styling, and accessible client interactions.

2. **Deterministic Arithmetic**:
   - The LLM **never** performs arithmetic or makes security decisions.
   - All budget allocations, totals, and percentages are computed in pure TypeScript.
   - All financial amounts are stored as integers in minor units (e.g., cents).

3. **Date Shift Invariant**:
   - Event tasks are anchored by relative day offsets (`daysBeforeEvent`).
   - Changing the event date automatically recomputes due dates for all tasks.

4. **Security & Ownership**:
   - Every database query for event resources must include `owner_id = ?` (IDOR proof).
   - Foreign resources return `404 Not Found`.
   - Never log passwords, tokens, API keys, or brief contents.

5. **Quality Gates**:
   - Strict TypeScript: `noImplicitAny: true`, `strictNullChecks: true`, `noUncheckedIndexedAccess: true`.
   - Domain unit test line coverage must remain ≥ 90%.
   - `npm audit` must have 0 High/Critical findings.
