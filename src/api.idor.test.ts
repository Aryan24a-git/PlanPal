/**
 * V2-08: API integration, IDOR security, and input validation test suite.
 * Tests: REQ-007–REQ-010, SEC-002, SEC-003, SEC-006, OBS-001.
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
    expect(r.body.events.length).toBeGreaterThanOrEqual(2);
    expect(r.body.events[0].tasks_total).toBeDefined();
    expect(r.body.events[0].actual_spent).toBeDefined();
  });

  it('pagination: limit and offset work and total count is accurate', async () => {
    const r = await request(app).get('/api/events?limit=1&offset=0').set(auth(token));
    expect(r.status).toBe(200);
    expect(r.body.events).toHaveLength(1);
    expect(r.body.limit).toBe(1);
    expect(r.body.offset).toBe(0);
    expect(r.body.total).toBeGreaterThanOrEqual(2);
  });
});

// ─── REQ-009: Edit and Delete ─────────────────────────────────────────────────
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
    const orig = await createEvent(token, { currency: 'EUR', brief: 'Special European conference trip.' });
    const id = orig.body.event.id;
    const r = await request(app).patch(`/api/events/${id}`).set(auth(token)).send({ name: 'Only New Name' });
    expect(r.status).toBe(200);
    expect(r.body.event.currency).toBe('EUR');
    expect(r.body.event.brief).toBe('Special European conference trip.');
  });

  it('deletes event and cascades to children', async () => {
    const r = await request(app).delete(`/api/events/${eventId}`).set(auth(token));
    expect(r.status).toBe(204);
    const getR = await request(app).get(`/api/events/${eventId}`).set(auth(token));
    expect(getR.status).toBe(404);
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
    const r = await request(app).post(`/api/events/${eventId}/ai/refine`).set(auth(token)).send({ instruction: 'Reduce the catering budget by 10%' });
    expect(r.status).toBe(200);
    expect(r.body.autoApplied).toBe(false);
    expect(r.body.diff.changes.length).toBeGreaterThan(0);
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
  let catAId: string;
  let itemAId: string;
  let taskAId: string;
  let vendorAId: string;

  beforeAll(async () => {
    await register('alice2@test.com', 'Alice');
    await register('bob2@test.com', 'Bob');
    ({ token: tokenA } = await login('alice2@test.com'));
    ({ token: tokenB } = await login('bob2@test.com'));

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
    expect((await request(app).get(`/api/events/${eventAId}`).set(auth(tokenB))).status).toBe(404);
  });

  it('Bob cannot delete Alice\'s event', async () => {
    expect((await request(app).delete(`/api/events/${eventAId}`).set(auth(tokenB))).status).toBe(404);
  });

  it('Bob cannot update Alice\'s budget category (Finding 26)', async () => {
    expect((await request(app).patch(`/api/events/${eventAId}/budget/categories/${catAId}`).set(auth(tokenB)).send({ name: 'Hacked' })).status).toBe(404);
  });

  it('Bob cannot update Alice\'s budget item (Finding 26)', async () => {
    expect((await request(app).patch(`/api/events/${eventAId}/budget/categories/${catAId}/items/${itemAId}`).set(auth(tokenB)).send({ label: 'Hacked' })).status).toBe(404);
  });

  it('Bob cannot delete Alice\'s budget item (Finding 26)', async () => {
    expect((await request(app).delete(`/api/events/${eventAId}/budget/categories/${catAId}/items/${itemAId}`).set(auth(tokenB))).status).toBe(404);
  });

  it('Bob cannot update Alice\'s task', async () => {
    expect((await request(app).patch(`/api/events/${eventAId}/timeline/${taskAId}`).set(auth(tokenB)).send({ status: 'completed' })).status).toBe(404);
  });

  it('Bob cannot update Alice\'s vendor (Finding 26)', async () => {
    expect((await request(app).patch(`/api/events/${eventAId}/vendors/${vendorAId}`).set(auth(tokenB)).send({ name: 'Hacked' })).status).toBe(404);
  });

  it('Bob cannot delete Alice\'s vendor (Finding 26)', async () => {
    expect((await request(app).delete(`/api/events/${eventAId}/vendors/${vendorAId}`).set(auth(tokenB))).status).toBe(404);
  });

  it('Bob cannot get AI draft for Alice\'s event', async () => {
    expect((await request(app).post(`/api/events/${eventAId}/ai/draft`).set(auth(tokenB))).status).toBe(404);
  });
});

// ─── SEC-006: Security Headers ────────────────────────────────────────────────
describe('SEC-006 Security Headers on all responses', () => {
  it('includes required security headers without unsafe-inline in script-src (Must-Fix #2)', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    const csp = r.headers['content-security-policy'] as string;
    expect(csp).toBeTruthy();
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-inline' in script-src");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});

// ─── OBS-001: Health Endpoint ─────────────────────────────────────────────────
describe('OBS-001 Health Endpoint', () => {
  it('GET /api/health returns ok and connected database', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.body.database).toBe('connected');
  });
});

// ─── SEC-003: Input Validation ────────────────────────────────────────────────
describe('SEC-003 Input Validation at every boundary', () => {
  let token: string;
  let eventId: string;

  beforeAll(async () => {
    await register('valuser2@test.com', 'Val User');
    ({ token } = await login('valuser2@test.com'));
    const r = await createEvent(token);
    eventId = r.body.event.id;
  });

  it('rejects invalid calendar dates like 2026-02-31', async () => {
    const r = await request(app).post('/api/events').set(auth(token)).send({
      type: 'wedding', name: 'Leap test', eventDate: '2026-02-31',
      guestEstimate: 100, totalBudget: 500000, currency: 'USD',
      brief: 'Wedding with invalid February 31st date.',
    });
    expect(r.status).toBe(400);
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
