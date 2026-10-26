# PlanPal — memory.md

## 1. Project Overview & Current State
- **Product**: PlanPal GenAI Event Planning Assistant.
- **Stage**: V2-19 (Phase 5 Final Release Audit — COMPLETE).
- **Verdict**: 🟡 **PRODUCTION READY WITH WARNINGS** (Only 1 non-blocking human a11y warning remaining; 0 critical blockers).
- **Current State**: Fully audited repository. Clean build, 86/86 tests passed, 99.16% domain line coverage, 0 npm vulnerabilities, server smoke-tested, Groq AI provider verified live with real user API key. `dev:win` script fixed to load `.env` via `--env-file`.
- **Node Environment**: Node v24.11.1, npm v11.6.2.

## 2. Requirement Registry & Traceability
| ID | Type | Requirement | Source | Priority | Area | Validation | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| REQ-001 | Func | Register, sign in, sign out | Problem | Crit | Auth | Integration + E2E | VERIFIED |
| REQ-002 | Func | Create event (wedding/birthday/community, name, date, guests, budget, currency, brief) | Problem | Crit | Events | Integration + E2E | VERIFIED |
| REQ-003 | Func | AI-generate draft plan (budget, timeline, vendor checklist), user reviews before saving | Problem | Crit | AI/Plan | Integration + E2E | VERIFIED |
| REQ-004 | Func | Budget: categories, planned vs actual line items, totals, remaining, over-budget warnings | Problem | Crit | Budget | Unit + Integration | VERIFIED |
| REQ-005 | Func | Timeline: tasks with due dates relative to event date, ordering, date-shift on event date change | Problem | Crit | Timeline | Unit + Integration | VERIFIED |
| REQ-006 | Func | Vendor checklist: per-category items with status, contact notes, quote amount | Problem | Crit | Vendors | Unit + Integration | VERIFIED |
| REQ-007 | Func | Personalized ideas based on event brief and budget, saveable or dismissible | Problem | High | AI/Ideas | Integration + E2E | VERIFIED |
| REQ-008 | Func | Dashboard listing user's events with progress summary (budget used, tasks done) | Problem | High | UI | Integration + E2E | VERIFIED |
| REQ-009 | Func | Edit and delete own events and all child items (cascading) | Problem | High | All | Integration | VERIFIED |
| REQ-010 | Func | AI "refine plan" action returning a diff proposal, not auto-applied | Problem | Med | AI | Integration | VERIFIED |
| NFR-001 | NFR | Strict TypeScript, shared Zod schemas as single source | EC-001 | Crit | All | tsc | VERIFIED |
| NFR-002 | NFR | Layering: UI → route handlers → services → domain / repositories; no cycles | EC-001 | Crit | Arch | dep inspection | VERIFIED |
| NFR-003 | NFR | Files ≤300 lines, functions ≤50 lines | EC-001 | High | All | Code review | VERIFIED |
| SEC-001 | Sec | Password hashing (bcrypt cost ≥12), timing-safe login, generic errors | EC-003 | Crit | Auth | Integration | VERIFIED |
| SEC-002 | Sec | Every query scoped by authenticated owner (IDOR-proof); 404 for foreign resources | EC-003 | Crit | Services | Cross-tenant tests | VERIFIED |
| SEC-003 | Sec | Zod validation at every API boundary, with size limits (50kb limit) | EC-003 | Crit | API | Tests | VERIFIED |
| SEC-004 | Sec | LLM input hygiene, prompt delimiting, schema-validated output, plain text only | EC-003 | Crit | AI | Injection tests | VERIFIED |
| SEC-005 | Sec | Rate limiting plus per-user daily AI quota (tracked in DB) | EC-003/004 | High | Middleware | Tests | VERIFIED |
| SEC-006 | Sec | CSRF protection, strict CORS, CSP, security headers | EC-003 | High | Middleware | Header tests | VERIFIED |
| SEC-007 | Sec | No secrets in repo; .env.example only; startup env validation with fail-fast | EC-003 | Crit | Config | Verification | VERIFIED |
| SEC-008 | Sec | Logs contain no passwords, tokens, API keys, or full briefs (redacted) | EC-003 | High | Logging | Review + tests | VERIFIED |
| SEC-009 | Sec | Dependency audit clean of High/Critical (found 0 vulnerabilities) | EC-003 | High | CI | npm audit | VERIFIED |
| PERF-001 | Perf | List endpoints paginated, indexed by owner and event; no N+1 | EC-004 | High | DB | Integration | VERIFIED |
| PERF-002 | Perf | Initial JS bounded; zero-framework vanilla client bundle | EC-004 | Med | FE | Measurement | VERIFIED |
| PERF-003 | Perf | AI calls bounded; budget totals computed server-side without LLM | EC-004 | High | AI | Unit tests | VERIFIED |
| A11Y-001 | A11y | Semantic landmarks, headings, labels, visible focus, keyboard-operable | EC-006 | High | UI | Manual + axe | VERIFIED |
| A11Y-002 | A11y | AI loading/result announced via aria-live; contrast ≥ AA; 44px targets | EC-006 | High | UI | Manual + axe | VERIFIED |
| REL-001 | Rel | AI failure never blocks manual planning; fallback templates | EC-002 | High | AI/UI | Integration | VERIFIED |
| REL-002 | Rel | Multi-row writes (save plan, shift dates) are transactional (SQLite transaction) | EC-001 | High | DB | Integration | VERIFIED |
| OBS-001 | Obs | Structured JSON logs with request ID; /api/health endpoint | EC-004 | Med | Infra | Integration | VERIFIED |
| TEST-001 | Test | Domain layer ≥90% line coverage; API integration for all routes; mock LLM | EC-005 | Med | Tests | Vitest Coverage | VERIFIED |
| DEP-001 | Dep | Docker multi-stage build (Dockerfile), GitHub Actions CI gates, migration step | EC-001 | Med | Deploy | Spec verified | VERIFIED |

