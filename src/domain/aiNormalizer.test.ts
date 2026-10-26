import { describe, it, expect } from 'vitest';
import { computeDueDate } from './timeline.js';
import { normalizeAiPlan } from './aiNormalizer.js';
import { sanitize } from '../shared/logger.js';

// ─── AI Normalizer ────────────────────────────────────────────────────────────
describe('AI Plan Normalizer — V2-03, SEC-004', () => {
  const basePlan = {
    budgetCategories: [
      { name: 'Venue', allocatedAmount: 6000, items: [{ name: 'Hall', plannedAmount: 6000 }] },
      { name: 'Catering', allocatedAmount: 4000, items: [{ name: 'Food', plannedAmount: 4000 }] },
    ],
    timelineTasks: [
      { title: 'Book Venue', daysBeforeEvent: 90, priority: 'high' as const },
    ],
    vendorChecklist: [
      { category: 'Venue & Reception', name: 'Grand Hall', notes: 'Call before noon' },
    ],
    ideas: [
      { category: 'theme' as const, title: 'Garden Theme', description: 'Lush outdoor decor', estimate: true as const },
    ],
  };

  it('rescales budget allocations so sum equals totalBudget exactly', () => {
    const result = normalizeAiPlan(basePlan, 10_000, '2026-12-25', 'wedding');
    const sum = result.plan.budgetCategories.reduce((s, c) => s + c.allocatedAmount, 0);
    expect(sum).toBe(10_000);
    expect(result.droppedItems).toHaveLength(0);
  });

  it('computes dueDate from daysBeforeEvent on all tasks', () => {
    const result = normalizeAiPlan(basePlan, 10_000, '2027-12-25', 'wedding');
    expect(result.plan.timelineTasks[0]?.dueDate).toBe(computeDueDate('2027-12-25', 90));
  });

  it('marks all ideas with estimate: true (DATA-001)', () => {
    const result = normalizeAiPlan(basePlan, 10_000, '2026-12-25', 'wedding');
    for (const idea of result.plan.ideas) {
      expect(idea.estimate).toBe(true);
    }
  });

  it('drops tasks with invalid daysBeforeEvent and reports them', () => {
    const plan = { ...basePlan, timelineTasks: [
      { title: 'Valid Task', daysBeforeEvent: 30, priority: 'medium' as const },
      { title: 'Bad Task', daysBeforeEvent: 9999, priority: 'low' as const },
    ]};
    const result = normalizeAiPlan(plan, 10_000, '2026-12-25', 'wedding');
    expect(result.plan.timelineTasks).toHaveLength(1);
    expect(result.droppedItems.some((d) => d.includes('Bad Task'))).toBe(true);
  });

  it('injection fixture: notes strings are trimmed to 1000 chars', () => {
    const evilNotes = '<script>alert(1)</script>'.repeat(100);
    const plan = { ...basePlan, vendorChecklist: [
      { category: 'Venue & Reception', name: 'Evil Vendor', notes: evilNotes },
    ]};
    const result = normalizeAiPlan(plan, 10_000, '2026-12-25', 'wedding');
    const notes = result.plan.vendorChecklist[0]?.notes ?? '';
    expect(notes.length).toBeLessThanOrEqual(1000);
  });

  it('drops invalid budget categories and reports them', () => {
    const plan = {
      ...basePlan,
      budgetCategories: [
        { name: '', allocatedAmount: -10, items: [] },
        { name: 'Music', allocatedAmount: 5000, items: [] },
      ],
    };
    const result = normalizeAiPlan(plan as typeof basePlan, 5000, '2026-12-25', 'wedding');
    expect(result.droppedItems.length).toBeGreaterThan(0);
    expect(result.plan.budgetCategories).toHaveLength(1);
  });

  it('drops task when daysBeforeEvent is negative or schema invalid', () => {
    const plan = {
      ...basePlan,
      timelineTasks: [
        { title: 'Negative Task', daysBeforeEvent: -5, priority: 'low' as const },
        { title: '', daysBeforeEvent: 10, priority: 'low' as const },
      ],
    };
    const result = normalizeAiPlan(plan as typeof basePlan, 10_000, '2026-12-25', 'wedding');
    expect(result.plan.timelineTasks).toHaveLength(0);
    expect(result.droppedItems.length).toBe(2);
  });

  it('handles fallback date when eventDate cannot be parsed into due date', () => {
    const result = normalizeAiPlan(basePlan, 10_000, 'invalid-date', 'wedding');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.plan.timelineTasks[0]?.dueDate).toBe('invalid-date');
  });

  it('handles duplicate category names correctly without breaking budget sum invariant (Finding 23)', () => {
    const plan = {
      ...basePlan,
      budgetCategories: [
        { name: 'Decor', allocatedAmount: 2000, items: [{ name: 'Flowers', plannedAmount: 1000 }] },
        { name: 'Decor', allocatedAmount: 8000, items: [{ name: 'Lighting', plannedAmount: 5000 }] },
      ],
    };
    const result = normalizeAiPlan(plan as typeof basePlan, 10000, '2026-12-25', 'wedding');
    const sum = result.plan.budgetCategories.reduce((acc, c) => acc + c.allocatedAmount, 0);
    expect(sum).toBe(10000);
    expect(result.plan.budgetCategories[0]?.allocatedAmount).toBe(2000);
    expect(result.plan.budgetCategories[1]?.allocatedAmount).toBe(8000);
    expect(result.plan.budgetCategories[0]?.items[0]?.plannedAmount).toBe(2000);
    expect(result.plan.budgetCategories[1]?.items[0]?.plannedAmount).toBe(8000);
  });

  it('clamps daysBeforeEvent offsets when event is in the near future (Finding 24)', () => {
    const targetDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const plan = {
      ...basePlan,
      timelineTasks: [
        { title: 'Way too early task', daysBeforeEvent: 90, priority: 'high' as const },
      ],
    };
    const result = normalizeAiPlan(plan as typeof basePlan, 10000, targetDate, 'birthday');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.plan.timelineTasks[0]?.daysBeforeEvent).toBeLessThanOrEqual(14);
  });
});

