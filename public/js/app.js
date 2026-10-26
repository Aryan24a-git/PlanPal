/**
 * PlanPal Client Application Script
 * Clean vanilla TS/JS client communicating with PlanPal REST API
 * Strictly satisfies REQ-001 through REQ-010, A11Y, SEC, and REL requirements.
 */

// Application State
let currentUser = null;
let currentToken = localStorage.getItem('planpal_token') || null;
let currentEventData = null;
let pendingAIPlan = null;

// DOM Selectors
const announcer = document.getElementById('live-announcer');
const toastContainer = document.getElementById('toast-container');
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const workspaceSection = document.getElementById('event-workspace-section');
const authNavGuest = document.getElementById('auth-nav-guest');
const authNavUser = document.getElementById('auth-nav-user');
const userNameDisplay = document.getElementById('user-name');

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const switchToRegisterBtn = document.getElementById('switch-to-register');
const switchToLoginBtn = document.getElementById('switch-to-login');
const logoutBtn = document.getElementById('btn-logout');

// Modals
const createEventModal = document.getElementById('create-event-modal');
const editEventModal = document.getElementById('edit-event-modal');
const addCategoryModal = document.getElementById('add-category-modal');
const addItemModal = document.getElementById('add-item-modal');
const addTaskModal = document.getElementById('add-task-modal');
const addVendorModal = document.getElementById('add-vendor-modal');

const createEventForm = document.getElementById('create-event-form');
const editEventForm = document.getElementById('edit-event-form');
const addCategoryForm = document.getElementById('add-category-form');
const addItemForm = document.getElementById('add-item-form');
const addTaskForm = document.getElementById('add-task-form');
const addVendorForm = document.getElementById('add-vendor-form');

const eventsGrid = document.getElementById('events-grid');
const btnBackDashboard = document.getElementById('btn-back-dashboard');
const btnTriggerAI = document.getElementById('btn-trigger-ai-plan');
const btnDeleteEvent = document.getElementById('btn-delete-event');
const btnEditEvent = document.getElementById('btn-edit-event');

const aiBanner = document.getElementById('ai-banner');
const btnApplyAI = document.getElementById('btn-apply-ai-plan');
const btnDismissAI = document.getElementById('btn-dismiss-ai');
const aiRefineInput = document.getElementById('ai-refine-input');
const btnSubmitRefine = document.getElementById('btn-submit-refine');
const aiPlanPreview = document.getElementById('ai-plan-preview');

// Tabs
const tabs = {
  budget: { btn: document.getElementById('tab-btn-budget'), pane: document.getElementById('tab-content-budget') },
  timeline: { btn: document.getElementById('tab-btn-timeline'), pane: document.getElementById('tab-content-timeline') },
  vendors: { btn: document.getElementById('tab-btn-vendors'), pane: document.getElementById('tab-content-vendors') },
  ideas: { btn: document.getElementById('tab-btn-ideas'), pane: document.getElementById('tab-content-ideas') },
};

// ─── Accessibility & Feedback Helpers ─────────────────────────────────────────
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function announce(message, priority = 'polite') {
  if (!announcer) return;
  announcer.setAttribute('aria-live', priority);
  announcer.textContent = '';
  // Force screen reader DOM mutation announcement
  setTimeout(() => {
    announcer.textContent = message;
  }, 50);
}

function showToast(message, type = 'info') {
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

// ─── Accessible Modal Dialog Helpers (W3C APG Standard) ──────────────────────
let lastFocusedElement = null;

function openModalDialog(modal) {
  if (!modal) return;
  lastFocusedElement = document.activeElement;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  const focusable = modal.querySelectorAll('input:not([type="hidden"]), select, textarea, button:not([disabled])');
  if (focusable.length > 0) {
    setTimeout(() => focusable[0].focus(), 50);
  }
}

function closeModalDialog(modal) {
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
}

// ─── Currency Formatter ───────────────────────────────────────────────────────
function formatCurrency(minorUnits, currency = 'USD') {
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

// ─── API Helper ───────────────────────────────────────────────────────────────
async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg = data?.error?.message || data?.message || data?.error || 'Request failed';
    throw new Error(errorMsg);
  }
  return data;
}

// ─── Application Bootstrap ────────────────────────────────────────────────────
async function initApp() {
  setupTabs();
  setupEventListeners();

  if (currentToken) {
    try {
      const { user } = await apiRequest('/api/auth/me');
      setAuthenticatedUser(user);
      loadDashboard();
      return;
    } catch {
      logout();
    }
  }
  showAuthView();
}

