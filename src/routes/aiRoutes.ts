/**
 * AI Routes — draft planning, refinement, ideas, and usage tracking.
 * REQ-003, REQ-007, REQ-010, SEC-002, SEC-004.
 */
import { Router } from 'express';
import { type AuthRequest } from '../middleware/auth.js';
import type { Container } from '../container.js';
import {
  UpdateIdeaStateSchema,
  AIRefineRequestSchema,
  AIDraftPlanSchema,
  type EventType,
} from '../schemas/index.js';
import { normalizeAiPlan } from '../domain/aiNormalizer.js';
import { param, currentUserId, parse } from './helpers.js';

export function createAIRouter(c: Container): Router {
  const router = Router();
  const { aiService, ideaService, planService, eventService, requireAuth } = c;

  // ─── AI Ideas Routes (REQ-007) ────────────────────────────────────────────
  router.get('/api/events/:eventId/ideas', requireAuth, (req: AuthRequest, res) => {
    const ideas = ideaService.listIdeas(param(req, 'eventId'), currentUserId(req));
    res.json({ ideas });
  });

  router.post('/api/events/:eventId/ideas/generate', requireAuth, async (req: AuthRequest, res) => {
    const eventId = param(req, 'eventId');
    const ideas = await aiService.generateIdeas(currentUserId(req), eventId);
    ideaService.addIdeas(eventId, currentUserId(req), ideas);
    res.json({ ideas });
  });

  router.patch('/api/events/:eventId/ideas/:ideaId', requireAuth, (req: AuthRequest, res) => {
    const { state } = parse(UpdateIdeaStateSchema, req.body);
    const idea = ideaService.updateIdeaState(param(req, 'ideaId'), param(req, 'eventId'), currentUserId(req), state);
    res.json({ idea });
  });

  // ─── AI Plan Routes (REQ-003, REQ-010) ───────────────────────────────────────
  router.post('/api/events/:eventId/ai/draft', requireAuth, async (req: AuthRequest, res) => {
    const { plan, warnings } = await aiService.generateDraftPlan(currentUserId(req), param(req, 'eventId'));
    // Return draft for user review — NOT auto-applied (REQ-003)
    res.json({ plan, warnings, autoApplied: false });
  });

  router.post('/api/events/:eventId/ai/draft/apply', requireAuth, async (req: AuthRequest, res) => {
    const eventId = param(req, 'eventId');
    const body = req.body as { plan?: unknown };
    if (!body?.plan) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'plan is required' } });
      return;
    }
    const parsed = AIDraftPlanSchema.safeParse(body.plan);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid plan structure' } });
      return;
    }

    // Finding 25: Re-normalize plan server-side against event budget & date before applying
    const event = eventService.getEventOrThrow(eventId, currentUserId(req));
    const { plan: normalizedPlan } = normalizeAiPlan(
      parsed.data,
      event.totalBudget,
      event.eventDate,
      event.type as EventType,
    );

    planService.applyDraftPlan(eventId, currentUserId(req), normalizedPlan);
    res.json({ applied: true });
  });

  router.post('/api/events/:eventId/ai/refine', requireAuth, async (req: AuthRequest, res) => {
    const { instruction } = parse(AIRefineRequestSchema, req.body);
    const result = await aiService.generateRefineDiff(currentUserId(req), param(req, 'eventId'), instruction);
    // REQ-010: Returns diff proposal only — never auto-applies
    res.json(result);
  });

  router.get('/api/events/:eventId/ai/usage', requireAuth, (req: AuthRequest, res) => {
    eventService.getEventOrThrow(param(req, 'eventId'), currentUserId(req));
    const usage = aiService.getUsageSummary(currentUserId(req));
    res.json(usage);
  });

  return router;
}
