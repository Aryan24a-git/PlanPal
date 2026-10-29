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

/**
 * Q4: Safe dynamic UPDATE query builder with strict column whitelist.
 * Table and column identifiers come strictly from internal column mapping constants.
 */
export function buildUpdate(
  table: string,
  columns: Record<string, string>,
  patch: Record<string, unknown>,
): { sql: string; vals: unknown[] } | null {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [key, col] of Object.entries(columns)) {
    const v = patch[key];
    if (v === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
  }
  return sets.length > 0 ? { sql: `UPDATE ${table} SET ${sets.join(', ')}`, vals } : null;
}
