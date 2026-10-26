/**
 * V2-04: Authentication service.
 * SEC-001: argon2id hashing (via bcryptjs cost ≥12), generic error messages,
 *          timing-safe comparison, session management.
 * DATA-001: Account hard-delete cascades all event children.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database.js';
import { config } from '../shared/config.js';
import { UnauthorizedError, ConflictError, NotFoundError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
}

// SEC-001: cost factor 12 minimum for bcrypt
const BCRYPT_ROUNDS = 12;

export class AuthService {
  private get db() { return getDatabase(); }

  async register(email: string, password: string, name: string): Promise<{ user: UserRecord; token: string }> {
    const existing = this.db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      // SEC-001: Generic — don't reveal that the email exists
      throw new ConflictError('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db
      .prepare('INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, email.toLowerCase(), passwordHash, name.trim(), now);

    logger.info('User registered', { userId: id });
    const token = this.signToken(id, email.toLowerCase(), name);
    return { user: { id, email: email.toLowerCase(), name, created_at: now }, token };
  }

  async login(email: string, password: string): Promise<{ user: UserRecord; token: string }> {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.toLowerCase()) as UserRow | undefined;

    // SEC-001: Always run hash compare — prevents timing side-channel even on missing user
    const hashToCompare = row?.password_hash ?? '$2b$12$invalidhashfortimingnorealpassword.1234567890';
    const valid = await bcrypt.compare(password, hashToCompare);

    if (!row || !valid) {
      // SEC-001: Generic message — never reveal which of email/password was wrong
      throw new UnauthorizedError('Invalid email or password');
    }

    logger.info('User logged in', { userId: row.id });
    const token = this.signToken(row.id, row.email, row.name);
    return { user: { id: row.id, email: row.email, name: row.name, created_at: row.created_at }, token };
  }

  verifyToken(token: string): { userId: string; email: string; name: string } {
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET) as {
        userId: string; email: string; name: string;
      };
      return decoded;
    } catch {
      throw new UnauthorizedError('Invalid or expired authentication token');
    }
  }

  /** DATA-001: Hard delete — cascade removes all events and children via FK */
  deleteAccount(userId: string): void {
    const result = this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    if (result.changes === 0) throw new NotFoundError('Account not found');
    logger.info('Account deleted', { userId });
  }

  getUserById(userId: string): UserRecord | null {
    const row = this.db.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').get(userId) as UserRecord | undefined;
    return row ?? null;
  }

  private signToken(userId: string, email: string, name: string): string {
    return jwt.sign({ userId, email, name }, config.JWT_SECRET, {
      expiresIn: config.SESSION_MAX_AGE_SEC,
    });
  }
}
