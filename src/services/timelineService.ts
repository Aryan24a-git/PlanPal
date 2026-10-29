/**
 * Q5: TimelineService — Task lifecycle, milestone scheduling, and offset anchoring.
 * REQ-005, SEC-002, PERF-001.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database.js';
import { prep, buildUpdate } from '../db/statements.js';
import { computeDueDate } from '../domain/timeline.js';
import { NotFoundError } from '../shared/errors.js';

export interface TaskRow {
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

export function rowToTask(r: TaskRow) {
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

const TASK_UPDATE_COLS: Record<string, string> = {
  title: 'title',
  offsetDays: 'offset_days',
  dueDate: 'due_date',
  status: 'status',
  pinned: 'pinned',
  priority: 'priority',
  phase: 'phase',
};

export class TimelineService {
  private get db() {
    return getDatabase();
  }

  private getEventDateOrThrow(eventId: string, ownerId: string): string {
    const row = prep(this.db, 'SELECT event_date FROM events WHERE id = ? AND owner_id = ?').get(eventId, ownerId) as { event_date: string } | undefined;
    if (!row) throw new NotFoundError('Event not found');
    return row.event_date;
  }

  listTasks(eventId: string, ownerId: string) {
    this.getEventDateOrThrow(eventId, ownerId); // IDOR check
    return (prep(this.db, 'SELECT * FROM timeline_tasks WHERE event_id = ? ORDER BY due_date ASC, offset_days DESC').all(eventId) as TaskRow[]).map(rowToTask);
  }

  createTask(eventId: string, ownerId: string, data: { title: string; offsetDays: number; pinned?: boolean; priority?: string; phase?: string }) {
    const eventDate = this.getEventDateOrThrow(eventId, ownerId);
    const id = uuidv4();
    const dueDate = computeDueDate(eventDate, data.offsetDays);
    prep(this.db, 'INSERT INTO timeline_tasks (id, event_id, title, offset_days, due_date, pinned, status, priority, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, eventId, data.title, data.offsetDays, dueDate, data.pinned ? 1 : 0, 'todo', data.priority ?? 'medium', data.phase ?? null);
    return rowToTask(prep(this.db, 'SELECT * FROM timeline_tasks WHERE id = ?').get(id) as TaskRow);
  }

  updateTask(taskId: string, eventId: string, ownerId: string, patch: { title?: string; offsetDays?: number; status?: string; pinned?: boolean; priority?: string; phase?: string }) {
    const eventDate = this.getEventDateOrThrow(eventId, ownerId);
    const task = prep(this.db, 'SELECT * FROM timeline_tasks WHERE id = ? AND event_id = ?').get(taskId, eventId) as TaskRow | undefined;
    if (!task) throw new NotFoundError('Task not found');

    const patchRecord: Record<string, unknown> = { ...patch };
    if (patch.offsetDays !== undefined) {
      patchRecord['dueDate'] = computeDueDate(eventDate, patch.offsetDays);
    }

    const update = buildUpdate('timeline_tasks', TASK_UPDATE_COLS, patchRecord);
    if (update) {
      prep(this.db, `${update.sql} WHERE id = ?`).run(...update.vals, taskId);
    }

    return rowToTask(prep(this.db, 'SELECT * FROM timeline_tasks WHERE id = ?').get(taskId) as TaskRow);
  }

  deleteTask(taskId: string, eventId: string, ownerId: string): void {
    this.getEventDateOrThrow(eventId, ownerId);
    const result = prep(this.db, 'DELETE FROM timeline_tasks WHERE id = ? AND event_id = ?').run(taskId, eventId);
    if (result.changes === 0) throw new NotFoundError('Task not found');
  }
}
