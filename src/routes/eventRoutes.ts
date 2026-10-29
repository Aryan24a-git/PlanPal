/**
 * Event, Budget, Timeline, and Vendor Routes.
 * REQ-002, REQ-004, REQ-005, REQ-006, REQ-008, REQ-009, SEC-002, SEC-003.
 */
import { Router } from 'express';
import { type AuthRequest } from '../middleware/auth.js';
import type { Container } from '../container.js';
import {
  CreateEventSchema, UpdateEventSchema,
  CreateBudgetCategorySchema, UpdateBudgetCategorySchema,
  CreateBudgetItemSchema, UpdateBudgetItemSchema,
  CreateTaskSchema, UpdateTaskSchema,
  CreateVendorSchema, UpdateVendorSchema,
  PaginationSchema,
} from '../schemas/index.js';
import { param, currentUserId, parse } from './helpers.js';

export function createEventRouter(c: Container): Router {
  const router = Router();
  const { eventService, budgetService, timelineService, vendorService, requireAuth } = c;

  // ─── Event Routes (REQ-002, REQ-008, REQ-009) ───────────────────────────────
  router.get('/api/events', requireAuth, (req: AuthRequest, res) => {
    const { limit, offset } = parse(PaginationSchema, req.query);
    const ownerId = currentUserId(req);
    const events = eventService.listEventsSummary(ownerId, limit, offset);
    const total = eventService.countEvents(ownerId);
    res.json({ events, total, limit, offset });
  });

  router.post('/api/events', requireAuth, (req: AuthRequest, res) => {
    const input = parse(CreateEventSchema, req.body);
    const event = eventService.createEvent(currentUserId(req), input);
    res.status(201).json({ event });
  });

  router.get('/api/events/:eventId', requireAuth, (req: AuthRequest, res) => {
    const event = eventService.getEventOrThrow(param(req, 'eventId'), currentUserId(req));
    res.json({ event });
  });

  router.patch('/api/events/:eventId', requireAuth, (req: AuthRequest, res) => {
    const input = parse(UpdateEventSchema, req.body);
    const event = eventService.updateEvent(param(req, 'eventId'), currentUserId(req), input);
    res.json({ event });
  });

  router.delete('/api/events/:eventId', requireAuth, (req: AuthRequest, res) => {
    eventService.deleteEvent(param(req, 'eventId'), currentUserId(req));
    res.status(204).send();
  });

  // ─── Budget Routes (REQ-004) ──────────────────────────────────────────────
  router.get('/api/events/:eventId/budget', requireAuth, (req: AuthRequest, res) => {
    const budget = budgetService.getFullBudget(param(req, 'eventId'), currentUserId(req));
    res.json(budget);
  });

  router.post('/api/events/:eventId/budget/categories', requireAuth, (req: AuthRequest, res) => {
    const { name, plannedMinor } = parse(CreateBudgetCategorySchema, req.body);
    const cat = budgetService.createCategory(param(req, 'eventId'), currentUserId(req), name, plannedMinor);
    res.status(201).json({ category: cat });
  });

  router.patch('/api/events/:eventId/budget/categories/:catId', requireAuth, (req: AuthRequest, res) => {
    const patch = parse(UpdateBudgetCategorySchema, req.body);
    const cat = budgetService.updateCategory(param(req, 'catId'), param(req, 'eventId'), currentUserId(req), { name: patch.name, plannedMinor: patch.plannedMinor });
    res.json({ category: cat });
  });

  router.delete('/api/events/:eventId/budget/categories/:catId', requireAuth, (req: AuthRequest, res) => {
    budgetService.deleteCategory(param(req, 'catId'), param(req, 'eventId'), currentUserId(req));
    res.status(204).send();
  });

  router.post('/api/events/:eventId/budget/categories/:catId/items', requireAuth, (req: AuthRequest, res) => {
    const data = parse(CreateBudgetItemSchema, req.body);
    const item = budgetService.createItem(param(req, 'catId'), param(req, 'eventId'), currentUserId(req), { label: data.label, plannedMinor: data.plannedMinor, actualMinor: data.actualMinor, note: data.note });
    res.status(201).json({ item });
  });

  router.patch('/api/events/:eventId/budget/categories/:catId/items/:itemId', requireAuth, (req: AuthRequest, res) => {
    const patch = parse(UpdateBudgetItemSchema, req.body);
    const item = budgetService.updateItem(param(req, 'itemId'), param(req, 'catId'), param(req, 'eventId'), currentUserId(req), { label: patch.label, plannedMinor: patch.plannedMinor, actualMinor: patch.actualMinor, note: patch.note });
    res.json({ item });
  });

  router.delete('/api/events/:eventId/budget/categories/:catId/items/:itemId', requireAuth, (req: AuthRequest, res) => {
    budgetService.deleteItem(param(req, 'itemId'), param(req, 'catId'), param(req, 'eventId'), currentUserId(req));
    res.status(204).send();
  });

  // ─── Timeline Routes (REQ-005) ─────────────────────────────────────────────
  router.get('/api/events/:eventId/timeline', requireAuth, (req: AuthRequest, res) => {
    const tasks = timelineService.listTasks(param(req, 'eventId'), currentUserId(req));
    res.json({ tasks });
  });

  router.post('/api/events/:eventId/timeline', requireAuth, (req: AuthRequest, res) => {
    const data = parse(CreateTaskSchema, req.body);
    const task = timelineService.createTask(param(req, 'eventId'), currentUserId(req), { title: data.title, offsetDays: data.offsetDays, pinned: data.pinned, priority: data.priority, phase: data.phase });
    res.status(201).json({ task });
  });

  router.patch('/api/events/:eventId/timeline/:taskId', requireAuth, (req: AuthRequest, res) => {
    const patch = parse(UpdateTaskSchema, req.body);
    const task = timelineService.updateTask(param(req, 'taskId'), param(req, 'eventId'), currentUserId(req), { title: patch.title, offsetDays: patch.offsetDays, status: patch.status, pinned: patch.pinned, priority: patch.priority, phase: patch.phase });
    res.json({ task });
  });

  router.delete('/api/events/:eventId/timeline/:taskId', requireAuth, (req: AuthRequest, res) => {
    timelineService.deleteTask(param(req, 'taskId'), param(req, 'eventId'), currentUserId(req));
    res.status(204).send();
  });

  // ─── Vendor Routes (REQ-006) ──────────────────────────────────────────────
  router.get('/api/events/:eventId/vendors', requireAuth, (req: AuthRequest, res) => {
    const vendors = vendorService.listVendors(param(req, 'eventId'), currentUserId(req));
    res.json({ vendors });
  });

  router.post('/api/events/:eventId/vendors', requireAuth, (req: AuthRequest, res) => {
    const data = parse(CreateVendorSchema, req.body);
    const vendor = vendorService.createVendor(param(req, 'eventId'), currentUserId(req), {
      category: data.category, name: data.name, status: data.status,
      contactName: data.contactName, contactEmail: data.contactEmail ?? undefined,
      contactPhone: data.contactPhone, quoteMinor: data.quoteMinor, note: data.note,
    });
    res.status(201).json({ vendor });
  });

  router.patch('/api/events/:eventId/vendors/:vendorId', requireAuth, (req: AuthRequest, res) => {
    const patch = parse(UpdateVendorSchema, req.body);
    const vendor = vendorService.updateVendor(param(req, 'vendorId'), param(req, 'eventId'), currentUserId(req), {
      category: patch.category, name: patch.name, status: patch.status,
      contactName: patch.contactName, contactEmail: patch.contactEmail ?? undefined,
      contactPhone: patch.contactPhone, quoteMinor: patch.quoteMinor, note: patch.note,
    });
    res.json({ vendor });
  });

  router.delete('/api/events/:eventId/vendors/:vendorId', requireAuth, (req: AuthRequest, res) => {
    vendorService.deleteVendor(param(req, 'vendorId'), param(req, 'eventId'), currentUserId(req));
    res.status(204).send();
  });

  return router;
}
