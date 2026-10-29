/**
 * VendorService — Vendor directory and CRM management.
 * REQ-006, SEC-002: IDOR-safe vendor operations.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database.js';
import { prep, buildUpdate } from '../db/statements.js';
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
    eventId: r.event_id,
    category: r.category,
    name: r.name,
    status: r.status,
    contactName: r.contact_name ?? undefined,
    contactEmail: r.contact_email ?? undefined,
    contactPhone: r.contact_phone ?? undefined,
    quoteMinor: r.quote_minor ?? undefined,
    note: r.note ?? undefined,
  };
}

const VENDOR_UPDATE_COLS: Record<string, string> = {
  category: 'category',
  name: 'name',
  status: 'status',
  contactName: 'contact_name',
  contactEmail: 'contact_email',
  contactPhone: 'contact_phone',
  quoteMinor: 'quote_minor',
  note: 'note',
};

export class VendorService {
  private get db() {
    return getDatabase();
  }

  private assertOwns(eventId: string, ownerId: string) {
    const row = prep(this.db, 'SELECT id FROM events WHERE id = ? AND owner_id = ?').get(eventId, ownerId);
    if (!row) throw new NotFoundError('Event not found');
  }

  listVendors(eventId: string, ownerId: string) {
    this.assertOwns(eventId, ownerId);
    return (prep(this.db, 'SELECT * FROM vendor_items WHERE event_id = ? ORDER BY category, name').all(eventId) as VendorRow[]).map(rowToVendor);
  }

  seedVendorsForEvent(eventId: string, eventType: string): void {
    const categories = VENDOR_CATEGORIES_BY_TYPE[eventType as EventType] || [];
    const insert = prep(
      this.db,
      'INSERT INTO vendor_items (id, event_id, category, name, status) VALUES (?, ?, ?, ?, ?)',
    );
    for (const cat of categories) {
      insert.run(uuidv4(), eventId, cat, `TBD ${cat}`, 'to_contact');
    }
  }

  createVendor(eventId: string, ownerId: string, data: { category: string; name: string; status?: string; contactName?: string; contactEmail?: string; contactPhone?: string; quoteMinor?: number; note?: string }) {
    this.assertOwns(eventId, ownerId);
    const id = uuidv4();
    prep(this.db, 'INSERT INTO vendor_items (id, event_id, category, name, status, contact_name, contact_email, contact_phone, quote_minor, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, eventId, data.category, data.name, data.status ?? 'to_contact', data.contactName ?? null, data.contactEmail ?? null, data.contactPhone ?? null, data.quoteMinor ?? null, data.note ?? null);
    return rowToVendor(prep(this.db, 'SELECT * FROM vendor_items WHERE id = ?').get(id) as VendorRow);
  }

  updateVendor(vendorId: string, eventId: string, ownerId: string, patch: Partial<{ category: string; name: string; status: string; contactName: string; contactEmail: string; contactPhone: string; quoteMinor: number; note: string }>) {
    this.assertOwns(eventId, ownerId);
    const vendor = prep(this.db, 'SELECT id FROM vendor_items WHERE id = ? AND event_id = ?').get(vendorId, eventId);
    if (!vendor) throw new NotFoundError('Vendor not found');

    const update = buildUpdate('vendor_items', VENDOR_UPDATE_COLS, patch as Record<string, unknown>);
    if (update) {
      prep(this.db, `${update.sql} WHERE id = ?`).run(...update.vals, vendorId);
    }
    return rowToVendor(prep(this.db, 'SELECT * FROM vendor_items WHERE id = ?').get(vendorId) as VendorRow);
  }

  deleteVendor(vendorId: string, eventId: string, ownerId: string): void {
    this.assertOwns(eventId, ownerId);
    const result = prep(this.db, 'DELETE FROM vendor_items WHERE id = ? AND event_id = ?').run(vendorId, eventId);
    if (result.changes === 0) throw new NotFoundError('Vendor not found');
  }
}
