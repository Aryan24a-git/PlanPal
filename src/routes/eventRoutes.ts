/**
 * Event, Budget, Timeline, and Vendor Routes.
 * REQ-002, REQ-004, REQ-005, REQ-006, REQ-008, REQ-009, SEC-002, SEC-003.
 */
import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { EventService, TimelineService, VendorService } from '../services/eventService.js';
import { BudgetService } from '../services/budgetService.js';
import {
  CreateEventSchema, UpdateEventSchema,
  CreateBudgetCategorySchema, UpdateBudgetCategorySchema,
  CreateBudgetItemSchema, UpdateBudgetItemSchema,
  CreateTaskSchema, UpdateTaskSchema,
  CreateVendorSchema, UpdateVendorSchema,
  PaginationSchema,
} from '../schemas/index.js';
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

export function createEventRouter(
  eventService: EventService,
  budgetService: BudgetService,
  timelineService: TimelineService,
  vendorService: VendorService,
): Router {
  const router = Router();

  // ─── Event Routes (REQ-002, REQ-008, REQ-009) ───────────────────────────────
  router.get('/api/events', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const { limit, offset } = validate(PaginationSchema, req.query);
      const events = eventService.listEventsSummary(uid(req));
      const total = (events as unknown[]).length;
      const page = (events as unknown[]).slice(offset, offset + limit);
      res.json({ events: page, total, limit, offset });
    } catch (e) { next(e); }
  });

  router.post('/api/events', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const input = validate(CreateEventSchema, req.body);
      const event = eventService.createEvent(uid(req), input);
      res.status(201).json({ event });
    } catch (e) { next(e); }
  });

  router.get('/api/events/:eventId', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const event = eventService.getEventOrThrow(p(req.params['eventId']), uid(req));
      res.json({ event });
    } catch (e) { next(e); }
  });

  router.patch('/api/events/:eventId', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const input = validate(UpdateEventSchema, req.body);
      const event = eventService.updateEvent(p(req.params['eventId']), uid(req), input);
      res.json({ event });
    } catch (e) { next(e); }
  });

  router.delete('/api/events/:eventId', requireAuth, (req: AuthRequest, res, next) => {
    try {
      eventService.deleteEvent(p(req.params['eventId']), uid(req));
      res.status(204).send();
    } catch (e) { next(e); }
  });

  // ─── Budget Routes (REQ-004) ──────────────────────────────────────────────
  router.get('/api/events/:eventId/budget', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const budget = budgetService.getFullBudget(p(req.params['eventId']), uid(req));
      res.json(budget);
    } catch (e) { next(e); }
  });

  router.post('/api/events/:eventId/budget/categories', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const { name, plannedMinor } = validate(CreateBudgetCategorySchema, req.body);
      const cat = budgetService.createCategory(p(req.params['eventId']), uid(req), name, plannedMinor);
      res.status(201).json({ category: cat });
    } catch (e) { next(e); }
  });

  router.patch('/api/events/:eventId/budget/categories/:catId', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const patch = validate(UpdateBudgetCategorySchema, req.body);
      const cat = budgetService.updateCategory(p(req.params['catId']), p(req.params['eventId']), uid(req), { name: patch.name, plannedMinor: patch.plannedMinor });
      res.json({ category: cat });
    } catch (e) { next(e); }
  });

  router.delete('/api/events/:eventId/budget/categories/:catId', requireAuth, (req: AuthRequest, res, next) => {
    try {
      budgetService.deleteCategory(p(req.params['catId']), p(req.params['eventId']), uid(req));
      res.status(204).send();
    } catch (e) { next(e); }
  });

  router.post('/api/events/:eventId/budget/categories/:catId/items', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const data = validate(CreateBudgetItemSchema, req.body);
      const item = budgetService.createItem(p(req.params['catId']), p(req.params['eventId']), uid(req), { label: data.label, plannedMinor: data.plannedMinor, actualMinor: data.actualMinor, note: data.note });
      res.status(201).json({ item });
    } catch (e) { next(e); }
  });

  router.patch('/api/events/:eventId/budget/categories/:catId/items/:itemId', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const patch = validate(UpdateBudgetItemSchema, req.body);
      const item = budgetService.updateItem(p(req.params['itemId']), p(req.params['catId']), p(req.params['eventId']), uid(req), { label: patch.label, plannedMinor: patch.plannedMinor, actualMinor: patch.actualMinor, note: patch.note });
      res.json({ item });
    } catch (e) { next(e); }
  });

  router.delete('/api/events/:eventId/budget/categories/:catId/items/:itemId', requireAuth, (req: AuthRequest, res, next) => {
    try {
      budgetService.deleteItem(p(req.params['itemId']), p(req.params['catId']), p(req.params['eventId']), uid(req));
      res.status(204).send();
    } catch (e) { next(e); }
  });

  // ─── Timeline Routes (REQ-005) ─────────────────────────────────────────────
  router.get('/api/events/:eventId/timeline', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const tasks = timelineService.listTasks(p(req.params['eventId']), uid(req));
      res.json({ tasks });
    } catch (e) { next(e); }
  });

  router.post('/api/events/:eventId/timeline', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const data = validate(CreateTaskSchema, req.body);
      const task = timelineService.createTask(p(req.params['eventId']), uid(req), { title: data.title, offsetDays: data.offsetDays, pinned: data.pinned, priority: data.priority, phase: data.phase });
      res.status(201).json({ task });
    } catch (e) { next(e); }
  });

  router.patch('/api/events/:eventId/timeline/:taskId', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const patch = validate(UpdateTaskSchema, req.body);
      const task = timelineService.updateTask(p(req.params['taskId']), p(req.params['eventId']), uid(req), { title: patch.title, offsetDays: patch.offsetDays, status: patch.status, pinned: patch.pinned, priority: patch.priority, phase: patch.phase });
      res.json({ task });
    } catch (e) { next(e); }
  });

  router.delete('/api/events/:eventId/timeline/:taskId', requireAuth, (req: AuthRequest, res, next) => {
    try {
      timelineService.deleteTask(p(req.params['taskId']), p(req.params['eventId']), uid(req));
      res.status(204).send();
    } catch (e) { next(e); }
  });

  // ─── Vendor Routes (REQ-006) ──────────────────────────────────────────────
  router.get('/api/events/:eventId/vendors', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const vendors = vendorService.listVendors(p(req.params['eventId']), uid(req));
      res.json({ vendors });
    } catch (e) { next(e); }
  });

  router.post('/api/events/:eventId/vendors', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const data = validate(CreateVendorSchema, req.body);
      const vendor = vendorService.createVendor(p(req.params['eventId']), uid(req), {
        category: data.category, name: data.name, status: data.status,
        contactName: data.contactName, contactEmail: data.contactEmail ?? undefined,
        contactPhone: data.contactPhone, quoteMinor: data.quoteMinor, note: data.note,
      });
      res.status(201).json({ vendor });
    } catch (e) { next(e); }
  });

  router.patch('/api/events/:eventId/vendors/:vendorId', requireAuth, (req: AuthRequest, res, next) => {
    try {
      const patch = validate(UpdateVendorSchema, req.body);
      const vendor = vendorService.updateVendor(p(req.params['vendorId']), p(req.params['eventId']), uid(req), {
        category: patch.category, name: patch.name, status: patch.status,
        contactName: patch.contactName, contactEmail: patch.contactEmail ?? undefined,
        contactPhone: patch.contactPhone, quoteMinor: patch.quoteMinor, note: patch.note,
      });
      res.json({ vendor });
    } catch (e) { next(e); }
  });

  router.delete('/api/events/:eventId/vendors/:vendorId', requireAuth, (req: AuthRequest, res, next) => {
    try {
      vendorService.deleteVendor(p(req.params['vendorId']), p(req.params['eventId']), uid(req));
      res.status(204).send();
    } catch (e) { next(e); }
  });

  return router;
}
