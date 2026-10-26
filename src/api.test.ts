/**
 * V2-08: API integration and IDOR security test suite.
 * Tests: REQ-001–REQ-010, SEC-001/002/003/004/005.
 * Uses in-memory SQLite; no external services.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { resetDatabase } from './db/database.js';

// Set test env before importing config
process.env['JWT_SECRET'] = 'test-jwt-secret-for-integration-tests-must-be-32';
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = ':memory:';
process.env['AI_PROVIDER'] = 'mock';
process.env['AI_DAILY_QUOTA_PER_USER'] = '100';

// Import app after env is set
const { createApp } = await import('./app.js');
const app = createApp();

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function register(email: string, name = 'Test User') {
  const r = await request(app).post('/api/auth/register').send({ email, password: 'ValidPass123!', name });
  return r;
}

async function login(email: string) {
  const r = await request(app).post('/api/auth/login').send({ email, password: 'ValidPass123!' });
  return r.body as { token: string };
}

function auth(token: string) { return { Authorization: `Bearer ${token}` }; }

async function createEvent(token: string, overrides = {}) {
  const r = await request(app).post('/api/events').set(auth(token)).send({
    type: 'wedding', name: 'Alice & Bob Wedding', eventDate: '2027-06-15',
    guestEstimate: 120, totalBudget: 1_000_000, currency: 'USD',
    brief: 'Elegant garden wedding in June. Looking for classic and romantic styling.',
    ...overrides,
  });
  return r;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
beforeAll(() => { resetDatabase(); });
afterAll(() => { resetDatabase(); });

// ─── REQ-001: Auth ────────────────────────────────────────────────────────────
describe('REQ-001 Auth — Register / Login / Me', () => {
  it('registers a new user and returns a JWT', async () => {
    const r = await register('alice@test.com', 'Alice');
    expect(r.status).toBe(201);
    expect(r.body.token).toBeTruthy();
    expect(r.body.user.email).toBe('alice@test.com');
  });

  it('returns 409 on duplicate email', async () => {
    await register('dup@test.com', 'Dup');
    const r = await register('dup@test.com', 'Dup2');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CONFLICT');
  });

  it('returns 401 on wrong password — generic message (SEC-001)', async () => {
    await register('logintest@test.com');
    const r = await request(app).post('/api/auth/login').send({ email: 'logintest@test.com', password: 'wrongpassword' });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toBe('Invalid email or password');
  });

  it('returns 401 on unknown email — same generic message (SEC-001)', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'nobody@test.com', password: 'anything' });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toBe('Invalid email or password');
  });

  it('returns 400 on validation failure', async () => {
    const r = await request(app).post('/api/auth/register').send({ email: 'notanemail', password: 'short', name: '' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('/api/auth/me returns the authenticated user', async () => {
    await register('me@test.com');
    const { token } = await login('me@test.com');
    const r = await request(app).get('/api/auth/me').set(auth(token));
    expect(r.status).toBe(200);
    expect(r.body.user.email).toBe('me@test.com');
  });

  it('returns 401 for missing Bearer token', async () => {
    const r = await request(app).get('/api/auth/me');
    expect(r.status).toBe(401);
  });
});

// ─── REQ-002: Create Event ────────────────────────────────────────────────────
describe('REQ-002 Create Event', () => {
  let token: string;
  beforeAll(async () => {
    await register('evtcreator@test.com', 'Creator');
    ({ token } = await login('evtcreator@test.com'));
  });

  it('creates a wedding event', async () => {
    const r = await createEvent(token);
    expect(r.status).toBe(201);
    expect(r.body.event.type).toBe('wedding');
    expect(r.body.event.name).toBe('Alice & Bob Wedding');
  });

  it('creates a birthday event', async () => {
    const r = await createEvent(token, { type: 'birthday', name: "Sam's 5th Birthday", totalBudget: 50_000 });
    expect(r.status).toBe(201);
    expect(r.body.event.type).toBe('birthday');
  });

  it('creates a community event', async () => {
    const r = await createEvent(token, { type: 'community', name: 'Neighbourhood Fair', totalBudget: 200_000 });
    expect(r.status).toBe(201);
    expect(r.body.event.type).toBe('community');
  });

  it('rejects invalid event type', async () => {
    const r = await createEvent(token, { type: 'party' });
    expect(r.status).toBe(400);
  });

  it('rejects brief that is too short', async () => {
    const r = await createEvent(token, { brief: 'short' });
    expect(r.status).toBe(400);
    expect(r.body.error.fieldErrors?.brief).toBeDefined();
  });
});

// ─── REQ-003: AI Draft Plan ───────────────────────────────────────────────────
describe('REQ-003 AI Draft Plan (generate & apply)', () => {
  let token: string;
  let eventId: string;

  beforeAll(async () => {
    await register('aiplanner@test.com', 'AI Planner');
    ({ token } = await login('aiplanner@test.com'));
    const r = await createEvent(token);
    eventId = r.body.event.id;
  });

  it('generates a draft plan without auto-applying (REQ-003)', async () => {
    const r = await request(app).post(`/api/events/${eventId}/ai/draft`).set(auth(token));
    expect(r.status).toBe(200);
    expect(r.body.autoApplied).toBe(false);
    expect(r.body.plan.budgetCategories).toBeDefined();
  });

  it('budget allocations sum equals event total budget (arithmetic invariant)', async () => {
    const r = await request(app).post(`/api/events/${eventId}/ai/draft`).set(auth(token));
    const totalAlloc = (r.body.plan.budgetCategories as Array<{ allocatedAmount: number }>)
      .reduce((s: number, c: { allocatedAmount: number }) => s + c.allocatedAmount, 0);
    const event = await request(app).get(`/api/events/${eventId}`).set(auth(token));
    expect(totalAlloc).toBe(event.body.event.total_budget);
  });

  it('all tasks have dates before or on the event date', async () => {
    const r = await request(app).post(`/api/events/${eventId}/ai/draft`).set(auth(token));
    const eventDate = '2027-06-15';
    for (const t of r.body.plan.timelineTasks) {
      expect((t as { dueDate?: string }).dueDate! <= eventDate).toBe(true);
    }
  });

  it('applies the draft plan transactionally (REL-002)', async () => {
    const draft = await request(app).post(`/api/events/${eventId}/ai/draft`).set(auth(token));
    const applyR = await request(app).post(`/api/events/${eventId}/ai/draft/apply`).set(auth(token)).send({ plan: draft.body.plan });
    expect(applyR.status).toBe(200);
    expect(applyR.body.applied).toBe(true);
    // Verify tasks are actually persisted
    const tasks = await request(app).get(`/api/events/${eventId}/timeline`).set(auth(token));
    expect((tasks.body.tasks as unknown[]).length).toBeGreaterThan(0);
  });

  it('all ideas have estimate: true (DATA-001)', async () => {
    const r = await request(app).post(`/api/events/${eventId}/ai/draft`).set(auth(token));
    for (const idea of r.body.plan.ideas) {
      expect((idea as { estimate: boolean }).estimate).toBe(true);
    }
  });
});

// ─── REQ-004: Budget CRUD ─────────────────────────────────────────────────────
describe('REQ-004 Budget — categories and items', () => {
  let token: string;
  let eventId: string;

  beforeAll(async () => {
    await register('budgetuser@test.com', 'Budget User');
    ({ token } = await login('budgetuser@test.com'));
    const r = await createEvent(token, { totalBudget: 100_000 });
    eventId = r.body.event.id;
  });

  it('creates a budget category', async () => {
    const r = await request(app).post(`/api/events/${eventId}/budget/categories`).set(auth(token)).send({ name: 'Venue', plannedMinor: 50_000 });
    expect(r.status).toBe(201);
    expect(r.body.category.name).toBe('Venue');
  });

  it('creates a budget item in a category', async () => {
    const cat = await request(app).post(`/api/events/${eventId}/budget/categories`).set(auth(token)).send({ name: 'Catering', plannedMinor: 40_000 });
    const catId = cat.body.category.id;
    const r = await request(app).post(`/api/events/${eventId}/budget/categories/${catId}/items`).set(auth(token)).send({ label: 'Buffet dinner', plannedMinor: 35_000, actualMinor: 0 });
    expect(r.status).toBe(201);
    expect(r.body.item.label).toBe('Buffet dinner');
  });

  it('returns full budget summary with totals', async () => {
    const r = await request(app).get(`/api/events/${eventId}/budget`).set(auth(token));
    expect(r.status).toBe(200);
    expect(r.body.summary.totalBudget).toBe(100_000);
    expect(typeof r.body.summary.remainingActual).toBe('number');
  });

  it('detects over-budget in summary', async () => {
    const small = await createEvent(token, { totalBudget: 1_000 });
    const sEventId = small.body.event.id;
    const cat = await request(app).post(`/api/events/${sEventId}/budget/categories`).set(auth(token)).send({ name: 'Venue', plannedMinor: 5_000 });
    const catId = cat.body.category.id;
    await request(app).post(`/api/events/${sEventId}/budget/categories/${catId}/items`).set(auth(token)).send({ label: 'Hall', plannedMinor: 5_000, actualMinor: 5_000 });
    const r = await request(app).get(`/api/events/${sEventId}/budget`).set(auth(token));
    expect(r.body.summary.isOverBudget).toBe(true);
  });
});

// ─── REQ-005: Timeline ────────────────────────────────────────────────────────
describe('REQ-005 Timeline — tasks with date anchoring', () => {
  let token: string;
  let eventId: string;

  beforeAll(async () => {
    await register('timelineuser@test.com', 'Timeline User');
    ({ token } = await login('timelineuser@test.com'));
    const r = await createEvent(token, { eventDate: '2027-06-15' });
    eventId = r.body.event.id;
  });

  it('creates a task with a computed due date', async () => {
    const r = await request(app).post(`/api/events/${eventId}/timeline`).set(auth(token)).send({ title: 'Book venue', offsetDays: 90, priority: 'high' });
    expect(r.status).toBe(201);
    expect(r.body.task.due_date ?? r.body.task.dueDate).toBe('2027-03-17');
  });

  it('shifts non-pinned tasks on event date change (REQ-005)', async () => {
    const create = await request(app).post(`/api/events/${eventId}/timeline`).set(auth(token)).send({ title: 'Send invites', offsetDays: 60, pinned: false });
    const taskBefore = create.body.task;
    // Change event date
    await request(app).patch(`/api/events/${eventId}`).set(auth(token)).send({ eventDate: '2027-09-20' });
    const tasks = await request(app).get(`/api/events/${eventId}/timeline`).set(auth(token));
    const updated = (tasks.body.tasks as Array<{ id: string; due_date?: string; dueDate?: string }>).find((t) => t.id === (taskBefore.id ?? taskBefore.id));
    const oldDue = taskBefore.due_date ?? taskBefore.dueDate;
    const newDue = updated?.due_date ?? updated?.dueDate;
    expect(newDue).not.toBe(oldDue);
  });

  it('marks a task as completed', async () => {
    const t = await request(app).post(`/api/events/${eventId}/timeline`).set(auth(token)).send({ title: 'Check venue', offsetDays: 30, priority: 'medium' });
    const r = await request(app).patch(`/api/events/${eventId}/timeline/${t.body.task.id}`).set(auth(token)).send({ status: 'completed' });
    expect(r.status).toBe(200);
    expect(r.body.task.status).toBe('completed');
  });
});

// ─── REQ-006: Vendor Checklist ────────────────────────────────────────────────
describe('REQ-006 Vendor Checklist', () => {
  let token: string;
  let eventId: string;

  beforeAll(async () => {
    await register('vendoruser@test.com', 'Vendor User');
    ({ token } = await login('vendoruser@test.com'));
    const r = await createEvent(token);
    eventId = r.body.event.id;
  });

  it('creates a vendor', async () => {
    const r = await request(app).post(`/api/events/${eventId}/vendors`).set(auth(token)).send({ category: 'Venue & Reception', name: 'Grand Hall', status: 'to_contact' });
    expect(r.status).toBe(201);
    expect(r.body.vendor.name).toBe('Grand Hall');
  });

  it('updates vendor status and quote', async () => {
    const v = await request(app).post(`/api/events/${eventId}/vendors`).set(auth(token)).send({ category: 'Catering & Bar', name: 'Tasty Bites', status: 'to_contact' });
    const r = await request(app).patch(`/api/events/${eventId}/vendors/${v.body.vendor.id}`).set(auth(token)).send({ status: 'quoted', quoteMinor: 300_000 });
    expect(r.status).toBe(200);
    expect(r.body.vendor.status).toBe('quoted');
    expect(r.body.vendor.quote_minor).toBe(300_000);
  });

  it('deletes a vendor', async () => {
    const v = await request(app).post(`/api/events/${eventId}/vendors`).set(auth(token)).send({ category: 'Photography', name: 'Snap Co', status: 'to_contact' });
    const r = await request(app).delete(`/api/events/${eventId}/vendors/${v.body.vendor.id}`).set(auth(token));
    expect(r.status).toBe(204);
  });
});

// ─── REQ-007: Ideas ───────────────────────────────────────────────────────────
describe('REQ-007 AI Ideas — generate, save, dismiss', () => {
  let token: string;
  let eventId: string;

  beforeAll(async () => {
    await register('ideauser@test.com', 'Idea User');
    ({ token } = await login('ideauser@test.com'));
    const r = await createEvent(token);
    eventId = r.body.event.id;
  });

  it('generates ideas and persists them', async () => {
    const r = await request(app).post(`/api/events/${eventId}/ideas/generate`).set(auth(token));
    expect(r.status).toBe(200);
    expect((r.body.ideas as unknown[]).length).toBeGreaterThan(0);
  });

  it('saves an idea (state = saved)', async () => {
    await request(app).post(`/api/events/${eventId}/ideas/generate`).set(auth(token));
    const ideas = await request(app).get(`/api/events/${eventId}/ideas`).set(auth(token));
    const ideaId = (ideas.body.ideas as Array<{ id: string }>)[0]?.id;
    const r = await request(app).patch(`/api/events/${eventId}/ideas/${ideaId}`).set(auth(token)).send({ state: 'saved' });
    expect(r.status).toBe(200);
    expect((r.body.idea as { state: string }).state).toBe('saved');
  });

  it('dismisses an idea', async () => {
    const ideas = await request(app).get(`/api/events/${eventId}/ideas`).set(auth(token));
    const ideaId = (ideas.body.ideas as Array<{ id: string }>)[0]?.id;
    const r = await request(app).patch(`/api/events/${eventId}/ideas/${ideaId}`).set(auth(token)).send({ state: 'dismissed' });
    expect(r.status).toBe(200);
  });
});

// ─── REQ-008: Dashboard ───────────────────────────────────────────────────────
describe('REQ-008 Dashboard — event list with summaries', () => {
  let token: string;

  beforeAll(async () => {
    await register('dashuser@test.com', 'Dash User');
    ({ token } = await login('dashuser@test.com'));
    await createEvent(token, { name: 'Event A' });
    await createEvent(token, { name: 'Event B', type: 'birthday', totalBudget: 50_000 });
  });

  it('lists all events with budget and task summary metrics', async () => {
    const r = await request(app).get('/api/events').set(auth(token));
    expect(r.status).toBe(200);
    expect(r.body.events).toBeDefined();
    const e = r.body.events[0] as { actual_spent?: number; tasks_total?: number; tasks_done?: number };
    expect(typeof e.actual_spent).toBe('number');
    expect(typeof e.tasks_total).toBe('number');
    expect(typeof e.tasks_done).toBe('number');
  });

  it('pagination: limit and offset work', async () => {
    const r1 = await request(app).get('/api/events?limit=1&offset=0').set(auth(token));
    const r2 = await request(app).get('/api/events?limit=1&offset=1').set(auth(token));
    expect((r1.body.events as unknown[]).length).toBe(1);
    expect((r2.body.events as unknown[]).length).toBe(1);
    expect((r1.body.events as Array<{ id: string }>)[0]?.id).not.toBe((r2.body.events as Array<{ id: string }>)[0]?.id);
  });
});

// ─── REQ-009: Edit & Delete ───────────────────────────────────────────────────
describe('REQ-009 Edit and Delete', () => {
  let token: string;
  let eventId: string;

  beforeAll(async () => {
    await register('edituser@test.com', 'Edit User');
    ({ token } = await login('edituser@test.com'));
    const r = await createEvent(token);
    eventId = r.body.event.id;
  });

  it('updates event name', async () => {
    const r = await request(app).patch(`/api/events/${eventId}`).set(auth(token)).send({ name: 'Updated Name' });
    expect(r.status).toBe(200);
    expect(r.body.event.name).toBe('Updated Name');
  });

  it('PATCH only name preserves currency and brief (Finding 22)', async () => {
    const created = await createEvent(token, { currency: 'EUR', brief: 'A preserved European vision' });
    const evId = created.body.event.id;
    const r = await request(app).patch(`/api/events/${evId}`).set(auth(token)).send({ name: 'Only Name Changed' });
    expect(r.status).toBe(200);
    expect(r.body.event.name).toBe('Only Name Changed');
    expect(r.body.event.currency).toBe('EUR');
    expect(r.body.event.brief).toBe('A preserved European vision');
  });

  it('deletes event and cascades to children', async () => {
    const t = await request(app).post(`/api/events/${eventId}/timeline`).set(auth(token)).send({ title: 'A task', offsetDays: 30 });
    expect(t.status).toBe(201);
    const r = await request(app).delete(`/api/events/${eventId}`).set(auth(token));
    expect(r.status).toBe(204);
    const check = await request(app).get(`/api/events/${eventId}`).set(auth(token));
    expect(check.status).toBe(404);
  });
});

// ─── REQ-010: Refine Diff ─────────────────────────────────────────────────────
describe('REQ-010 AI Refine Diff — proposal only, not auto-applied', () => {
  let token: string;
  let eventId: string;

  beforeAll(async () => {
    await register('refineuser@test.com', 'Refine User');
    ({ token } = await login('refineuser@test.com'));
    const r = await createEvent(token);
    eventId = r.body.event.id;
  });

  it('returns a diff proposal, autoApplied is false', async () => {
    const r = await request(app).post(`/api/events/${eventId}/ai/refine`).set(auth(token)).send({ instruction: 'Reduce venue budget by 10% and add a photobooth' });
    expect(r.status).toBe(200);
    expect(r.body.autoApplied).toBe(false);
    expect((r.body.diff.changes as unknown[]).length).toBeGreaterThan(0);
  });

  it('rejects instruction that is too short (SEC-004)', async () => {
    const r = await request(app).post(`/api/events/${eventId}/ai/refine`).set(auth(token)).send({ instruction: 'hi' });
    expect(r.status).toBe(400);
  });
});

// ─── SEC-002: IDOR Prevention ─────────────────────────────────────────────────
describe('SEC-002 IDOR Prevention — cross-tenant isolation', () => {
  let tokenA: string;
  let tokenB: string;
  let eventAId: string;
  let taskAId: string;
  let catAId: string;
  let itemAId: string;
  let vendorAId: string;

  beforeAll(async () => {
    await register('alice_idor@test.com', 'Alice');
    await register('bob_idor@test.com', 'Bob');
    ({ token: tokenA } = await login('alice_idor@test.com'));
    ({ token: tokenB } = await login('bob_idor@test.com'));

    const r = await createEvent(tokenA, { name: "Alice's Private Event" });
    eventAId = r.body.event.id;
    const t = await request(app).post(`/api/events/${eventAId}/timeline`).set(auth(tokenA)).send({ title: 'Private Task', offsetDays: 30 });
    taskAId = t.body.task.id;

    const cat = await request(app).post(`/api/events/${eventAId}/budget/categories`).set(auth(tokenA)).send({ name: 'Private Catering', plannedMinor: 50_000 });
    catAId = cat.body.category.id;

    const item = await request(app).post(`/api/events/${eventAId}/budget/categories/${catAId}/items`).set(auth(tokenA)).send({ label: 'Champagne', plannedMinor: 20_000 });
    itemAId = item.body.item.id;

    const v = await request(app).post(`/api/events/${eventAId}/vendors`).set(auth(tokenA)).send({ category: 'Catering', name: 'Private Chef' });
    vendorAId = v.body.vendor.id;
  });

  it('Bob cannot read Alice\'s event (404, not 403)', async () => {
    const r = await request(app).get(`/api/events/${eventAId}`).set(auth(tokenB));
    expect(r.status).toBe(404);
  });

  it('Bob cannot delete Alice\'s event', async () => {
    const r = await request(app).delete(`/api/events/${eventAId}`).set(auth(tokenB));
    expect(r.status).toBe(404);
  });

  it('Bob cannot read Alice\'s budget', async () => {
    const r = await request(app).get(`/api/events/${eventAId}/budget`).set(auth(tokenB));
    expect(r.status).toBe(404);
  });

  it('Bob cannot update Alice\'s budget category (Finding 26)', async () => {
    const r = await request(app).patch(`/api/events/${eventAId}/budget/categories/${catAId}`).set(auth(tokenB)).send({ name: 'Hacked' });
    expect(r.status).toBe(404);
  });

  it('Bob cannot update Alice\'s budget item (Finding 26)', async () => {
    const r = await request(app).patch(`/api/events/${eventAId}/budget/categories/${catAId}/items/${itemAId}`).set(auth(tokenB)).send({ label: 'Hacked Item' });
    expect(r.status).toBe(404);
  });

  it('Bob cannot delete Alice\'s budget item (Finding 26)', async () => {
    const r = await request(app).delete(`/api/events/${eventAId}/budget/categories/${catAId}/items/${itemAId}`).set(auth(tokenB));
    expect(r.status).toBe(404);
  });

  it('Bob cannot read Alice\'s timeline', async () => {
    const r = await request(app).get(`/api/events/${eventAId}/timeline`).set(auth(tokenB));
    expect(r.status).toBe(404);
  });

  it('Bob cannot update Alice\'s task', async () => {
    const r = await request(app).patch(`/api/events/${eventAId}/timeline/${taskAId}`).set(auth(tokenB)).send({ status: 'completed' });
    expect(r.status).toBe(404);
  });

  it('Bob cannot read Alice\'s vendors (Finding 26)', async () => {
    const r = await request(app).get(`/api/events/${eventAId}/vendors`).set(auth(tokenB));
    expect(r.status).toBe(404);
  });

  it('Bob cannot update Alice\'s vendor (Finding 26)', async () => {
    const r = await request(app).patch(`/api/events/${eventAId}/vendors/${vendorAId}`).set(auth(tokenB)).send({ name: 'Hacked Vendor' });
    expect(r.status).toBe(404);
  });

  it('Bob cannot delete Alice\'s vendor (Finding 26)', async () => {
    const r = await request(app).delete(`/api/events/${eventAId}/vendors/${vendorAId}`).set(auth(tokenB));
    expect(r.status).toBe(404);
  });

  it('Bob cannot get AI draft for Alice\'s event', async () => {
    const r = await request(app).post(`/api/events/${eventAId}/ai/draft`).set(auth(tokenB));
    expect(r.status).toBe(404);
  });

  it('Bob cannot generate ideas for Alice\'s event', async () => {
    const r = await request(app).post(`/api/events/${eventAId}/ideas/generate`).set(auth(tokenB));
    expect(r.status).toBe(404);
  });
});

// ─── SEC-006: Security Headers ────────────────────────────────────────────────
describe('SEC-006 Security Headers on all responses', () => {
  it('includes required security headers', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['content-security-policy']).toBeTruthy();
    expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});

// ─── OBS-001: Health Endpoint ─────────────────────────────────────────────────
describe('OBS-001 Health Endpoint', () => {
  it('GET /api/health returns ok', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.body.timestamp).toBeTruthy();
  });
});

// ─── SEC-003: Input Validation ────────────────────────────────────────────────
describe('SEC-003 Input Validation at every boundary', () => {
  let token: string;
  let eventId: string;

  beforeAll(async () => {
    await register('valuser@test.com', 'Val User');
    ({ token } = await login('valuser@test.com'));
    const r = await createEvent(token);
    eventId = r.body.event.id;
  });

  it('rejects negative budget amounts', async () => {
    const r = await request(app).post(`/api/events/${eventId}/budget/categories`).set(auth(token)).send({ name: 'X', plannedMinor: -100 });
    expect(r.status).toBe(400);
  });

  it('rejects invalid vendor email format', async () => {
    const r = await request(app).post(`/api/events/${eventId}/vendors`).set(auth(token)).send({ category: 'Venue', name: 'Test Vendor', contactEmail: 'not-an-email' });
    expect(r.status).toBe(400);
  });

  it('rejects AI refine instruction over 500 chars (SEC-004)', async () => {
    const r = await request(app).post(`/api/events/${eventId}/ai/refine`).set(auth(token)).send({ instruction: 'x'.repeat(501) });
    expect(r.status).toBe(400);
  });
});
