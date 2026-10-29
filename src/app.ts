/**
 * Express REST API — Application bootstrap and route mounting.
 * Composition-only architecture with DI container and centralized middleware.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import compression from 'compression';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { requestLogger, securityHeaders, globalRateLimit } from './middleware/auth.js';
import { createContainer, type Container } from './container.js';
import { AppError } from './shared/errors.js';
import { logger } from './shared/logger.js';
import { config } from './shared/config.js';
import { getDatabase } from './db/database.js';
import { prep } from './db/statements.js';
import { createAuthRouter } from './routes/authRoutes.js';
import { createEventRouter } from './routes/eventRoutes.js';
import { createAIRouter } from './routes/aiRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(containerOverride?: Container) {
  const container = containerOverride ?? createContainer();
  const app = express();

  // Trust proxy for reverse proxies (Render, Fly.io, Cloudflare)
  app.set('trust proxy', 1);

  app.use(compression());
  app.use(requestLogger);
  app.use(securityHeaders);

  // Configurable CORS origins for production, permissive for dev/test
  const corsOrigin = config.CORS_ORIGIN
    ? config.CORS_ORIGIN.split(',').map((o) => o.trim())
    : (config.NODE_ENV === 'production' ? false : true);

  app.use(cors({ origin: corsOrigin, credentials: true }));

  // ─── Static Frontend (REQ-008: served before API rate limiting) ─────────
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(
    express.static(publicDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.(js|css|svg|png|jpg|ico)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
        }
      },
    }),
  );

  // ─── API Middleware & Boundaries ──────────────────────────────────────────
  app.use(express.json({ limit: '50kb' }));  // SEC-003: body size limit
  app.use('/api', globalRateLimit);

  // ─── Health (OBS-001 / Finding 31: touches DB) ──────────────────────────
  app.get('/api/health', (_req, res) => {
    try {
      prep(getDatabase(), 'SELECT 1').get();
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

  // ─── Mount Modular Sub-Routers (NFR-002, NFR-003, Q3, Q6) ──────────────────
  app.use(createAuthRouter(container));
  app.use(createEventRouter(container));
  app.use(createAIRouter(container));

  // ─── JSON 404 for unknown API routes (Finding 28) ─────────────────────────
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found' } });
  });

  // ─── SPA Fallback for client navigation ───────────────────────────────────
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(publicDir, 'index.html'));
      return;
    }
    next();
  });

  // ─── Global Error Handler (Express 5 error forwarding, Finding 28) ────────
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
