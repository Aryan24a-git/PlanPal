/**
 * Zod schema for all API boundaries (V2-01, V2-05, SEC-003).
 * Single source of truth for validation and TypeScript types.
 */
import { z } from 'zod';

// ─── Domain Enums ────────────────────────────────────────────────────────────
export const EventTypeSchema = z.enum(['wedding', 'birthday', 'community']);
export type EventType = z.infer<typeof EventTypeSchema>;

export const CurrencySchema = z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR']);
export type Currency = z.infer<typeof CurrencySchema>;

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'completed']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const VendorStatusSchema = z.enum(['to_contact', 'contacted', 'quoted', 'booked', 'declined']);
export type VendorStatus = z.infer<typeof VendorStatusSchema>;

export const IdeaCategorySchema = z.enum(['theme', 'activity', 'menu', 'decor']);
export type IdeaCategory = z.infer<typeof IdeaCategorySchema>;

export const IdeaStateSchema = z.enum(['suggested', 'saved', 'dismissed']);
export type IdeaState = z.infer<typeof IdeaStateSchema>;

export const TaskPrioritySchema = z.enum(['low', 'medium', 'high']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

// ─── Auth Schemas (SEC-003, SEC-001) ─────────────────────────────────────────
export const RegisterSchema = z.object({
  email: z.string().trim().email('Invalid email').max(100),
  // V2-04: password policy ≥10 chars, max 72 bytes (bcrypt truncation limit)
  password: z.string().min(10, 'Password must be at least 10 characters').max(72, 'Password cannot exceed 72 characters'),
  name: z.string().trim().min(1, 'Name is required').max(100),
});

export const LoginSchema = z.object({
  email: z.string().trim().email().max(100),
  password: z.string().min(1).max(72),
});

// ─── Event Schemas ────────────────────────────────────────────────────────────
// Finding 22: Base schema without defaults prevents partial updates from silently resetting fields
const BaseEventSchema = z.object({
  type: EventTypeSchema,
  name: z.string().trim().min(2, 'Name too short').max(120),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  guestEstimate: z.number().int().min(1).max(50000),
  totalBudget: z.number().int().min(0).max(1_000_000_000),
  currency: CurrencySchema,
  brief: z.string().trim().min(10, 'Brief too short').max(2000),
});

export const CreateEventSchema = BaseEventSchema.extend({
  currency: CurrencySchema.default('USD'),
});
export type CreateEventInput = z.infer<typeof CreateEventSchema>;

export const UpdateEventSchema = BaseEventSchema.partial();
export type UpdateEventInput = z.infer<typeof UpdateEventSchema>;

// ─── Budget Schemas ───────────────────────────────────────────────────────────
export const CreateBudgetCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  plannedMinor: z.number().int().min(0),
});

export const UpdateBudgetCategorySchema = CreateBudgetCategorySchema.partial();

export const CreateBudgetItemSchema = z.object({
  label: z.string().trim().min(1).max(100),
  plannedMinor: z.number().int().min(0),
  actualMinor: z.number().int().min(0).optional(),
  note: z.string().trim().max(500).optional(),
});

export const UpdateBudgetItemSchema = CreateBudgetItemSchema.partial();

// ─── Timeline Schemas ─────────────────────────────────────────────────────────
export const CreateTaskSchema = z.object({
  title: z.string().trim().min(2).max(150),
  offsetDays: z.number().int().min(0).max(3650),
  pinned: z.boolean().default(false),
  priority: TaskPrioritySchema.default('medium'),
  phase: z.string().trim().max(60).optional(),
});

export const UpdateTaskSchema = z.object({
  title: z.string().trim().min(2).max(150).optional(),
  offsetDays: z.number().int().min(0).max(3650).optional(),
  status: TaskStatusSchema.optional(),
  pinned: z.boolean().optional(),
  priority: TaskPrioritySchema.optional(),
  phase: z.string().trim().max(60).optional(),
});

// ─── Vendor Schemas ───────────────────────────────────────────────────────────
export const CreateVendorSchema = z.object({
  category: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(120),
  status: VendorStatusSchema.default('to_contact'),
  contactName: z.string().trim().max(100).optional(),
  contactEmail: z.string().trim().email().max(100).optional().or(z.literal('')),
  contactPhone: z.string().trim().max(30).optional(),
  quoteMinor: z.number().int().min(0).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const UpdateVendorSchema = CreateVendorSchema.partial();

// ─── Idea Schemas ─────────────────────────────────────────────────────────────
export const UpdateIdeaStateSchema = z.object({
  state: IdeaStateSchema,
});

// ─── AI Schemas ───────────────────────────────────────────────────────────────
// SEC-004: bounded refine instruction
export const AIRefineRequestSchema = z.object({
  instruction: z.string().trim().min(3).max(500),
});

// AI Draft output schema — validated before any persistence (Finding 25 bounds)
export const AIDraftBudgetItemSchema = z.object({
  name: z.string().min(1).max(100),
  plannedAmount: z.number().int().min(0).max(1_000_000_000),
});

export const AIDraftCategorySchema = z.object({
  name: z.string().min(1).max(80),
  allocatedAmount: z.number().int().min(0).max(1_000_000_000),
  items: z.array(AIDraftBudgetItemSchema).max(50),
});

export const AIDraftTaskSchema = z.object({
  title: z.string().min(2).max(150),
  daysBeforeEvent: z.number().int().min(0).max(3650),
  priority: TaskPrioritySchema.default('medium'),
});

export const AIDraftVendorSchema = z.object({
  category: z.string().min(2).max(80),
  name: z.string().min(2).max(120),
  notes: z.string().max(1000).optional(),
});

export const AIDraftIdeaSchema = z.object({
  category: IdeaCategorySchema,
  title: z.string().min(2).max(120),
  description: z.string().min(5).max(1000),
  estLowMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  estHighMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  estimate: z.literal(true).default(true), // DATA-001: always flagged as estimate
});

export const AIDraftPlanSchema = z.object({
  budgetCategories: z.array(AIDraftCategorySchema).max(30),
  timelineTasks: z.array(AIDraftTaskSchema).max(100),
  vendorChecklist: z.array(AIDraftVendorSchema).max(50),
  ideas: z.array(AIDraftIdeaSchema).max(20),
});
export type AIDraftPlan = z.infer<typeof AIDraftPlanSchema>;

// Pagination query
export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
