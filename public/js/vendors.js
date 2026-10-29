/**
 * PlanPal Vendor CRM Module
 * REQ-006: Vendor Directory, Status Tracking, Contact Notes, and Quotes.
 */
import { apiRequest } from './api.js';
import { escapeHtml, formatCurrency, showToast, closeModalDialog } from './dom.js';

export function renderVendors(vendors, currency, eventId, onRefresh) {
  const statsDiv = document.getElementById('vendor-stats-summary');
  const booked = vendors.filter((v) => v.status === 'booked').length;
  const quoted = vendors.filter((v) => v.status === 'quoted').length;
  const totalQuoted = vendors.reduce((sum, v) => sum + (v.quoteMinor || 0), 0);

  statsDiv.innerHTML = `
    <span class="date-pill">${vendors.length} Total</span>
    <span class="type-pill">${booked} Booked</span>
    <span class="guest-pill">${quoted} Quoted (${formatCurrency(totalQuoted, currency)})</span>
  `;

  const vendorGrid = document.getElementById('vendors-grid');
  if (!vendors || vendors.length === 0) {
    vendorGrid.innerHTML = '<p class="subtext">No vendor checklist items yet. Click "+ Add Vendor" or use AI Draft Plan.</p>';
    return;
  }

  vendorGrid.innerHTML = vendors
    .map(
      (v) => `
    <div class="vendor-card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div class="vendor-cat">${escapeHtml(v.category)}</div>
        <button class="btn btn-ghost btn-sm btn-delete-vendor" data-id="${escapeHtml(v.id)}" title="Delete Vendor" aria-label="Delete vendor ${escapeHtml(v.name)}">&times;</button>
      </div>
      <div class="vendor-title">${escapeHtml(v.name)}</div>
      <p class="vendor-notes">${escapeHtml(v.note || 'No notes specified')}</p>
      
      <div style="margin: 0.75rem 0; font-size:0.85rem; color:var(--text-muted);">
        ${v.contactName ? `<div>👤 ${escapeHtml(v.contactName)}</div>` : ''}
        ${v.contactPhone ? `<div>📞 ${escapeHtml(v.contactPhone)}</div>` : ''}
        ${v.contactEmail ? `<div>✉️ ${escapeHtml(v.contactEmail)}</div>` : ''}
        ${v.quoteMinor ? `<div style="font-weight:600; color:var(--text-main); margin-top:0.25rem;">Quote: ${formatCurrency(v.quoteMinor, currency)}</div>` : ''}
      </div>

      <div style="margin-top:0.5rem;">
        <label for="vendor-status-${escapeHtml(v.id)}" style="font-size:0.75rem; color:var(--text-dim); display:block; margin-bottom:0.2rem;">Status</label>
        <select id="vendor-status-${escapeHtml(v.id)}" class="form-control select-vendor-status" data-id="${escapeHtml(v.id)}" aria-label="Status for ${escapeHtml(v.name)}" style="padding:0.35rem 0.6rem; font-size:0.85rem;">
          <option value="to_contact" ${v.status === 'to_contact' ? 'selected' : ''}>To Contact</option>
          <option value="contacted" ${v.status === 'contacted' ? 'selected' : ''}>Contacted</option>
          <option value="quoted" ${v.status === 'quoted' ? 'selected' : ''}>Quoted</option>
          <option value="booked" ${v.status === 'booked' ? 'selected' : ''}>Booked</option>
          <option value="declined" ${v.status === 'declined' ? 'selected' : ''}>Declined</option>
        </select>
      </div>
    </div>
  `
    )
    .join('');

  vendorGrid.querySelectorAll('.select-vendor-status').forEach((select) => {
    select.addEventListener('change', async () => {
      const vendorId = select.getAttribute('data-id');
      const status = select.value;
      try {
        await apiRequest(`/api/events/${eventId}/vendors/${vendorId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        });
        await onRefresh();
        showToast('Vendor status updated', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  vendorGrid.querySelectorAll('.btn-delete-vendor').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const vendorId = btn.getAttribute('data-id');
      try {
        await apiRequest(`/api/events/${eventId}/vendors/${vendorId}`, { method: 'DELETE' });
        await onRefresh();
        showToast('Vendor entry removed', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

export function initVendorForms({ getCurrentEventId, onRefresh }) {
  const addVendorModal = document.getElementById('add-vendor-modal');
  const addVendorForm = document.getElementById('add-vendor-form');

  addVendorForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventId = getCurrentEventId();
    if (!eventId) return;

    const category = document.getElementById('vendor-category').value.trim();
    const name = document.getElementById('vendor-name').value.trim();
    const status = document.getElementById('vendor-status').value;
    const rawQuote = document.getElementById('vendor-quote').value;
    const quoteMinor = rawQuote ? Math.round(parseFloat(rawQuote) * 100) : undefined;
    const contactName = document.getElementById('vendor-contact-name').value.trim() || undefined;
    const contactPhone = document.getElementById('vendor-contact-phone').value.trim() || undefined;
    const contactEmail = document.getElementById('vendor-contact-email').value.trim() || undefined;
    const note = document.getElementById('vendor-notes').value.trim() || undefined;

    try {
      await apiRequest(`/api/events/${eventId}/vendors`, {
        method: 'POST',
        body: JSON.stringify({ category, name, status, quoteMinor, contactName, contactPhone, contactEmail, note }),
      });
      closeModalDialog(addVendorModal);
      addVendorForm.reset();
      await onRefresh();
      showToast(`Vendor "${name}" recorded`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
