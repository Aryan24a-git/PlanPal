# PlanPal — Security Architecture & Threat Model

## 1. Threat Model & Mitigations (STRIDE-lite)

| Threat | Risk Description | Architectural Mitigation (PlanPal) | Requirement |
| :--- | :--- | :--- | :--- |
| **Account Takeover / Brute Force** | Credential stuffing, weak password storage | Salted `bcrypt` password hashing (cost factor 10), timing-safe comparisons, generic error messages | SEC-001 |
| **Insecure Direct Object Reference (IDOR)** | Malicious user accessing or altering another user's event | All repository queries and mutation statements strictly require and filter by `owner_id = ?`. Foreign resources return `404 Not Found`. | SEC-002 |
| **Input Tampering & Injection** | Excessively large payloads or SQL/NoSQL injection | Strict Zod validation on every API endpoint boundary with string length caps (`brief` ≤ 2000 chars, `notes` ≤ 1000 chars). Parameterized SQL prepared statements. | SEC-003 |
| **Prompt Injection & Malicious Output** | Malicious brief attempting to hijack AI prompt instructions | Delimited user inputs treated strictly as data; schema-validated JSON outputs via Zod; React/HTML text escaping without `eval` or `innerHTML`. | SEC-004 |
| **Denial of Service / AI Cost Abuse** | High-volume API calls exhausting LLM credits | Daily request quotas tracked per user in `ai_usage` table; rate-limiting middleware. | SEC-005 |
| **Cross-Site Scripting (XSS) & Clickjacking** | Malicious script execution in user browser | Comprehensive security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and strict `Content-Security-Policy`. | SEC-006 |
| **Secret Leakage** | Committing API keys or database credentials | `.env` excluded from version control; `.env.example` template; secrets loaded via environment variables only. | SEC-007 |
| **Information Disclosure in Logs** | Sensitive credentials or PII appearing in log aggregators | Structured JSON logging with request IDs, route, status, and duration; sensitive fields (passwords, tokens, briefs) stripped before logging. | SEC-008 |
| **Vulnerable Dependencies** | Supply-chain CVEs in third-party packages | Continuous `npm audit` verification with 0 High/Critical vulnerabilities policy. | SEC-009 |
| **Privacy & Data Minimization** | Unnecessary PII storage | Zero guest PII collected or stored; hard cascading deletion of all child records when an event is deleted. | DATA-001 |
