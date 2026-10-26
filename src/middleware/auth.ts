/**
 * V2-07: Authentication and request middleware.
 * SEC-001: Token verification with typed AppError.
 * SEC-006: Security headers applied globally.
 * OBS-001: Request ID + structured JSON logging for every request.
 * SEC-005: Express-rate-limit protecting all routes.
 */
import { type Request, type Response, type NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { AuthService } from '../services/authService.js';
import { UnauthorizedError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import { config } from '../shared/config.js';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
  userName?: string;
  requestId?: string;
}

const authService = new AuthService();

// ─── Request ID & Timing (OBS-001) ───────────────────────────────────────────
export function requestLogger(req: AuthRequest, res: Response, next: NextFunction): void {
  req.requestId = uuidv4();
  const start = Date.now();

  res.on('finish', () => {
    logger.info('HTTP request', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
}

// ─── Security Headers (SEC-006) ──────────────────────────────────────────────
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');  // disable legacy — rely on CSP
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",  // inline scripts for SPA
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  if (config.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  next();
}

// ─── JWT Auth Guard (SEC-001, SEC-002) ───────────────────────────────────────
export function requireAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Authorization header missing or malformed');
  }
  const token = header.slice(7);
  const { userId, email, name } = authService.verifyToken(token);
  req.userId = userId;
  req.userEmail = email;
  req.userName = name;
  next();
}

// ─── Global Rate Limiter (SEC-005) ───────────────────────────────────────────
export const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' } },
  skip: () => config.NODE_ENV === 'test',
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many auth attempts, please try again later.' } },
  skip: () => config.NODE_ENV === 'test',
});
