/**
 * PlanPal Events Module
 * REQ-002, REQ-008, REQ-009: Event CRUD, Dashboard Listing, Modal Management.
 */
import { apiRequest } from './api.js';
import { escapeHtml, formatCurrency, announce, showToast, openModalDialog, closeModalDialog } from './dom.js';

export async function loadEvents(eventsGrid, onSelectEvent) {
  eventsGrid.innerHTML = '<p class="subtext">Loading your events...</p>';
  try {
    const res = await apiRequest('/api/events');
    renderEventsList(eventsGrid, res.events || [], onSelectEvent);
  } catch (err) {
    eventsGrid.innerHTML = `<p class="text-danger">Failed to load events: ${escapeHtml(err.message)}</p>`;
  }
}

export function renderEventsList(eventsGrid, events, onSelectEvent) {
  const createEventModal = document.getElementById('create-event-modal');

  if (!events || events.length === 0) {
    eventsGrid.innerHTML = `
      <div class="glass-panel" style="padding: 2.5rem; text-align: center; grid-column: 1 / -1;">
        <h3>No events planned yet</h3>
        <p class="subtext" style="margin: 0.5rem 0 1.5rem;">Create your first wedding, birthday, or community gathering to launch the GenAI copilot.</p>
        <button id="btn-create-first" class="btn btn-primary">+ Create First Event</button>
      </div>
    `;
    document.getElementById('btn-create-first')?.addEventListener('click', () => {
      openModalDialog(createEventModal);
    });
    return;
  }

  eventsGrid.innerHTML = events
    .map(
      (ev) => `
    <div class="event-card glass-panel" data-id="${escapeHtml(ev.id)}" tabindex="0" role="button" aria-label="Open event ${escapeHtml(ev.name)}">
      <div>
        <div class="card-top">
          <span class="type-pill">${escapeHtml(ev.type?.toUpperCase())}</span>
          <span class="date-pill">${escapeHtml(ev.eventDate)}</span>
        </div>
        <h2 class="event-name">${escapeHtml(ev.name)}</h2>
        <p class="card-brief">${escapeHtml(ev.brief)}</p>
      </div>
      <div class="card-metrics">
        <div>
          <div class="metric-mini-label">Budget Limit</div>
          <div class="metric-mini-val">${formatCurrency(ev.totalBudget, ev.currency)}</div>
        </div>
        <div>
          <div class="metric-mini-label">Spent / Progress</div>
          <div class="metric-mini-val">${formatCurrency(ev.actualSpent, ev.currency)} &bull; ${ev.tasksDone ?? 0}/${ev.tasksTotal ?? 0} tasks</div>
        </div>
      </div>
    </div>
  `
    )
    .join('');

  eventsGrid.querySelectorAll('.event-card').forEach((card) => {
    const openCard = () => {
      const id = card.getAttribute('data-id');
      if (id) onSelectEvent(id);
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

export function initEventForms({ getCurrentEventId, onEventCreated, onEventUpdated, onEventDeleted }) {
  const createEventModal = document.getElementById('create-event-modal');
  const editEventModal = document.getElementById('edit-event-modal');
  const createEventForm = document.getElementById('create-event-form');
  const editEventForm = document.getElementById('edit-event-form');
  const btnDeleteEvent = document.getElementById('btn-delete-event');

  createEventForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('event-name').value.trim();
    const type = document.getElementById('event-type').value;
    const eventDate = document.getElementById('event-date').value;
    const guestEstimate = parseInt(document.getElementById('event-guests').value, 10);
    const currency = document.getElementById('event-currency').value;
    const rawBudget = parseFloat(document.getElementById('event-budget').value);
    const totalBudget = Math.round(rawBudget * 100);
    const brief = document.getElementById('event-brief').value.trim();

    try {
      const res = await apiRequest('/api/events', {
        method: 'POST',
        body: JSON.stringify({ name, type, eventDate, guestEstimate, totalBudget, currency, brief }),
      });
      closeModalDialog(createEventModal);
      createEventForm.reset();
      announce(`Event "${name}" created successfully`);
      showToast('Event created! Now launch the AI Copilot to generate your draft plan.', 'success');
      onEventCreated(res.event.id);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  editEventForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventId = getCurrentEventId();
    if (!eventId) return;

    const name = document.getElementById('edit-event-name').value.trim();
    const eventDate = document.getElementById('edit-event-date').value;
    const guestEstimate = parseInt(document.getElementById('edit-event-guests').value, 10);
    const rawBudget = parseFloat(document.getElementById('edit-event-budget').value);
    const totalBudget = Math.round(rawBudget * 100);
    const brief = document.getElementById('edit-event-brief').value.trim();

    try {
      await apiRequest(`/api/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, eventDate, guestEstimate, totalBudget, brief }),
      });
      closeModalDialog(editEventModal);
      announce('Event updated. Timeline tasks automatically resynchronized with new date.');
      showToast('Event settings saved. Tasks shifted to match new event date.', 'success');
      onEventUpdated(eventId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  btnDeleteEvent?.addEventListener('click', async () => {
    const eventId = getCurrentEventId();
    if (!eventId) return;

    if (confirm('Are you sure you want to delete this event? This will permanently delete all associated budget, tasks, and vendors.')) {
      try {
        await apiRequest(`/api/events/${eventId}`, { method: 'DELETE' });
        announce('Event deleted');
        showToast('Event deleted successfully.', 'info');
        onEventDeleted();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });
}
