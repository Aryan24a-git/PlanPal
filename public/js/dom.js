/**
 * PlanPal DOM Utilities & Accessibility Helpers
 * A11Y-001, A11Y-002, SEC-004.
 */

function getAnnouncer() {
  return typeof document !== 'undefined' ? document.getElementById('live-announcer') : null;
}
function getToastContainer() {
  return typeof document !== 'undefined' ? document.getElementById('toast-container') : null;
}
let lastFocusedElement = null;

/**
 * SEC-004 / Finding 16: Sanitize all untrusted dynamic strings before DOM interpolation.
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * A11Y-002: Dynamic screen reader announcer using aria-live
 */
export function announce(message, priority = 'polite') {
  const announcer = getAnnouncer();
  if (!announcer) return;
  announcer.setAttribute('aria-live', priority);
  announcer.textContent = '';
  setTimeout(() => {
    announcer.textContent = message;
  }, 50);
}

/**
 * Toast notifications with auto-dismiss and accessibility announcement
 */
export function showToast(message, type = 'info') {
  const toastContainer = getToastContainer();
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);
  announce(message, type === 'error' ? 'assertive' : 'polite');
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

/**
 * W3C APG Accessible Dialog: Opens modal and sets focus
 */
export function openModalDialog(modal) {
  if (!modal) return;
  lastFocusedElement = document.activeElement;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  const dialog = modal.querySelector('.modal-dialog') || modal;
  const focusable = dialog.querySelectorAll('input:not([type="hidden"]), select, textarea, button:not([disabled])');
  if (focusable.length > 0) {
    setTimeout(() => focusable[0].focus(), 50);
  }
}

/**
 * W3C APG Accessible Dialog: Closes modal and restores focus
 */
export function closeModalDialog(modal) {
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
}

/**
 * Finding 32: Move focus to view heading on SPA navigation
 */
export function focusViewHeading(headingId) {
  setTimeout(() => {
    const heading = document.getElementById(headingId);
    if (heading && typeof heading.focus === 'function') {
      heading.focus();
    }
  }, 50);
}

/**
 * Currency formatter converting integer minor units (cents) to localized string
 */
export function formatCurrency(minorUnits, currency = 'USD') {
  const amount = (minorUnits ?? 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

/**
 * W3C ARIA Tablist Keyboard Navigation (ArrowRight / ArrowLeft)
 */
export function setupTabs(tabs, onSelect) {
  const tabKeys = Object.keys(tabs);
  tabKeys.forEach((key, index) => {
    tabs[key].btn.addEventListener('click', () => {
      onSelect(key);
    });
    tabs[key].btn.addEventListener('keydown', (e) => {
      let nextIndex = null;
      if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabKeys.length;
      if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabKeys.length) % tabKeys.length;
      if (nextIndex !== null) {
        e.preventDefault();
        const nextKey = tabKeys[nextIndex];
        onSelect(nextKey);
        tabs[nextKey].btn.focus();
      }
    });
  });
}