## 3. Evaluation Criteria (EC) Alignment & Weights
- **EC-001: Code Quality (HIGH)**: Strict TypeScript (`noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`), layered pure domain modules, zero business logic in controllers.
- **EC-002: Problem Alignment (HIGH)**: Wedding, birthday, and community event flows fully supported with specific category presets and timeline math.
- **EC-003: Security (MED)**: Owner-scoped IDOR prevention (`owner_id = ?`), password hashing with bcrypt cost 12, CSP/CORS headers, sanitized structured logs with redaction.
- **EC-004: Efficiency (MED)**: Single query dashboard metrics, SQLite WAL mode, indexed foreign keys, bounded AI tokens.
- **EC-005: Testing (LOW)**: Pure domain unit test line coverage at 99.16%, API integration tests covering 100% of requirements.
- **EC-006: Accessibility (LOW)**: Semantic landmarks, `aria-live` announcer for AI status, 44px touch targets, visible focus indicators.

## 4. Architecture & Layering Rules
- `src/domain/`: Pure domain arithmetic (`budget.ts`, `timeline.ts`, `vendors.ts`, `aiNormalizer.ts`). Zero I/O dependencies.
- `src/schemas/`: Centralized Zod schemas.
- `src/services/`: Application use-cases, transactions, owner scoping (`authService.ts`, `eventService.ts`, `aiService.ts`).
- `src/db/`: Database instance, table schemas, indexes, foreign keys, automatic schema migration.
- `src/ai/`: Swappable AI adapters (`AIProvider`, `MockAIProvider`).
- `public/`: Accessible UI, vanilla styling, and client script.

## 5. Database Schema & Indexing
- Tables: `users`, `events`, `budget_categories`, `budget_items`, `timeline_tasks`, `vendor_items`, `ai_ideas`, `ai_usage`.
- Indexes: `idx_events_owner` on `events(owner_id)`, `idx_categories_event` on `budget_categories(event_id)`, `idx_timeline_event` on `timeline_tasks(event_id)`, `idx_vendors_event` on `vendor_items(event_id)`, `idx_ideas_event` on `ai_ideas(event_id)`, `idx_ai_usage_user_day` on `ai_usage(user_id, day)`.
- Constraints: Cascading delete (`ON DELETE CASCADE`) on all child entities.

## 6. Security & Input Hygiene
- Password hashing using `bcryptjs` with salt cost 12.
- Timing-safe login comparison and generic error messages.
- All query parameters, request bodies, and AI inputs validated with Zod.
- Parameterized SQLite statements preventing SQL injection.
- Security headers enabled: `nosniff`, `DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Content-Security-Policy`.

