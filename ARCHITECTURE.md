# PlanPal: Architecture & Implementation Blueprint

## Overview
PlanPal is a full-stack GenAI Event Planning Assistant built with strict TypeScript, layered architecture, deterministic domain math, swappable LLM adapters with mock fallback, IDOR-safe owner-scoped data access, and WCAG 2.1 AA accessible UI.

## Architecture & Layers
1. **Domain Layer (Pure TypeScript)**:
   - Zero framework dependencies.
   - Deterministic budget math (allocations, totals, remaining, over-budget detection, minor units currency).
   - Date-relative timeline math (offset shifts, sorting, status transitions).
   - Vendor checklist state transitions.
   - Comprehensive unit test coverage (≥90%).
2. **Schema & Contract Layer (Zod)**:
   - Single source of truth for validation, input hygiene, DTOs, and TS types.
   - Prompt sanitization and output schema validation.
3. **Repository / Storage Layer**:
   - SQLite / Better-SQLite3 with WAL mode, transactions, cascade deletes, indexed queries by owner & event.
   - Foreign key constraints enabled.
4. **Service Layer**:
   - Auth service (argon2 / bcrypt, secure sessions).
   - Event service (IDOR checks, ownership enforcement, cascade operations).
   - AI planning service (swappable provider interface, rate limiting, token limits, diff proposal for refinements, fallback manual templates).
5. **API & Route Handlers**:
   - RESTful endpoints with Zod validation, structured logging, request IDs, rate limiting, and security headers (CSP, CORS, CSRF).
6. **Frontend**:
   - Modern, responsive, glassmorphic UI with dark/light themes.
   - Accessible keyboard navigation, accessible contrast verified with axe-core, aria-live status alerts for AI operations.
   - Interactive Event Wizard, Budget Planner, Timeline Gantt/Calendar view, Vendor CRM, and AI Idea Studio.
