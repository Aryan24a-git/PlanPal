/**
 * V2-06: AI Orchestration Service.
 * SEC-004: Prompt isolation — user text wrapped in delimiters.
 * SEC-005: Per-user daily quota checked before every AI call.
 * REL-001: AI failures throw typed errors — callers fall back gracefully.
 * PERF-003: Token budget bounded, LLM never does arithmetic.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database.js';
import { prep } from '../db/statements.js';
import { MockAIProvider, type AIProvider, type GeneratePlanParams, type RefineParams, type RefineDiff } from '../ai/provider.js';
import { GroqAIProvider } from '../ai/groqProvider.js';
import { normalizeAiPlan } from '../domain/aiNormalizer.js';
import { AIDraftPlanSchema } from '../schemas/index.js';
import { AppError, AiQuotaError, AiMalformedError, AiTimeoutError, NotFoundError } from '../shared/errors.js';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import type { AIDraftPlan } from '../schemas/index.js';
import type { EventType } from '../schemas/index.js';

interface DayUsageRow { count: number; }

function createProvider(): AIProvider {
  switch (config.AI_PROVIDER) {
    case 'groq':
      logger.info(`AI provider: Groq (${config.GROQ_MODEL})`);
      return new GroqAIProvider();
    case 'mock':
    default:
      return new MockAIProvider();
  }
}

export class AIService {
  private provider: AIProvider;

  constructor(provider?: AIProvider) {
    this.provider = provider ?? createProvider();
  }

  private get db() { return getDatabase(); }

  // ─── Atomic Quota (SEC-005) ────────────────────────────────────────────────
  private getUsageToday(userId: string): number {
    const day = new Date().toISOString().slice(0, 10);
    const row = prep(this.db, 'SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(userId, day) as DayUsageRow | undefined;
    return row?.count ?? 0;
  }

  private consumeQuotaOrThrow(userId: string): void {
    const day = new Date().toISOString().slice(0, 10);
    const limit = config.AI_DAILY_QUOTA_PER_USER;

    prep(this.db, `
      INSERT INTO ai_usage (id, user_id, day, count) VALUES (?, ?, ?, 0)
      ON CONFLICT(user_id, day) DO NOTHING
    `).run(uuidv4(), userId, day);

    const res = prep(this.db, `
      UPDATE ai_usage SET count = count + 1 WHERE user_id = ? AND day = ? AND count < ?
    `).run(userId, day, limit);

    if (res.changes === 0) {
      throw new AiQuotaError(`Daily AI limit of ${limit} requests reached. Try again tomorrow.`);
    }
  }

  private rollbackQuota(userId: string): void {
    const day = new Date().toISOString().slice(0, 10);
    prep(this.db, 'UPDATE ai_usage SET count = MAX(0, count - 1) WHERE user_id = ? AND day = ?').run(userId, day);
  }

  // ─── Generate Draft Plan (REQ-003) ─────────────────────────────────────────
  async generateDraftPlan(userId: string, eventId: string): Promise<{ plan: AIDraftPlan; warnings: string[] }> {
    this.consumeQuotaOrThrow(userId);

    const event = prep(this.db, 'SELECT * FROM events WHERE id = ? AND owner_id = ?').get(eventId, userId) as {
      type: string; event_date: string; guest_estimate: number; total_budget: number; currency: string; brief: string;
    } | undefined;
    if (!event) {
      this.rollbackQuota(userId);
      throw new NotFoundError('Event not found');
    }

    const params: GeneratePlanParams = {
      eventType: event.type,
      eventDate: event.event_date,
      guestEstimate: event.guest_estimate,
      totalBudget: event.total_budget,
      currency: event.currency,
      brief: event.brief,
      userId,
    };

    let rawPlan: AIDraftPlan;
    try {
      const signal = AbortSignal.timeout(config.AI_TIMEOUT_MS);
      rawPlan = await this.provider.generateDraftPlan(params, signal);
    } catch (e) {
      this.rollbackQuota(userId);
      if (e instanceof AppError) throw e;
      logger.error('AI provider error', { action: 'generateDraftPlan', eventId });
      throw new AiTimeoutError('AI service unavailable');
    }

    // SEC-004: Validate raw output against schema
    const parsed = AIDraftPlanSchema.safeParse(rawPlan);
    if (!parsed.success) {
      this.rollbackQuota(userId);
      logger.warn('AI malformed output', { action: 'generateDraftPlan', eventId });
      throw new AiMalformedError();
    }

    // V2-03: Normalize — rescale budgets, validate task offsets
    const { plan, droppedItems, warnings } = normalizeAiPlan(
      parsed.data,
      event.total_budget,
      event.event_date,
      event.type as EventType,
    );

    if (droppedItems.length > 0) {
      logger.warn('AI plan had dropped items', { action: 'generateDraftPlan', eventId });
    }

    logger.info('AI draft plan generated', { action: 'generateDraftPlan', userId, eventId });
    return { plan, warnings };
  }

  // ─── Generate Ideas (REQ-007) ───────────────────────────────────────────────
  async generateIdeas(userId: string, eventId: string): Promise<AIDraftPlan['ideas']> {
    this.consumeQuotaOrThrow(userId);

    const event = prep(this.db, 'SELECT * FROM events WHERE id = ? AND owner_id = ?').get(eventId, userId) as {
      type: string; total_budget: number; currency: string; brief: string;
    } | undefined;
    if (!event) {
      this.rollbackQuota(userId);
      throw new NotFoundError('Event not found');
    }

    let ideas: AIDraftPlan['ideas'];
    try {
      const signal = AbortSignal.timeout(config.AI_TIMEOUT_MS);
      ideas = await this.provider.generateIdeas({
        eventType: event.type,
        brief: event.brief,
        totalBudget: event.total_budget,
        currency: event.currency,
        userId,
      }, signal);
    } catch (e) {
      this.rollbackQuota(userId);
      if (e instanceof AppError) throw e;
      throw new AiTimeoutError('AI ideas service unavailable');
    }

    // Always mark all ideas with estimate: true (DATA-001)
    const safeIdeas = ideas.map((i) => ({ ...i, estimate: true as const }));
    return safeIdeas;
  }

  // ─── Refine Diff Context Builder (Finding 6) ────────────────────────────────
  private buildPlanSummary(eventId: string): string {
    const cats = prep(
      this.db,
      'SELECT name, planned_minor FROM budget_categories WHERE event_id = ?'
    ).all(eventId) as Array<{ name: string; planned_minor: number }>;

    const tasks = prep(
      this.db,
      'SELECT title, due_date, offset_days FROM timeline_tasks WHERE event_id = ? ORDER BY offset_days DESC LIMIT 8'
    ).all(eventId) as Array<{ title: string; due_date: string; offset_days: number }>;

    const vendors = prep(
      this.db,
      'SELECT category, name, status, quote_minor FROM vendor_items WHERE event_id = ? LIMIT 8'
    ).all(eventId) as Array<{ category: string; name: string; status: string; quote_minor: number | null }>;

    const catStr = cats.length > 0
      ? `Budget Categories: ` + cats.map((c) => `${c.name} (${c.planned_minor} minor units)`).join(', ')
      : 'No budget categories configured';

    const taskStr = tasks.length > 0
      ? `Key Milestones: ` + tasks.map((t) => `${t.title} (due ${t.due_date})`).join(', ')
      : 'No timeline tasks scheduled';

    const vendorStr = vendors.length > 0
      ? `Vendor Directory: ` + vendors.map((v) => `${v.category}: ${v.name} [status: ${v.status}${v.quote_minor ? `, quote: ${v.quote_minor}` : ''}]`).join(', ')
      : 'No vendors listed';

    return `${catStr}. ${taskStr}. ${vendorStr}.`.slice(0, 1500);
  }

  // ─── Refine Diff (REQ-010) ──────────────────────────────────────────────────
  async generateRefineDiff(userId: string, eventId: string, instruction: string) {
    this.consumeQuotaOrThrow(userId);

    const event = prep(this.db, 'SELECT * FROM events WHERE id = ? AND owner_id = ?').get(eventId, userId) as { type: string } | undefined;
    if (!event) {
      this.rollbackQuota(userId);
      throw new NotFoundError('Event not found');
    }

    const params: RefineParams = {
      eventType: event.type,
      currentPlanSummary: this.buildPlanSummary(eventId),
      instruction: instruction.slice(0, 500),
      userId,
    };

    let diff: RefineDiff;
    try {
      const signal = AbortSignal.timeout(config.AI_TIMEOUT_MS);
      diff = await this.provider.generateRefineDiff(params, signal);
    } catch (e) {
      this.rollbackQuota(userId);
      if (e instanceof AppError) throw e;
      throw new AiTimeoutError('AI refine service unavailable');
    }

    // REQ-010: Return diff proposal — NEVER auto-apply
    return { diff, autoApplied: false };
  }

  getUsageSummary(userId: string): { used: number; quota: number; remaining: number } {
    const used = this.getUsageToday(userId);
    const quota = config.AI_DAILY_QUOTA_PER_USER;
    return { used, quota, remaining: Math.max(0, quota - used) };
  }
}
