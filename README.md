# PlanPal 🎈 — GenAI Event Planning Assistant

[![PlanPal CI](https://github.com/Aryan24a-git/PlanPal/actions/workflows/ci.yml/badge.svg)](https://github.com/Aryan24a-git/PlanPal/actions)
![Tests Passing](https://img.shields.io/badge/tests-113%2F113%20passing-brightgreen)
![Domain Coverage](https://img.shields.io/badge/domain%20coverage-97.77%25-brightgreen)
[![Gitleaks Clean](https://img.shields.io/badge/gitleaks-clean-blue)](https://github.com/Aryan24a-git/PlanPal/actions/workflows/ci.yml)
![Vulnerabilities](https://img.shields.io/badge/vulnerabilities-0-brightgreen)
[![Axe Core](https://img.shields.io/badge/axe--core-0%20violations-brightgreen)](https://github.com/Aryan24a-git/PlanPal/blob/main/docs/axe-audit-results.json)
![Node](https://img.shields.io/badge/node-v24.x-green)
![License](https://img.shields.io/badge/license-ISC-blue)

> **A reliable, full-stack, AI-powered event planning copilot built with deterministic pure-domain arithmetic, strict TypeScript layering, IDOR-safe architecture, and automated axe-core verified accessibility.**

---

## 🌟 Overview

Planning complex events (weddings, birthday parties, community festivals) is stressful and error-prone. Most AI planning assistants generate hallucinated figures, invalid calendar dates, and unpredictable mutations. 

**PlanPal** eliminates this by strictly separating **generative AI creativity** from **deterministic business logic**:
- **AI generates structured advisory proposals**: Category breakdowns, timeline milestones, vendor slots, and creative theme ideas.
- **Pure TypeScript domain code computes all arithmetic**: Budget allocations, remaining balances, currency conversions, and relative date offsets. The LLM is **never** permitted to calculate budget totals or mutate records directly.
- **Review before apply**: Users preview, inspect, and approve AI proposals in an interactive sandbox diff before saving them transactionally to the database.
- **First-class manual planning**: If AI is offline, rate-limited, or disabled, all planning features remain 100% operational.

---

## 🏗️ Architecture & Layering Rules

PlanPal enforces a strict one-way dependency flow with a central composition root container:

```
┌────────────────────────────────────────────────────────┐
│                   Vanilla Web Client                   │
│        (Bundled 33.2 KB ESModule / Glassmorphism UI)   │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP / JSON
┌───────────────────────────▼────────────────────────────┐
│                  Express API Routes                    │
│      (Rate Limit, CSP, Auth Guard, Zod Schemas)       │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│            Composition Root (DI Container)             │
│      (Auth, Events, Budget, Timeline, Vendors, AI)     │
└─────────────┬────────────────────────────┬─────────────┘
              │                            │
┌─────────────▼──────────────┐ ┌───────────▼─────────────┐
│  Pure TypeScript Domain    │ │    Database Layer       │
│  (Budget Math, Timeline    │ │ (SQLite WAL, Normal     │
│   Offsets, Normalizer)     │ │  Pragmas, Statement     │
│      *ZERO I/O*            │ │  Cache, Cascade FKs)    │
└─────────────┬──────────────┘ └─────────────────────────┘
              │
┌─────────────▼──────────────┐
│     AI Provider Adapters   │
│ (Groq Cloud / Mock Engine) │
└────────────────────────────┘
```

### Core Invariants
1. **Integer Minor Units**: All monetary values are stored and computed as integer minor units (e.g. cents: `$15,000.00` = `1500000`), completely preventing floating-point rounding errors.
2. **Deterministic Allocations**: AI draft percentages are post-normalized deterministically so `sum(category_allocations) === total_budget` down to the exact cent.
3. **Timeline Anchoring**: Tasks store relative offsets (`daysBeforeEvent`). When an event date moves, all dependent deadlines shift automatically.
4. **Advisory AI Proposals**: AI draft plans and refinements are proposals. They are never applied directly without user confirmation.

---

## 🎯 Features Walkthrough

### 1. 🔐 Secure Authentication & Session Management
- User registration and login with bcrypt password hashing (salt cost 12).
- Timing-safe login comparison preventing username enumeration.
- Stateless JSON Web Tokens (JWT) with automatic token revocation on deleted accounts.

### 2. 🎈 Event Studio & AI Wizard
- Support for **Weddings**, **Birthdays**, and **Community Gatherings**.
- Input validation: Guest estimates, target dates, budget ceilings, and natural-language brief.
- Generates a balanced draft plan in under 3 seconds using Groq Cloud LLM (or mock engine).

### 3. 💰 Deterministic Budget Planner
- Category-level planned allocations vs. actual itemized spending.
- Visual progress meters with real-time remaining balance calculations.
- Over-budget warning badges with explicit icons and text (never color alone).
- Focused partial tab refreshes: line item updates re-render only the budget panel without reloading the workspace.

### 4. 📅 Dynamic Timeline Milestones
- Chronologically sorted tasks relative to the event date (*"90 days before"*, *"30 days before"*).
- One-click completion checkboxes and real-time dashboard progress rollups.
- Moving the event date automatically re-anchors every milestone.
- Unpinned tasks shift automatically; pinned tasks retain their absolute dates.

### 5. 🤝 Vendor Directory CRM
- Pre-seeded vendor slots customized per event type (*Catering, Photography, Venue, Music, Decor*).
- Status pipeline: `to_contact` → `contacted` → `quoted` → `booked` (or `declined`).
- Quote tracking and contact notes.

### 6. 💡 AI Ideas & Themes Studio
- Personalized concepts categorized by **Theme**, **Menu**, **Activity**, and **Decor**.
- Realistic estimated cost ranges clearly marked as *"estimate"*.
- One-click **"Save to Event"** or **"Dismiss"** actions.

### 7. ✨ AI Plan Refinement (Advisory Text Proposals)
- Natural-language instructions (e.g., *"Cut food budget by 10% and allocate more to live music"*).
- Produces structured advisory text suggestions, explanations, and proposed allocations across budget, timeline, and vendors.
- User can inspect and apply or discard changes without risk of corrupting existing data.

---

## 🛡️ Security Architecture & Threat Model

| Threat Category | Risk Description | Architectural Mitigation in PlanPal | Requirement |
| :--- | :--- | :--- | :--- |
| **Account Takeover / Brute Force** | Credential stuffing, weak password storage | Salted `bcryptjs` (cost 12), timing-safe comparisons, generic error messages, deleted-token rejection | `SEC-001` |
| **Insecure Direct Object Reference (IDOR)** | Malicious user accessing or altering another user's event | All repository queries and mutations strictly enforce `owner_id = ?`. Foreign resources return `404 Not Found`. | `SEC-002` |
| **Input Tampering & Injection** | Malicious payloads or SQL injection | Strict Zod boundary validation on all endpoints with string caps (`brief` ≤ 2000 chars). Parameterized SQLite statements with strict column whitelisting (`buildUpdate`). | `SEC-003` |
| **Prompt Injection & Malicious Output** | Prompt hijacking via brief text | Delimited user inputs (`<user_brief>...</user_brief>`); Zod schema-constrained JSON outputs; strict 502 error mapping. | `SEC-004` |
| **Denial of Service / AI Cost Abuse** | High-volume API calls exhausting LLM credits | Daily request quotas tracked per user in `ai_usage` table with atomic counter increment & refund on failure; rate-limiting middleware (`express-rate-limit`). | `SEC-005` |
| **Cross-Site Scripting (XSS)** | Malicious script execution in user browser | Strict CSP (`script-src 'self'`, zero `'unsafe-inline'`), universal `escapeHtml()` sanitization across all templates. | `SEC-006` |
| **Secret Leakage** | Committing API keys or secrets | `.env` gitignored; `.gitleaks.toml` allowlist; automated `gitleaks` CI scanner; startup fail-fast on placeholder secrets. | `SEC-007` |
| **Information Disclosure in Logs** | Sensitive credentials or PII appearing in logs | Structured JSON logger with redaction allow-list; sensitive fields (passwords, tokens, briefs) stripped. | `SEC-008` |
| **Vulnerable Dependencies** | Supply-chain CVEs in packages | Continuous `npm audit` verification with 0 High/Critical vulnerabilities policy. | `SEC-009` |

---

## ♿ Accessibility (Axe-Core Verified)

PlanPal is engineered for keyboard and screen reader accessibility:

- **Automated Axe-Core Audits**: 0 violations across all 6 views (`Auth`, `Dashboard`, `Budget`, `Timeline`, `Vendors`, `Ideas`), recorded in `docs/axe-audit-results.json`.
- **W3C APG Dialogs**: Focus trap (`Tab`/`Shift+Tab`) inside modals, auto-focus on open, focus restoration on close, and `Escape` key dismissal.
- **Dynamic Live Region**: `#live-announcer` with `aria-live="polite"` announces AI generation, savings, and errors.
- **Form Association**: Explicit `<label for="...">` and `aria-label` pairing for every input, select, and icon-only button.
- **Touch Targets**: Minimum 44px hit target on all interactive elements (`styles.css`).
- **Visible Focus**: High-contrast outline rings for keyboard navigation.
- **Focus Restoration**: In partial tab refreshes, keyboard focus is dynamically restored to the active panel trigger after re-rendering.
- **Semantic Structure**: Proper heading hierarchy, landmark regions (`banner`, `main`, `region`, `contentinfo`), and ARIA roles.

---

## 💻 Tech Stack

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Runtime & Language** | Node.js (v24) + Strict TypeScript | End-to-end type safety across domain, services, and API. |
| **Validation** | Zod | Single source of truth for TypeScript types, API boundary parsing, and AI output schemas. |
| **Database** | SQLite (`better-sqlite3`) | ACID transactional integrity (`WAL` mode, `synchronous=NORMAL`, `temp_store=MEMORY`), prepared statement cache (`WeakMap`), composite indexes. |
| **Security & Auth** | `bcryptjs` + `jsonwebtoken` + CSP | IDOR-safe owner scoping, secure password hashing, strict security headers, cheap `SELECT 1` token validation. |
| **AI Adapters** | Groq Cloud (`openai/gpt-oss-120b`) + `MockAIProvider` | Schema-constrained JSON generation, deterministic post-normalization, `AbortSignal.timeout` bounded execution. |
| **Testing** | Vitest + Supertest + Vitest Coverage V8 + Axe-Core | Fast ESM test execution, pure domain unit coverage (97.77%), API integration, automated a11y. |
| **Frontend** | Semantic HTML5, Vanilla CSS, esbuild | Pre-bundled & minified client bundle (`33.2 KB`, `8.61 KB` gzip), instant loading, full keyboard & ARIA semantics with 0 axe-core violations. |

---

## 🚀 Quick Start & Local Development

### Prerequisites
- Node.js 24 (Node v24.x recommended, tested on Node 24.11.1)
- npm 10+

### 1. Installation
```bash
git clone https://github.com/Aryan24a-git/PlanPal.git
cd PlanPal
npm install
```

### 2. Environment Configuration
Copy the example environment file:
```bash
cp .env.example .env
```

Configure `.env`:
```env
PORT=4000
NODE_ENV=development
JWT_SECRET=super-secret-dev-jwt-key-replace-in-prod-minimum-32-chars-length
SESSION_MAX_AGE_SEC=86400
DATABASE_URL=./data/planpal.db

# Choose 'groq' for live GenAI or 'mock' for instant offline testing
AI_PROVIDER=groq
GROQ_API_KEY=your_real_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b
AI_DAILY_QUOTA_PER_USER=20
```

### 3. Run the Development Server
**Windows:**
```bash
npm run dev:win
```

**macOS / Linux:**
```bash
npm run dev
```

Open **`http://localhost:4000`** in your browser.

---

## 🧪 Testing & Verification Pipeline

Run the complete verification pipeline (File size gate, Oxlint + ESLint check, TypeScript compile check, 113 tests with coverage, and dependency audit):

```bash
npm run check:full
```

### Individual Verification Commands
```bash
# Run all 113 unit, integration, refactor, and accessibility tests
npm test

# Run tests with coverage report (97.77% pure domain line coverage)
npm run test:coverage

# Run linting (oxlint --deny-warnings && eslint .)
npm run lint

# TypeScript compile check (0 errors)
npm run typecheck

# Verify file size rule (<= 300 lines across all source files - NFR-003)
npm run check:lines

# Run automated axe-core accessibility audit across all 6 views
node scripts/audit-axe.js

# Run real headless Chrome CDP browser journey verification suite
npm run test:browser

# Dependency security audit (0 vulnerabilities)
npm audit

# Build client bundle (esbuild) and compile TypeScript backend
npm run build
```

---

## 🚢 Deployment (Docker & Cloud)

### Option A: Standalone Docker Deployment
PlanPal includes a multi-stage `Dockerfile` creating an unprivileged user to guarantee runtime container security:

```bash
# Build the container image
docker build -t planpal:latest .

# Run the container
docker run -d -p 4000:4000 \
  --name planpal-app \
  -e NODE_ENV=production \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -e AI_PROVIDER=mock \
  planpal:latest

# Health check endpoint
curl -fsS http://localhost:4000/api/health
# Response: {"status":"ok","database":"connected","aiProvider":"mock","timestamp":"..."}
```

### Option B: Cloud Deployment (Render / Koyeb / Fly.io)
PlanPal is completely self-contained with no external database dependencies:
1. Connect your repository to **Render** or **Koyeb**.
2. Select **Docker** or **Node** runtime (Build command: `npm run build`, Start command: `npm start`).
3. Set environment variables:
   - `NODE_ENV=production`
   - `PORT=4000`
   - `JWT_SECRET=<32+ character random string>`
   - `AI_PROVIDER=groq` *(or `mock`)*
   - `GROQ_API_KEY=<your_groq_api_key>`
   - `GROQ_MODEL=openai/gpt-oss-120b`
   - `DATABASE_URL=/data/planpal.db`
4. Deploy!

---

## 📂 Project Structure

```
├── .github/workflows/ci.yml    # CI Quality Gates (Lint, Typecheck, Tests, Axe, Audit, Docker smoke)
├── .oxlintrc.json              # Oxlint TypeScript and client static analysis configuration
├── eslint.config.js            # ESLint flat configuration
├── Dockerfile                  # Multi-stage production container
├── docs/
│   └── axe-audit-results.json  # Axe-core automated accessibility audit report
├── scripts/
│   ├── audit-axe.js            # Client-rendered axe-core a11y auditor
│   ├── check-line-counts.js    # NFR-003 file size enforcement gate (<= 300 lines)
│   └── verify-real-browser.js  # Headless Chrome CDP end-to-end journey test suite
├── public/
│   ├── index.html              # Semantic HTML5 single-page application
│   ├── css/styles.css          # Glassmorphic responsive design system (16.1 KB)
│   ├── dist/app.js             # Pre-bundled, minified client bundle (33.2 KB esbuild output, 8.61 KB gzip)
│   └── js/                     # Modular client-side ES modules (10 modules, <= 300 lines each)
│       ├── app.js              # Application entry, partial tab refreshes & focus restore
│       ├── auth.js             # Authentication view & JWT session storage
│       ├── events.js           # Dashboard view & event card rendering
│       ├── budget.js           # Budget planner view & line item mutations
│       ├── timeline.js         # Timeline milestones view & date shifts
│       ├── vendors.js          # Vendor directory view & status updates
│       ├── ideas.js            # AI ideas studio view & save/dismiss actions
│       ├── ai.js               # AI draft modal & refinement proposal banner
│       ├── api.js              # HTTP client with generic error handling
│       └── dom.js              # Shared DOM utilities & universal escapeHtml()
└── src/
    ├── server.ts               # Production HTTP listener
    ├── app.ts                  # Express application setup, routes & middleware
    ├── container.ts            # Composition Root dependency injection container
    ├── core.refactor.test.ts   # Core refactor tests (buildUpdate, statement cache, quotas, 502)
    ├── db/
    │   ├── database.ts         # SQLite connection, WAL mode, migrations & schema
    │   └── statements.ts       # Prepared statement cache (WeakMap)
    ├── routes/
    │   ├── helpers.ts          # Shared route utilities (p, uid, validate, buildUpdate)
    │   ├── authRoutes.ts       # Authentication sub-router
    │   ├── eventRoutes.ts      # Event CRUD, budget, timeline, vendors, ideas routes
    │   └── aiRoutes.ts         # AI draft generation, application, and refinement routes
    ├── schemas/index.ts        # Single source of truth Zod schemas & TypeScript types
    ├── domain/                 # Pure domain business logic (ZERO I/O, 97.77% coverage)
    │   ├── budget.ts           # Integer minor unit budget math & category allocations
    │   ├── timeline.ts         # Relative date offsets & automated date shifting
    │   ├── vendors.ts          # Vendor category presets & status rollups
    │   └── aiNormalizer.ts     # Deterministic AI plan post-normalizer
    ├── services/               # Application use-cases & owner-scoped mutations
    │   ├── authService.ts      # Password hashing, timing-safe login & JWTs
    │   ├── eventService.ts     # Owner-scoped event queries & cascading deletes
    │   ├── budgetService.ts    # Budget category & line item transactions
    │   ├── timelineService.ts  # Timeline milestone use-cases & date recalculations
    │   ├── vendorService.ts    # Vendor CRM queries & updates
    │   ├── planService.ts      # Multi-table atomic plan application
    │   └── aiService.ts        # AI quotas, prompt isolation & provider dispatch
    ├── ai/                     # Swappable AI adapters
    │   ├── provider.ts         # Abstract AIProvider interface & MockAIProvider
    │   └── groqProvider.ts     # Groq Cloud OpenAI-compatible adapter
    └── middleware/
        └── auth.ts             # JWT authentication guard & express-rate-limit
```

---

## ⚠️ Known Limitations & Design Decisions

To maintain full engineering transparency:
1. **AI Timeout & Error Mapping**: In-flight requests are bounded and aborted via `AbortSignal.timeout(config.AI_TIMEOUT_MS)`. Malformed model responses and schema validation failures map deterministically to `AiMalformedError` (502 Bad Gateway), while network interruptions and timeout limits report `AiTimeoutError` (504 Gateway Timeout).
2. **Atomic Quota Enforcement**: Daily quotas are enforced atomically via conditional `UPDATE ai_usage SET count = count + 1 WHERE count < ?` to eliminate concurrency race conditions. On the first request of each UTC day, the quota record is initialized to 1. If an AI call fails, quota is refunded via `MAX(0, count - 1)` so it never decrements below zero.
3. **Budget Allocation Ceilings**: A category planned amount exceeding the total event budget displays an overall over-budget warning metric on the dashboard, but does not block category creation or display per-row warning badges.
4. **Testing Environment Scope**: Rate limiters and static file middleware are bypassed in test harnesses to ensure sub-second local test execution.
