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
  const budgetCategories = validCategories.map((cat, i) => {
    const allocated = rescaled[i] ?? 0;
    let items = cat.items.map((item) => ({
      ...item,
      plannedAmount: Math.max(0, item.plannedAmount),
    }));

    // Finding 23: Rescale items so their sum equals the category allocation
    if (items.length > 0 && allocated > 0) {
      const rawItemSum = items.reduce((sum, item) => sum + item.plannedAmount, 0);
      if (rawItemSum > 0) {
        const itemRescaled = rescaleAllocations(
          items.map((it) => it.plannedAmount),
          allocated
        );
        items = items.map((it, idx) => ({
          ...it,
          plannedAmount: itemRescaled[idx] ?? it.plannedAmount,
        }));
      }
    }

    return {
      ...cat,
      allocatedAmount: allocated,
      items,
    };
  });

  // Verify invariant
  const allocSum = budgetCategories.reduce((s, c) => s + c.allocatedAmount, 0);
  if (allocSum !== totalBudget) {
    warnings.push(`Budget rescaling produced ${allocSum} instead of ${totalBudget}`);
  }

  // 3. Validate & compute timeline tasks
  const now = new Date();
  const eventTarget = new Date(eventDate);
  const diffDays = Number.isNaN(eventTarget.getTime())
    ? 3650
    : Math.max(0, Math.floor((eventTarget.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  const timelineTasks = rawPlan.timelineTasks
    .filter((t) => {
      const result = AIDraftTaskSchema.safeParse(t);
      if (!result.success) {
        droppedItems.push(`Task "${t.title}": ${result.error.issues[0]?.message}`);
        return false;
      }
      if (t.daysBeforeEvent < 0) {
        droppedItems.push(`Task "${t.title}": daysBeforeEvent cannot be negative`);
        return false;
      }
      return true;
    })
    .map((t) => {
      let offset = t.daysBeforeEvent;
      // Finding 24: Clamp offset to days until event so tasks never land in the past
      if (offset > diffDays) {
        warnings.push(`Task "${t.title}" offset (${offset}d) was clamped to available days until event (${diffDays}d)`);
        offset = diffDays;
      }

      let dueDate: string;
      try {
        dueDate = computeDueDate(eventDate, offset);
      } catch {
        warnings.push(`Could not compute due date for task "${t.title}"`);
        dueDate = eventDate;
      }
      return {
        ...t,
        daysBeforeEvent: offset,
        dueDate,
        phase: assignPhaseLabel(offset),
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
