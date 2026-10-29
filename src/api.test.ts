/**
 * V2-08: API integration test suite for Core User Journeys.
 * Tests: REQ-001 (Auth), REQ-002 (Events), REQ-003 (AI Draft), REQ-004 (Budget),
 * REQ-005 (Timeline), REQ-006 (Vendors).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { resetDatabase } from './db/database.js';

process.env['JWT_SECRET'] = 'test-jwt-secret-for-integration-tests-must-be-32';
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = ':memory:';
process.env['AI_PROVIDER'] = 'mock';
process.env['AI_DAILY_QUOTA_PER_USER'] = '100';

const { createApp } = await import('./app.js');
const app = createApp();

async function register(email: string, name = 'Test User') {
  return request(app).post('/api/auth/register').send({ email, password: 'ValidPass123!', name });
}

async function login(email: string) {
  const r = await request(app).post('/api/auth/login').send({ email, password: 'ValidPass123!' });
  return r.body as { token: string };
}

function auth(token: string) { return { Authorization: `Bearer ${token}` }; }

async function createEvent(token: string, overrides = {}) {
  return request(app).post('/api/events').set(auth(token)).send({
    type: 'wedding', name: 'Alice & Bob Wedding', eventDate: '2027-06-15',
    guestEstimate: 120, totalBudget: 1_000_000, currency: 'USD',
    brief: 'Elegant garden wedding in June. Looking for classic and romantic styling.',
    ...overrides,
  });
}

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
    expect(totalAlloc).toBe(event.body.event.totalBudget);
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
    expect(r.body.vendor.quoteMinor).toBe(300_000);
  });

  it('deletes a vendor', async () => {
    const v = await request(app).post(`/api/events/${eventId}/vendors`).set(auth(token)).send({ category: 'Photography', name: 'Snap Co', status: 'to_contact' });
    const r = await request(app).delete(`/api/events/${eventId}/vendors/${v.body.vendor.id}`).set(auth(token));
    expect(r.status).toBe(204);
  });
});
