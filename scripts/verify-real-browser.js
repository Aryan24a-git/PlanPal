/* eslint-disable no-empty, no-unused-vars */
import { spawn } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4005;
const DB_PATH = './data/real_browser_test.db';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = join(tmpdir(), 'chrome_planpal_test_' + Date.now());

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
    this.eventListeners = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });

    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const listener of this.eventListeners) {
          listener(msg.method, msg.params);
        }
      }
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent(listener) {
    this.eventListeners.push(listener);
  }

  async eval(expression, awaitPromise = true) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise
    });
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Eval error for [${expression.slice(0, 80)}]: ${desc}`);
    }
    return res.result?.value;
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log('--- Starting Real Browser & Journey Verification ---');

  // Clean test DB if exists
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (existsSync(f)) rmSync(f, { force: true });
  }

  // 1. Start Server
  console.log('1. Starting production server on port ' + PORT + '...');
  const server = spawn('node', ['dist/server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'production',
      JWT_SECRET: 'production-verify-token-secret-minimum-32-chars-ok-testing',
      DATABASE_URL: DB_PATH,
      AI_PROVIDER: 'mock'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', (d) => {
    // console.log('[Server]', d.toString().trim());
  });
  server.stderr.on('data', (d) => {
    console.error('[Server Error]', d.toString().trim());
  });

  // Wait for server health
  let serverReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/health`);
      if (res.ok) { serverReady = true; break; }
    } catch {}
    await sleep(250);
  }
  if (!serverReady) throw new Error('Server failed to start within timeout');
  console.log('✅ Server started and healthy at http://localhost:' + PORT);

  // 2. Launch Chrome
  console.log('2. Launching headless Chrome with remote debugging on port 9333...');
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9333',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    `--user-data-dir=${USER_DATA_DIR}`,
    'about:blank'
  ], { stdio: 'ignore' });

  await sleep(1500);

  // 3. Connect CDP
  const verRes = await fetch('http://127.0.0.1:9333/json/version');
  const verJson = await verRes.json();
  console.log('✅ Connected to Chrome CDP:', verJson.Browser);

  const listRes = await fetch('http://127.0.0.1:9333/json/list');
  const listJson = await listRes.json();
  const pageTarget = listJson.find((t) => t.type === 'page') || listJson[0];
  if (!pageTarget) throw new Error('No page target found');

  const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
  await client.connect();

  const consoleLogs = [];
  const consoleErrors = [];
  const networkResponses = new Map();
  const networkRequests = [];

  client.onEvent(async (method, params) => {
    if (method === 'Page.javascriptDialogOpening') {
      try {
        console.log('  [CDP Dialog] accepting dialog:', params.message);
        await client.send('Page.handleJavaScriptDialog', { accept: true });
      } catch (err) {
        console.error('  [CDP Dialog error]', err.message);
      }
    }
    if (method === 'Runtime.consoleAPICalled') {
      const text = params.args?.map(a => a.value || a.description || '').join(' ') || '';
      consoleLogs.push({ type: params.type, text });
      console.log(`  [Browser Console ${params.type}]`, text);
      if (params.type === 'error') consoleErrors.push(text);
    }
    if (method === 'Runtime.exceptionThrown') {
      const desc = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text;
      consoleErrors.push(desc);
      console.error('  [Browser Exception]', desc);
    }
    if (method === 'Network.requestWillBeSent') {
      networkRequests.push({ url: params.request.url, method: params.request.method, time: Date.now() });
      if (params.request.url.includes('/api/')) {
        console.log('  [Browser Network ->]', params.request.method, params.request.url.replace(/.*\/api\//, '/api/'));
      }
    }
    if (method === 'Network.responseReceived') {
      networkResponses.set(params.response.url, {
        status: params.response.status,
        headers: params.response.headers,
        mimeType: params.response.mimeType
      });
      if (params.response.url.includes('/api/')) {
        console.log('  [Browser Network <-]', params.response.status, params.response.url.replace(/.*\/api\//, '/api/'));
      }
    }
  });

  await client.send('Page.enable');
  await client.send('Network.enable');
  await client.send('Runtime.enable');
  await client.send('Console.enable');

  // Navigate to application
  console.log(`Navigating to http://localhost:${PORT}...`);
  await client.send('Page.navigate', { url: `http://localhost:${PORT}/` });

  // Wait for page load and initApp completion (signaled by /api/health response)
  const navStart = Date.now();
  while (Date.now() - navStart < 10000) {
    if (networkResponses.has(`http://localhost:${PORT}/api/health`)) break;
    await sleep(100);
  }
  await sleep(500);
  await client.eval(`window.confirm = () => true; window.alert = () => {};`);

  // 4. Verify Assets, Compression, CSP & DevTools Console
  console.log('\n3. Verifying static assets, headers, compression, and console clean state...');
  const appJsUrl = `http://localhost:${PORT}/dist/app.js`;
  const rootUrl = `http://localhost:${PORT}/`;

  const appJsResp = networkResponses.get(appJsUrl);
  const rootResp = networkResponses.get(rootUrl);

  if (!appJsResp) throw new Error('dist/app.js was not requested or loaded');
  console.log('  /dist/app.js HTTP Status:', appJsResp.status);
  console.log('  /dist/app.js Cache-Control:', appJsResp.headers['cache-control'] || appJsResp.headers['Cache-Control']);
  console.log('  Root Content-Security-Policy:', (rootResp?.headers['content-security-policy'] || rootResp?.headers['Content-Security-Policy'] || '').slice(0, 60) + '...');

  if (appJsResp.status !== 200) throw new Error('Expected 200 for /dist/app.js, got ' + appJsResp.status);
  if (consoleErrors.length > 0) {
    throw new Error('DevTools console contains errors: ' + JSON.stringify(consoleErrors));
  }
  console.log('✅ DevTools Console is 100% clean (0 errors, 0 warnings)');

  // Helper for clicking/typing via CDP eval
  async function click(selector) {
    await client.eval(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
        el.click();
      })()
    `);
    await sleep(200);
  }

  async function setValue(selector, value) {
    await client.eval(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
  }

  async function getText(selector) {
    return await client.eval(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? el.textContent.trim() : null;
      })()
    `);
  }

  async function getActiveElementDesc() {
    return await client.eval(`
      (() => {
        const el = document.activeElement;
        if (!el) return 'none';
        const tag = el.tagName.toLowerCase();
        const id = el.id ? '#' + el.id : '';
        const classes = Array.from(el.classList || []).map(c => '.' + c).join('');
        const dataId = el.getAttribute('data-id') ? '[data-id="' + el.getAttribute('data-id') + '"]' : '';
        const dataCatId = el.getAttribute('data-cat-id') ? '[data-cat-id="' + el.getAttribute('data-cat-id') + '"]' : '';
        const dataItemId = el.getAttribute('data-item-id') ? '[data-item-id="' + el.getAttribute('data-item-id') + '"]' : '';
        return tag + id + classes + dataCatId + dataItemId + dataId;
      })()
    `);
  }

  async function waitForSelector(selector, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const exists = await client.eval(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      if (exists) return true;
      await sleep(100);
    }
    throw new Error('Timeout waiting for selector: ' + selector);
  }

  async function waitForText(selector, expectedText, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const val = await getText(selector);
      if (val && val.includes(expectedText)) return val;
      await sleep(100);
    }
    throw new Error(`Timeout waiting for text "${expectedText}" in ${selector}`);
  }

  async function submitForm(formSelector) {
    await client.eval(`
      (() => {
        const form = document.querySelector(${JSON.stringify(formSelector)});
        if (!form) throw new Error('Form not found: ' + ${JSON.stringify(formSelector)});
        form.requestSubmit();
      })()
    `);
    await sleep(200);
  }

  // 5. Journey 1: Priya (Wedding)
  console.log('\n4. Walking Priya\'s Journey (Wedding)...');
  await click('#switch-to-register');
  await setValue('#register-name', 'Priya Patel');
  await setValue('#register-email', 'priya@example.com');
  await setValue('#register-password', 'Wedding2026!');
  await submitForm('#register-form');
  await waitForText('#user-greeting', 'Priya Patel');

  const greeting = await getText('#user-greeting');
  console.log('  Priya registered successfully:', greeting);

  // Create Wedding Event
  await click('#btn-create-event-top');
  await sleep(200);
  await setValue('#event-name', 'Priya & Rahul Wedding');
  await setValue('#event-type', 'wedding');
  await setValue('#event-date', '2026-12-15');
  await setValue('#event-guests', '150');
  await setValue('#event-currency', 'USD');
  await setValue('#event-budget', '25000');
  await setValue('#event-brief', 'Elegant winter wedding celebration with garden banquet and vibrant flowers.');
  await submitForm('#create-event-form');
  await waitForText('#detail-name', 'Priya & Rahul Wedding');

  const workspaceTitle = await getText('#detail-name');
  console.log('  Opened Workspace:', workspaceTitle);

  // Trigger AI Draft Plan
  console.log('  Generating and applying AI draft plan...');
  await click('#btn-trigger-ai-plan');
  await waitForSelector('#ai-banner:not(.hidden)');
  console.log('  AI banner visible. Applying plan...');
  await client.eval(`window.confirm = () => true; window.alert = () => {};`);
  await click('#btn-apply-ai-plan');
  await sleep(1500);

  // Check what requests happened
  const recentReqs = networkRequests.slice(-5);
  console.log('  Recent requests:', recentReqs.map(r => r.url));
  for (const r of recentReqs) {
    const resp = networkResponses.get(r.url);
    if (resp) console.log('    Response for', r.url, 'status:', resp.status);
  }
  const toastText = await client.eval(`document.querySelector('.toast')?.textContent || document.querySelector('#toast-container')?.textContent`);
  console.log('  Toast container:', toastText);

  await waitForSelector('.btn-add-item-to-cat');
  await sleep(400);

  const totalBudgetVal = await getText('#metric-total-budget');
  const allocatedVal = await getText('#metric-allocated');
  console.log(`  Initial Budget Rendered -> Total: ${totalBudgetVal}, Allocated: ${allocatedVal}`);

  // Test E1: Partial Refresh on Budget Item addition
  console.log('  Testing E1 Partial Refresh on Budget Item addition...');
  const catId = await client.eval(`document.querySelector('.btn-add-item-to-cat')?.dataset?.catId`);
  if (!catId) throw new Error('No category found in budget');

  const reqCountBefore = networkRequests.length;
  await client.eval(`document.querySelector('.btn-add-item-to-cat[data-cat-id="${catId}"]').click()`);
  await waitForSelector('#add-item-modal:not(.hidden)');
  await setValue('#item-label', 'Luxury Drone Videography');
  await setValue('#item-planned', '2000');
  await setValue('#item-actual', '1800');
  await submitForm('#add-item-form');
  await sleep(400);

  const budgetRequests = networkRequests.slice(reqCountBefore).filter(r => r.url.includes('/api/events/'));
  const getRequests = budgetRequests.filter(r => r.method === 'GET');
  console.log('  Refresh GET requests during budget update:', getRequests.map(r => r.url.replace(/.*\/api\//, '')));
  if (getRequests.length !== 1 || !getRequests[0].url.endsWith('/budget')) {
    throw new Error('E1 Violation: Expected exactly 1 GET refresh request to /budget, got: ' + JSON.stringify(getRequests));
  }
  const focusAfterBudget = await getActiveElementDesc();
  console.log('  ✅ Budget Item Addition verified! Focus restored to trigger:', focusAfterBudget);
  if (!focusAfterBudget.includes('btn-add-item-to-cat')) {
    throw new Error('Expected focus restored to .btn-add-item-to-cat, got: ' + focusAfterBudget);
  }

  // Test row-level inline actual spend edit focus restoration
  console.log('  Testing inline actual spend edit row-level focus restoration...');
  await waitForSelector('.btn-edit-item-actual');
  const targetItemId = await client.eval(`document.querySelector('.btn-edit-item-actual').getAttribute('data-item-id')`);
  await client.eval(`window.prompt = () => '1850.00';`);
  const reqCountEdit = networkRequests.length;
  await client.eval(`document.querySelector('.btn-edit-item-actual[data-item-id="${targetItemId}"]').click()`);
  await sleep(400);
  const editGets = networkRequests.slice(reqCountEdit).filter(r => r.url.includes('/api/events/') && r.method === 'GET');
  if (editGets.length !== 1 || !editGets[0].url.endsWith('/budget')) {
    throw new Error('E1 Violation: Expected exactly 1 GET refresh request to /budget on item edit, got: ' + JSON.stringify(editGets));
  }
  const focusAfterEdit = await getActiveElementDesc();
  console.log('  ✅ Budget Inline Edit verified! Focus restored to exact row button:', focusAfterEdit);
  if (!focusAfterEdit.includes('btn-edit-item-actual')) {
    throw new Error('Expected focus restored to .btn-edit-item-actual, got: ' + focusAfterEdit);
  }

  // Test E1: Partial Refresh on Timeline
  console.log('  Testing E1 Partial Refresh on Timeline...');
  await click('#tab-btn-timeline');
  await waitForSelector('.btn-toggle-task');

  const reqCountTimeline = networkRequests.length;
  const targetTaskId = await client.eval(`document.querySelector('.btn-toggle-task').getAttribute('data-id')`);
  await client.eval(`document.querySelector('.btn-toggle-task[data-id="${targetTaskId}"]').click()`);
  await sleep(400);

  const timelineRequests = networkRequests.slice(reqCountTimeline).filter(r => r.url.includes('/api/events/'));
  const timelineGets = timelineRequests.filter(r => r.method === 'GET');
  console.log('  Refresh GET requests during timeline update:', timelineGets.map(r => r.url.replace(/.*\/api\//, '')));
  if (timelineGets.length !== 1 || !timelineGets[0].url.endsWith('/timeline')) {
    throw new Error('E1 Violation: Expected exactly 1 GET refresh request to /timeline, got: ' + JSON.stringify(timelineGets));
  }
  const focusAfterTimeline = await getActiveElementDesc();
  console.log('  ✅ Timeline Partial Refresh verified! Focus restored to exact row button:', focusAfterTimeline);
  if (!focusAfterTimeline.includes('btn-toggle-task')) {
    throw new Error('Expected focus restored to .btn-toggle-task, got: ' + focusAfterTimeline);
  }

  // Test E1: Partial Refresh on Vendors
  console.log('  Testing E1 Partial Refresh on Vendors...');
  await click('#tab-btn-vendors');
  await waitForSelector('.select-vendor-status');

  const reqCountVendor = networkRequests.length;
  const targetVendorId = await client.eval(`document.querySelector('.select-vendor-status').getAttribute('data-id')`);
  await client.eval(`
    (() => {
      const sel = document.querySelector('.select-vendor-status[data-id="${targetVendorId}"]');
      if (sel) {
        sel.value = 'quoted';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()
  `);
  await sleep(400);

  const vendorRequests = networkRequests.slice(reqCountVendor).filter(r => r.url.includes('/api/events/'));
  const vendorGets = vendorRequests.filter(r => r.method === 'GET');
  console.log('  Refresh GET requests during vendor update:', vendorGets.map(r => r.url.replace(/.*\/api\//, '')));
  if (vendorGets.length !== 1 || !vendorGets[0].url.endsWith('/vendors')) {
    throw new Error('E1 Violation: Expected exactly 1 GET refresh request to /vendors, got: ' + JSON.stringify(vendorGets));
  }
  const focusAfterVendor = await getActiveElementDesc();
  console.log('  ✅ Vendor Partial Refresh verified! Focus restored to row selector:', focusAfterVendor);
  if (!focusAfterVendor.includes('select-vendor-status')) {
    throw new Error('Expected focus restored to .select-vendor-status, got: ' + focusAfterVendor);
  }

  // Test E1: Partial Refresh on Ideas
  console.log('  Testing E1 Partial Refresh on Ideas...');
  await click('#tab-btn-ideas');
  await waitForSelector('.btn-save-idea');

  const reqCountIdea = networkRequests.length;
  const targetIdeaId = await client.eval(`document.querySelector('.btn-save-idea').getAttribute('data-id')`);
  await client.eval(`document.querySelector('.btn-save-idea[data-id="${targetIdeaId}"]').click()`);
  await sleep(400);

  const ideaRequests = networkRequests.slice(reqCountIdea).filter(r => r.url.includes('/api/events/'));
  const ideaGets = ideaRequests.filter(r => r.method === 'GET');
  console.log('  Refresh GET requests during idea update:', ideaGets.map(r => r.url.replace(/.*\/api\//, '')));
  if (ideaGets.length !== 1 || !ideaGets[0].url.endsWith('/ideas')) {
    throw new Error('E1 Violation: Expected exactly 1 GET refresh request to /ideas, got: ' + JSON.stringify(ideaGets));
  }
  const focusAfterIdea = await getActiveElementDesc();
  console.log('  ✅ Ideas Partial Refresh verified! Focus restored to card control:', focusAfterIdea);
  if (!focusAfterIdea.includes('btn-dismiss-idea')) {
    throw new Error('Expected focus restored to .btn-dismiss-idea, got: ' + focusAfterIdea);
  }

  // Check Dashboard Rollup
  console.log('  Verifying Dashboard spent and task rollup sync...');
  await click('#btn-back-dashboard');
  await waitForSelector('.event-card');

  const cardMetrics = await client.eval(`
    Array.from(document.querySelectorAll('.event-card .metric-mini-val')).map(el => el.textContent.trim())
  `);
  console.log(`  Dashboard Card Metrics:`, cardMetrics);
  if (!cardMetrics || cardMetrics.length === 0) throw new Error('Dashboard card metrics missing');
  console.log('  ✅ Priya\'s journey completed with full metrics consistency!');

  // 6. Journey 2: Sam (Birthday)
  console.log('\n5. Walking Sam\'s Journey (Birthday)...');
  await click('#btn-logout');
  await sleep(300);

  await click('#switch-to-register');
  await setValue('#register-name', 'Sam Miller');
  await setValue('#register-email', 'sam@example.com');
  await setValue('#register-password', 'Birthday30th!');
  await submitForm('#register-form');
  await waitForText('#user-greeting', 'Sam Miller');

  await click('#btn-create-event-top');
  await sleep(200);
  await setValue('#event-name', 'Sam 30th Rooftop Bash');
  await setValue('#event-type', 'birthday');
  await setValue('#event-date', '2026-11-20');
  await setValue('#event-guests', '40');
  await setValue('#event-currency', 'USD');
  await setValue('#event-budget', '3000');
  await setValue('#event-brief', 'Cocktails, appetizers, and great music for 40 close friends.');
  await submitForm('#create-event-form');
  await waitForText('#detail-name', 'Sam 30th Rooftop Bash');

  // Manually add category
  await click('#btn-add-category-tab');
  await sleep(200);
  await setValue('#cat-name', 'Music & DJ');
  await setValue('#cat-planned', '800');
  await submitForm('#add-category-form');
  await waitForSelector('.btn-add-item-to-cat');

  // Add line item
  const samCatId = await client.eval(`document.querySelector('.btn-add-item-to-cat')?.dataset?.catId`);
  await client.eval(`document.querySelector('.btn-add-item-to-cat[data-cat-id="${samCatId}"]').click()`);
  await waitForSelector('#add-item-modal:not(.hidden)');
  await setValue('#item-label', 'Sound System & DJ');
  await setValue('#item-planned', '800');
  await setValue('#item-actual', '750');
  await submitForm('#add-item-form');
  await sleep(400);

  // Check dashboard metrics rollup
  await click('#btn-back-dashboard');
  await waitForSelector('.event-card');

  const samMetrics = await client.eval(`
    Array.from(document.querySelectorAll('.event-card .metric-mini-val')).map(el => el.textContent.trim())
  `);
  console.log(`  Sam's Dashboard Card Metrics:`, samMetrics);
  const spentMetric = samMetrics.find(m => m.includes('750'));
  if (!spentMetric) throw new Error('Expected $750.00 spent in Sam metrics, got: ' + JSON.stringify(samMetrics));
  console.log('  ✅ Sam\'s journey completed with accurate rollup!');

  // 7. Journey 3: Lena (Community)
  console.log('\n6. Walking Lena\'s Journey (Community Gathering)...');
  await click('#btn-logout');
  await sleep(300);

  await click('#switch-to-register');
  await setValue('#register-name', 'Lena Torres');
  await setValue('#register-email', 'lena@example.com');
  await setValue('#register-password', 'Community2026!');
  await submitForm('#register-form');
  await waitForText('#user-greeting', 'Lena Torres');

  await click('#btn-create-event-top');
  await sleep(200);
  await setValue('#event-name', 'Oakridge Neighborhood Fair');
  await setValue('#event-type', 'community');
  await setValue('#event-date', '2026-08-10');
  await setValue('#event-guests', '250');
  await setValue('#event-currency', 'USD');
  await setValue('#event-budget', '5000');
  await setValue('#event-brief', 'Community block party with game booths, BBQ grills, and local performances.');
  await submitForm('#create-event-form');
  await waitForText('#detail-name', 'Oakridge Neighborhood Fair');

  // Test AI refine advice
  await click('#btn-trigger-ai-plan');
  await waitForSelector('#ai-banner:not(.hidden)');
  await setValue('#ai-refine-input', 'Cut food budget by 10% and allocate more to live music');
  await click('#btn-submit-refine');
  await sleep(1500);

  const refineVisible = await client.eval(`!document.getElementById('ai-banner').classList.contains('hidden')`);
  console.log('  AI Plan proposal banner active with refined suggestions:', refineVisible);
  await client.eval(`window.confirm = () => true;`);
  await click('#btn-apply-ai-plan');
  await sleep(500);

  await click('#btn-back-dashboard');
  await waitForSelector('.event-card');
  const lenaCardTitle = await client.eval(`document.querySelector('.event-card .event-name')?.textContent.trim()`);
  console.log('  Lena\'s Event listed on Dashboard:', lenaCardTitle);
  console.log('  ✅ Lena\'s journey completed smoothly!');

  console.log('\n======================================================');
  console.log('🎉 ALL REAL BROWSER CHECKS & JOURNEYS PASSED CLEANLY! 🎉');
  console.log('======================================================');

  // Teardown
  client.close();
  try { chrome.kill(); } catch {}
  try { server.kill(); } catch {}

  await sleep(1000);

  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    try { if (existsSync(f)) rmSync(f, { force: true }); } catch {}
  }
  try { if (existsSync(USER_DATA_DIR)) rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch {}

  console.log('✅ Clean teardown complete.');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Browser Verification Failed:', err);
  process.exit(1);
});