function setAuthenticatedUser(user) {
  currentUser = user;
  authNavGuest.classList.add('hidden');
  authNavUser.classList.remove('hidden');
  userNameDisplay.textContent = user.name;
}

function logout() {
  currentUser = null;
  currentToken = null;
  localStorage.removeItem('planpal_token');
  authNavUser.classList.add('hidden');
  authNavGuest.classList.remove('hidden');
  showAuthView();
  announce('Signed out successfully');
  showToast('Signed out', 'info');
}

function showAuthView() {
  authSection.classList.remove('hidden');
  dashboardSection.classList.add('hidden');
  workspaceSection.classList.add('hidden');
}

function showDashboardView() {
  authSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  workspaceSection.classList.add('hidden');
}

function showWorkspaceView() {
  authSection.classList.add('hidden');
  dashboardSection.classList.add('hidden');
  workspaceSection.classList.remove('hidden');
}

function selectTab(key) {
  Object.keys(tabs).forEach((k) => {
    tabs[k].btn.classList.remove('active');
    tabs[k].btn.setAttribute('aria-selected', 'false');
    tabs[k].pane.classList.add('hidden');
  });
  tabs[key].btn.classList.add('active');
  tabs[key].btn.setAttribute('aria-selected', 'true');
  tabs[key].pane.classList.remove('hidden');
  announce(`Switched to ${tabs[key].btn.textContent.trim()} tab`);
}

function setupTabs() {
  const tabKeys = Object.keys(tabs);
  tabKeys.forEach((key, index) => {
    tabs[key].btn.addEventListener('click', () => {
      selectTab(key);
    });
    // W3C ARIA Tab Navigation (Arrow keys)
    tabs[key].btn.addEventListener('keydown', (e) => {
      let nextIndex = null;
      if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabKeys.length;
      if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabKeys.length) % tabKeys.length;
      if (nextIndex !== null) {
        e.preventDefault();
        const nextKey = tabKeys[nextIndex];
        selectTab(nextKey);
        tabs[nextKey].btn.focus();
      }
    });
  });
}

