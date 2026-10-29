/**
 * PlanPal AI Ideas Studio Module
 * REQ-007, DATA-001: Personalized Inspiration Cards, State Toggling (Saved/Dismissed).
 */
import { apiRequest } from './api.js';
import { escapeHtml, formatCurrency, showToast } from './dom.js';

export function renderIdeas(ideas, currency, eventId, onRefresh) {
  const ideasGrid = document.getElementById('ideas-grid');
  if (!ideas || ideas.length === 0) {
    ideasGrid.innerHTML = '<p class="subtext">No AI ideas yet. Click "✨ Generate Fresh Ideas" above to create personalized concepts tailored to your brief!</p>';
    return;
  }

  ideasGrid.innerHTML = ideas
    .map((idea) => {
      const hasRange = typeof idea.estLowMinor === 'number' && typeof idea.estHighMinor === 'number' && !isNaN(idea.estLowMinor) && !isNaN(idea.estHighMinor);
      return `
      <div class="idea-card ${idea.state === 'dismissed' ? 'hidden' : ''}">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="idea-cat-tag">${escapeHtml(idea.category)}</div>
          <span class="type-pill" style="font-size:0.7rem;">${escapeHtml(idea.state)}</span>
        </div>
        <div class="idea-title">${escapeHtml(idea.title)}</div>
        <p class="idea-desc">${escapeHtml(idea.description)}</p>
        
        ${hasRange ? `
          <div class="idea-estimate-pill">
            Est: ${formatCurrency(idea.estLowMinor, currency)} – ${formatCurrency(idea.estHighMinor, currency)} (Advisory)
          </div>
        ` : ''}

        <div class="idea-actions">
          ${idea.state !== 'saved' ? `
            <button class="btn btn-primary btn-sm btn-save-idea" data-id="${escapeHtml(idea.id)}" aria-label="Save idea: ${escapeHtml(idea.title)}">⭐ Save</button>
          ` : '<span class="date-pill">Saved ⭐</span>'}
          ${idea.state !== 'dismissed' ? `
            <button class="btn btn-ghost btn-sm btn-dismiss-idea" data-id="${escapeHtml(idea.id)}" aria-label="Dismiss idea: ${escapeHtml(idea.title)}">Dismiss</button>
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
        await apiRequest(`/api/events/${eventId}/ideas/${ideaId}`, {
          method: 'PATCH',
          body: JSON.stringify({ state: 'saved' }),
        });
        await onRefresh(`.idea-card:has([data-id="${ideaId}"])`);
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
        await apiRequest(`/api/events/${eventId}/ideas/${ideaId}`, {
          method: 'PATCH',
          body: JSON.stringify({ state: 'dismissed' }),
        });
        await onRefresh();
        showToast('Idea dismissed', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

export function initIdeasActions({ getCurrentEventId, onRefresh }) {
  document.getElementById('btn-generate-fresh-ideas')?.addEventListener('click', async () => {
    const eventId = getCurrentEventId();
    if (!eventId) return;

    const btn = document.getElementById('btn-generate-fresh-ideas');
    btn.disabled = true;
    btn.textContent = 'Generating Ideas...';
    try {
      await apiRequest(`/api/events/${eventId}/ideas/generate`, { method: 'POST' });
      await onRefresh();
      showToast('Fresh ideas generated!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Generate Fresh Ideas';
    }
  });
}
