/**
 * V2-03: Pure domain budget calculations — deterministic, zero I/O.
 * All amounts in integer minor units (cents).
 * EC-001, EC-004, PERF-003: LLM never performs arithmetic.
 */

export interface BudgetItem {
  id?: string;
  label: string;
  plannedMinor: number;
  actualMinor: number;
  note?: string;
}

export interface BudgetCategory {
  id?: string;
  name: string;
  plannedMinor: number;
  items: BudgetItem[];
}

export interface CategoryBreakdown {
  categoryId: string | undefined;
  categoryName: string;
  plannedMinor: number;
  actualMinor: number;
  allocatedMinor: number;
  remainingMinor: number;
  utilizationPct: number;
  isOverAllocated: boolean;
}

export interface BudgetSummary {
  totalBudget: number;
  totalPlanned: number;
  totalActual: number;
  remainingActual: number;
  isOverBudget: boolean;
  isOverPlanned: boolean;
  categoryBreakdown: CategoryBreakdown[];
}

/** Clamp to integer minor units, minimum 0 */
function clamp(n: number): number {
  return Math.max(0, Math.floor(n));
}

/**
 * V2-03 normalizeAiPlan helper: largest-remainder rescaling
 * so the sum of allocations equals totalBudget exactly.
 * Called after AI output, before any persistence.
 */
export function rescaleAllocations(
  rawAllocations: number[],
  totalBudget: number,
): number[] {
  if (rawAllocations.length === 0) return [];
  const total = rawAllocations.reduce((s, v) => s + Math.max(0, v), 0);
  if (total === 0) {
    // Distribute evenly
    const share = Math.floor(totalBudget / rawAllocations.length);
    const remainder = totalBudget - share * rawAllocations.length;
    return rawAllocations.map((_, i) => (i === 0 ? share + remainder : share));
  }

  const scaled = rawAllocations.map((v) => (Math.max(0, v) / total) * totalBudget);
  const floored = scaled.map(Math.floor);
  const remainders = scaled.map((v, i) => ({ i, r: v - (floored[i] ?? 0) }));
  const gapNeeded = totalBudget - floored.reduce((s, v) => s + v, 0);

  // Distribute remainder to highest fractional parts
  remainders
    .sort((a, b) => b.r - a.r)
    .slice(0, gapNeeded)
    .forEach(({ i }) => {
      (floored[i] as number)++;
    });

  return floored;
}

export function summarizeBudget(totalBudget: number, categories: BudgetCategory[]): BudgetSummary {
  const safeBudget = clamp(totalBudget);
  let totalPlanned = 0;
  let totalActual = 0;

  const categoryBreakdown: CategoryBreakdown[] = categories.map((cat) => {
    const allocated = clamp(cat.plannedMinor);
    let catActual = 0;
    let catPlanned = 0;

    for (const item of cat.items) {
      catPlanned += clamp(item.plannedMinor);
      catActual += clamp(item.actualMinor);
    }

    totalPlanned += catPlanned;
    totalActual += catActual;

    const remainingMinor = allocated - catActual;
    const utilizationPct = allocated > 0 ? Math.round((catActual / allocated) * 100) : 0;

    return {
      categoryId: cat.id,
      categoryName: cat.name,
      plannedMinor: catPlanned,
      actualMinor: catActual,
      allocatedMinor: allocated,
      remainingMinor,
      utilizationPct,
      isOverAllocated: catActual > allocated || catPlanned > allocated || allocated > safeBudget,
    };
  });

  return {
    totalBudget: safeBudget,
    totalPlanned,
    totalActual,
    remainingActual: safeBudget - totalActual,
    isOverBudget: totalActual > safeBudget,
    isOverPlanned: totalPlanned > safeBudget,
    categoryBreakdown,
  };
}

/** Format minor units to locale currency string */
export function formatMinorUnits(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

/** Parse a decimal currency string to integer minor units */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/** Detect over-budget state for UI alerting (text + icon, not color alone — A11Y) */
export function detectOverBudget(summary: BudgetSummary): {
  isOver: boolean;
  overByMinor: number;
  overCategories: string[];
} {
  const overCategories = summary.categoryBreakdown
    .filter((c) => c.isOverAllocated)
    .map((c) => c.categoryName);
  const overByMinor = Math.max(0, summary.totalActual - summary.totalBudget);
  return {
    isOver: summary.isOverBudget || summary.isOverPlanned,
    overByMinor,
    overCategories,
  };
}