// ─── Event Listeners Setup ────────────────────────────────────────────────────
function setupEventListeners() {
  // Auth Form Toggling
  switchToRegisterBtn.addEventListener('click', () => {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
  });
  switchToLoginBtn.addEventListener('click', () => {
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
  });

  // Login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      currentToken = res.token;
      localStorage.setItem('planpal_token', res.token);
      setAuthenticatedUser(res.user);
      loadDashboard();
      announce(`Welcome back, ${res.user.name}`);
      showToast(`Welcome back, ${res.user.name}!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Register
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    try {
      const res = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      });
      currentToken = res.token;
      localStorage.setItem('planpal_token', res.token);
      setAuthenticatedUser(res.user);
      loadDashboard();
      announce(`Account created! Welcome, ${res.user.name}`);
      showToast('Account created successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  logoutBtn.addEventListener('click', logout);

  // Modal Controls (W3C APG Accessible Dialog Pattern)
  const setupModal = (modal, openBtns, closeBtns) => {
    openBtns.forEach((btn) => btn?.addEventListener('click', () => openModalDialog(modal)));
    closeBtns.forEach((btn) => btn?.addEventListener('click', () => closeModalDialog(modal)));
  };

  // Global Escape key listener to close active modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
      if (openModal) closeModalDialog(openModal);
    }
  });

  // Focus trap inside active modal dialog
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (!openModal) return;

    const focusable = Array.from(openModal.querySelectorAll('input:not([type="hidden"]), select, textarea, button:not([disabled]), [tabindex="0"]'));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  setupModal(createEventModal,
    [document.getElementById('btn-create-event-top'), document.getElementById('btn-new-event-nav')],
    [document.getElementById('btn-close-modal'), document.getElementById('btn-cancel-event')]);

  setupModal(editEventModal,
    [btnEditEvent],
    [document.getElementById('btn-close-edit-modal'), document.getElementById('btn-cancel-edit-event')]);

  setupModal(addCategoryModal,
    [document.getElementById('btn-add-category-tab')],
    [document.getElementById('btn-close-cat-modal'), document.getElementById('btn-cancel-cat')]);

  setupModal(addItemModal,
    [],
    [document.getElementById('btn-close-item-modal'), document.getElementById('btn-cancel-item')]);

  setupModal(addTaskModal,
    [document.getElementById('btn-add-task-tab')],
    [document.getElementById('btn-close-task-modal'), document.getElementById('btn-cancel-task')]);

  setupModal(addVendorModal,
    [document.getElementById('btn-add-vendor-tab')],
    [document.getElementById('btn-close-vendor-modal'), document.getElementById('btn-cancel-vendor')]);

  // Create Event Form
  createEventForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('event-name').value.trim();
    const type = document.getElementById('event-type').value;
    const eventDate = document.getElementById('event-date').value;
    const guestEstimate = parseInt(document.getElementById('event-guests').value, 10);
    const currency = document.getElementById('event-currency').value;
    const rawBudget = parseFloat(document.getElementById('event-budget').value);
    const totalBudget = Math.round(rawBudget * 100); // convert to minor units
    const brief = document.getElementById('event-brief').value.trim();

    try {
      const res = await apiRequest('/api/events', {
        method: 'POST',
        body: JSON.stringify({ name, type, eventDate, guestEstimate, totalBudget, currency, brief }),
      });
      createEventModal.classList.add('hidden');
      createEventForm.reset();
      await openEventWorkspace(res.event.id);
      announce(`Event "${name}" created successfully`);
      showToast('Event created! Now launch the AI Copilot to generate your draft plan.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Edit Event Form (REQ-005: date changes shift unpinned tasks)
  editEventForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEventData) return;
    const name = document.getElementById('edit-event-name').value.trim();
    const eventDate = document.getElementById('edit-event-date').value;
    const guestEstimate = parseInt(document.getElementById('edit-event-guests').value, 10);
    const rawBudget = parseFloat(document.getElementById('edit-event-budget').value);
    const totalBudget = Math.round(rawBudget * 100);
    const brief = document.getElementById('edit-event-brief').value.trim();

    try {
      await apiRequest(`/api/events/${currentEventData.event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, eventDate, guestEstimate, totalBudget, brief }),
      });
      editEventModal.classList.add('hidden');
      await openEventWorkspace(currentEventData.event.id);
      announce('Event updated. Timeline tasks automatically resynchronized with new date.');
      showToast('Event settings saved. Tasks shifted to match new event date.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Add Budget Category Form
  addCategoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEventData) return;
    const name = document.getElementById('cat-name').value.trim();
    const plannedMinor = Math.round(parseFloat(document.getElementById('cat-planned').value) * 100);

    try {
      await apiRequest(`/api/events/${currentEventData.event.id}/budget/categories`, {
        method: 'POST',
        body: JSON.stringify({ name, plannedMinor }),
      });
      addCategoryModal.classList.add('hidden');
      addCategoryForm.reset();
      await openEventWorkspace(currentEventData.event.id);
      showToast(`Category "${name}" added`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Add Line Item Form
  addItemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEventData) return;
    const catId = document.getElementById('item-cat-id').value;
    const label = document.getElementById('item-label').value.trim();
    const plannedMinor = Math.round(parseFloat(document.getElementById('item-planned').value) * 100);
    const rawActual = document.getElementById('item-actual').value;
    const actualMinor = rawActual ? Math.round(parseFloat(rawActual) * 100) : 0;
    const note = document.getElementById('item-note').value.trim() || undefined;

    try {
      await apiRequest(`/api/events/${currentEventData.event.id}/budget/categories/${catId}/items`, {
        method: 'POST',
        body: JSON.stringify({ label, plannedMinor, actualMinor, note }),
      });
      addItemModal.classList.add('hidden');
      addItemForm.reset();
      await openEventWorkspace(currentEventData.event.id);
      showToast(`Item "${label}" added to budget`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Add Task Form
  addTaskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEventData) return;
    const title = document.getElementById('task-title').value.trim();
    const offsetDays = parseInt(document.getElementById('task-offset').value, 10);
    const priority = document.getElementById('task-priority').value;
    const phase = document.getElementById('task-phase').value.trim() || undefined;
    const pinned = document.getElementById('task-pinned').checked;

    try {
      await apiRequest(`/api/events/${currentEventData.event.id}/timeline`, {
        method: 'POST',
        body: JSON.stringify({ title, offsetDays, priority, phase, pinned }),
      });
      addTaskModal.classList.add('hidden');
      addTaskForm.reset();
      await openEventWorkspace(currentEventData.event.id);
      showToast(`Task "${title}" added to timeline`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Add Vendor Form
  addVendorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEventData) return;
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
      await apiRequest(`/api/events/${currentEventData.event.id}/vendors`, {
        method: 'POST',
        body: JSON.stringify({ category, name, status, quoteMinor, contactName, contactPhone, contactEmail, note }),
      });
      addVendorModal.classList.add('hidden');
      addVendorForm.reset();
      await openEventWorkspace(currentEventData.event.id);
      showToast(`Vendor "${name}" recorded`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  btnBackDashboard.addEventListener('click', loadDashboard);

  // Trigger AI plan generation (REQ-003: advisory, not auto-applied)
  btnTriggerAI.addEventListener('click', async () => {
    if (!currentEventData) return;
    btnTriggerAI.disabled = true;
    btnTriggerAI.innerHTML = '<span class="sparkle-icon">⏳</span> Generating AI Draft...';
    announce('AI is generating draft plan for budget, timeline, and vendors');

    try {
      const res = await apiRequest(`/api/events/${currentEventData.event.id}/ai/draft`, {
        method: 'POST',
      });
      pendingAIPlan = res.plan;
      showAIBanner(res.plan, res.warnings);
      announce('AI draft plan ready for review');
      showToast('AI draft plan generated. Review details in the proposal banner before applying.', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnTriggerAI.disabled = false;
      btnTriggerAI.innerHTML = '<span class="sparkle-icon" aria-hidden="true">✨</span> Generate AI Draft Plan';
    }
  });

  // Apply AI Plan (REQ-003, REL-002)
  btnApplyAI.addEventListener('click', async () => {
    if (!currentEventData || !pendingAIPlan) return;
    btnApplyAI.disabled = true;
    btnApplyAI.textContent = 'Saving Plan...';

    try {
      await apiRequest(`/api/events/${currentEventData.event.id}/ai/draft/apply`, {
        method: 'POST',
        body: JSON.stringify({ plan: pendingAIPlan }),
      });
      pendingAIPlan = null;
      aiBanner.classList.add('hidden');
      await openEventWorkspace(currentEventData.event.id);
      announce('AI plan applied and saved to your event.');
      showToast('AI Draft Plan saved! Budget, timeline, and vendors updated.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnApplyAI.disabled = false;
      btnApplyAI.textContent = 'Apply & Save Plan';
    }
  });

  btnDismissAI.addEventListener('click', () => {
    pendingAIPlan = null;
    aiBanner.classList.add('hidden');
    showToast('AI draft plan dismissed.', 'info');
  });

  // Refine AI Plan (REQ-010: proposal only)
  btnSubmitRefine.addEventListener('click', async () => {
    const instruction = aiRefineInput.value.trim();
    if (!instruction || !currentEventData) return;

    btnSubmitRefine.disabled = true;
    btnSubmitRefine.textContent = 'Refining...';
    announce('Generating refinement proposal with AI');

    try {
      const res = await apiRequest(`/api/events/${currentEventData.event.id}/ai/refine`, {
        method: 'POST',
        body: JSON.stringify({ instruction }),
      });
      pendingAIPlan = res.proposedPlan;
      showAIBanner(res.proposedPlan, [], res.diff?.explanation || 'Refinement proposal ready.');
      aiRefineInput.value = '';
      announce('Refinement proposal ready. Review before applying.');
      showToast('Refinement proposal ready! Click Apply & Save to accept.', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnSubmitRefine.disabled = false;
      btnSubmitRefine.textContent = 'Refine with AI';
    }
  });

  // Generate Fresh Ideas Button (REQ-007)
  document.getElementById('btn-generate-fresh-ideas')?.addEventListener('click', async () => {
    if (!currentEventData) return;
    const btn = document.getElementById('btn-generate-fresh-ideas');
    btn.disabled = true;
    btn.textContent = 'Generating Ideas...';
    try {
      await apiRequest(`/api/events/${currentEventData.event.id}/ideas/generate`, { method: 'POST' });
      await openEventWorkspace(currentEventData.event.id);
      showToast('Fresh ideas generated!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Generate Fresh Ideas';
    }
  });

  // Delete Event (REQ-009)
  btnDeleteEvent.addEventListener('click', async () => {
    if (!currentEventData) return;
    if (confirm(`Are you sure you want to delete "${currentEventData.event.name}"? This will permanently delete all associated budget, tasks, and vendors.`)) {
      try {
        await apiRequest(`/api/events/${currentEventData.event.id}`, { method: 'DELETE' });
        loadDashboard();
        announce('Event deleted');
        showToast('Event deleted successfully.', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });
}

// ─── AI Banner Presentation ───────────────────────────────────────────────────
function showAIBanner(plan, warnings = [], customHeading = null) {
  aiBanner.classList.remove('hidden');
  document.getElementById('ai-banner-heading').textContent = customHeading || 'AI Generated Draft Plan Ready';
  document.getElementById('ai-banner-sub').textContent =
    `Proposed ${plan.budgetCategories.length} budget categories, ${plan.timelineTasks.length} timeline milestones, and ${plan.vendorChecklist.length} vendor checklist items.`;

  const currency = currentEventData?.event?.currency || 'USD';
  aiPlanPreview.innerHTML = `
    <div class="ai-preview-grid">
      <div class="ai-preview-col">
        <h4>💰 Budget Allocations</h4>
        <ul>
          ${plan.budgetCategories.map((c) => `<li><strong>${c.name}</strong>: ${formatCurrency(c.allocatedAmount, currency)} (${c.items.length} items)</li>`).join('')}
        </ul>
      </div>
      <div class="ai-preview-col">
        <h4>📅 Key Milestones</h4>
        <ul>
          ${plan.timelineTasks.slice(0, 5).map((t) => `<li>${t.title} (${t.daysBeforeEvent}d before)</li>`).join('')}
        </ul>
      </div>
      <div class="ai-preview-col">
        <h4>🤝 Vendor Checklist</h4>
        <ul>
          ${plan.vendorChecklist.slice(0, 5).map((v) => `<li>${v.category}: ${v.name}</li>`).join('')}
        </ul>
      </div>
    </div>
    ${warnings.length > 0 ? `<div style="margin-top:0.5rem; color:var(--warning); font-size:0.8rem;">⚠️ ${warnings.join(', ')}</div>` : ''}
  `;
}

// ─── Dashboard Loader (REQ-008) ───────────────────────────────────────────────
async function loadDashboard() {
  showDashboardView();
  eventsGrid.innerHTML = '<p class="subtext">Loading your events...</p>';
  try {
    const res = await apiRequest('/api/events');
    renderEventsList(res.events || []);
  } catch (err) {
    eventsGrid.innerHTML = `<p class="text-danger">Failed to load events: ${err.message}</p>`;
  }
}

function renderEventsList(events) {
  if (!events || events.length === 0) {
    eventsGrid.innerHTML = `
      <div class="glass-panel" style="padding: 2.5rem; text-align: center; grid-column: 1 / -1;">
        <h3>No events planned yet</h3>
        <p class="subtext" style="margin: 0.5rem 0 1.5rem;">Create your first wedding, birthday, or community gathering to launch the GenAI copilot.</p>
        <button id="btn-create-first" class="btn btn-primary">+ Create First Event</button>
      </div>
    `;
    document.getElementById('btn-create-first')?.addEventListener('click', () => {
      createEventModal.classList.remove('hidden');
    });
    return;
  }

  eventsGrid.innerHTML = events
    .map(
      (ev) => `
    <div class="event-card glass-panel" data-id="${ev.id}" tabindex="0" role="button" aria-label="Open event ${ev.name}">
      <div>
        <div class="card-top">
          <span class="type-pill">${ev.type.toUpperCase()}</span>
          <span class="date-pill">${ev.event_date}</span>
        </div>
        <h2 class="event-name">${escapeHtml(ev.name)}</h2>
        <p class="card-brief">${escapeHtml(ev.brief)}</p>
      </div>
      <div class="card-metrics">
        <div>
          <div class="metric-mini-label">Budget Limit</div>
          <div class="metric-mini-val">${formatCurrency(ev.total_budget, ev.currency)}</div>
        </div>
        <div>
          <div class="metric-mini-label">Spent / Progress</div>
          <div class="metric-mini-val">${formatCurrency(ev.actual_spent, ev.currency)} &bull; ${ev.tasks_done ?? 0}/${ev.tasks_total ?? 0} tasks</div>
        </div>
      </div>
    </div>
  `
    )
    .join('');

  eventsGrid.querySelectorAll('.event-card').forEach((card) => {
    const openCard = () => {
      const id = card.getAttribute('data-id');
      if (id) openEventWorkspace(id);
    };
    card.addEventListener('click', openCard);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCard();
      }
    });
  });
}

// ─── Event Workspace Loader & Renderer ─────────────────────────────────────────
async function openEventWorkspace(eventId) {
  showWorkspaceView();
  try {
    const [{ event }, budget, { tasks }, { vendors }, { ideas }] = await Promise.all([
      apiRequest(`/api/events/${eventId}`),
      apiRequest(`/api/events/${eventId}/budget`),
      apiRequest(`/api/events/${eventId}/timeline`),
      apiRequest(`/api/events/${eventId}/vendors`),
      apiRequest(`/api/events/${eventId}/ideas`),
    ]);

    currentEventData = { event, budget, tasks, vendors, ideas };
    renderEventWorkspace();
  } catch (err) {
    showToast(`Failed to load event: ${err.message}`, 'error');
    loadDashboard();
  }
}

function renderEventWorkspace() {
  if (!currentEventData) return;
  const { event, budget, tasks, vendors, ideas } = currentEventData;

  // Header Details
  document.getElementById('detail-name').textContent = event.name;
  document.getElementById('detail-type-badge').textContent = event.type.toUpperCase();
  document.getElementById('detail-date').textContent = event.event_date;
  document.getElementById('detail-guests').textContent = `${event.guest_estimate} Guests`;
  document.getElementById('detail-brief').textContent = event.brief;

  // Populate Edit Modal Fields
  document.getElementById('edit-event-name').value = event.name;
  document.getElementById('edit-event-date').value = event.event_date;
  document.getElementById('edit-event-guests').value = event.guest_estimate;
  document.getElementById('edit-event-budget').value = (event.total_budget / 100).toFixed(0);
  document.getElementById('edit-event-brief').value = event.brief;

  // 1. Budget Tab Metrics
  document.getElementById('metric-total-budget').textContent = formatCurrency(budget.totalBudget, event.currency);
  document.getElementById('metric-allocated').textContent = formatCurrency(budget.totalAllocated, event.currency);
  document.getElementById('metric-unallocated').textContent = `${formatCurrency(budget.unallocated, event.currency)} unallocated`;
  document.getElementById('metric-planned').textContent = formatCurrency(budget.totalPlanned, event.currency);

  const plannedWarning = document.getElementById('metric-overplanned-warning');
  if (budget.isOverBudget) {
    plannedWarning.textContent = '⚠️ Over budget ceiling!';
    plannedWarning.className = 'metric-sub text-danger';
  } else {
    plannedWarning.textContent = '✓ Within planned limit';
    plannedWarning.className = 'metric-sub text-success';
  }

  document.getElementById('metric-actual').textContent = formatCurrency(budget.totalActual, event.currency);
  document.getElementById('metric-remaining').textContent = `${formatCurrency(budget.remainingActual, event.currency)} remaining`;

  // Render Budget Categories
  renderBudgetCategories(budget.categories || [], event.currency);

  // 2. Timeline Tab
  renderTimeline(tasks || []);

  // 3. Vendors Tab
  renderVendors(vendors || [], event.currency);

  // 4. Ideas Tab
  renderIdeas(ideas || [], event.currency);
}

// ─── Budget Categories Renderer ───────────────────────────────────────────────
function renderBudgetCategories(categories, currency) {
  const catList = document.getElementById('budget-categories-list');
  if (categories.length === 0) {
    catList.innerHTML = '<p class="subtext">No budget categories yet. Click "+ Add Category" or "Generate AI Draft Plan" above to create them!</p>';
    return;
  }

  catList.innerHTML = categories
    .map(
      (cat) => `
    <div class="category-block">
      <div class="category-header">
        <div>
          <span class="category-name">${cat.name}</span>
          <span class="category-amounts">Allocated: ${formatCurrency(cat.plannedMinor, currency)}</span>
        </div>
        <div class="category-actions">
          <button class="btn btn-secondary btn-sm btn-add-item-to-cat" data-cat-id="${cat.id}">+ Item</button>
          <button class="btn btn-ghost btn-sm btn-delete-cat" data-cat-id="${cat.id}" title="Delete Category">&times;</button>
        </div>
      </div>
      ${(cat.items || [])
        .map(
          (item) => `
        <div class="line-item-row">
          <div>
            <strong>${item.label}</strong>
            ${item.note ? `<span class="subtext" style="margin-left:0.5rem;">(${item.note})</span>` : ''}
          </div>
          <div class="line-item-actions">
            <span>Planned: ${formatCurrency(item.plannedMinor, currency)}</span>
            <span style="color:var(--text-main); font-weight:600;">Actual: ${formatCurrency(item.actualMinor, currency)}</span>
            <button class="btn btn-ghost btn-sm btn-edit-item-actual" data-cat-id="${cat.id}" data-item-id="${item.id}" data-label="${item.label}" data-planned="${item.plannedMinor}" data-actual="${item.actualMinor}" title="Update Actual Amount">✏️</button>
            <button class="btn btn-ghost btn-sm btn-delete-item" data-cat-id="${cat.id}" data-item-id="${item.id}" title="Delete Line Item">&times;</button>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `
    )
    .join('');

  // Event handlers for Category Actions
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
          await apiRequest(`/api/events/${currentEventData.event.id}/budget/categories/${catId}`, { method: 'DELETE' });
          await openEventWorkspace(currentEventData.event.id);
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
        await apiRequest(`/api/events/${currentEventData.event.id}/budget/categories/${catId}/items/${itemId}`, { method: 'DELETE' });
        await openEventWorkspace(currentEventData.event.id);
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
            await apiRequest(`/api/events/${currentEventData.event.id}/budget/categories/${catId}/items/${itemId}`, {
              method: 'PATCH',
              body: JSON.stringify({ actualMinor: Math.round(parsed * 100) }),
            });
            await openEventWorkspace(currentEventData.event.id);
            showToast('Actual cost updated', 'success');
          } catch (err) {
            showToast(err.message, 'error');
          }
        }
      }
    });
  });
}

// ─── Timeline Renderer ────────────────────────────────────────────────────────
function renderTimeline(tasks) {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

  document.getElementById('timeline-progress-pill').textContent = `${pct}% Complete (${completed}/${total})`;

  const timelineList = document.getElementById('timeline-list');
  if (tasks.length === 0) {
    timelineList.innerHTML = '<p class="subtext">No tasks scheduled yet. Click "+ Add Task" or let AI generate your milestone timeline!</p>';
    return;
  }

  timelineList.innerHTML = tasks
    .map(
      (t) => `
    <div class="timeline-item ${t.status === 'completed' ? 'task-done' : ''}">
      <div class="task-date-box">
        <strong>${t.dueDate || t.due_date}</strong>
        <span style="font-size:0.7rem; color:var(--text-dim);">${t.offsetDays ?? t.offset_days ?? t.days_before_event ?? 0}d before</span>
      </div>
      <div class="task-content">
        <div class="task-title" style="${t.status === 'completed' ? 'text-decoration: line-through; opacity: 0.7;' : ''}">${t.title}</div>
        <span class="subtext">Phase: ${t.phase || 'General'} &bull; Priority: ${t.priority.toUpperCase()}</span>
      </div>
      <div class="task-controls">
        <button class="btn btn-ghost btn-sm btn-toggle-task" data-id="${t.id}" data-status="${t.status}">
          ${t.status === 'completed' ? '✓ Done' : '○ Mark Done'}
        </button>
        <button class="btn btn-ghost btn-sm btn-toggle-pin" data-id="${t.id}" data-pinned="${t.pinned}" title="${t.pinned ? 'Pinned (Won\'t shift)' : 'Unpinned (Shifts with event date)'}">
          ${t.pinned ? '📌' : '📍'}
        </button>
        <button class="btn btn-ghost btn-sm btn-delete-task" data-id="${t.id}" title="Delete Task">&times;</button>
      </div>
    </div>
  `
    )
    .join('');

  timelineList.querySelectorAll('.btn-toggle-task').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const taskId = btn.getAttribute('data-id');
      const currentStatus = btn.getAttribute('data-status');
      const nextStatus = currentStatus === 'completed' ? 'todo' : 'completed';
      try {
        await apiRequest(`/api/events/${currentEventData.event.id}/timeline/${taskId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus }),
        });
        await openEventWorkspace(currentEventData.event.id);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  timelineList.querySelectorAll('.btn-toggle-pin').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const taskId = btn.getAttribute('data-id');
      const isPinned = btn.getAttribute('data-pinned') === '1' || btn.getAttribute('data-pinned') === 'true';
      try {
        await apiRequest(`/api/events/${currentEventData.event.id}/timeline/${taskId}`, {
          method: 'PATCH',
          body: JSON.stringify({ pinned: !isPinned }),
        });
        await openEventWorkspace(currentEventData.event.id);
        showToast(!isPinned ? 'Task pinned to date' : 'Task unpinned (will shift with event date)', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  timelineList.querySelectorAll('.btn-delete-task').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const taskId = btn.getAttribute('data-id');
      try {
        await apiRequest(`/api/events/${currentEventData.event.id}/timeline/${taskId}`, { method: 'DELETE' });
        await openEventWorkspace(currentEventData.event.id);
        showToast('Task removed', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

// ─── Vendors Renderer ─────────────────────────────────────────────────────────
function renderVendors(vendors, currency) {
  const statsDiv = document.getElementById('vendor-stats-summary');
  const booked = vendors.filter((v) => v.status === 'booked').length;
  const quoted = vendors.filter((v) => v.status === 'quoted').length;
  const totalQuoted = vendors.reduce((sum, v) => sum + (v.quote_minor || 0), 0);

  statsDiv.innerHTML = `
    <span class="date-pill">${vendors.length} Total</span>
    <span class="type-pill">${booked} Booked</span>
    <span class="guest-pill">${quoted} Quoted (${formatCurrency(totalQuoted, currency)})</span>
  `;

  const vendorGrid = document.getElementById('vendors-grid');
  if (vendors.length === 0) {
    vendorGrid.innerHTML = '<p class="subtext">No vendor checklist items yet. Click "+ Add Vendor" or use AI Draft Plan.</p>';
    return;
  }

  vendorGrid.innerHTML = vendors
    .map(
      (v) => `
    <div class="vendor-card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div class="vendor-cat">${v.category}</div>
        <button class="btn btn-ghost btn-sm btn-delete-vendor" data-id="${v.id}" title="Delete Vendor">&times;</button>
      </div>
      <div class="vendor-title">${v.name}</div>
      <p class="vendor-notes">${v.note || 'No notes specified'}</p>
      
      <div style="margin: 0.75rem 0; font-size:0.85rem; color:var(--text-muted);">
        ${v.contact_name ? `<div>👤 ${v.contact_name}</div>` : ''}
        ${v.contact_phone ? `<div>📞 ${v.contact_phone}</div>` : ''}
        ${v.contact_email ? `<div>✉️ ${v.contact_email}</div>` : ''}
        ${v.quote_minor ? `<div style="font-weight:600; color:var(--text-main); margin-top:0.25rem;">Quote: ${formatCurrency(v.quote_minor, currency)}</div>` : ''}
      </div>

      <div style="margin-top:0.5rem;">
        <label style="font-size:0.75rem; color:var(--text-dim); display:block; margin-bottom:0.2rem;">Status</label>
        <select class="form-control select-vendor-status" data-id="${v.id}" style="padding:0.35rem 0.6rem; font-size:0.85rem;">
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
        await apiRequest(`/api/events/${currentEventData.event.id}/vendors/${vendorId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        });
        await openEventWorkspace(currentEventData.event.id);
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
        await apiRequest(`/api/events/${currentEventData.event.id}/vendors/${vendorId}`, { method: 'DELETE' });
        await openEventWorkspace(currentEventData.event.id);
        showToast('Vendor entry removed', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

// ─── Ideas Renderer (REQ-007, DATA-001) ───────────────────────────────────────
function renderIdeas(ideas, currency) {
  const ideasGrid = document.getElementById('ideas-grid');
  if (ideas.length === 0) {
    ideasGrid.innerHTML = '<p class="subtext">No AI ideas yet. Click "✨ Generate Fresh Ideas" above to create personalized concepts tailored to your brief!</p>';
    return;
  }

  ideasGrid.innerHTML = ideas
    .map((idea) => {
      const hasRange = idea.est_low_minor !== null && idea.est_high_minor !== null;
      return `
      <div class="idea-card ${idea.state === 'dismissed' ? 'hidden' : ''}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="idea-cat-tag">${idea.category}</div>
          <span class="type-pill" style="font-size:0.7rem;">${idea.state}</span>
        </div>
        <div class="idea-title">${idea.title}</div>
        <p class="idea-desc">${idea.description}</p>
        
        ${hasRange ? `
          <div class="idea-estimate-pill">
            Est: ${formatCurrency(idea.est_low_minor, currency)} – ${formatCurrency(idea.est_high_minor, currency)} (Advisory)
          </div>
        ` : ''}

        <div class="idea-actions">
          ${idea.state !== 'saved' ? `
            <button class="btn btn-primary btn-sm btn-save-idea" data-id="${idea.id}">⭐ Save</button>
          ` : '<span class="date-pill">Saved ⭐</span>'}
          ${idea.state !== 'dismissed' ? `
            <button class="btn btn-ghost btn-sm btn-dismiss-idea" data-id="${idea.id}">Dismiss</button>
          ` : ''}
        </div>
      </div>
    `;
    })
    .join('');

  ideasGrid.querySelectorAll('.btn-save-idea').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ideaId = btn.getAttribute('data-id');
      try {
        await apiRequest(`/api/events/${currentEventData.event.id}/ideas/${ideaId}`, {
          method: 'PATCH',
          body: JSON.stringify({ state: 'saved' }),
        });
        await openEventWorkspace(currentEventData.event.id);
        showToast('Idea marked as saved!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  ideasGrid.querySelectorAll('.btn-dismiss-idea').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ideaId = btn.getAttribute('data-id');
      try {
        await apiRequest(`/api/events/${currentEventData.event.id}/ideas/${ideaId}`, {
          method: 'PATCH',
          body: JSON.stringify({ state: 'dismissed' }),
        });
        await openEventWorkspace(currentEventData.event.id);
        showToast('Idea dismissed', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

// Launch
initApp();
