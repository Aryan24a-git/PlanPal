/**
 * PlanPal Timeline & Milestone Module
 * REQ-005: Milestone Tasks, Due Dates, Pinning, and Status Completion.
 */
import { apiRequest } from './api.js';
import { escapeHtml, showToast, closeModalDialog } from './dom.js';

export function renderTimeline(tasks, eventId, onRefresh) {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

  document.getElementById('timeline-progress-pill').textContent = `${pct}% Complete (${completed}/${total})`;

  const timelineList = document.getElementById('timeline-list');
  if (!tasks || tasks.length === 0) {
    timelineList.innerHTML = '<p class="subtext">No tasks scheduled yet. Click "+ Add Task" or let AI generate your milestone timeline!</p>';
    return;
  }

  timelineList.innerHTML = tasks
    .map(
      (t) => `
    <div class="timeline-item ${t.status === 'completed' ? 'task-done' : ''}">
      <div class="task-date-box">
        <strong>${escapeHtml(t.dueDate)}</strong>
        <span style="font-size:0.7rem; color:var(--text-dim);">${escapeHtml(t.offsetDays ?? 0)}d before</span>
      </div>
      <div class="task-content">
        <div class="task-title" style="${t.status === 'completed' ? 'text-decoration: line-through; opacity: 0.7;' : ''}">${escapeHtml(t.title)}</div>
        <span class="subtext">Phase: ${escapeHtml(t.phase || 'General')} &bull; Priority: ${escapeHtml(t.priority?.toUpperCase())}</span>
      </div>
      <div class="task-controls">
        <button class="btn btn-ghost btn-sm btn-toggle-task" data-id="${escapeHtml(t.id)}" data-status="${escapeHtml(t.status)}" aria-label="${t.status === 'completed' ? 'Mark task incomplete: ' + escapeHtml(t.title) : 'Mark task complete: ' + escapeHtml(t.title)}">
          ${t.status === 'completed' ? '✓ Done' : '○ Mark Done'}
        </button>
        <button class="btn btn-ghost btn-sm btn-toggle-pin" data-id="${escapeHtml(t.id)}" data-pinned="${t.pinned}" title="${t.pinned ? 'Pinned (Won\'t shift)' : 'Unpinned (Shifts with event date)'}" aria-label="${t.pinned ? 'Unpin task: ' + escapeHtml(t.title) : 'Pin task: ' + escapeHtml(t.title)}">
          ${t.pinned ? '📌' : '📍'}
        </button>
        <button class="btn btn-ghost btn-sm btn-delete-task" data-id="${escapeHtml(t.id)}" title="Delete Task" aria-label="Delete task: ${escapeHtml(t.title)}">&times;</button>
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
        await apiRequest(`/api/events/${eventId}/timeline/${taskId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus }),
        });
        await onRefresh();
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
        await apiRequest(`/api/events/${eventId}/timeline/${taskId}`, {
          method: 'PATCH',
          body: JSON.stringify({ pinned: !isPinned }),
        });
        await onRefresh();
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
        await apiRequest(`/api/events/${eventId}/timeline/${taskId}`, { method: 'DELETE' });
        await onRefresh();
        showToast('Task removed', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

export function initTimelineForms({ getCurrentEventId, onRefresh }) {
  const addTaskModal = document.getElementById('add-task-modal');
  const addTaskForm = document.getElementById('add-task-form');

  addTaskForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventId = getCurrentEventId();
    if (!eventId) return;

    const title = document.getElementById('task-title').value.trim();
    const offsetDays = parseInt(document.getElementById('task-offset').value, 10);
    const priority = document.getElementById('task-priority').value;
    const phase = document.getElementById('task-phase').value.trim() || undefined;
    const pinned = document.getElementById('task-pinned').checked;

    try {
      await apiRequest(`/api/events/${eventId}/timeline`, {
        method: 'POST',
        body: JSON.stringify({ title, offsetDays, priority, phase, pinned }),
      });
      closeModalDialog(addTaskModal);
      addTaskForm.reset();
      await onRefresh();
      showToast(`Task "${title}" added to timeline`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
