/**
 * PlanPal Main Application Entrypoint
 * Orchestrates views, navigation, accessible dialog traps, and module lifecycle.
 * REQ-001 through REQ-010, A11Y-001, A11Y-002, SEC-001 through SEC-009.
 */
import { getToken, apiRequest } from './api.js';
import {
  openModalDialog,
  closeModalDialog,
  announce,
  showToast,
  setupTabs,
  focusViewHeading,
} from './dom.js';
import { initAuth, setCurrentUser } from './auth.js';
import { loadEvents, initEventForms } from './events.js';
import { renderBudgetMetrics, renderBudgetCategories, initBudgetForms } from './budget.js';
import { renderTimeline, initTimelineForms } from './timeline.js';
import { renderVendors, initVendorForms } from './vendors.js';
import { renderIdeas, initIdeasActions } from './ideas.js';
import { initAIActions } from './ai.js';

// Re-export for accessibility test suite compliance
export { openModalDialog, closeModalDialog };

// State
let currentEventData = null;

// DOM View Containers
const authSection = document.getElementById('auth-section');
const dashboardSection = document.getElementById('dashboard-section');
const workspaceSection = document.getElementById('event-workspace-section');
const authNavGuest = document.getElementById('auth-nav-guest');
const authNavUser = document.getElementById('auth-nav-user');
const userNameDisplay = document.getElementById('user-name');
const eventsGrid = document.getElementById('events-grid');
const mockAiBadge = document.getElementById('mock-ai-badge');

const tabs = {
  budget: { btn: document.getElementById('tab-btn-budget'), pane: document.getElementById('tab-content-budget') },
  timeline: { btn: document.getElementById('tab-btn-timeline'), pane: document.getElementById('tab-content-timeline') },
  vendors: { btn: document.getElementById('tab-btn-vendors'), pane: document.getElementById('tab-content-vendors') },
  ideas: { btn: document.getElementById('tab-btn-ideas'), pane: document.getElementById('tab-content-ideas') },
};

export function showAuthView() {
  authSection.classList.remove('hidden');
  dashboardSection.classList.add('hidden');
  workspaceSection.classList.add('hidden');
  focusViewHeading('auth-heading');
}

export function showDashboardView() {
  authSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  workspaceSection.classList.add('hidden');
  focusViewHeading('dashboard-heading');
  loadEvents(eventsGrid, openEventWorkspace);
}

export function showWorkspaceView() {
  authSection.classList.add('hidden');
  dashboardSection.classList.add('hidden');
  workspaceSection.classList.remove('hidden');
  focusViewHeading('detail-name');
}

export function selectTab(key) {
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

export async function openEventWorkspace(eventId) {
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
    showDashboardView();
  }
}

function renderEventWorkspace() {
  if (!currentEventData) return;
  const { event, budget, tasks, vendors, ideas } = currentEventData;

  document.getElementById('detail-name').textContent = event.name;
  document.getElementById('detail-type-badge').textContent = event.type.toUpperCase();
  document.getElementById('detail-date').textContent = event.event_date;
  document.getElementById('detail-guests').textContent = `${event.guest_estimate} Guests`;
  document.getElementById('detail-brief').textContent = event.brief;

  document.getElementById('edit-event-name').value = event.name;
  document.getElementById('edit-event-date').value = event.event_date;
  document.getElementById('edit-event-guests').value = event.guest_estimate;
  document.getElementById('edit-event-budget').value = (event.total_budget / 100).toFixed(0);
  document.getElementById('edit-event-brief').value = event.brief;

  renderBudgetMetrics(budget, event.currency);
  renderBudgetCategories(budget.categories || [], event.currency, event.id, () => openEventWorkspace(event.id));
  renderTimeline(tasks || [], event.id, () => openEventWorkspace(event.id));
  renderVendors(vendors || [], event.currency, event.id, () => openEventWorkspace(event.id));
  renderIdeas(ideas || [], event.currency, event.id, () => openEventWorkspace(event.id));
}

