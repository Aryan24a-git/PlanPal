/**
 * PlanService and IdeaService — Plan application and AI idea management.
 * REQ-003, REQ-007, REL-002, SEC-002.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database.js';
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
    if (!this.db.prepare('SELECT id FROM events WHERE id = ? AND owner_id = ?').get(eventId, ownerId)) {
      throw new NotFoundError('Event not found');
    }
  }

  listIdeas(eventId: string, ownerId: string) {
    this.assertOwns(eventId, ownerId);
    return this.db.prepare('SELECT * FROM ai_ideas WHERE event_id = ? ORDER BY rowid').all(eventId) as IdeaRow[];
  }

  updateIdeaState(ideaId: string, eventId: string, ownerId: string, state: string) {
    this.assertOwns(eventId, ownerId);
    const idea = this.db.prepare('SELECT id FROM ai_ideas WHERE id = ? AND event_id = ?').get(ideaId, eventId);
    if (!idea) throw new NotFoundError('Idea not found');
    if (!['suggested', 'saved', 'dismissed'].includes(state)) throw new ValidationError('Invalid state');
    this.db.prepare('UPDATE ai_ideas SET state = ? WHERE id = ?').run(state, ideaId);
    return this.db.prepare('SELECT * FROM ai_ideas WHERE id = ?').get(ideaId);
  }

  addIdeas(eventId: string, ownerId: string, ideas: Array<{ category: string; title: string; description: string; estLowMinor?: number; estHighMinor?: number }>) {
    this.assertOwns(eventId, ownerId);
    for (const idea of ideas) {
      this.db.prepare('INSERT INTO ai_ideas (id, event_id, category, title, description, est_low_minor, est_high_minor, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), eventId, idea.category, idea.title, idea.description, idea.estLowMinor ?? null, idea.estHighMinor ?? null, 'suggested');
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
    const event = this.db.prepare('SELECT * FROM events WHERE id = ? AND owner_id = ?').get(eventId, ownerId) as EventRow | undefined;
    if (!event) throw new NotFoundError('Event not found');

    const apply = this.db.transaction(() => {
      // Clear existing plan data
      this.db.prepare('DELETE FROM budget_categories WHERE event_id = ?').run(eventId);
      this.db.prepare('DELETE FROM timeline_tasks WHERE event_id = ?').run(eventId);
      this.db.prepare('DELETE FROM vendor_items WHERE event_id = ?').run(eventId);
      this.db.prepare('DELETE FROM ai_ideas WHERE event_id = ?').run(eventId);

      // Insert budget
      let order = 0;
      for (const cat of plan.budgetCategories) {
        const catId = uuidv4();
        this.db.prepare('INSERT INTO budget_categories (id, event_id, name, planned_minor, sort_order) VALUES (?, ?, ?, ?, ?)').run(catId, eventId, cat.name, cat.allocatedAmount, order++);
        for (const item of cat.items) {
          this.db.prepare('INSERT INTO budget_items (id, category_id, label, planned_minor, actual_minor) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), catId, item.name, item.plannedAmount, 0);
        }
      }

      // Insert tasks
      for (const task of plan.timelineTasks) {
        const dueDate = task.dueDate ?? computeDueDate(event.event_date, task.daysBeforeEvent);
        this.db.prepare('INSERT INTO timeline_tasks (id, event_id, title, offset_days, due_date, pinned, status, priority, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(uuidv4(), eventId, task.title, task.daysBeforeEvent, dueDate, 0, 'todo', task.priority, task.phase ?? null);
      }

      // Insert vendors
      for (const v of plan.vendorChecklist) {
        this.db.prepare('INSERT INTO vendor_items (id, event_id, category, name, status, note) VALUES (?, ?, ?, ?, ?, ?)').run(uuidv4(), eventId, v.category, v.name, 'to_contact', v.notes ?? null);
      }

      // Insert ideas
      for (const idea of plan.ideas) {
        this.db.prepare('INSERT INTO ai_ideas (id, event_id, category, title, description, est_low_minor, est_high_minor, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(uuidv4(), eventId, idea.category, idea.title, idea.description, idea.estLowMinor ?? null, idea.estHighMinor ?? null, 'suggested');
      }

      this.db.prepare('UPDATE events SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), eventId);
    });

    apply();
    logger.info('Draft plan applied', { eventId, userId: ownerId });
  }
}
