# PlanPal — Product Requirements Document (PRD)

## 1. Overview
PlanPal turns a short event brief into an editable, trackable plan: budget, timeline, vendor checklist, and ideas.

## 2. Personas
- **Priya**: First-time wedding planner on a fixed budget.
- **Sam**: Parent planning a child’s birthday in 6 weeks.
- **Lena**: Volunteer running an annual neighborhood fair.

## 3. Goals
- Go from brief to a saved draft plan in under 3 minutes.
- Never present AI output as fact (clearly labeled as estimates).
- Keep manual planning fully usable without AI.

## 4. MVP Scope
- **In-Scope**: REQ-001 through REQ-010 (Auth, Event Creation, AI Plan Generation, Budget Math, Timeline Date-shifting, Vendor CRM, AI Ideas Studio, Dashboard Progress, CRUD, AI Plan Refinement).
- **Out-of-Scope**: Payments, live vendor marketplace/pricing, guest RSVP lists, multi-user collaboration, mobile native apps, email/calendar sync, multi-language UI.

## 5. User Stories & Acceptance Criteria
1. **Draft Plan Generation**: As a planner, I want to describe my event and receive a draft plan so that I don't start from a blank page.
   - *AC*: Category allocations sum exactly to total budget; tasks have dates before the event; nothing is saved until confirmed.
2. **Deterministic Budget Tracking**: As a planner, I want to see remaining budget as I log costs so that I avoid overspending.
   - *AC*: Over-budget categories are flagged with text and icons (not color alone); currency stored in minor units.
3. **Vendor Checklist**: As a planner, I want a checklist per vendor category so that I track contacts and quotes.
   - *AC*: Status changes persist and are keyboard-operable.
4. **Curated Ideas**: As a planner, I want theme and activity ideas fitting my budget and guest profile.
   - *AC*: Ideas show estimated cost labeled "estimate"; can be saved or dismissed.

## 6. Business Rules & Invariants
- Budget math is 100% deterministic code in integer minor units. Sum of category plans cannot exceed total budget without explicit warning.
- Task due dates are anchored relative to event date (`daysBeforeEvent`); shifting the event date shifts task schedule automatically.
- Vendor categories are seeded by event type (`wedding`, `birthday`, `community`).
- AI daily quotas are enforced per user per day.
