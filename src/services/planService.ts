/**
 * PlanService and IdeaService — Plan application and AI idea management.
 * REQ-003, REQ-007, REL-002, SEC-002.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database.js';
import { prep } from '../db/statements.js';
import { computeDueDate } from '../domain/timeline.js';
import { NotFoundError, ValidationError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

interface IdeaRow {
  id: string;
  event_id: string;
  category: string;
  title: string;
  description: string;
  est_low_minor: number | null;
  est_high_minor: number | null;
  state: string;
}

export function rowToIdea(r: IdeaRow) {
  return {
    id: r.id,
    eventId: r.event_id,
    category: r.category,
    title: r.title,
    description: r.description,
    estLowMinor: r.est_low_minor ?? undefined,
    estHighMinor: r.est_high_minor ?? undefined,
    state: r.state,
  };
}

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

export class IdeaService {
  private get db() {
    return getDatabase();
  }

  private assertOwns(eventId: string, ownerId: string) {
    if (!prep(this.db, 'SELECT id FROM events WHERE id = ? AND owner_id = ?').get(eventId, ownerId)) {
      throw new NotFoundError('Event not found');
    }
  }

  listIdeas(eventId: string, ownerId: string) {
    this.assertOwns(eventId, ownerId);
    return (prep(this.db, 'SELECT * FROM ai_ideas WHERE event_id = ? ORDER BY rowid').all(eventId) as IdeaRow[]).map(rowToIdea);
  }

  updateIdeaState(ideaId: string, eventId: string, ownerId: string, state: string) {
    this.assertOwns(eventId, ownerId);
    const idea = prep(this.db, 'SELECT id FROM ai_ideas WHERE id = ? AND event_id = ?').get(ideaId, eventId);
    if (!idea) throw new NotFoundError('Idea not found');
    if (!['suggested', 'saved', 'dismissed'].includes(state)) throw new ValidationError('Invalid state');
    prep(this.db, 'UPDATE ai_ideas SET state = ? WHERE id = ?').run(state, ideaId);
    const row = prep(this.db, 'SELECT * FROM ai_ideas WHERE id = ?').get(ideaId) as IdeaRow;
    return rowToIdea(row);
  }

  addIdeas(eventId: string, ownerId: string, ideas: Array<{ category: string; title: string; description: string; estLowMinor?: number; estHighMinor?: number }>) {
    this.assertOwns(eventId, ownerId);
    const insertIdea = prep(this.db, 'INSERT INTO ai_ideas (id, event_id, category, title, description, est_low_minor, est_high_minor, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const idea of ideas) {
      insertIdea.run(uuidv4(), eventId, idea.category, idea.title, idea.description, idea.estLowMinor ?? null, idea.estHighMinor ?? null, 'suggested');
    }
  }
}

export class PlanService {
  private get db() {
    return getDatabase();
  }

  /**
   * Atomically replace all plan children with the normalized AI draft.
   * REL-002: wrapped in a single SQLite transaction.
   */
  applyDraftPlan(eventId: string, ownerId: string, plan: {
    budgetCategories: Array<{ name: string; allocatedAmount: number; items: Array<{ name: string; plannedAmount: number }> }>;
    timelineTasks: Array<{ title: string; daysBeforeEvent: number; priority: string; dueDate?: string; phase?: string }>;
    vendorChecklist: Array<{ category: string; name: string; notes?: string }>;
    ideas: Array<{ category: string; title: string; description: string; estLowMinor?: number; estHighMinor?: number }>;
  }): void {
    const event = prep(this.db, 'SELECT * FROM events WHERE id = ? AND owner_id = ?').get(eventId, ownerId) as EventRow | undefined;
    if (!event) throw new NotFoundError('Event not found');

    const apply = this.db.transaction(() => {
      // Clear existing plan data
      prep(this.db, 'DELETE FROM budget_categories WHERE event_id = ?').run(eventId);
      prep(this.db, 'DELETE FROM timeline_tasks WHERE event_id = ?').run(eventId);
      prep(this.db, 'DELETE FROM vendor_items WHERE event_id = ?').run(eventId);
      prep(this.db, 'DELETE FROM ai_ideas WHERE event_id = ?').run(eventId);

      // E2: Prepare statements once outside loops
      const insertCatStmt = prep(this.db, 'INSERT INTO budget_categories (id, event_id, name, planned_minor, sort_order) VALUES (?, ?, ?, ?, ?)');
      const insertItemStmt = prep(this.db, 'INSERT INTO budget_items (id, category_id, label, planned_minor, actual_minor) VALUES (?, ?, ?, ?, ?)');
      const insertTaskStmt = prep(this.db, 'INSERT INTO timeline_tasks (id, event_id, title, offset_days, due_date, pinned, status, priority, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const insertVendorStmt = prep(this.db, 'INSERT INTO vendor_items (id, event_id, category, name, status, note) VALUES (?, ?, ?, ?, ?, ?)');
      const insertIdeaStmt = prep(this.db, 'INSERT INTO ai_ideas (id, event_id, category, title, description, est_low_minor, est_high_minor, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

      // Insert budget
      let order = 0;
      for (const cat of plan.budgetCategories) {
        const catId = uuidv4();
        insertCatStmt.run(catId, eventId, cat.name, cat.allocatedAmount, order++);
        for (const item of cat.items) {
          insertItemStmt.run(uuidv4(), catId, item.name, item.plannedAmount, 0);
        }
      }

      // Insert tasks
      for (const task of plan.timelineTasks) {
        const dueDate = task.dueDate ?? computeDueDate(event.event_date, task.daysBeforeEvent);
        insertTaskStmt.run(uuidv4(), eventId, task.title, task.daysBeforeEvent, dueDate, 0, 'todo', task.priority, task.phase ?? null);
      }

      // Insert vendors
      for (const v of plan.vendorChecklist) {
        insertVendorStmt.run(uuidv4(), eventId, v.category, v.name, 'to_contact', v.notes ?? null);
      }

      // Insert ideas
      for (const idea of plan.ideas) {
        insertIdeaStmt.run(uuidv4(), eventId, idea.category, idea.title, idea.description, idea.estLowMinor ?? null, idea.estHighMinor ?? null, 'suggested');
      }

      prep(this.db, 'UPDATE events SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), eventId);
    });

    apply();
    logger.info('Draft plan applied', { eventId, userId: ownerId });
  }
}
