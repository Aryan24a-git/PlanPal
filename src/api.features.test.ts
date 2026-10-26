/**
 * V2-08 / Finding 26 / SEC-005: Vendor Category Seeding and AI Quota Integration Tests.
 * Tests:
 * - Automatic vendor checklist category seeding by event type (REQ-006)
 * - Per-user daily AI quota enforcement (SEC-005)
 * - Refinement context injection (REQ-010)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { resetDatabase } from './db/database.js';

process.env['JWT_SECRET'] = 'test-jwt-secret-for-integration-tests-must-be-32';
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = ':memory:';
process.env['AI_PROVIDER'] = 'mock';
process.env['AI_DAILY_QUOTA_PER_USER'] = '3';

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

beforeAll(() => { resetDatabase(); });
afterAll(() => { resetDatabase(); });

// ─── REQ-006: Vendor Seeding by Event Type ────────────────────────────────────
describe('REQ-006 Vendor Seeding by Event Type', () => {
  let token: string;

  beforeAll(async () => {
    await register('vendorseed@test.com', 'Vendor Seeder');
    ({ token } = await login('vendorseed@test.com'));
  });

  it('automatically seeds wedding vendor checklist categories on creation', async () => {
    const res = await request(app).post('/api/events').set(auth(token)).send({
      type: 'wedding',
      name: 'Maya & Liam Wedding',
      eventDate: '2027-08-15',
      guestEstimate: 150,
      totalBudget: 2_000_000,
      currency: 'USD',
      brief: 'Outdoor rustic wedding celebration.',
    });
    expect(res.status).toBe(201);
    const eventId = res.body.event.id;

    const vendorsRes = await request(app).get(`/api/events/${eventId}/vendors`).set(auth(token));
    expect(vendorsRes.status).toBe(200);
    const vendors = vendorsRes.body.vendors as Array<{ category: string }>;
    expect(vendors.length).toBeGreaterThanOrEqual(4);
    const categories = vendors.map((v) => v.category);
    expect(categories).toContain('Venue & Reception');
    expect(categories).toContain('Catering & Bar');
    expect(categories).toContain('Photography & Video');
  });

  it('automatically seeds birthday vendor checklist categories on creation', async () => {
    const res = await request(app).post('/api/events').set(auth(token)).send({
      type: 'birthday',
      name: "Sam's 10th Birthday Party",
      eventDate: '2027-04-10',
      guestEstimate: 30,
      totalBudget: 100_000,
      currency: 'USD',
      brief: 'Fun science-themed birthday celebration.',
    });
    expect(res.status).toBe(201);
    const eventId = res.body.event.id;

    const vendorsRes = await request(app).get(`/api/events/${eventId}/vendors`).set(auth(token));
    expect(vendorsRes.status).toBe(200);
    const categories = (vendorsRes.body.vendors as Array<{ category: string }>).map((v) => v.category);
    expect(categories).toContain('Cake & Sweets');
    expect(categories).toContain('Entertainment / DJ');
    expect(categories).not.toContain('Venue & Reception');
  });

  it('automatically seeds community vendor checklist categories on creation', async () => {
    const res = await request(app).post('/api/events').set(auth(token)).send({
      type: 'community',
      name: 'Oakwood Block Party',
      eventDate: '2027-07-04',
      guestEstimate: 300,
      totalBudget: 300_000,
      currency: 'USD',
      brief: 'Annual neighborhood summer block party.',
    });
    expect(res.status).toBe(201);
    const eventId = res.body.event.id;

    const vendorsRes = await request(app).get(`/api/events/${eventId}/vendors`).set(auth(token));
    expect(vendorsRes.status).toBe(200);
    const categories = (vendorsRes.body.vendors as Array<{ category: string }>).map((v) => v.category);
    expect(categories).toContain('Permits & Venue');
    expect(categories).toContain('Signage & Printing');
  });
});

// ─── SEC-005: AI Daily Quota Enforcement ──────────────────────────────────────
describe('SEC-005 AI Daily Quota Enforcement', () => {
  let token: string;
  let eventId: string;

  beforeAll(async () => {
    await register('quotauser@test.com', 'Quota User');
    ({ token } = await login('quotauser@test.com'));
    const res = await request(app).post('/api/events').set(auth(token)).send({
      type: 'wedding',
      name: 'Quota Test Wedding',
      eventDate: '2027-09-01',
      guestEstimate: 80,
      totalBudget: 800_000,
      currency: 'USD',
      brief: 'Private test event to verify per-user AI rate limits.',
    });
    eventId = res.body.event.id;
  });

  it('tracks usage and blocks requests when daily quota is exceeded (429)', async () => {
    // Daily quota is configured as 3 in this test process
    const res1 = await request(app).post(`/api/events/${eventId}/ai/draft`).set(auth(token));
    expect(res1.status).toBe(200);

    const res2 = await request(app).post(`/api/events/${eventId}/ideas/generate`).set(auth(token));
    expect(res2.status).toBe(200);

    const res3 = await request(app).post(`/api/events/${eventId}/ai/refine`).set(auth(token)).send({
      instruction: 'Adjust floral budget lower',
    });
    expect(res3.status).toBe(200);

    // 4th request must be rejected with 429 AI_QUOTA_EXCEEDED
    const res4 = await request(app).post(`/api/events/${eventId}/ai/draft`).set(auth(token));
    expect(res4.status).toBe(429);
    expect(res4.body.error.code).toBe('AI_QUOTA_EXCEEDED');
  });
});
