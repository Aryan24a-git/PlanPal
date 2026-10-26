#!/usr/bin/env node
/**
 * Automated axe-core Accessibility Audit Script.
 * Audits all 6 application views with rendered DOM state and data:
 * 1. Auth View (Sign in / Registration)
 * 2. Events Dashboard (User events list with metrics)
 * 3. Workspace — Budget Planner
 * 4. Workspace — Timeline Milestones
 * 5. Workspace — Vendor Directory
 * 6. Workspace — AI Ideas & Themes
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
const baseHtml = fs.readFileSync(htmlPath, 'utf8');

async function auditView(viewName, setupDom) {
  const dom = new JSDOM(baseHtml, {
    runScripts: 'outside-only',
    url: 'http://localhost:4000/',
  });

  setupDom(dom.window.document);

  const results = await axe.run(dom.window.document.documentElement, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
    },
  });

  return {
    view: viewName,
    violations: results.violations.length,
    passes: results.passes.length,
    incomplete: results.incomplete.length,
    inapplicable: results.inapplicable.length,
    details: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    })),
  };
}

async function runAudits() {
  console.log('Running automated axe-core accessibility audit across 6 views...\n');

  const report = [];

  // 1. Auth View
  report.push(await auditView('Auth View (Sign-in / Register)', (doc) => {
    doc.getElementById('auth-section')?.classList.remove('hidden');
    doc.getElementById('dashboard-section')?.classList.add('hidden');
    doc.getElementById('event-workspace-section')?.classList.add('hidden');
  }));

  // 2. Events Dashboard
  report.push(await auditView('Events Dashboard', (doc) => {
    doc.getElementById('auth-section')?.classList.add('hidden');
    const dash = doc.getElementById('dashboard-section');
    dash?.classList.remove('hidden');
    doc.getElementById('event-workspace-section')?.classList.add('hidden');
    const grid = doc.getElementById('events-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="event-card glass-panel" data-id="evt-1" tabindex="0" role="button" aria-label="Open event Alice & Bob Wedding">
          <div>
            <div class="card-top">
              <span class="type-pill">WEDDING</span>
              <span class="date-pill">2027-06-15</span>
            </div>
            <h2 class="event-name">Alice & Bob Wedding</h2>
            <p class="card-brief">Elegant garden wedding celebration.</p>
          </div>
          <div class="card-metrics">
            <div>
              <div class="metric-mini-label">Budget Limit</div>
              <div class="metric-mini-val">$10,000.00</div>
            </div>
            <div>
              <div class="metric-mini-label">Spent / Progress</div>
              <div class="metric-mini-val">$3,500.00 &bull; 4/8 tasks</div>
            </div>
          </div>
        </div>
      `;
    }
  }));

  // Helper to activate workspace tab
  function setupWorkspace(doc, activeTabId) {
    doc.getElementById('auth-section')?.classList.add('hidden');
    doc.getElementById('dashboard-section')?.classList.add('hidden');
    const ws = doc.getElementById('event-workspace-section');
    ws?.classList.remove('hidden');
    const title = doc.getElementById('detail-name');
    if (title) title.textContent = 'Alice & Bob Wedding';

    ['tab-content-budget', 'tab-content-timeline', 'tab-content-vendors', 'tab-content-ideas'].forEach((id) => {
      const pane = doc.getElementById(id);
      if (id === activeTabId) {
        pane?.classList.remove('hidden');
        pane?.classList.add('active');
      } else {
        pane?.classList.add('hidden');
        pane?.classList.remove('active');
      }
    });
  }

  // 3. Workspace — Budget
  report.push(await auditView('Workspace — Budget Planner', (doc) => {
    setupWorkspace(doc, 'tab-content-budget');
    const catList = doc.getElementById('categories-list');
    if (catList) {
      catList.innerHTML = `
        <div class="category-block">
          <div class="category-header">
            <div>
              <span class="category-name">Venue & Reception</span>
              <span class="category-amounts">Allocated: $5,000.00</span>
            </div>
            <div class="category-actions">
              <button class="btn btn-secondary btn-sm" aria-label="Add item to Venue">+ Item</button>
            </div>
          </div>
          <div class="line-item-row">
            <div><strong>Main Hall Deposit</strong></div>
            <div class="line-item-actions">
              <span>Planned: $3,000.00</span>
              <span>Actual: $3,000.00</span>
            </div>
          </div>
        </div>
      `;
    }
  }));

  // 4. Workspace — Timeline
  report.push(await auditView('Workspace — Timeline Milestones', (doc) => {
    setupWorkspace(doc, 'tab-content-timeline');
    const timeline = doc.getElementById('timeline-list');
    if (timeline) {
      timeline.innerHTML = `
        <div class="timeline-item">
          <div class="task-date-box">
            <strong>2027-03-15</strong>
            <span>90d before</span>
          </div>
          <div class="task-content">
            <div class="task-title">Book catering and final menu tasting</div>
            <span class="subtext">Phase: 3+ months out &bull; Priority: HIGH</span>
          </div>
          <div class="task-controls">
            <button class="btn btn-ghost btn-sm" aria-label="Mark task done">○ Mark Done</button>
          </div>
        </div>
      `;
    }
  }));

  // 5. Workspace — Vendors
  report.push(await auditView('Workspace — Vendor Directory', (doc) => {
    setupWorkspace(doc, 'tab-content-vendors');
    const grid = doc.getElementById('vendors-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="vendor-card">
          <div class="vendor-cat">Catering & Bar</div>
          <div class="vendor-title">Gourmet Catering Co.</div>
          <p class="vendor-notes">Tasting scheduled for next month.</p>
          <div>Quote: $3,200.00</div>
          <div>
            <label for="vendor-select-sample" class="sr-only">Status for Gourmet Catering Co.</label>
            <select id="vendor-select-sample" class="form-control">
              <option value="quoted" selected>Quoted</option>
              <option value="booked">Booked</option>
            </select>
          </div>
        </div>
      `;
    }
  }));

  // 6. Workspace — Ideas
  report.push(await auditView('Workspace — AI Ideas & Themes', (doc) => {
    setupWorkspace(doc, 'tab-content-ideas');
    const grid = doc.getElementById('ideas-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="idea-card">
          <div class="idea-cat-tag">theme</div>
          <div class="idea-title">Garden Elegance Theme</div>
          <p class="idea-desc">Wildflower centerpieces with string lights.</p>
          <div class="idea-estimate-pill">Est: $500.00 – $1,200.00 (Advisory)</div>
          <div class="idea-actions">
            <button class="btn btn-primary btn-sm" aria-label="Save Garden Elegance idea">⭐ Save</button>
            <button class="btn btn-ghost btn-sm" aria-label="Dismiss Garden Elegance idea">Dismiss</button>
          </div>
        </div>
      `;
    }
  }));

  // Print results table
  console.log('| View | Violations | Passes | Incomplete | Inapplicable | Status |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const r of report) {
    const status = r.violations === 0 ? '✅ PASS (0 violations)' : `⚠️ ${r.violations} violations`;
    console.log(`| ${r.view} | ${r.violations} | ${r.passes} | ${r.incomplete} | ${r.inapplicable} | ${status} |`);
    if (r.violations > 0) {
      console.log('  Details:', JSON.stringify(r.details, null, 2));
    }
  }

  // Save report as artifact/evidence
  fs.writeFileSync(
    path.join(__dirname, '..', 'axe-audit-results.json'),
    JSON.stringify(report, null, 2)
  );
  console.log('\nReport written to axe-audit-results.json');
}

runAudits().catch((err) => {
  console.error(err);
  process.exit(1);
});
