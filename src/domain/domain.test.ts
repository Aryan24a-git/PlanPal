import { describe, it, expect } from 'vitest';
import {
  summarizeBudget, detectOverBudget, rescaleAllocations, formatMinorUnits, toMinorUnits
} from './budget.js';
import {
  computeDueDate, shiftTasks, calculateProgress, detectOverdueTasks, assignPhaseLabel, groupByPhase
} from './timeline.js';
import { summarizeVendors, VENDOR_CATEGORIES_BY_TYPE } from './vendors.js';
import { normalizeAiPlan } from './aiNormalizer.js';

// ─── Budget Domain ────────────────────────────────────────────────────────────
describe('Budget Domain — REQ-004', () => {
  it('calculates budget summary with correct totals and remaining', () => {
    const cats = [
      { name: 'Venue', plannedMinor: 1_000_00, items: [
        { label: 'Deposit', plannedMinor: 50_000, actualMinor: 50_000 },
        { label: 'Balance', plannedMinor: 50_000, actualMinor: 45_000 },
      ]},
      { name: 'Catering', plannedMinor: 80_000, items: [
        { label: 'Buffet', plannedMinor: 70_000, actualMinor: 75_000 },
      ]},
    ];
    const s = summarizeBudget(200_000, cats);
    expect(s.totalBudget).toBe(200_000);
    expect(s.totalActual).toBe(50_000 + 45_000 + 75_000);
    expect(s.remainingActual).toBe(200_000 - 170_000);
    expect(s.isOverBudget).toBe(false);
  });

  it('detects over-budget with text message (not color alone)', () => {
    const cats = [
      { name: 'Decor', plannedMinor: 12_000, items: [
        { label: 'Flowers', plannedMinor: 11_000, actualMinor: 13_000 },
      ]},
    ];
    const s = summarizeBudget(10_000, cats);
    const ob = detectOverBudget(s);
    expect(ob.isOver).toBe(true);
    expect(ob.overCategories).toContain('Decor');
    expect(ob.overByMinor).toBeGreaterThan(0);
  });

  it('handles zero budget and empty categories', () => {
    expect(summarizeBudget(0, []).totalBudget).toBe(0);
    expect(summarizeBudget(0, []).categoryBreakdown).toHaveLength(0);
  });

  it('rescaleAllocations: sum invariant holds for all cases', () => {
    const budgets = [10_000, 25_000, 1, 999_999, 7];
    for (const total of budgets) {
      const raw = [3000, 2000, 5000, 1500];
      const scaled = rescaleAllocations(raw, total);
      const sum = scaled.reduce((a, b) => a + b, 0);
      expect(sum).toBe(total);
    }
  });

  it('rescaleAllocations: single category gets entire budget', () => {
    const scaled = rescaleAllocations([999], 50_000);
    expect(scaled).toEqual([50_000]);
  });

  it('rescaleAllocations: zero inputs distribute evenly', () => {
    const scaled = rescaleAllocations([0, 0, 0], 9);
    expect(scaled.reduce((a, b) => a + b, 0)).toBe(9);
  });

  it('formats minor units correctly', () => {
    expect(formatMinorUnits(150050, 'USD')).toBe('$1,500.50');
    expect(formatMinorUnits(0, 'EUR')).toBe('€0.00');
  });

  it('converts decimal currency amounts to minor units', () => {
    expect(toMinorUnits(15.5)).toBe(1550);
    expect(toMinorUnits(0)).toBe(0);
    expect(toMinorUnits(99.99)).toBe(9999);
  });
});

