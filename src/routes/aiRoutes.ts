/**
 * AI Routes — draft planning, refinement, ideas, and usage tracking.
 * REQ-003, REQ-007, REQ-010, SEC-002, SEC-004.
 */
import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { AIService } from '../services/aiService.js';
import { IdeaService, PlanService } from '../services/planService.js';
import { EventService } from '../services/eventService.js';
import {
  UpdateIdeaStateSchema,
  AIRefineRequestSchema,
  AIDraftPlanSchema,
  type EventType,
} from '../schemas/index.js';
import { normalizeAiPlan } from '../domain/aiNormalizer.js';
import { ValidationError } from '../shared/errors.js';
import type { ZodSchema } from 'zod';

function p(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] ?? '';
  return val ?? '';
}

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

export function createAIRouter(
  aiService: AIService,
  ideaService: IdeaService,
  planService: PlanService,
  eventService: EventService,
): Router {
  const router = Router();

  // ─── AI Ideas Routes (REQ-007) ────────────────────────────────────────────
  router.get('/api/events/:eventId/ideas', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const ideas = ideaService.listIdeas(p(req.params['eventId']), uid(req));
      res.json({ ideas });
    } catch (e) { next(e); }
  });

  router.post('/api/events/:eventId/ideas/generate', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const eventId = p(req.params['eventId']);
      const ideas = await aiService.generateIdeas(uid(req), eventId);
      ideaService.addIdeas(eventId, uid(req), ideas);
      res.json({ ideas });
    } catch (e) { next(e); }
  });

  router.patch('/api/events/:eventId/ideas/:ideaId', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const { state } = validate(UpdateIdeaStateSchema, req.body);
      const idea = ideaService.updateIdeaState(p(req.params['ideaId']), p(req.params['eventId']), uid(req), state);
      res.json({ idea });
    } catch (e) { next(e); }
  });

  // ─── AI Plan Routes (REQ-003, REQ-010) ───────────────────────────────────────
  router.post('/api/events/:eventId/ai/draft', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const { plan, warnings } = await aiService.generateDraftPlan(uid(req), p(req.params['eventId']));
      // Return draft for user review — NOT auto-applied (REQ-003)
      res.json({ plan, warnings, autoApplied: false });
    } catch (e) { next(e); }
  });

  router.post('/api/events/:eventId/ai/draft/apply', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const eventId = p(req.params['eventId']);
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
      const event = eventService.getEventOrThrow(eventId, uid(req));
      const { plan: normalizedPlan } = normalizeAiPlan(
        parsed.data,
        event.total_budget,
        event.event_date,
        event.type as EventType,
      );

      planService.applyDraftPlan(eventId, uid(req), normalizedPlan);
      res.json({ applied: true });
    } catch (e) { next(e); }
  });

  router.post('/api/events/:eventId/ai/refine', requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const { instruction } = validate(AIRefineRequestSchema, req.body);
      const result = await aiService.generateRefineDiff(uid(req), p(req.params['eventId']), instruction);
      // REQ-010: Returns diff proposal only — never auto-applies
      res.json(result);
    } catch (e) { next(e); }
  });

  router.get('/api/events/:eventId/ai/usage', requireAuth, (req: AuthRequest, res, next) => {
    try {
      eventService.getEventOrThrow(p(req.params['eventId']), uid(req));
      const usage = aiService.getUsageSummary(uid(req));
      res.json(usage);
    } catch (e) { next(e); }
  });

  return router;
}
