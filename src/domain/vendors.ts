/**
 * V2-03: Vendor domain — seeded categories per event type.
 * REQ-006: Vendor categories vary by event type (business rule).
 */
import type { EventType } from '../schemas/index.js';

export interface VendorItem {
  id?: string;
  category: string;
  name: string;
  status: 'to_contact' | 'contacted' | 'quoted' | 'booked' | 'declined';
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  quoteMinor?: number;
  note?: string;
}

export const VENDOR_CATEGORIES_BY_TYPE: Record<EventType, string[]> = {
  wedding: [
    'Venue & Reception',
    'Catering & Bar',
    'Photography & Video',
    'Floral & Decor',
    'Music / DJ / Band',
    'Hair & Makeup',
    'Invitations & Stationery',
    'Wedding Cake & Desserts',
    'Transportation',
    'Officiant & Ceremony',
  ],
  birthday: [
    'Venue / Space Rental',
    'Cake & Sweets',
    'Catering / Snacks',
    'Entertainment / DJ',
    'Decor & Balloons',
    'Photography',
    'Party Favors',
  ],
  community: [
    'Permits & Venue',
    'Sound / Audio-Visual',
    'Food & Refreshments',
    'Waste Management',
    'Security & First Aid',
    'Signage & Printing',
    'Volunteers & Staffing',
  ],
};

export interface VendorSummary {
  total: number;
  booked: number;
  quoted: number;
  contacted: number;
  toContact: number;
  declined: number;
  totalQuotedMinor: number;
}

export function summarizeVendors(vendors: VendorItem[]): VendorSummary {
  const result: VendorSummary = {
    total: vendors.length,
    booked: 0,
    quoted: 0,
    contacted: 0,
    toContact: 0,
    declined: 0,
    totalQuotedMinor: 0,
  };

  for (const v of vendors) {
    if (typeof v.quoteMinor === 'number') {
      result.totalQuotedMinor += Math.max(0, v.quoteMinor);
    }
    switch (v.status) {
      case 'booked': result.booked++; break;
      case 'quoted': result.quoted++; break;
      case 'contacted': result.contacted++; break;
      case 'declined': result.declined++; break;
      default: result.toContact++;
    }
  }
  return result;
}
