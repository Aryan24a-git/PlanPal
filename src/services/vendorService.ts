/**
 * VendorService — Vendor directory and CRM management.
 * REQ-006, SEC-002: IDOR-safe vendor operations.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database.js';
import { NotFoundError } from '../shared/errors.js';
import { VENDOR_CATEGORIES_BY_TYPE } from '../domain/vendors.js';
import type { EventType } from '../schemas/index.js';

export interface VendorRow {
  id: string;
  event_id: string;
  category: string;
  name: string;
  status: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  quote_minor: number | null;
  note: string | null;
}

export function rowToVendor(r: VendorRow) {
  return {
    id: r.id,
    event_id: r.event_id,
    category: r.category,
    name: r.name,
    status: r.status,
    contact_name: r.contact_name ?? undefined,
    contact_email: r.contact_email ?? undefined,
    contact_phone: r.contact_phone ?? undefined,
    quote_minor: r.quote_minor ?? undefined,
    note: r.note ?? undefined,
  };
}

export class VendorService {
  private get db() {
    return getDatabase();
  }

  private assertOwns(eventId: string, ownerId: string) {
    const row = this.db.prepare('SELECT id FROM events WHERE id = ? AND owner_id = ?').get(eventId, ownerId);
    if (!row) throw new NotFoundError('Event not found');
  }

  listVendors(eventId: string, ownerId: string) {
    this.assertOwns(eventId, ownerId);
    return (this.db.prepare('SELECT * FROM vendor_items WHERE event_id = ? ORDER BY category, name').all(eventId) as VendorRow[]).map(rowToVendor);
  }

  seedVendorsForEvent(eventId: string, eventType: string): void {
    const categories = VENDOR_CATEGORIES_BY_TYPE[eventType as EventType] || [];
    const insert = this.db.prepare(
      'INSERT INTO vendor_items (id, event_id, category, name, status) VALUES (?, ?, ?, ?, ?)'
    );
    for (const cat of categories) {
      insert.run(uuidv4(), eventId, cat, `TBD ${cat}`, 'to_contact');
    }
  }

  createVendor(eventId: string, ownerId: string, data: { category: string; name: string; status?: string; contactName?: string; contactEmail?: string; contactPhone?: string; quoteMinor?: number; note?: string }) {
    this.assertOwns(eventId, ownerId);
    const id = uuidv4();
    this.db.prepare('INSERT INTO vendor_items (id, event_id, category, name, status, contact_name, contact_email, contact_phone, quote_minor, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, eventId, data.category, data.name, data.status ?? 'to_contact', data.contactName ?? null, data.contactEmail ?? null, data.contactPhone ?? null, data.quoteMinor ?? null, data.note ?? null);
    return rowToVendor(this.db.prepare('SELECT * FROM vendor_items WHERE id = ?').get(id) as VendorRow);
  }

  updateVendor(vendorId: string, eventId: string, ownerId: string, patch: Partial<{ category: string; name: string; status: string; contactName: string; contactEmail: string; contactPhone: string; quoteMinor: number; note: string }>) {
    this.assertOwns(eventId, ownerId);
    const vendor = this.db.prepare('SELECT id FROM vendor_items WHERE id = ? AND event_id = ?').get(vendorId, eventId);
    if (!vendor) throw new NotFoundError('Vendor not found');
    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<string, string> = {
      category: 'category',
      name: 'name',
      status: 'status',
      contactName: 'contact_name',
      contactEmail: 'contact_email',
      contactPhone: 'contact_phone',
      quoteMinor: 'quote_minor',
      note: 'note',
    };
    for (const [k, col] of Object.entries(map)) {
      if (patch[k as keyof typeof patch] !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(patch[k as keyof typeof patch] ?? null);
      }
    }
    if (sets.length > 0) {
      vals.push(vendorId);
      this.db.prepare(`UPDATE vendor_items SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    return rowToVendor(this.db.prepare('SELECT * FROM vendor_items WHERE id = ?').get(vendorId) as VendorRow);
  }

  deleteVendor(vendorId: string, eventId: string, ownerId: string) {
    this.assertOwns(eventId, ownerId);
    const result = this.db.prepare('DELETE FROM vendor_items WHERE id = ? AND event_id = ?').run(vendorId, eventId);
    if (result.changes === 0) throw new NotFoundError('Vendor not found');
  }
}
