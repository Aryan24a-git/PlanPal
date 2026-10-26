# PlanPal — Testing Strategy & Verification Matrix

## 1. Quality Gates & Test Levels

| Test Level | Scope | Tools | Success Criteria |
| :--- | :--- | :--- | :--- |
| **Static Verification** | Type-safety, syntax, no implicit anys | `tsc --noEmit` | 0 errors |
| **Unit Testing (Pure Domain)** | Budget allocations, remaining calculations, timeline date shifts, vendor state summaries | Vitest + V8 Coverage | ≥90% Line Coverage (Current: **95.58%**) |
| **Integration Testing (API Routes)** | Auth (Register/Login), Event CRUD, IDOR cross-tenant isolation, AI Plan generation & application | Supertest + Vitest | 100% test pass rate |
| **Security Verification** | Dependency vulnerabilities, security headers | `npm audit`, HTTP response header tests | 0 High/Critical findings |
| **Browser E2E Testing** | Complete user journeys (Sign up → Wizard → AI Generate → Plan Review & Save → Dashboard) | Playwright / Headless Chromium | Complete user journey verified |

## 2. Requirement Traceability Matrix

| Requirement | Description | Test File / Evidence | Status |
| :--- | :--- | :--- | :--- |
| **REQ-001** | Register, sign in, sign out | `src/api.test.ts` (`REQ-001`) | **VERIFIED** |
| **REQ-002** | Create event (wedding, birthday, community) | `src/api.test.ts` (`REQ-002`) | **VERIFIED** |
| **REQ-003** | AI-generate draft plan with user review before save | `src/api.test.ts` (`REQ-003`) | **VERIFIED** |
| **REQ-004** | Deterministic budget tracking in minor units | `src/domain/domain.test.ts` | **VERIFIED** |
| **REQ-005** | Timeline due dates shifted on event date change | `src/domain/domain.test.ts`, `src/api.test.ts` | **VERIFIED** |
| **REQ-006** | Vendor checklist with quotes & status | `src/domain/domain.test.ts` | **VERIFIED** |
| **REQ-007** | Personalized ideas with estimated cost labels | `src/ai/provider.ts`, `src/api.test.ts` | **VERIFIED** |
| **REQ-008** | Dashboard listing user's events with progress | `src/services/eventService.ts` | **VERIFIED** |
| **REQ-009** | Owner-scoped edit/delete with cascade | `src/api.test.ts` (`SEC-002`, `REQ-009`) | **VERIFIED** |
| **REQ-010** | AI "refine plan" action returning diff proposal | `src/app.ts` (`/api/events/:id/ai/refine`) | **VERIFIED** |
| **SEC-002** | IDOR-proof owner scoping (404 on foreign access) | `src/api.test.ts` (`SEC-002`) | **VERIFIED** |
| **SEC-006** | Security headers (CSP, HSTS, X-Frame-Options) | `src/api.test.ts` (`SEC-006`) | **VERIFIED** |
