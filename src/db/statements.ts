import type Database from 'better-sqlite3';

const cache = new WeakMap<Database.Database, Map<string, Database.Statement>>();

/**
 * Prepares and caches SQL statements per Database instance.
 * WeakMap keying ensures clean garbage collection on database teardown/reset in tests.
 */
export function prep(db: Database.Database, sql: string): Database.Statement {
  let m = cache.get(db);
  if (!m) {
    m = new Map();
    cache.set(db, m);
  }
  let s = m.get(sql);
  if (!s) {
    s = db.prepare(sql);
    m.set(sql, s);
  }
  return s;
}
