/**
 * V2-03: Pure domain timeline calculations — zero I/O.
 * REQ-005: Tasks anchored by offsetDays relative to event date.
 * A date change → shiftTasks recomputes dueDate for non-pinned tasks.
 */

export interface TimelineTask {
  id?: string;
  title: string;
  offsetDays: number;       // days before event date (deterministic anchor)
  dueDate: string;          // YYYY-MM-DD, computed
  pinned: boolean;          // pinned tasks are NOT shifted on date change
  status: 'todo' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  phase?: string;
}

/**
 * Compute due date from event date and offset.
 * @param eventDateStr YYYY-MM-DD
 * @param offsetDays days before event (must be ≥ 0)
 */
export function computeDueDate(eventDateStr: string, offsetDays: number): string {
  const parts = eventDateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((p) => isNaN(p ?? NaN))) {
    throw new Error(`Invalid event date: ${eventDateStr}`);
  }
  const [year, month, day] = parts as [number, number, number];
  // Strict range validation — month 13 must throw, not silently roll over
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1970) {
    throw new Error(`Invalid event date: ${eventDateStr}`);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(date.getTime())) throw new Error(`Invalid event date: ${eventDateStr}`);
  date.setUTCDate(date.getUTCDate() - Math.max(0, offsetDays));
  return date.toISOString().slice(0, 10);
}

/**
 * Shift all non-pinned tasks to match a new event date.
 * Pinned tasks retain their existing dueDate.
 */
export function shiftTasks(tasks: TimelineTask[], newEventDateStr: string): TimelineTask[] {
  return tasks.map((t) => {
    if (t.pinned) return t;
    return { ...t, dueDate: computeDueDate(newEventDateStr, t.offsetDays) };
  });
}

/** Group tasks by phase label for UI rendering */
export function groupByPhase(tasks: TimelineTask[]): Map<string, TimelineTask[]> {
  const groups = new Map<string, TimelineTask[]>();
  for (const t of tasks) {
    const phase = t.phase ?? 'General';
    const group = groups.get(phase) ?? [];
    group.push(t);
    groups.set(phase, group);
  }
  return groups;
}

export interface TimelineProgress {
  total: number;
  completed: number;
  inProgress: number;
  todo: number;
  completionPct: number;
}

export function calculateProgress(tasks: TimelineTask[]): TimelineProgress {
  const total = tasks.length;
  if (total === 0) return { total: 0, completed: 0, inProgress: 0, todo: 0, completionPct: 0 };
  let completed = 0;
  let inProgress = 0;
  let todo = 0;
  for (const t of tasks) {
    if (t.status === 'completed') completed++;
    else if (t.status === 'in_progress') inProgress++;
    else todo++;
  }
  return { total, completed, inProgress, todo, completionPct: Math.round((completed / total) * 100) };
}

/** Detect overdue tasks (dueDate < today and not completed) */
export function detectOverdueTasks(tasks: TimelineTask[], todayStr?: string): TimelineTask[] {
  const today = todayStr ?? new Date().toISOString().slice(0, 10);
  return tasks.filter((t) => t.status !== 'completed' && t.dueDate < today);
}

/** Assign phase labels based on daysBeforeEvent */
export function assignPhaseLabel(offsetDays: number): string {
  if (offsetDays >= 90) return '3+ months out';
  if (offsetDays >= 30) return '1–3 months out';
  if (offsetDays >= 7) return '1 month out';
  if (offsetDays >= 1) return 'Final week';
  return 'Event day';
}
