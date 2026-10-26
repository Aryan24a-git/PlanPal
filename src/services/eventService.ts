/**
 * EventService, TimelineService, VendorService — Core event domain orchestration.
 * SEC-002: EVERY query scoped by owner_id = ? — IDOR-proof.
 * REL-002: Multi-row writes are transactional.
 * PERF-001: No N+1 — use joined queries for dashboard metrics.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database.js';
import { computeDueDate, shiftTasks } from '../domain/timeline.js';
import { NotFoundError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import type { CreateEventInput, UpdateEventInput } from '../schemas/index.js';

// Re-export decomposed services for seamless imports across the app
export { BudgetService } from './budgetService.js';
export { PlanService, IdeaService } from './planService.js';
import { VendorService, type VendorRow, rowToVendor } from './vendorService.js';
export { VendorService, type VendorRow, rowToVendor };

// ────────────────────────────────────────────────────────────────────────────
// ROW TYPES (internal DB representation)
// ────────────────────────────────────────────────────────────────────────────
interface EventRow {
  id: string;
  owner_id: string;
  type: string;
  name: string;
  event_date: string;
  guest_estimate: number;
  total_budget: number;
  currency: string;
  brief: string;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  event_id: string;
  title: string;
  offset_days: number;
  due_date: string;
  pinned: number;
  status: string;
  priority: string;
  phase: string | null;
}

function rowToTask(r: TaskRow) {
  return {
    id: r.id,
    title: r.title,
    offsetDays: r.offset_days,
    dueDate: r.due_date,
    pinned: r.pinned === 1,
    status: r.status as 'todo' | 'in_progress' | 'completed',
    priority: r.priority as 'low' | 'medium' | 'high',
    phase: r.phase ?? undefined,
  };
}

export interface EventDto {
  id: string;
  ownerId: string;
  type: string;
  name: string;
  eventDate: string;
  guestEstimate: number;
  totalBudget: number;
  currency: string;
  brief: string;
  createdAt: string;
  updatedAt: string;
  // Also keep snake_case for backward compatibility
  owner_id: string;
  event_date: string;
  guest_estimate: number;
  total_budget: number;
  created_at: string;
  updated_at: string;
}

export interface EventSummaryDto {
  id: string;
  name: string;
  type: string;
  eventDate: string;
  event_date: string;
  totalBudget: number;
  total_budget: number;
  currency: string;
  updatedAt: string;
  updated_at: string;
  actual_spent: number;
  tasks_total: number;
  tasks_done: number;
}

export function toEventDto(r: EventRow): EventDto {
  return {
    id: r.id,
    ownerId: r.owner_id,
    type: r.type,
    name: r.name,
    eventDate: r.event_date,
    guestEstimate: r.guest_estimate,
    totalBudget: r.total_budget,
    currency: r.currency,
    brief: r.brief,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    owner_id: r.owner_id,
    event_date: r.event_date,
    guest_estimate: r.guest_estimate,
    total_budget: r.total_budget,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// EVENT SERVICE
// ────────────────────────────────────────────────────────────────────────────
export class EventService {
  private get db() {
    return getDatabase();
  }

  createEvent(ownerId: string, input: CreateEventInput) {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO events (id, owner_id, type, name, event_date, guest_estimate, total_budget, currency, brief, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ownerId, input.type, input.name, input.eventDate, input.guestEstimate, input.totalBudget, input.currency, input.brief, now, now);

    // REQ-006: Seed initial vendor categories per event type
    new VendorService().seedVendorsForEvent(id, input.type);

    logger.info('Event created', { userId: ownerId, eventId: id });
    return this.getEventOrThrow(id, ownerId);
  }

  listEvents(ownerId: string, limit = 50, offset = 0): EventDto[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE owner_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(ownerId, limit, offset) as EventRow[];
    return rows.map(toEventDto);
  }

  /** Dashboard: single-query aggregated metrics per event — PERF-001 */
  listEventsSummary(ownerId: string, limit = 50, offset = 0): EventSummaryDto[] {
    return this.db.prepare(`
      SELECT
        e.id, e.name, e.type, e.event_date, e.total_budget, e.currency, e.updated_at,
        e.event_date AS eventDate, e.total_budget AS totalBudget, e.updated_at AS updatedAt,
        COALESCE((SELECT SUM(bi.actual_minor) FROM budget_items bi
                  JOIN budget_categories bc ON bi.category_id = bc.id
                  WHERE bc.event_id = e.id), 0) AS actual_spent,
        COALESCE((SELECT COUNT(*) FROM timeline_tasks WHERE event_id = e.id), 0) AS tasks_total,
        COALESCE((SELECT COUNT(*) FROM timeline_tasks WHERE event_id = e.id AND status = 'completed'), 0) AS tasks_done
      FROM events e WHERE e.owner_id = ? ORDER BY e.created_at DESC LIMIT ? OFFSET ?
    `).all(ownerId, limit, offset) as EventSummaryDto[];
  }

  countEvents(ownerId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM events WHERE owner_id = ?').get(ownerId) as { count: number };
    return row?.count ?? 0;
  }

  getEventOrThrow(eventId: string, ownerId: string): EventDto {
    const row = this.db.prepare('SELECT * FROM events WHERE id = ? AND owner_id = ?').get(eventId, ownerId) as EventRow | undefined;
    if (!row) throw new NotFoundError('Event not found');
    return toEventDto(row);
  }

  updateEvent(eventId: string, ownerId: string, input: UpdateEventInput): EventDto {
    this.getEventOrThrow(eventId, ownerId); // IDOR check

    const tx = this.db.transaction(() => {
      if (input.eventDate !== undefined) {
        // REQ-005: date change → shift all non-pinned tasks
        const taskRows = this.db.prepare('SELECT * FROM timeline_tasks WHERE event_id = ?').all(eventId) as TaskRow[];
        const tasks = taskRows.map(rowToTask);
        const shifted = shiftTasks(tasks, input.eventDate);

        const updateTask = this.db.prepare('UPDATE timeline_tasks SET due_date = ?, offset_days = ? WHERE id = ?');
        for (const t of shifted) {
          if (t.id) updateTask.run(t.dueDate, t.offsetDays, t.id);
        }
      }

      const sets: string[] = ['updated_at = ?'];
      const values: unknown[] = [new Date().toISOString()];

      if (input.name !== undefined) { sets.push('name = ?'); values.push(input.name); }
      if (input.eventDate !== undefined) { sets.push('event_date = ?'); values.push(input.eventDate); }
      if (input.guestEstimate !== undefined) { sets.push('guest_estimate = ?'); values.push(input.guestEstimate); }
      if (input.totalBudget !== undefined) { sets.push('total_budget = ?'); values.push(input.totalBudget); }
      if (input.currency !== undefined) { sets.push('currency = ?'); values.push(input.currency); }
      if (input.brief !== undefined) { sets.push('brief = ?'); values.push(input.brief); }

      values.push(eventId, ownerId);
      this.db.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ? AND owner_id = ?`).run(...values);
    });
    tx();

    return this.getEventOrThrow(eventId, ownerId);
  }

  deleteEvent(eventId: string, ownerId: string): void {
    const result = this.db.prepare('DELETE FROM events WHERE id = ? AND owner_id = ?').run(eventId, ownerId);
    if (result.changes === 0) throw new NotFoundError('Event not found');
    logger.info('Event deleted', { userId: ownerId, eventId });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TIMELINE SERVICE
// ────────────────────────────────────────────────────────────────────────────
export class TimelineService {
  private get db() {
    return getDatabase();
  }

  private getEventDateOrThrow(eventId: string, ownerId: string): string {
    const row = this.db.prepare('SELECT event_date FROM events WHERE id = ? AND owner_id = ?').get(eventId, ownerId) as { event_date: string } | undefined;
    if (!row) throw new NotFoundError('Event not found');
    return row.event_date;
  }

  listTasks(eventId: string, ownerId: string) {
    this.getEventDateOrThrow(eventId, ownerId); // IDOR check
    return (this.db.prepare('SELECT * FROM timeline_tasks WHERE event_id = ? ORDER BY due_date ASC, offset_days DESC').all(eventId) as TaskRow[]).map(rowToTask);
  }

  createTask(eventId: string, ownerId: string, data: { title: string; offsetDays: number; pinned?: boolean; priority?: string; phase?: string }) {
    const eventDate = this.getEventDateOrThrow(eventId, ownerId);
    const id = uuidv4();
    const dueDate = computeDueDate(eventDate, data.offsetDays);
    this.db.prepare('INSERT INTO timeline_tasks (id, event_id, title, offset_days, due_date, pinned, status, priority, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, eventId, data.title, data.offsetDays, dueDate, data.pinned ? 1 : 0, 'todo', data.priority ?? 'medium', data.phase ?? null);
    return rowToTask(this.db.prepare('SELECT * FROM timeline_tasks WHERE id = ?').get(id) as TaskRow);
  }

  updateTask(taskId: string, eventId: string, ownerId: string, patch: { title?: string; offsetDays?: number; status?: string; pinned?: boolean; priority?: string; phase?: string }) {
    const eventDate = this.getEventDateOrThrow(eventId, ownerId);
    const task = this.db.prepare('SELECT * FROM timeline_tasks WHERE id = ? AND event_id = ?').get(taskId, eventId) as TaskRow | undefined;
    if (!task) throw new NotFoundError('Task not found');

    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.title !== undefined) { sets.push('title = ?'); vals.push(patch.title); }
    if (patch.offsetDays !== undefined) {
      const dueDate = computeDueDate(eventDate, patch.offsetDays);
      sets.push('offset_days = ?', 'due_date = ?'); vals.push(patch.offsetDays, dueDate);
    }
    if (patch.status !== undefined) { sets.push('status = ?'); vals.push(patch.status); }
    if (patch.pinned !== undefined) { sets.push('pinned = ?'); vals.push(patch.pinned ? 1 : 0); }
    if (patch.priority !== undefined) { sets.push('priority = ?'); vals.push(patch.priority); }
    if (patch.phase !== undefined) { sets.push('phase = ?'); vals.push(patch.phase); }
    if (sets.length > 0) {
      vals.push(taskId);
      this.db.prepare(`UPDATE timeline_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    return rowToTask(this.db.prepare('SELECT * FROM timeline_tasks WHERE id = ?').get(taskId) as TaskRow);
  }

  deleteTask(taskId: string, eventId: string, ownerId: string) {
    this.getEventDateOrThrow(eventId, ownerId);
    const result = this.db.prepare('DELETE FROM timeline_tasks WHERE id = ? AND event_id = ?').run(taskId, eventId);
    if (result.changes === 0) throw new NotFoundError('Task not found');
  }
}

