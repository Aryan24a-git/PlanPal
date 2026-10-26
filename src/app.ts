/**
 * V2-07: Express REST API — Application bootstrap and route mounting.
 * Route handler structure:
 *   1. Parse & validate with Zod (SEC-003)
 *   2. Call service (IDOR-safe, throws AppError on unauthorized access)
 *   3. Return JSON envelope
 *   4. Global error handler converts AppError to correct HTTP status + envelope
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  requestLogger, securityHeaders, requireAuth, globalRateLimit, authRateLimit,
  type AuthRequest,
} from './middleware/auth.js';
import { AuthService } from './services/authService.js';
import {
  EventService, BudgetService, TimelineService, VendorService, IdeaService, PlanService,
} from './services/eventService.js';
import { AIService } from './services/aiService.js';
import { AppError, ValidationError } from './shared/errors.js';
import { logger } from './shared/logger.js';
import { config } from './shared/config.js';
import { getDatabase } from './db/database.js';
import { RegisterSchema, LoginSchema } from './schemas/index.js';
import { createEventRouter } from './routes/eventRoutes.js';
import { createAIRouter } from './routes/aiRoutes.js';
import type { ZodSchema } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Service Instances ────────────────────────────────────────────────────────
const authService = new AuthService();
const eventService = new EventService();
const budgetService = new BudgetService();
const timelineService = new TimelineService();
const vendorService = new VendorService();
const ideaService = new IdeaService();
const planService = new PlanService();
const aiService = new AIService();

// ─── Helper Functions ─────────────────────────────────────────────────────────
function uid(req: AuthRequest): string {
  if (!req.userId) throw new Error('requireAuth must precede this route');
  return req.userId;
}

function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const err of result.error.issues) {
      const key = err.path.join('.') || 'body';
      fieldErrors[key] = [...(fieldErrors[key] ?? []), err.message];
    }
    throw new ValidationError('Validation failed', fieldErrors);
  }
  return result.data;
}

// ─── App Setup ────────────────────────────────────────────────────────────────
export function createApp() {
  const app = express();

  // Trust proxy for reverse proxies (Render, Fly.io, Cloudflare) so rate limits use real client IPs
  app.set('trust proxy', 1);

  app.use(requestLogger);
  app.use(securityHeaders);

  // W-06: Configurable CORS origins for production, permissive for dev/test
  const corsOrigin = config.CORS_ORIGIN
    ? config.CORS_ORIGIN.split(',').map((o) => o.trim())
    : (config.NODE_ENV === 'production' ? false : true);

  app.use(cors({ origin: corsOrigin, credentials: true }));

  // ─── Static Frontend (REQ-008: served before API rate limiting) ─────────
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  // ─── API Middleware & Boundaries ──────────────────────────────────────────
  app.use(express.json({ limit: '50kb' }));  // SEC-003: body size limit
  app.use('/api', globalRateLimit);

  // ─── Health (OBS-001 / Finding 31: touches DB) ──────────────────────────
  app.get('/api/health', (_req, res) => {
    try {
      getDatabase().prepare('SELECT 1').get();
      res.json({
        status: 'ok',
        database: 'connected',
        aiProvider: config.AI_PROVIDER,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      });
    } catch {
      res.status(500).json({ status: 'error', database: 'disconnected' });
    }
  });

  // ─── Auth Routes (REQ-001, SEC-001) ──────────────────────────────────────────
  app.post('/api/auth/register', authRateLimit, async (req, res, next) => {
    try {
      const { email, password, name } = validate(RegisterSchema, req.body);
      const result = await authService.register(email, password, name);
      res.status(201).json(result);
    } catch (e) { next(e); }
  });

  app.post('/api/auth/login', authRateLimit, async (req, res, next) => {
    try {
      const { email, password } = validate(LoginSchema, req.body);
      const result = await authService.login(email, password);
      res.json(result);
    } catch (e) { next(e); }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const user = authService.getUserById(uid(req));
      if (!user) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } }); return; }
      res.json({ user });
    } catch (e) { next(e); }
  });

  app.delete('/api/auth/account', requireAuth, (req: AuthRequest, res, next) => {
    try {
      authService.deleteAccount(uid(req));
      res.status(204).send();
    } catch (e) { next(e); }
  });

  // ─── Mount Modular Sub-Routers (NFR-002, NFR-003) ─────────────────────────
  app.use(createEventRouter(eventService, budgetService, timelineService, vendorService));
  app.use(createAIRouter(aiService, ideaService, planService, eventService));

  // ─── JSON 404 for unknown API routes (Finding 28) ─────────────────────────
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found' } });
  });

  // ─── SPA Fallback for client navigation ───────────────────────────────────
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(path.join(publicDir, 'index.html'));
      return;
    }
    next();
  });

  // ─── Global Error Handler (Finding 28: maps body parser status 400 & 413) ─
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(err.toEnvelope());
      return;
    }

    const status = (err as { status?: number; type?: string }).status;
    const errType = (err as { type?: string }).type;
    if (status === 400 || errType === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON payload' } });
      return;
    }
    if (status === 413 || errType === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeds 50kb limit' } });
      return;
    }

    logger.error('Unhandled error', { name: (err as Error).name, message: (err as Error).message });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  return app;
}
