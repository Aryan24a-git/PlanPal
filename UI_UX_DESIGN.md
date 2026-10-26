# PlanPal — UI / UX Design System & Accessibility Specification

## 1. Principles
- **Plain, Clear Language**: No jargon or ambiguous statuses.
- **AI as an Advisory Copilot**: Never present AI output as settled fact. All AI suggestions are editable, dismissible, and require user confirmation before persisting.
- **First-Class Manual Planning**: If AI is offline, rate-limited, or disabled, manual planning remains 100% operational.
- **Calm, High-Contrast Aesthetics**: Deep slate backgrounds, frosted glass panels (`backdrop-filter: blur(16px)`), and curated Indigo/Pink accents with ≥4.5:1 contrast ratios.

## 2. Accessibility (WCAG 2.1 AA)
- **Live Regions**: AI generation, saving, and progress updates are announced through an `aria-live="polite"` region (`#live-announcer`).
- **Touch Targets**: All interactive elements (buttons, inputs, tabs) maintain a minimum 44px hit target (A11Y-002).
- **Visible Focus Indicators**: High-contrast focus rings (`box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2)`).
- **Semantic Structure**: Single `<h1>` per view, proper heading hierarchy (`h1` → `h2` → `h3`), semantic landmarks (`<header>`, `<main>`, `<section>`, `<footer>`), and valid ARIA attributes.
- **Color Independence**: Status indications (e.g. over-budget, task progress, vendor statuses) use explicit text and icons, never color alone.

## 3. Key View Workflows
1. **Auth View**: Sign In and Registration forms with inline error validation and autofocus.
2. **Dashboard**: High-level event cards with budget utilization, task completion counters, and "+ Create New Event" CTA.
3. **Event Wizard Modal**: Bounded input fields (guest count, budget in currency, brief with character limits).
4. **Event Workspace**:
   - **Header & AI Banner**: Event metadata pills and the AI Draft Review & Refinement strip.
   - **Budget Planner**: Four summary metric cards (Total, Allocated, Planned, Actual) and category breakdown tables.
   - **Timeline Gantt/List**: Date-anchored milestones showing days before event and completion badges.
   - **Vendor CRM**: Category cards tracking contact status, quotes, and notes.
   - **AI Ideas Studio**: Curated theme, activity, and menu concept cards with estimated cost badges.
