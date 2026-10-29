#!/usr/bin/env node
/**
 * Automated axe-core Accessibility Audit Script.
 * Audits all 6 application views directly by invoking the REAL render functions
 * from public/js/ with realistic fixture data:
 * 1. Auth View (Sign in / Registration)
 * 2. Events Dashboard (renderEventsList)
 * 3. Workspace — Budget Planner (renderBudgetCategories & renderBudgetMetrics)
 * 4. Workspace — Timeline Milestones (renderTimeline)
 * 5. Workspace — Vendor Directory (renderVendors)
 * 6. Workspace — AI Ideas & Themes (renderIdeas & showAIBanner)
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

// Fixture Data
const mockEvents = [
  {
    id: 'evt-1',
    name: 'Alice & Bob Wedding',
    type: 'wedding',
    eventDate: '2027-06-15',
    brief: 'Elegant garden wedding celebration in June.',
    totalBudget: 1000000,
    currency: 'USD',
    actualSpent: 350000,
    tasksDone: 4,
    tasksTotal: 8,
  },
];

const mockCategories = [
  {
    id: 'cat-1',
    name: 'Venue & Reception',
    plannedMinor: 500000,
    items: [
      { id: 'item-1', label: 'Main Hall Deposit', plannedMinor: 300000, actualMinor: 300000, note: 'Deposit paid' },
      { id: 'item-2', label: 'Sound & Lighting Package', plannedMinor: 200000, actualMinor: 180000 },
    ],
  },
];

const mockBudget = {
  totalBudget: 1000000,
  totalAllocated: 500000,
  unallocated: 500000,
  totalPlanned: 500000,
  totalActual: 480000,
  remainingActual: 520000,
  isOverBudget: false,
};

const mockTasks = [
  {
    id: 'task-1',
    title: 'Book catering and final menu tasting',
    dueDate: '2027-03-15',
    offsetDays: 90,
    phase: '3+ months out',
    priority: 'high',
    status: 'todo',
    pinned: false,
  },
  {
    id: 'task-2',
    title: 'Send wedding invitations',
    dueDate: '2027-04-15',
    offsetDays: 60,
    phase: '1–3 months out',
    priority: 'medium',
    status: 'completed',
    pinned: true,
  },
];

const mockVendors = [
  {
    id: 'ven-1',
    category: 'Catering & Bar',
    name: 'Gourmet Catering Co.',
    status: 'quoted',
    quoteMinor: 320000,
    contactName: 'Chef John',
    contactPhone: '555-0199',
    contactEmail: 'john@gourmet.com',
    note: 'Menu tasting scheduled for next month',
  },
  {
    id: 'ven-2',
    category: 'Photography',
    name: 'Snap Magic Studio',
    status: 'booked',
    quoteMinor: 250000,
    contactName: 'Sarah Lens',
    contactPhone: '555-0144',
    contactEmail: 'sarah@snapmagic.com',
    note: 'Contract signed and deposit transferred',
  },
];

const mockIdeas = [
  {
    id: 'idea-1',
    category: 'theme',
    title: 'Garden Elegance Theme',
    description: 'Wildflower centerpieces with warm fairy lights and linen table runners.',
    estLowMinor: 50000,
    estHighMinor: 120000,
    state: 'saved',
  },
  {
    id: 'idea-2',
    category: 'activity',
    title: 'Polaroid Guestbook Station',
    description: 'Interactive instant photo guestbook with metallic markers and adhesive corners.',
    estLowMinor: 15000,
    estHighMinor: 30000,
    state: 'active',
  },
];

const mockAiPlan = {
  budgetCategories: [
    { name: 'Venue & Reception', allocatedAmount: 500000, items: [{ name: 'Hall', plannedAmount: 500000 }] },
  ],
  timelineTasks: [
    { title: 'Reserve hall', daysBeforeEvent: 90, priority: 'high' },
  ],
  vendorChecklist: [
    { category: 'Venue & Reception', name: 'Grand Ballroom' },
  ],
  ideas: [
    { category: 'theme', title: 'Summer Blossom', description: 'Pastel flowers', estimate: true },
  ],
};

async function auditView(viewName, setupDom) {
  const dom = new JSDOM(baseHtml, {
    runScripts: 'outside-only',
    url: 'http://localhost:4000/',
  });

  // Expose global window and document for client template modules
  global.window = dom.window;
  global.document = dom.window.document;

  await setupDom(dom.window.document);

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
  console.log('Running automated axe-core accessibility audit using REAL render functions...\n');

  // Dynamically import real client renderers
  const { renderEventsList } = await import('../public/js/events.js');
  const { renderBudgetCategories, renderBudgetMetrics } = await import('../public/js/budget.js');
  const { renderTimeline } = await import('../public/js/timeline.js');
  const { renderVendors } = await import('../public/js/vendors.js');
  const { renderIdeas } = await import('../public/js/ideas.js');
  const { showAIBanner } = await import('../public/js/ai.js');

  const report = [];

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

  // 1. Auth View
  report.push(await auditView('Auth View (Sign-in / Register)', (doc) => {
    doc.getElementById('auth-section')?.classList.remove('hidden');
    doc.getElementById('dashboard-section')?.classList.add('hidden');
    doc.getElementById('event-workspace-section')?.classList.add('hidden');
  }));

  // 2. Events Dashboard (Real renderEventsList)
  report.push(await auditView('Events Dashboard', (doc) => {
    doc.getElementById('auth-section')?.classList.add('hidden');
    doc.getElementById('dashboard-section')?.classList.remove('hidden');
    doc.getElementById('event-workspace-section')?.classList.add('hidden');
    const grid = doc.getElementById('events-grid');
    renderEventsList(grid, mockEvents, () => {});
  }));

  // 3. Workspace — Budget Planner (Real renderBudgetCategories & renderBudgetMetrics)
  report.push(await auditView('Workspace — Budget Planner', (doc) => {
    setupWorkspace(doc, 'tab-content-budget');
    renderBudgetMetrics(mockBudget, 'USD');
    renderBudgetCategories(mockCategories, 'USD', 'evt-1', () => {});
  }));

  // 4. Workspace — Timeline Milestones (Real renderTimeline)
  report.push(await auditView('Workspace — Timeline Milestones', (doc) => {
    setupWorkspace(doc, 'tab-content-timeline');
    renderTimeline(mockTasks, 'evt-1', () => {});
  }));

  // 5. Workspace — Vendor Directory (Real renderVendors)
  report.push(await auditView('Workspace — Vendor Directory', (doc) => {
    setupWorkspace(doc, 'tab-content-vendors');
    renderVendors(mockVendors, 'USD', 'evt-1', () => {});
  }));

  // 6. Workspace — AI Ideas & Themes (Real renderIdeas & showAIBanner)
  report.push(await auditView('Workspace — AI Ideas & Themes', (doc) => {
    setupWorkspace(doc, 'tab-content-ideas');
    renderIdeas(mockIdeas, 'USD', 'evt-1', () => {});
    showAIBanner(mockAiPlan, [], 'AI Proposal Ready', 'USD');
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
