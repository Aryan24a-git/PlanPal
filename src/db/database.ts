/**
 * V2-02: Database schema, foreign keys, cascade deletes, indexes, CHECK constraints.
 * V2-04: Users/sessions tables for auth.
 * REL-002: Multi-row writes wrapped in transactions.
 * PERF-001: Indexes on owner_id and event_id for every child table.
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let _db: Database.Database | null = null;

export function getDatabase(urlOverride?: string): Database.Database {
  if (_db) return _db;

  const url = urlOverride ?? process.env['DATABASE_URL'] ?? './data/planpal.db';
  const isMemory = url === ':memory:';

  if (!isMemory) {
    const dir = path.dirname(path.resolve(process.cwd(), url));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(isMemory ? ':memory:' : path.resolve(process.cwd(), url));
  _db.pragma('journal_mode = WAL');   // concurrent reads
  _db.pragma('synchronous = NORMAL'); // E6: safe with WAL, avoids fsync stalls
  _db.pragma('temp_store = MEMORY');  // E6: faster temp table and sort operations
  _db.pragma('foreign_keys = ON');    // V2-02: enforce FKs + cascades
  _db.pragma('busy_timeout = 5000');  // retry on lock

  applySchema(_db);
  return _db;
}

/** For tests: reset the singleton so each test suite gets a fresh in-memory DB */
export function resetDatabase(): void {
  if (_db) { try { _db.close(); } catch { /* ignore */ } }
  _db = null;
}

function applySchema(db: Database.Database): void {
  db.exec(`
    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      name        TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    -- Sessions (V2-04)
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      expires_at  TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    -- Events
    CREATE TABLE IF NOT EXISTS events (
      id               TEXT PRIMARY KEY,
      owner_id         TEXT NOT NULL,
      type             TEXT NOT NULL CHECK(type IN ('wedding','birthday','community')),
      name             TEXT NOT NULL,
      event_date       TEXT NOT NULL,
      guest_estimate   INTEGER NOT NULL CHECK(guest_estimate >= 1),
      total_budget     INTEGER NOT NULL CHECK(total_budget >= 0),
      currency         TEXT NOT NULL DEFAULT 'USD',
      brief            TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_id);

    -- Budget Categories
    CREATE TABLE IF NOT EXISTS budget_categories (
      id            TEXT PRIMARY KEY,
      event_id      TEXT NOT NULL,
      name          TEXT NOT NULL,
      planned_minor INTEGER NOT NULL DEFAULT 0 CHECK(planned_minor >= 0),
      sort_order    INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_categories_event ON budget_categories(event_id);

    -- Budget Items
    CREATE TABLE IF NOT EXISTS budget_items (
      id            TEXT PRIMARY KEY,
      category_id   TEXT NOT NULL,
      label         TEXT NOT NULL,
      planned_minor INTEGER NOT NULL DEFAULT 0 CHECK(planned_minor >= 0),
      actual_minor  INTEGER NOT NULL DEFAULT 0 CHECK(actual_minor >= 0),
      note          TEXT,
      FOREIGN KEY (category_id) REFERENCES budget_categories(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_items_category ON budget_items(category_id);

    -- Timeline Tasks
    CREATE TABLE IF NOT EXISTS timeline_tasks (
      id          TEXT PRIMARY KEY,
      event_id    TEXT NOT NULL,
      title       TEXT NOT NULL,
      offset_days INTEGER NOT NULL CHECK(offset_days >= 0),
      due_date    TEXT NOT NULL,
      pinned      INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
      status      TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','completed')),
      priority    TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      phase       TEXT,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_event ON timeline_tasks(event_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_event_status ON timeline_tasks(event_id, status);

    -- Vendor Items
    CREATE TABLE IF NOT EXISTS vendor_items (
      id             TEXT PRIMARY KEY,
      event_id       TEXT NOT NULL,
      category       TEXT NOT NULL,
      name           TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'to_contact' CHECK(status IN ('to_contact','contacted','quoted','booked','declined')),
      contact_name   TEXT,
      contact_email  TEXT,
      contact_phone  TEXT,
      quote_minor    INTEGER CHECK(quote_minor IS NULL OR quote_minor >= 0),
      note           TEXT,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_vendors_event ON vendor_items(event_id);

    -- AI Ideas
    CREATE TABLE IF NOT EXISTS ai_ideas (
      id            TEXT PRIMARY KEY,
      event_id      TEXT NOT NULL,
      category      TEXT NOT NULL,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL,
      est_low_minor INTEGER CHECK(est_low_minor IS NULL OR est_low_minor >= 0),
      est_high_minor INTEGER CHECK(est_high_minor IS NULL OR est_high_minor >= 0),
      state         TEXT NOT NULL DEFAULT 'suggested' CHECK(state IN ('suggested','saved','dismissed')),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ideas_event ON ai_ideas(event_id);

    -- AI Usage (SEC-005: daily quota tracking, unique per user+day)
    CREATE TABLE IF NOT EXISTS ai_usage (
      id             TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL,
      day            TEXT NOT NULL,
      count          INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, day),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Migration step: ensure ai_usage has modern count/day columns
  const usageCols = db.prepare('PRAGMA table_info(ai_usage)').all() as Array<{ name: string }>;
  if (usageCols.length > 0 && !usageCols.some(c => c.name === 'count')) {
    db.exec(`
      DROP TABLE ai_usage;
      CREATE TABLE ai_usage (
        id             TEXT PRIMARY KEY,
        user_id        TEXT NOT NULL,
        day            TEXT NOT NULL,
        count          INTEGER NOT NULL DEFAULT 0,
        UNIQUE(user_id, day),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
  }
}
