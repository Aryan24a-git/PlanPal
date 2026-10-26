/**
 * V2-06: AI Orchestration Service.
 * SEC-004: Prompt isolation — user text wrapped in delimiters.
 * SEC-005: Per-user daily quota checked before every AI call.
 * REL-001: AI failures throw typed errors — callers fall back gracefully.
 * PERF-003: Token budget bounded, LLM never does arithmetic.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database.js';
import { MockAIProvider, type AIProvider, type GeneratePlanParams, type RefineParams } from '../ai/provider.js';
import { GroqAIProvider } from '../ai/groqProvider.js';
import { normalizeAiPlan } from '../domain/aiNormalizer.js';
import { AIDraftPlanSchema } from '../schemas/index.js';
import { AiQuotaError, AiMalformedError, AiTimeoutError, NotFoundError } from '../shared/errors.js';
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
    case 'anthropic':
    case 'openai':
      logger.warn(`AI provider "${config.AI_PROVIDER}" not yet implemented, falling back to mock`);
      return new MockAIProvider();
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

  // ─── Quota (SEC-005) ────────────────────────────────────────────────────────
  private getUsageToday(userId: string): number {
    const day = new Date().toISOString().slice(0, 10);
    const row = this.db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(userId, day) as DayUsageRow | undefined;
    return row?.count ?? 0;
  }

  private incrementUsage(userId: string): void {
    const day = new Date().toISOString().slice(0, 10);
    this.db.prepare(`
      INSERT INTO ai_usage (id, user_id, day, count) VALUES (?, ?, ?, 1)
      ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1
    `).run(uuidv4(), userId, day);
  }

  private checkQuota(userId: string): void {
    const used = this.getUsageToday(userId);
    if (used >= config.AI_DAILY_QUOTA_PER_USER) {
      throw new AiQuotaError(
        `Daily AI limit of ${config.AI_DAILY_QUOTA_PER_USER} requests reached. Try again tomorrow.`,
      );
    }
  }

  // ─── Generate Draft Plan (REQ-003) ─────────────────────────────────────────
  async generateDraftPlan(userId: string, eventId: string): Promise<{ plan: AIDraftPlan; warnings: string[] }> {
    this.checkQuota(userId);

    const event = this.db.prepare('SELECT * FROM events WHERE id = ? AND owner_id = ?').get(eventId, userId) as {
      type: string; event_date: string; guest_estimate: number; total_budget: number; currency: string; brief: string;
    } | undefined;
    if (!event) throw new NotFoundError('Event not found');

    const params: GeneratePlanParams = {
      eventType: event.type,
      eventDate: event.event_date,
      guestEstimate: event.guest_estimate,
      totalBudget: event.total_budget,
      currency: event.currency,
      // SEC-004: wrap brief in delimiters to isolate from prompt
      brief: `[USER_BRIEF_START]${event.brief}[USER_BRIEF_END]`,
      userId,
    };

    let rawPlan: AIDraftPlan;
    try {
      const result = await Promise.race([
        this.provider.generateDraftPlan(params),
        new Promise<never>((_, rej) => setTimeout(() => rej(new AiTimeoutError()), config.AI_TIMEOUT_MS)),
      ]);
      rawPlan = result;
    } catch (e) {
      if (e instanceof AiTimeoutError || e instanceof AiQuotaError) throw e;
      logger.error('AI provider error', { action: 'generateDraftPlan', eventId });
      throw new AiTimeoutError('AI service unavailable');
    }

    // SEC-004: Validate raw output against schema
    const parsed = AIDraftPlanSchema.safeParse(rawPlan);
    if (!parsed.success) {
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

    this.incrementUsage(userId);
    logger.info('AI draft plan generated', { action: 'generateDraftPlan', userId, eventId, tokenEstimate: JSON.stringify(plan).length });
    return { plan, warnings };
  }

  // ─── Generate Ideas (REQ-007) ───────────────────────────────────────────────
  async generateIdeas(userId: string, eventId: string): Promise<AIDraftPlan['ideas']> {
    this.checkQuota(userId);

    const event = this.db.prepare('SELECT * FROM events WHERE id = ? AND owner_id = ?').get(eventId, userId) as {
      type: string; total_budget: number; currency: string; brief: string;
    } | undefined;
    if (!event) throw new NotFoundError('Event not found');

    let ideas: AIDraftPlan['ideas'];
    try {
      ideas = await Promise.race([
        this.provider.generateIdeas({
          eventType: event.type,
          brief: `[USER_BRIEF_START]${event.brief}[USER_BRIEF_END]`,
          totalBudget: event.total_budget,
          currency: event.currency,
          userId,
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new AiTimeoutError()), config.AI_TIMEOUT_MS)),
      ]);
    } catch (e) {
      if (e instanceof AiTimeoutError || e instanceof AiQuotaError) throw e;
      throw new AiTimeoutError('AI ideas service unavailable');
    }

    // Always mark all ideas with estimate: true (DATA-001)
    const safeIdeas = ideas.map((i) => ({ ...i, estimate: true as const }));
    this.incrementUsage(userId);
    return safeIdeas;
  }

  // ─── Refine Diff (REQ-010) ──────────────────────────────────────────────────
  async generateRefineDiff(userId: string, eventId: string, instruction: string) {
    this.checkQuota(userId);

    const event = this.db.prepare('SELECT * FROM events WHERE id = ? AND owner_id = ?').get(eventId, userId) as { type: string } | undefined;
    if (!event) throw new NotFoundError('Event not found');

    const params: RefineParams = {
      eventType: event.type,
      currentPlanSummary: `Event ID: ${eventId}`,
      // SEC-004: delimit the instruction
      instruction: `[INSTRUCTION_START]${instruction.slice(0, 500)}[INSTRUCTION_END]`,
      userId,
    };

    const diff = await Promise.race([
      this.provider.generateRefineDiff(params),
      new Promise<never>((_, rej) => setTimeout(() => rej(new AiTimeoutError()), config.AI_TIMEOUT_MS)),
    ]).catch((e) => {
      if (e instanceof AiTimeoutError || e instanceof AiQuotaError) throw e;
      throw new AiTimeoutError('AI refine service unavailable');
    });

    this.incrementUsage(userId);
    // REQ-010: Return diff proposal — NEVER auto-apply
    return { diff, autoApplied: false };
  }

  getUsageSummary(userId: string): { used: number; quota: number; remaining: number } {
    const used = this.getUsageToday(userId);
    const quota = config.AI_DAILY_QUOTA_PER_USER;
    return { used, quota, remaining: Math.max(0, quota - used) };
  }
}