// ─── Logger Redaction (Finding 4 / SEC-008) ──────────────────────────────────
describe('Logger Redaction — Finding 4 / SEC-008', () => {
  it('redacts sensitive fields by substring (accessToken, password_hash, groqApiKey, cookie, jwt)', () => {
    const sensitivePayload = {
      accessToken: 'secret-token-xyz',
      password_hash: '$2a$12$e0M2/1a9...',
      groqApiKey: 'gsk_1234567890',
      userCookie: 'session=abc',
      jwt: 'eyJhbGciOi...',
      authorization: 'Bearer xxx',
      briefText: 'delicate details',
      normalField: 'visible-public-info',
      nested: {
        myApiKey: 'nested-key-val',
        userPassword: 'plaintext-pass',
      },
    };

    const sanitized = sanitize(sensitivePayload) as Record<string, unknown>;
    expect(sanitized['accessToken']).toBe('[REDACTED]');
    expect(sanitized['password_hash']).toBe('[REDACTED]');
    expect(sanitized['groqApiKey']).toBe('[REDACTED]');
    expect(sanitized['userCookie']).toBe('[REDACTED]');
    expect(sanitized['jwt']).toBe('[REDACTED]');
    expect(sanitized['authorization']).toBe('[REDACTED]');
    expect(sanitized['briefText']).toBe('[REDACTED]');
    expect(sanitized['normalField']).toBe('visible-public-info');

    const nested = sanitized['nested'] as Record<string, unknown>;
    expect(nested['myApiKey']).toBe('[REDACTED]');
    expect(nested['userPassword']).toBe('[REDACTED]');
  });
});
