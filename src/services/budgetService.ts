/**
 * BudgetService — Budget categories and item management.
 * REQ-004, SEC-002.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database.js';
import { summarizeBudget, type BudgetCategory } from '../domain/budget.js';
import { NotFoundError } from '../shared/errors.js';

interface CategoryRow {
  id: string;
  event_id: string;
  name: string;
  planned_minor: number;
  sort_order: number;
}

interface ItemRow {
  id: string;
  category_id: string;
  label: string;
  planned_minor: number;
  actual_minor: number;
  note: string | null;
}

export class BudgetService {
  private get db() {
    return getDatabase();
  }

  getFullBudget(eventId: string, ownerId: string) {
    // IDOR check via event ownership
    const event = this.db.prepare('SELECT id, total_budget, currency FROM events WHERE id = ? AND owner_id = ?')
      .get(eventId, ownerId) as { id: string; total_budget: number; currency: string } | undefined;
    if (!event) throw new NotFoundError('Event not found');

    const cats = this.db.prepare('SELECT * FROM budget_categories WHERE event_id = ? ORDER BY sort_order').all(eventId) as CategoryRow[];
    const catIds = cats.map((c) => c.id);

    const allItems = catIds.length > 0
      ? this.db.prepare(`SELECT * FROM budget_items WHERE category_id IN (${catIds.map(() => '?').join(',')}) ORDER BY rowid`).all(...catIds) as ItemRow[]
      : [];

    const categories: BudgetCategory[] = cats.map((cat) => ({
      id: cat.id,
      name: cat.name,
      plannedMinor: cat.planned_minor,
      items: allItems
        .filter((i) => i.category_id === cat.id)
        .map((i) => ({ id: i.id, label: i.label, plannedMinor: i.planned_minor, actualMinor: i.actual_minor, note: i.note ?? undefined })),
    }));

    return { summary: summarizeBudget(event.total_budget, categories), categories, currency: event.currency };
  }

  createCategory(eventId: string, ownerId: string, name: string, plannedMinor: number) {
    const event = this.db.prepare('SELECT id FROM events WHERE id = ? AND owner_id = ?').get(eventId, ownerId);
    if (!event) throw new NotFoundError('Event not found');
    const id = uuidv4();
    const order = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM budget_categories WHERE event_id = ?').get(eventId) as { m: number }).m + 1;
    this.db.prepare('INSERT INTO budget_categories (id, event_id, name, planned_minor, sort_order) VALUES (?, ?, ?, ?, ?)').run(id, eventId, name, plannedMinor, order);
    return { id, event_id: eventId, name, planned_minor: plannedMinor, sort_order: order };
  }

  updateCategory(catId: string, eventId: string, ownerId: string, patch: { name?: string; plannedMinor?: number }) {
    const cat = this.db.prepare('SELECT bc.* FROM budget_categories bc JOIN events e ON e.id = bc.event_id WHERE bc.id = ? AND bc.event_id = ? AND e.owner_id = ?').get(catId, eventId, ownerId);
    if (!cat) throw new NotFoundError('Budget category not found');
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name); }
    if (patch.plannedMinor !== undefined) { sets.push('planned_minor = ?'); vals.push(patch.plannedMinor); }
    if (sets.length > 0) {
      vals.push(catId);
      this.db.prepare(`UPDATE budget_categories SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    return this.db.prepare('SELECT * FROM budget_categories WHERE id = ?').get(catId);
  }

  deleteCategory(catId: string, eventId: string, ownerId: string) {
    const cat = this.db.prepare('SELECT bc.id FROM budget_categories bc JOIN events e ON e.id = bc.event_id WHERE bc.id = ? AND bc.event_id = ? AND e.owner_id = ?').get(catId, eventId, ownerId);
    if (!cat) throw new NotFoundError('Budget category not found');
    this.db.prepare('DELETE FROM budget_categories WHERE id = ?').run(catId);
  }

  createItem(catId: string, eventId: string, ownerId: string, data: { label: string; plannedMinor: number; actualMinor?: number; note?: string }) {
    const cat = this.db.prepare('SELECT bc.id FROM budget_categories bc JOIN events e ON e.id = bc.event_id WHERE bc.id = ? AND bc.event_id = ? AND e.owner_id = ?').get(catId, eventId, ownerId);
    if (!cat) throw new NotFoundError('Budget category not found');
    const id = uuidv4();
    this.db.prepare('INSERT INTO budget_items (id, category_id, label, planned_minor, actual_minor, note) VALUES (?, ?, ?, ?, ?, ?)').run(id, catId, data.label, data.plannedMinor, data.actualMinor ?? 0, data.note ?? null);
    return this.db.prepare('SELECT * FROM budget_items WHERE id = ?').get(id);
  }

  updateItem(itemId: string, catId: string, eventId: string, ownerId: string, patch: { label?: string; plannedMinor?: number; actualMinor?: number; note?: string }) {
    const item = this.db.prepare('SELECT bi.id FROM budget_items bi JOIN budget_categories bc ON bi.category_id = bc.id JOIN events e ON e.id = bc.event_id WHERE bi.id = ? AND bi.category_id = ? AND bc.event_id = ? AND e.owner_id = ?').get(itemId, catId, eventId, ownerId);
    if (!item) throw new NotFoundError('Budget item not found');
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.label !== undefined) { sets.push('label = ?'); vals.push(patch.label); }
    if (patch.plannedMinor !== undefined) { sets.push('planned_minor = ?'); vals.push(patch.plannedMinor); }
    if (patch.actualMinor !== undefined) { sets.push('actual_minor = ?'); vals.push(patch.actualMinor); }
    if (patch.note !== undefined) { sets.push('note = ?'); vals.push(patch.note); }
    if (sets.length > 0) {
      vals.push(itemId);
      this.db.prepare(`UPDATE budget_items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    return this.db.prepare('SELECT * FROM budget_items WHERE id = ?').get(itemId);
  }

  deleteItem(itemId: string, catId: string, eventId: string, ownerId: string) {
    const item = this.db.prepare('SELECT bi.id FROM budget_items bi JOIN budget_categories bc ON bi.category_id = bc.id JOIN events e ON e.id = bc.event_id WHERE bi.id = ? AND bi.category_id = ? AND bc.event_id = ? AND e.owner_id = ?').get(itemId, catId, eventId, ownerId);
    if (!item) throw new NotFoundError('Budget item not found');
    this.db.prepare('DELETE FROM budget_items WHERE id = ?').run(itemId);
  }
}
