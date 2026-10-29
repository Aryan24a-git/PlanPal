/**
 * Core Efficiency & Quality Refactor Test Suite.
 * Protects:
 * - buildUpdate column whitelisting and dynamic SQL generation
 * - Prepared statement WeakMap cache reuse
 * - Atomic daily quota initialization (first request of the day) and limit enforcement
 * - AI rollback logic preventing negative quota
 * - Schema validation mapping malformed AI output to AiMalformedError (502)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

process.env['JWT_SECRET'] = 'test-jwt-secret-for-integration-tests-must-be-32';
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = ':memory:';
process.env['AI_PROVIDER'] = 'mock';
process.env['AI_DAILY_QUOTA_PER_USER'] = '100';

const { prep, buildUpdate } = await import('./db/statements.js');
const { AIService } = await import('./services/aiService.js');
const { resetDatabase, getDatabase } = await import('./db/database.js');
const { AiMalformedError, AiQuotaError } = await import('./shared/errors.js');
const { config } = await import('./shared/config.js');
import type { AIProvider, RefineDiff } from './ai/provider.js';
import type { AIDraftPlan } from './schemas/index.js';

describe('Q4: buildUpdate SQL Helper & Column Whitelist', () => {
  const whitelist = {
    title: 'title',
    offsetDays: 'offset_days',
    status: 'status',
  };

  it('generates parameterized SQL and values for whitelisted keys', () => {
    const patch = { title: 'New Task', offsetDays: 14 };
    const res = buildUpdate('timeline_tasks', whitelist, patch);
    expect(res).not.toBeNull();
    expect(res!.sql).toBe('UPDATE timeline_tasks SET title = ?, offset_days = ?');
    expect(res!.vals).toEqual(['New Task', 14]);
  });

  it('strictly filters out non-whitelisted or malicious columns (whitelist defense)', () => {
    const maliciousPatch = {
      title: 'Legit Title',
      'id = 1; DROP TABLE users; --': 'exploit',
      owner_id: 'attacker-id',
      isAdmin: true,
    };
    const res = buildUpdate('timeline_tasks', whitelist, maliciousPatch);
    expect(res).not.toBeNull();
    expect(res!.sql).toBe('UPDATE timeline_tasks SET title = ?');
    expect(res!.vals).toEqual(['Legit Title']);
  });

  it('returns null when patch contains no whitelisted keys or is empty', () => {
    expect(buildUpdate('timeline_tasks', whitelist, {})).toBeNull();
    expect(buildUpdate('timeline_tasks', whitelist, { invalidCol: 'val' })).toBeNull();
  });
});

describe('E2: Prepared Statement WeakMap Cache', () => {
  it('reuses the exact same statement instance for identical SQL queries on the same DB', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test (id TEXT PRIMARY KEY, val TEXT);');

    const sql = 'SELECT val FROM test WHERE id = ?';
    const stmt1 = prep(db, sql);
    const stmt2 = prep(db, sql);

    expect(stmt1).toBe(stmt2); // Reference equality check
    db.close();
  });

  it('compiles distinct statements for different SQL strings', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE test (id TEXT PRIMARY KEY, val TEXT);');

    const stmt1 = prep(db, 'SELECT val FROM test WHERE id = ?');
    const stmt2 = prep(db, 'SELECT id FROM test WHERE val = ?');

    expect(stmt1).not.toBe(stmt2);
    db.close();
  });
});

describe('E3: Atomic Daily Quota & Rollback Verification', () => {
  beforeEach(() => {
    resetDatabase();
    // Seed user and event for AI service
    const db = getDatabase();
    db.exec(`
      INSERT INTO users (id, email, password_hash, name, created_at)
      VALUES ('quota-u1', 'quota@test.com', 'hash', 'Quota User', '2026-01-01T00:00:00Z');
      INSERT INTO events (id, owner_id, type, name, event_date, guest_estimate, total_budget, currency, brief, created_at, updated_at)
      VALUES ('quota-e1', 'quota-u1', 'wedding', 'Quota Wedding', '2027-06-15', 100, 1000000, 'USD', 'Brief', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `);
  });

  it('initializes quota row on the very first request of a new day and increments to 1', async () => {
    const aiService = new AIService();
    const summaryBefore = aiService.getUsageSummary('quota-u1');
    expect(summaryBefore.used).toBe(0);

    await aiService.generateDraftPlan('quota-u1', 'quota-e1');

    const summaryAfter = aiService.getUsageSummary('quota-u1');
    expect(summaryAfter.used).toBe(1);
    expect(summaryAfter.remaining).toBe(config.AI_DAILY_QUOTA_PER_USER - 1);
  });

  it('enforces limit when quota reaches config.AI_DAILY_QUOTA_PER_USER', async () => {
    const aiService = new AIService();
    const limit = config.AI_DAILY_QUOTA_PER_USER;

    // Fast-forward usage to limit
    const day = new Date().toISOString().slice(0, 10);
    prep(getDatabase(), 'INSERT INTO ai_usage (id, user_id, day, count) VALUES (?, ?, ?, ?)').run('u-quota', 'quota-u1', day, limit);

    await expect(aiService.generateDraftPlan('quota-u1', 'quota-e1')).rejects.toThrow(AiQuotaError);
  });

  it('refunds quota on AI failure and never allows count to drop below zero', async () => {
    const failingProvider: AIProvider = {
      name: 'failing',
      async generateDraftPlan(): Promise<AIDraftPlan> {
        throw new Error('Simulated upstream network crash');
      },
      async generateIdeas() { return []; },
      async generateRefineDiff(): Promise<RefineDiff> {
        return { budgetChanges: [], timelineChanges: [], vendorChanges: [], generalAdvice: [] };
      },
    };

    const aiService = new AIService(failingProvider);
    await expect(aiService.generateDraftPlan('quota-u1', 'quota-e1')).rejects.toThrow();

    // Verify rollback did not produce negative count
    const summary = aiService.getUsageSummary('quota-u1');
    expect(summary.used).toBe(0);
    expect(summary.remaining).toBe(config.AI_DAILY_QUOTA_PER_USER);
  });

  it('maps malformed AI responses to 502 AiMalformedError', async () => {
    const malformedProvider: AIProvider = {
      name: 'malformed',
      async generateDraftPlan(): Promise<AIDraftPlan> {
        // Missing required budgetCategories and timelineTasks
        return { ideas: [] } as unknown as AIDraftPlan;
      },
      async generateIdeas() { return []; },
      async generateRefineDiff(): Promise<RefineDiff> {
        return { budgetChanges: [], timelineChanges: [], vendorChanges: [], generalAdvice: [] };
      },
    };

    const aiService = new AIService(malformedProvider);
    try {
      await aiService.generateDraftPlan('quota-u1', 'quota-e1');
      expect.fail('Should have thrown AiMalformedError');
    } catch (err) {
      expect(err).toBeInstanceOf(AiMalformedError);
      expect((err as AiMalformedError).statusCode).toBe(502);
      expect((err as AiMalformedError).code).toBe('AI_MALFORMED');
    }
  });
});
