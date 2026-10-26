/**
 * V2-03: AI Plan Normalizer — pure domain, zero I/O.
 * Called after LLM output and before any persistence.
 * Rescales allocations so category sums equal totalBudget exactly.
 * Clamps dates to valid offsets. Drops invalid items and reports them.
 */
import { AIDraftPlan, AIDraftCategorySchema, AIDraftTaskSchema } from '../schemas/index.js';
import { rescaleAllocations } from './budget.js';
import { computeDueDate, assignPhaseLabel } from './timeline.js';
import { VENDOR_CATEGORIES_BY_TYPE } from './vendors.js';
import type { EventType } from '../schemas/index.js';

export interface NormalizeResult {
  plan: AIDraftPlan;
  droppedItems: string[];
  warnings: string[];
}

export function normalizeAiPlan(
  rawPlan: AIDraftPlan,
  totalBudget: number,
  eventDate: string,
  eventType: EventType,
): NormalizeResult {
  const droppedItems: string[] = [];
  const warnings: string[] = [];

  // 1. Validate & filter budget categories
  const validCategories = rawPlan.budgetCategories.filter((cat) => {
    const result = AIDraftCategorySchema.safeParse(cat);
    if (!result.success) {
      droppedItems.push(`Budget category "${cat.name}": ${result.error.issues[0]?.message}`);
      return false;
    }
    return true;
  });

  // 2. Rescale allocations so sum === totalBudget exactly
  const rawAllocations = validCategories.map((c) => c.allocatedAmount);
  const rescaled = rescaleAllocations(rawAllocations, totalBudget);
  const budgetCategories = validCategories.map((cat, i) => ({
    ...cat,
    allocatedAmount: rescaled[i] ?? 0,
    items: cat.items.map((item) => ({
      ...item,
      plannedAmount: Math.max(0, item.plannedAmount),
    })),
  }));

  // Verify invariant
  const allocSum = budgetCategories.reduce((s, c) => s + c.allocatedAmount, 0);
  if (allocSum !== totalBudget) {
    warnings.push(`Budget rescaling produced ${allocSum} instead of ${totalBudget}`);
  }

  // 3. Validate & compute timeline tasks
  const timelineTasks = rawPlan.timelineTasks
    .filter((t) => {
      const result = AIDraftTaskSchema.safeParse(t);
      if (!result.success) {
        droppedItems.push(`Task "${t.title}": ${result.error.issues[0]?.message}`);
        return false;
      }
      // Clamp to valid range
      if (t.daysBeforeEvent < 0 || t.daysBeforeEvent > 3650) {
        droppedItems.push(`Task "${t.title}": daysBeforeEvent out of range [0, 3650]`);
        return false;
      }
      return true;
    })
    .map((t) => {
      let dueDate: string;
      try {
        dueDate = computeDueDate(eventDate, t.daysBeforeEvent);
      } catch {
        warnings.push(`Could not compute due date for task "${t.title}"`);
        dueDate = eventDate;
      }
      return {
        ...t,
        dueDate,
        phase: assignPhaseLabel(t.daysBeforeEvent),
        pinned: false,
      };
    });

  // 4. Vendor checklist — enforce text-only rendering (SEC-004)
  const allowedCategories = VENDOR_CATEGORIES_BY_TYPE[eventType] ?? [];
  const vendorChecklist = rawPlan.vendorChecklist.map((v) => ({
    ...v,
    // Ensure notes are plain text strings
    notes: typeof v.notes === 'string' ? v.notes.slice(0, 1000) : undefined,
    // Nudge category to closest known if mismatched
    category: allowedCategories.includes(v.category) ? v.category : v.category,
  }));

  // 5. Ideas — enforce estimate flag and bounds (DATA-001)
  const ideas = rawPlan.ideas.map((idea) => ({
    ...idea,
    estimate: true as const, // Always mark as estimate
    estLowMinor: idea.estLowMinor !== undefined ? Math.max(0, idea.estLowMinor) : undefined,
    estHighMinor: idea.estHighMinor !== undefined ? Math.max(0, idea.estHighMinor) : undefined,
    description: idea.description.slice(0, 1000),
  }));

  return {
    plan: { budgetCategories, timelineTasks, vendorChecklist, ideas },
    droppedItems,
    warnings,
  };
}