// ─── Timeline Domain ──────────────────────────────────────────────────────────
describe('Timeline Domain — REQ-005', () => {
  it('computeDueDate calculates correctly', () => {
    expect(computeDueDate('2026-12-25', 10)).toBe('2026-12-15');
    expect(computeDueDate('2026-03-01', 1)).toBe('2026-02-28');
    expect(computeDueDate('2024-03-01', 1)).toBe('2024-02-29'); // leap year
  });

  it('throws on invalid event date', () => {
    expect(() => computeDueDate('not-a-date', 10)).toThrow();
    expect(() => computeDueDate('2026-13-01', 0)).toThrow();
  });

  it('shiftTasks respects pinned flag', () => {
    const tasks = [
      { title: 'Send Invites', offsetDays: 60, dueDate: '2026-06-01', pinned: false, status: 'todo' as const, priority: 'medium' as const },
      { title: 'Confirm Venue', offsetDays: 30, dueDate: '2026-07-01', pinned: true, status: 'todo' as const, priority: 'high' as const },
    ];
    const shifted = shiftTasks(tasks, '2026-09-01');
    expect(shifted[0]?.dueDate).toBe(computeDueDate('2026-09-01', 60));
    expect(shifted[1]?.dueDate).toBe('2026-07-01'); // pinned — unchanged
  });

  it('calculateProgress returns correct percentages', () => {
    const tasks = [
      { title: 'A', offsetDays: 10, dueDate: '2026-01-01', pinned: false, status: 'completed' as const, priority: 'low' as const },
      { title: 'B', offsetDays: 5, dueDate: '2026-01-06', pinned: false, status: 'in_progress' as const, priority: 'medium' as const },
      { title: 'C', offsetDays: 1, dueDate: '2026-01-10', pinned: false, status: 'todo' as const, priority: 'high' as const },
    ];
    const p = calculateProgress(tasks);
    expect(p.total).toBe(3);
    expect(p.completed).toBe(1);
    expect(p.completionPct).toBe(33);
  });

  it('calculateProgress handles empty list', () => {
    expect(calculateProgress([]).completionPct).toBe(0);
  });

  it('detectOverdueTasks filters only overdue non-completed tasks', () => {
    const tasks = [
      { title: 'Old Todo', offsetDays: 100, dueDate: '2020-01-01', pinned: false, status: 'todo' as const, priority: 'high' as const },
      { title: 'Old Done', offsetDays: 90, dueDate: '2020-01-01', pinned: false, status: 'completed' as const, priority: 'medium' as const },
      { title: 'Future', offsetDays: 10, dueDate: '2099-12-31', pinned: false, status: 'todo' as const, priority: 'low' as const },
    ];
    const overdue = detectOverdueTasks(tasks, '2026-01-01');
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.title).toBe('Old Todo');
  });

  it('assignPhaseLabel returns correct phase strings', () => {
    expect(assignPhaseLabel(120)).toBe('3+ months out');
    expect(assignPhaseLabel(60)).toBe('1–3 months out');
    expect(assignPhaseLabel(14)).toBe('1 month out');
    expect(assignPhaseLabel(3)).toBe('Final week');
    expect(assignPhaseLabel(0)).toBe('Event day');
  });

  it('groupByPhase groups tasks by phase label', () => {
    const tasks = [
      { title: 'T1', offsetDays: 100, dueDate: '2026-01-01', pinned: false, status: 'todo' as const, priority: 'medium' as const, phase: 'Phase 1' },
      { title: 'T2', offsetDays: 50, dueDate: '2026-02-01', pinned: false, status: 'todo' as const, priority: 'medium' as const, phase: 'Phase 1' },
      { title: 'T3', offsetDays: 10, dueDate: '2026-03-01', pinned: false, status: 'todo' as const, priority: 'medium' as const },
    ];
    const grouped = groupByPhase(tasks);
    expect(grouped.get('Phase 1')).toHaveLength(2);
    expect(grouped.get('General')).toHaveLength(1);
  });
});

// ─── Vendor Domain ────────────────────────────────────────────────────────────
describe('Vendor Domain — REQ-006', () => {
  it('provides distinct default categories for each event type', () => {
    expect(VENDOR_CATEGORIES_BY_TYPE.wedding).toContain('Venue & Reception');
    expect(VENDOR_CATEGORIES_BY_TYPE.birthday).toContain('Cake & Sweets');
    expect(VENDOR_CATEGORIES_BY_TYPE.community).toContain('Permits & Venue');
    // Disjoint check — community shouldn't share wedding venue label
    expect(VENDOR_CATEGORIES_BY_TYPE.community).not.toContain('Venue & Reception');
  });

  it('summarizes vendor status counts and quote totals correctly', () => {
    const vendors = [
      { category: 'Venue', name: 'Grand Hall', status: 'booked' as const, quoteMinor: 300_000 },
      { category: 'Catering', name: 'Tasty Bites', status: 'quoted' as const, quoteMinor: 200_000 },
      { category: 'DJ', name: 'Spin Masters', status: 'to_contact' as const },
      { category: 'Photo', name: 'Snap Co', status: 'declined' as const },
    ];
    const s = summarizeVendors(vendors);
    expect(s.total).toBe(4);
    expect(s.booked).toBe(1);
    expect(s.quoted).toBe(1);
    expect(s.toContact).toBe(1);
    expect(s.declined).toBe(1);
    expect(s.totalQuotedMinor).toBe(500_000);
  });

  it('handles empty vendor list', () => {
    const s = summarizeVendors([]);
    expect(s.total).toBe(0);
    expect(s.totalQuotedMinor).toBe(0);
  });

  it('handles contacted vendor status', () => {
    const s = summarizeVendors([
      { category: 'Decor', name: 'Props Inc', status: 'contacted' as const, quoteMinor: 1200 },
    ]);
    expect(s.contacted).toBe(1);
    expect(s.totalQuotedMinor).toBe(1200);
  });
});

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
    // Categories maintain their rescaled proportional amounts
    expect(result.plan.budgetCategories[0]?.allocatedAmount).toBe(2000);
    expect(result.plan.budgetCategories[1]?.allocatedAmount).toBe(8000);
    // Items are rescaled to match their category allocation
    expect(result.plan.budgetCategories[0]?.items[0]?.plannedAmount).toBe(2000);
    expect(result.plan.budgetCategories[1]?.items[0]?.plannedAmount).toBe(8000);
  });

  it('clamps daysBeforeEvent offsets when event is in the near future (Finding 24)', () => {
    // 14 days from now
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
import { sanitize } from '../shared/logger.js';

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

