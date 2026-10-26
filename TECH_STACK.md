# PlanPal — Technology Stack Specification

| Area | Selected Technology | Architectural Justification | Alternatives Evaluated & Rejected |
| :--- | :--- | :--- | :--- |
| **Runtime & Language** | Node.js (v24) + TypeScript (Strict) | Single language across domain, services, and API; end-to-end type safety | Python / Go (separate type definitions and build systems) |
| **Validation** | Zod | Single source of truth for TypeScript types, API boundary parsing, and AI output schemas | Hand-written validators, Joi |
| **Database** | SQLite (Better-SQLite3) / PostgreSQL compatible | Transactional integrity (`WAL` mode), foreign key cascading, zero network overhead in single-region deployments | MongoDB (unstructured, lacks strict relational foreign keys) |
| **Security & Auth** | Bcrypt / Argon2id + JWT / HttpOnly Cookie | IDOR-safe owner scoping on every query, secure password hashing, CSRF & CSP headers | Third-party hosted auth (unnecessary coupling) |
| **AI Architecture** | Swappable `AIProvider` Interface + `MockAIProvider` / Anthropic | Schema-constrained JSON generation, bounded token limits, deterministic domain post-normalization | Unconstrained LLM output, scattered direct API calls |
| **Testing** | Vitest + Supertest + Vitest Coverage V8 | Fast ESM test execution, pure domain unit tests (≥90% coverage target), API route integration | Jest (heavier configuration, slower ESM support) |
| **Frontend** | Semantic HTML5, Vanilla CSS Design System, Responsive Glassmorphism | Zero build-step bundle bloat, instant page loading, full WCAG 2.1 AA keyboard & ARIA compliance | Heavy monolithic UI kits (causes bundle bloat) |