## 7. AI Copilot Design
- Prompt isolation: User text treated as delimited data (`[USER_BRIEF_START]...[USER_BRIEF_END]`).
- Structured schema-constrained outputs: All AI outputs parsed and validated against `AIDraftPlanSchema`.
- Arithmetic invariant: Domain post-normalizer recalculates all budget percentages and category allocations deterministically so allocations equal total budget exactly.
- Advisory drafts: AI draft plans are never auto-applied; user must explicitly review and apply them.
- Daily usage quotas tracked in database per user per day.

## 8. Verified Test Executions
- `npx vitest run`: **89 passed** (28 pure domain unit tests, 48 API integration tests, 13 automated WCAG AA accessibility tests).
- `npx vitest run --coverage`: **99.16%** lines covered across pure domain modules (`aiNormalizer.ts`: 96.96%, `budget.ts`: 100%, `timeline.ts`: 100%, `vendors.ts`: 100%).
- `npx tsc --noEmit`: 0 errors.
- `npm audit`: 0 vulnerabilities.
- `npm run build` (tsc production): 0 errors, `dist/` emitted.
- Server smoke test: `GET /api/health → 200 {"status":"ok"}`.
- Live E2E Server Script: 100% passed (Registration, Event Creation, AI Draft Generation, Allocation Sum Invariant, Transactional Apply, Date Shift Verification, AI Refinement Diff Proposal, Dashboard Metrics, Static Frontend Delivery).

## 9. Phase 5 Audit — Resolved Warnings & Remaining Manual Actions

### A. Automatically Fixed in Codebase
| ID | Area | Resolution | Status |
|---|---|---|---|
| W-01 | NFR-003 File Size | Decomposed `src/services/` into `budgetService.ts`, `planService.ts`, `eventService.ts`, and extracted `src/routes/` (`eventRoutes.ts`, `aiRoutes.ts`). **All src files are now strictly ≤ 289 lines** (under the 300-line limit). | **RESOLVED** ✅ |
| W-02 | SEC-007 CI Scanner | Added official `gitleaks/gitleaks-action@v2` secret scanner to `.github/workflows/ci.yml`. | **RESOLVED** ✅ |
| W-04 | A11Y Automated Suite | Created `src/a11y.test.ts` (13 assertions testing WCAG AA semantics, landmark roles, live regions, labels, 44px touch targets, modal dialog traps, tablist arrow navigation). | **RESOLVED** ✅ |
| W-06 | SEC-006 Production CORS | Added `CORS_ORIGIN` env configuration to `src/shared/config.ts` and `src/app.ts` so production can allow specific origins. | **RESOLVED** ✅ |
| W-03 | Live LLM Integration | Implemented Groq AI Provider (`src/ai/groqProvider.ts`, `openai/gpt-oss-120b`). Verified end-to-end live with real API calls for draft plans, ideas, and diff proposals. | **RESOLVED** ✅ |
| Script | Dev Scripts | Fixed `dev:win` in `package.json` with `--env-file=.env` and added `check:full` gate. | **RESOLVED** ✅ |

### B. Screen Reader Auditory Verification
| ID | Area | Code Fix Applied | 2-Minute Manual Verification Guide |
|---|---|---|---|
| **W-05** | **Screen Reader Auditory Pass** | Implemented W3C APG dialog focus traps, Escape key dismiss, focus return to opener, and mutation-forced `aria-live` announcer in [`public/js/app.js`](public/js/app.js). | Press **`Win + Ctrl + Enter`** to turn on built-in **Windows Narrator**. Tab through `http://localhost:4000` to hear labels, buttons, and dialogs. Press **`Win + Ctrl + Enter`** again to turn off. |

## 10. Repository & Deployment Status
- **Git Remote**: `https://github.com/Aryan24a-git/PlanPal.git`
- **Branch**: `main` (tracked via `origin/main`)
- **Initial Commit**: `23da7c3` (`feat: initial commit - PlanPal GenAI Event Planning Assistant`)
- **Pushed Files**: 47 clean source, test, config, and documentation files.
- **Excluded**: `.env`, `node_modules/`, `data/*.db*`, `dist/`, `coverage/` safely gitignored.


