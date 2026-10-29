/**
 * EventService — Core event domain orchestration.
 * SEC-002: EVERY query scoped by owner_id = ? — IDOR-proof.
 * REL-002: Multi-row writes are transactional.
 * PERF-001: Aggregated joined queries for dashboard metrics.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database.js';
import { prep, buildUpdate } from '../db/statements.js';
import { shiftTasks } from '../domain/timeline.js';
import { NotFoundError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import type { CreateEventInput, UpdateEventInput } from '../schemas/index.js';
import { VendorService, type VendorRow, rowToVendor } from './vendorService.js';
import { TimelineService, type TaskRow, rowToTask } from './timelineService.js';

export { BudgetService } from './budgetService.js';
export { PlanService, IdeaService } from './planService.js';
export { VendorService, type VendorRow, rowToVendor };
export { TimelineService, type TaskRow, rowToTask };

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
  // Compatibility fields
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

const EVENT_UPDATE_COLS: Record<string, string> = {
  name: 'name',
  eventDate: 'event_date',
  guestEstimate: 'guest_estimate',
  totalBudget: 'total_budget',
  currency: 'currency',
  brief: 'brief',
};

export class EventService {
  constructor(private vendorService: VendorService = new VendorService()) {}

  private get db() {
    return getDatabase();
  }

  createEvent(ownerId: string, input: CreateEventInput): EventDto {
    const id = uuidv4();
    const now = new Date().toISOString();
    prep(
      this.db,
      `INSERT INTO events (id, owner_id, type, name, event_date, guest_estimate, total_budget, currency, brief, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, ownerId, input.type, input.name, input.eventDate, input.guestEstimate, input.totalBudget, input.currency, input.brief, now, now);

    // REQ-006: Seed initial vendor categories per event type via injected service
    this.vendorService.seedVendorsForEvent(id, input.type);

    logger.info('Event created', { userId: ownerId, eventId: id });
    return this.getEventOrThrow(id, ownerId);
  }

  listEvents(ownerId: string, limit = 50, offset = 0): EventDto[] {
    const rows = prep(
      this.db,
      'SELECT * FROM events WHERE owner_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    ).all(ownerId, limit, offset) as EventRow[];
    return rows.map(toEventDto);
  }

  /** Dashboard: single-query aggregated metrics per event — PERF-001 */
  listEventsSummary(ownerId: string, limit = 50, offset = 0): EventSummaryDto[] {
    return prep(
      this.db,
      `SELECT
        e.id, e.name, e.type, e.event_date, e.total_budget, e.currency, e.updated_at,
        e.event_date AS eventDate, e.total_budget AS totalBudget, e.updated_at AS updatedAt,
        COALESCE((SELECT SUM(bi.actual_minor) FROM budget_items bi
                  JOIN budget_categories bc ON bi.category_id = bc.id
                  WHERE bc.event_id = e.id), 0) AS actual_spent,
        COALESCE((SELECT COUNT(*) FROM timeline_tasks WHERE event_id = e.id), 0) AS tasks_total,
        COALESCE((SELECT COUNT(*) FROM timeline_tasks WHERE event_id = e.id AND status = 'completed'), 0) AS tasks_done
      FROM events e WHERE e.owner_id = ? ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
    ).all(ownerId, limit, offset) as EventSummaryDto[];
  }

  countEvents(ownerId: string): number {
    const row = prep(this.db, 'SELECT COUNT(*) as count FROM events WHERE owner_id = ?').get(ownerId) as { count: number };
    return row?.count ?? 0;
  }

  getEventOrThrow(eventId: string, ownerId: string): EventDto {
    const row = prep(this.db, 'SELECT * FROM events WHERE id = ? AND owner_id = ?').get(eventId, ownerId) as EventRow | undefined;
    if (!row) throw new NotFoundError('Event not found');
    return toEventDto(row);
  }

  updateEvent(eventId: string, ownerId: string, input: UpdateEventInput): EventDto {
    this.getEventOrThrow(eventId, ownerId); // IDOR check

    const tx = this.db.transaction(() => {
      if (input.eventDate !== undefined) {
        // REQ-005: date change → shift all non-pinned tasks
        const taskRows = prep(this.db, 'SELECT * FROM timeline_tasks WHERE event_id = ?').all(eventId) as TaskRow[];
        const tasks = taskRows.map(rowToTask);
        const shifted = shiftTasks(tasks, input.eventDate);

        const updateTask = prep(this.db, 'UPDATE timeline_tasks SET due_date = ?, offset_days = ? WHERE id = ?');
        for (const t of shifted) {
          if (t.id) updateTask.run(t.dueDate, t.offsetDays, t.id);
        }
      }

      const update = buildUpdate('events', EVENT_UPDATE_COLS, input as Record<string, unknown>);
      if (update) {
        prep(this.db, `${update.sql}, updated_at = ? WHERE id = ? AND owner_id = ?`).run(
          ...update.vals,
          new Date().toISOString(),
          eventId,
          ownerId,
        );
      }
    });
    tx();

    return this.getEventOrThrow(eventId, ownerId);
  }

  deleteEvent(eventId: string, ownerId: string): void {
    const result = prep(this.db, 'DELETE FROM events WHERE id = ? AND owner_id = ?').run(eventId, ownerId);
    if (result.changes === 0) throw new NotFoundError('Event not found');
    logger.info('Event deleted', { userId: ownerId, eventId });
  }
}
