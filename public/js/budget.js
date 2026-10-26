/**
 * PlanPal Budget Module
 * REQ-004: Categories, Planned vs Actual line items, Summary metrics, Over-budget warning.
 */
import { apiRequest } from './api.js';
import { escapeHtml, formatCurrency, showToast, openModalDialog, closeModalDialog } from './dom.js';

export function renderBudgetMetrics(budget, currency) {
  document.getElementById('metric-total-budget').textContent = formatCurrency(budget.totalBudget, currency);
  document.getElementById('metric-allocated').textContent = formatCurrency(budget.totalAllocated, currency);
  document.getElementById('metric-unallocated').textContent = `${formatCurrency(budget.unallocated, currency)} unallocated`;
  document.getElementById('metric-planned').textContent = formatCurrency(budget.totalPlanned, currency);

  const plannedWarning = document.getElementById('metric-overplanned-warning');
  if (budget.isOverBudget) {
    plannedWarning.textContent = '⚠️ Over budget ceiling!';
    plannedWarning.className = 'metric-sub text-danger';
  } else {
    plannedWarning.textContent = '✓ Within planned limit';
    plannedWarning.className = 'metric-sub text-success';
  }

  document.getElementById('metric-actual').textContent = formatCurrency(budget.totalActual, currency);
  document.getElementById('metric-remaining').textContent = `${formatCurrency(budget.remainingActual, currency)} remaining`;
}

export function renderBudgetCategories(categories, currency, eventId, onRefresh) {
  const catList = document.getElementById('budget-categories-list');
  const addItemModal = document.getElementById('add-item-modal');

  if (!categories || categories.length === 0) {
    catList.innerHTML = '<p class="subtext">No budget categories yet. Click "+ Add Category" or "Generate AI Draft Plan" above to create them!</p>';
    return;
  }

  catList.innerHTML = categories
    .map(
      (cat) => `
    <div class="category-block">
      <div class="category-header">
        <div>
          <span class="category-name">${escapeHtml(cat.name)}</span>
          <span class="category-amounts">Allocated: ${formatCurrency(cat.plannedMinor, currency)}</span>
        </div>
        <div class="category-actions">
          <button class="btn btn-secondary btn-sm btn-add-item-to-cat" data-cat-id="${escapeHtml(cat.id)}">+ Item</button>
          <button class="btn btn-ghost btn-sm btn-delete-cat" data-cat-id="${escapeHtml(cat.id)}" title="Delete Category">&times;</button>
        </div>
      </div>
      ${(cat.items || [])
        .map(
          (item) => `
        <div class="line-item-row">
          <div>
            <strong>${escapeHtml(item.label)}</strong>
            ${item.note ? `<span class="subtext" style="margin-left:0.5rem;">(${escapeHtml(item.note)})</span>` : ''}
          </div>
          <div class="line-item-actions">
            <span>Planned: ${formatCurrency(item.plannedMinor, currency)}</span>
            <span style="color:var(--text-main); font-weight:600;">Actual: ${formatCurrency(item.actualMinor, currency)}</span>
            <button class="btn btn-ghost btn-sm btn-edit-item-actual" data-cat-id="${escapeHtml(cat.id)}" data-item-id="${escapeHtml(item.id)}" data-label="${escapeHtml(item.label)}" data-planned="${item.plannedMinor}" data-actual="${item.actualMinor}" title="Update Actual Amount">✏️</button>
            <button class="btn btn-ghost btn-sm btn-delete-item" data-cat-id="${escapeHtml(cat.id)}" data-item-id="${escapeHtml(item.id)}" title="Delete Line Item">&times;</button>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `
    )
    .join('');

  catList.querySelectorAll('.btn-add-item-to-cat').forEach((btn) => {
    btn.addEventListener('click', () => {
      const catId = btn.getAttribute('data-cat-id');
      document.getElementById('item-cat-id').value = catId;
      openModalDialog(addItemModal);
    });
  });

  catList.querySelectorAll('.btn-delete-cat').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const catId = btn.getAttribute('data-cat-id');
      if (confirm('Delete this budget category and all its line items?')) {
        try {
          await apiRequest(`/api/events/${eventId}/budget/categories/${catId}`, { method: 'DELETE' });
          await onRefresh();
          showToast('Category deleted', 'info');
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });
  });

  catList.querySelectorAll('.btn-delete-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const catId = btn.getAttribute('data-cat-id');
      const itemId = btn.getAttribute('data-item-id');
      try {
        await apiRequest(`/api/events/${eventId}/budget/categories/${catId}/items/${itemId}`, { method: 'DELETE' });
        await onRefresh();
        showToast('Item deleted', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  catList.querySelectorAll('.btn-edit-item-actual').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const catId = btn.getAttribute('data-cat-id');
      const itemId = btn.getAttribute('data-item-id');
      const label = btn.getAttribute('data-label');
      const currentActual = (parseInt(btn.getAttribute('data-actual'), 10) / 100).toFixed(2);

      const input = prompt(`Update actual spent for "${label}":`, currentActual);
      if (input !== null) {
        const parsed = parseFloat(input);
        if (!isNaN(parsed) && parsed >= 0) {
          try {
            await apiRequest(`/api/events/${eventId}/budget/categories/${catId}/items/${itemId}`, {
              method: 'PATCH',
              body: JSON.stringify({ actualMinor: Math.round(parsed * 100) }),
            });
            await onRefresh();
            showToast('Actual cost updated', 'success');
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      }
    });
  });
}

export function initBudgetForms({ getCurrentEventId, onRefresh }) {
  const addCategoryModal = document.getElementById('add-category-modal');
  const addItemModal = document.getElementById('add-item-modal');
  const addCategoryForm = document.getElementById('add-category-form');
  const addItemForm = document.getElementById('add-item-form');

  addCategoryForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventId = getCurrentEventId();
    if (!eventId) return;

    const name = document.getElementById('cat-name').value.trim();
    const plannedMinor = Math.round(parseFloat(document.getElementById('cat-planned').value) * 100);

    try {
      await apiRequest(`/api/events/${eventId}/budget/categories`, {
        method: 'POST',
        body: JSON.stringify({ name, plannedMinor }),
      });
      closeModalDialog(addCategoryModal);
      addCategoryForm.reset();
      await onRefresh();
      showToast(`Category "${name}" added`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  addItemForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventId = getCurrentEventId();
    if (!eventId) return;

    const catId = document.getElementById('item-cat-id').value;
    const label = document.getElementById('item-label').value.trim();
    const plannedMinor = Math.round(parseFloat(document.getElementById('item-planned').value) * 100);
    const rawActual = document.getElementById('item-actual').value;
    const actualMinor = rawActual ? Math.round(parseFloat(rawActual) * 100) : 0;
    const note = document.getElementById('item-note').value.trim() || undefined;

    try {
      await apiRequest(`/api/events/${eventId}/budget/categories/${catId}/items`, {
        method: 'POST',
        body: JSON.stringify({ label, plannedMinor, actualMinor, note }),
      });
      closeModalDialog(addItemModal);
      addItemForm.reset();
      await onRefresh();
      showToast(`Item "${label}" added to budget`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
