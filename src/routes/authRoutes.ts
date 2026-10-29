/**
 * Auth Routes — User registration, login, profile inspection, and account termination.
 * REQ-001, SEC-001, DATA-001.
 */
import { Router } from 'express';
import { authRateLimit, type AuthRequest } from '../middleware/auth.js';
import type { Container } from '../container.js';
import { RegisterSchema, LoginSchema } from '../schemas/index.js';
import { currentUserId, parse } from './helpers.js';

export function createAuthRouter(c: Container): Router {
  const router = Router();
  const { authService, requireAuth } = c;

  router.post('/api/auth/register', authRateLimit, async (req, res) => {
    const { email, password, name } = parse(RegisterSchema, req.body);
    const result = await authService.register(email, password, name);
    res.status(201).json(result);
  });

  router.post('/api/auth/login', authRateLimit, async (req, res) => {
    const { email, password } = parse(LoginSchema, req.body);
    const result = await authService.login(email, password);
    res.json(result);
  });

  router.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => {
    const user = authService.getUserById(currentUserId(req));
    if (!user) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
      return;
    }
    res.json({ user });
  });

  router.delete('/api/auth/account', requireAuth, (req: AuthRequest, res) => {
    authService.deleteAccount(currentUserId(req));
    res.status(204).send();
  });

  return router;
}