function setupModalTriggers() {
  const triggerMap = [
    { modal: document.getElementById('create-event-modal'), opens: ['btn-create-event-top', 'btn-new-event-nav'], closes: ['btn-close-modal', 'btn-cancel-event'] },
    { modal: document.getElementById('edit-event-modal'), opens: ['btn-edit-event'], closes: ['btn-close-edit-modal', 'btn-cancel-edit-event'] },
    { modal: document.getElementById('add-category-modal'), opens: ['btn-add-category-tab'], closes: ['btn-close-cat-modal', 'btn-cancel-cat'] },
    { modal: document.getElementById('add-item-modal'), opens: [], closes: ['btn-close-item-modal', 'btn-cancel-item'] },
    { modal: document.getElementById('add-task-modal'), opens: ['btn-add-task-tab'], closes: ['btn-close-task-modal', 'btn-cancel-task'] },
    { modal: document.getElementById('add-vendor-modal'), opens: ['btn-add-vendor-tab'], closes: ['btn-close-vendor-modal', 'btn-cancel-vendor'] },
  ];

  triggerMap.forEach(({ modal, opens, closes }) => {
    opens.forEach((id) => document.getElementById(id)?.addEventListener('click', () => openModalDialog(modal)));
    closes.forEach((id) => document.getElementById(id)?.addEventListener('click', () => closeModalDialog(modal)));
  });

  // W3C APG Accessible Dialog Keydown Listeners (Escape dismiss and Tab trap)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
      if (openModal) closeModalDialog(openModal);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const openModal = document.querySelector('.modal-backdrop:not(.hidden)');
    if (!openModal) return;

    const dialog = openModal.querySelector('.modal-dialog') || openModal;
    const focusable = Array.from(dialog.querySelectorAll('input:not([type="hidden"]), select, textarea, button:not([disabled]), [tabindex="0"]'));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!dialog.contains(document.activeElement)) {
      focusable[0].focus();
      return;
    }

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

async function initApp() {
  setupTabs(tabs, selectTab);
  setupModalTriggers();

  document.getElementById('btn-back-dashboard')?.addEventListener('click', showDashboardView);

  initAuth({
    onLoginSuccess: (user) => {
      authNavGuest.classList.add('hidden');
      authNavUser.classList.remove('hidden');
      userNameDisplay.textContent = user.name;
      showDashboardView();
    },
    onLogout: () => {
      authNavUser.classList.add('hidden');
      authNavGuest.classList.remove('hidden');
      showAuthView();
    },
  });

  initEventForms({
    getCurrentEventId: () => currentEventData?.event?.id,
    onEventCreated: (id) => openEventWorkspace(id),
    onEventUpdated: (id) => openEventWorkspace(id),
    onEventDeleted: () => showDashboardView(),
  });

  initBudgetForms({
    getCurrentEventId: () => currentEventData?.event?.id,
    onRefresh: () => openEventWorkspace(currentEventData.event.id),
  });

  initTimelineForms({
    getCurrentEventId: () => currentEventData?.event?.id,
    onRefresh: () => openEventWorkspace(currentEventData.event.id),
  });

  initVendorForms({
    getCurrentEventId: () => currentEventData?.event?.id,
    onRefresh: () => openEventWorkspace(currentEventData.event.id),
  });

  initIdeasActions({
    getCurrentEventId: () => currentEventData?.event?.id,
    onRefresh: () => openEventWorkspace(currentEventData.event.id),
  });

  initAIActions({
    getCurrentEvent: () => currentEventData?.event,
    onPlanApplied: (id) => openEventWorkspace(id),
  });

  // Check health and demo mode badge (Finding 18)
  try {
    const health = await apiRequest('/api/health');
    if (health.aiProvider === 'mock' && mockAiBadge) {
      mockAiBadge.classList.remove('hidden');
    }
  } catch {
    // ignore
  }

  // Restore authenticated session if token exists
  if (getToken()) {
    try {
      const { user } = await apiRequest('/api/auth/me');
      setCurrentUser(user);
      authNavGuest.classList.add('hidden');
      authNavUser.classList.remove('hidden');
      userNameDisplay.textContent = user.name;
      showDashboardView();
      return;
    } catch {
      // invalid token
    }
  }
  showAuthView();
}

initApp();
