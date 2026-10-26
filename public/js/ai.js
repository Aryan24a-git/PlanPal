/**
 * PlanPal AI Plan & Refinement Module
 * REQ-003, REQ-010: AI Draft Generation, Proposal Banner Preview, Transactional Apply, Refine Diff.
 */
import { apiRequest } from './api.js';
import { escapeHtml, formatCurrency, announce, showToast } from './dom.js';

let pendingAIPlan = null;

export function getPendingAIPlan() {
  return pendingAIPlan;
}

export function setPendingAIPlan(plan) {
  pendingAIPlan = plan;
}

export function showAIBanner(plan, warnings = [], customHeading = null, currency = 'USD') {
  const aiBanner = document.getElementById('ai-banner');
  const aiPlanPreview = document.getElementById('ai-plan-preview');
  aiBanner.classList.remove('hidden');

  document.getElementById('ai-banner-heading').textContent = customHeading || 'AI Generated Draft Plan Ready';
  document.getElementById('ai-banner-sub').textContent =
    `Proposed ${plan.budgetCategories.length} budget categories, ${plan.timelineTasks.length} timeline milestones, and ${plan.vendorChecklist.length} vendor checklist items.`;

  aiPlanPreview.innerHTML = `
    <div class="ai-preview-grid">
      <div class="ai-preview-col">
        <h4>💰 Budget Allocations</h4>
        <ul>
          ${plan.budgetCategories.map((c) => `<li><strong>${escapeHtml(c.name)}</strong>: ${formatCurrency(c.allocatedAmount, currency)} (${c.items.length} items)</li>`).join('')}
        </ul>
      </div>
      <div class="ai-preview-col">
        <h4>📅 Key Milestones</h4>
        <ul>
          ${plan.timelineTasks.slice(0, 5).map((t) => `<li>${escapeHtml(t.title)} (${escapeHtml(t.daysBeforeEvent)}d before)</li>`).join('')}
        </ul>
      </div>
      <div class="ai-preview-col">
        <h4>🤝 Vendor Checklist</h4>
        <ul>
          ${plan.vendorChecklist.slice(0, 5).map((v) => `<li>${escapeHtml(v.category)}: ${escapeHtml(v.name)}</li>`).join('')}
        </ul>
      </div>
    </div>
    ${warnings.length > 0 ? `<div style="margin-top:0.5rem; color:var(--warning); font-size:0.8rem;">⚠️ ${warnings.map(escapeHtml).join(', ')}</div>` : ''}
  `;
}

export function hideAIBanner() {
  const aiBanner = document.getElementById('ai-banner');
  aiBanner.classList.add('hidden');
  pendingAIPlan = null;
}

export function initAIActions({ getCurrentEvent, onPlanApplied }) {
  const btnTriggerAI = document.getElementById('btn-trigger-ai-plan');
  const btnApplyAI = document.getElementById('btn-apply-ai-plan');
  const btnDismissAI = document.getElementById('btn-dismiss-ai');
  const btnSubmitRefine = document.getElementById('btn-submit-refine');
  const aiRefineInput = document.getElementById('ai-refine-input');

  btnTriggerAI?.addEventListener('click', async () => {
    const event = getCurrentEvent();
    if (!event) return;

    btnTriggerAI.disabled = true;
    btnTriggerAI.innerHTML = '<span class="sparkle-icon">⏳</span> Generating AI Draft...';
    announce('AI is generating draft plan for budget, timeline, and vendors');

    try {
      const res = await apiRequest(`/api/events/${event.id}/ai/draft`, {
        method: 'POST',
      });
      setPendingAIPlan(res.plan);
      showAIBanner(res.plan, res.warnings, null, event.currency);
      announce('AI draft plan ready for review');
      showToast('AI draft plan generated. Review details in the proposal banner before applying.', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnTriggerAI.disabled = false;
      btnTriggerAI.innerHTML = '<span class="sparkle-icon" aria-hidden="true">✨</span> Generate AI Draft Plan';
    }
  });

  btnApplyAI?.addEventListener('click', async () => {
    const event = getCurrentEvent();
    const plan = getPendingAIPlan();
    if (!event || !plan) return;

    btnApplyAI.disabled = true;
    btnApplyAI.textContent = 'Saving Plan...';

    try {
      await apiRequest(`/api/events/${event.id}/ai/draft/apply`, {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      hideAIBanner();
      announce('AI plan applied and saved to your event.');
      showToast('AI Draft Plan saved! Budget, timeline, and vendors updated.', 'success');
      await onPlanApplied(event.id);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnApplyAI.disabled = false;
      btnApplyAI.textContent = 'Apply & Save Plan';
    }
  });

  btnDismissAI?.addEventListener('click', () => {
    hideAIBanner();
    showToast('AI draft plan dismissed.', 'info');
  });

  btnSubmitRefine?.addEventListener('click', async () => {
    const event = getCurrentEvent();
    const instruction = aiRefineInput.value.trim();
    if (!instruction || !event) return;

    btnSubmitRefine.disabled = true;
    btnSubmitRefine.textContent = 'Refining...';
    announce('Generating refinement proposal with AI');

    try {
      const res = await apiRequest(`/api/events/${event.id}/ai/refine`, {
        method: 'POST',
        body: JSON.stringify({ instruction }),
      });
      setPendingAIPlan(res.proposedPlan);
      showAIBanner(res.proposedPlan, [], res.diff?.explanation || 'Refinement proposal ready.', event.currency);
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
}
