/**
 * BudgetService — Budget categories and item management.
 * REQ-004, SEC-002.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database.js';
import { prep, buildUpdate } from '../db/statements.js';
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

const CATEGORY_UPDATE_COLS: Record<string, string> = {
  name: 'name',
  plannedMinor: 'planned_minor',
};

const ITEM_UPDATE_COLS: Record<string, string> = {
  label: 'label',
  plannedMinor: 'planned_minor',
  actualMinor: 'actual_minor',
  note: 'note',
};

export class BudgetService {
  private get db() {
    return getDatabase();
  }

  getFullBudget(eventId: string, ownerId: string) {
    // IDOR check via event ownership
    const event = prep(this.db, 'SELECT id, total_budget, currency FROM events WHERE id = ? AND owner_id = ?')
      .get(eventId, ownerId) as { id: string; total_budget: number; currency: string } | undefined;
    if (!event) throw new NotFoundError('Event not found');

    const cats = prep(this.db, 'SELECT * FROM budget_categories WHERE event_id = ? ORDER BY sort_order').all(eventId) as CategoryRow[];
    const catIds = cats.map((c) => c.id);

    const allItems = catIds.length > 0
      ? prep(this.db, `SELECT * FROM budget_items WHERE category_id IN (${catIds.map(() => '?').join(',')}) ORDER BY rowid`).all(...catIds) as ItemRow[]
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
    const event = prep(this.db, 'SELECT id FROM events WHERE id = ? AND owner_id = ?').get(eventId, ownerId);
    if (!event) throw new NotFoundError('Event not found');
    const id = uuidv4();
    const order = (prep(this.db, 'SELECT COALESCE(MAX(sort_order), 0) AS m FROM budget_categories WHERE event_id = ?').get(eventId) as { m: number }).m + 1;
    prep(this.db, 'INSERT INTO budget_categories (id, event_id, name, planned_minor, sort_order) VALUES (?, ?, ?, ?, ?)').run(id, eventId, name, plannedMinor, order);
    return { id, event_id: eventId, name, planned_minor: plannedMinor, sort_order: order };
  }

  updateCategory(catId: string, eventId: string, ownerId: string, patch: { name?: string; plannedMinor?: number }) {
    const cat = prep(this.db, 'SELECT bc.id FROM budget_categories bc JOIN events e ON e.id = bc.event_id WHERE bc.id = ? AND bc.event_id = ? AND e.owner_id = ?').get(catId, eventId, ownerId);
    if (!cat) throw new NotFoundError('Budget category not found');

    const update = buildUpdate('budget_categories', CATEGORY_UPDATE_COLS, patch as Record<string, unknown>);
    if (update) {
      prep(this.db, `${update.sql} WHERE id = ?`).run(...update.vals, catId);
    }
    return prep(this.db, 'SELECT * FROM budget_categories WHERE id = ?').get(catId);
  }

  deleteCategory(catId: string, eventId: string, ownerId: string): void {
    const cat = prep(this.db, 'SELECT bc.id FROM budget_categories bc JOIN events e ON e.id = bc.event_id WHERE bc.id = ? AND bc.event_id = ? AND e.owner_id = ?').get(catId, eventId, ownerId);
    if (!cat) throw new NotFoundError('Budget category not found');
    prep(this.db, 'DELETE FROM budget_categories WHERE id = ?').run(catId);
  }

  createItem(catId: string, eventId: string, ownerId: string, data: { label: string; plannedMinor: number; actualMinor?: number; note?: string }) {
    const cat = prep(this.db, 'SELECT bc.id FROM budget_categories bc JOIN events e ON e.id = bc.event_id WHERE bc.id = ? AND bc.event_id = ? AND e.owner_id = ?').get(catId, eventId, ownerId);
    if (!cat) throw new NotFoundError('Budget category not found');
    const id = uuidv4();
    prep(this.db, 'INSERT INTO budget_items (id, category_id, label, planned_minor, actual_minor, note) VALUES (?, ?, ?, ?, ?, ?)').run(id, catId, data.label, data.plannedMinor, data.actualMinor ?? 0, data.note ?? null);
    return prep(this.db, 'SELECT * FROM budget_items WHERE id = ?').get(id);
  }

  updateItem(itemId: string, catId: string, eventId: string, ownerId: string, patch: { label?: string; plannedMinor?: number; actualMinor?: number; note?: string }) {
    const item = prep(this.db, 'SELECT bi.id FROM budget_items bi JOIN budget_categories bc ON bi.category_id = bc.id JOIN events e ON e.id = bc.event_id WHERE bi.id = ? AND bi.category_id = ? AND bc.event_id = ? AND e.owner_id = ?').get(itemId, catId, eventId, ownerId);
    if (!item) throw new NotFoundError('Budget item not found');

    const update = buildUpdate('budget_items', ITEM_UPDATE_COLS, patch as Record<string, unknown>);
    if (update) {
      prep(this.db, `${update.sql} WHERE id = ?`).run(...update.vals, itemId);
    }
    return prep(this.db, 'SELECT * FROM budget_items WHERE id = ?').get(itemId);
  }

  deleteItem(itemId: string, catId: string, eventId: string, ownerId: string): void {
    const item = prep(this.db, 'SELECT bi.id FROM budget_items bi JOIN budget_categories bc ON bi.category_id = bc.id JOIN events e ON e.id = bc.event_id WHERE bi.id = ? AND bi.category_id = ? AND bc.event_id = ? AND e.owner_id = ?').get(itemId, catId, eventId, ownerId);
    if (!item) throw new NotFoundError('Budget item not found');
    prep(this.db, 'DELETE FROM budget_items WHERE id = ?').run(itemId);
  }
}
