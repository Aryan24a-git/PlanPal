/**
 * V2-06: Groq AI Provider — OpenAI-compatible chat completions via Groq Cloud.
 * Uses llama-3.3-70b-versatile model for structured event planning outputs.
 * SEC-004: User text wrapped in delimiters; output schema-validated.
 * PERF-003: Token budget bounded by config.AI_MAX_TOKENS.
 */
import type {
  AIProvider,
  GeneratePlanParams,
  GenerateIdeasParams,
  RefineParams,
  RefineDiff,
} from './provider.js';
import type { AIDraftPlan } from '../schemas/index.js';
import { config } from '../shared/config.js';
import { logger } from '../shared/logger.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

async function callGroq(messages: GroqMessage[], maxTokens: number): Promise<string> {
  const apiKey = config.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set in environment');
  }

  const body = {
    model: config.GROQ_MODEL,
    messages,
    temperature: 0.7,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  };

  const resp = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => 'unknown error');
    logger.error('Groq API error', { status: resp.status });
    throw new Error(`Groq API returned ${resp.status}: ${errText}`);
  }

  const data = (await resp.json()) as GroqResponse;
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error('Groq returned empty response');

  if (data.usage) {
    logger.info('Groq tokens used', {
      prompt: data.usage.prompt_tokens,
      completion: data.usage.completion_tokens,
      total: data.usage.total_tokens,
    });
  }

  return content;
}

function sanitizeIdeaCategory(cat: string): 'theme' | 'activity' | 'menu' | 'decor' {
  const lower = (cat || '').toLowerCase();
  if (lower.includes('theme') || lower.includes('style')) return 'theme';
  if (lower.includes('activ') || lower.includes('game') || lower.includes('entertain') || lower.includes('gift')) return 'activity';
  if (lower.includes('menu') || lower.includes('food') || lower.includes('drink') || lower.includes('cater')) return 'menu';
  if (lower.includes('decor') || lower.includes('photo') || lower.includes('flower')) return 'decor';
  return 'theme';
}

function buildDraftPlanPrompt(p: GeneratePlanParams): GroqMessage[] {
  return [
    {
      role: 'system',
      content: `You are PlanPal AI, an expert event planning assistant. You generate structured JSON event plans.
RULES:
- All monetary amounts are in MINOR UNITS (cents). 1 dollar = 100 cents.
- Budget category allocations MUST sum exactly to totalBudget.
- Each category must have at least 1 line item.
- Timeline tasks have daysBeforeEvent (positive integer) and priority (low/medium/high).
- Vendor checklist has category, name, and optional notes.
- Ideas category MUST be one of: "theme", "activity", "menu", "decor".
- Ideas have category, title, description, and optional estLowMinor/estHighMinor.
- Return ONLY valid JSON matching this exact schema:
{
  "budgetCategories": [{"name": "string", "allocatedAmount": number, "items": [{"name": "string", "plannedAmount": number}]}],
  "timelineTasks": [{"title": "string", "daysBeforeEvent": number, "priority": "low"|"medium"|"high"}],
  "vendorChecklist": [{"category": "string", "name": "string", "notes": "string"}],
  "ideas": [{"category": "theme"|"activity"|"menu"|"decor", "title": "string", "description": "string", "estLowMinor": number, "estHighMinor": number, "estimate": true}]
}`,
    },
    {
      role: 'user',
      content: `Create a comprehensive JSON event plan for:
- Event Type: ${p.eventType}
- Event Date: ${p.eventDate}
- Guest Estimate: ${p.guestEstimate}
- Total Budget: ${p.totalBudget} minor units (${p.currency})
- Vision & Brief: ${p.brief}

Generate 4-6 budget categories, 5-8 timeline tasks, 3-5 vendors, and 2-3 creative ideas. Output only valid JSON.`,
    },
  ];
}

function buildIdeasPrompt(p: GenerateIdeasParams): GroqMessage[] {
  return [
    {
      role: 'system',
      content: `You are PlanPal AI. Generate creative, personalized event ideas.
Return ONLY valid JSON: {"ideas": [{"category": "theme"|"activity"|"menu"|"decor", "title": "string", "description": "string", "estLowMinor": number, "estHighMinor": number, "estimate": true}]}
All cost estimates in minor units (cents). Categories MUST be one of: "theme", "activity", "menu", "decor".`,
    },
    {
      role: 'user',
      content: `Generate 3-4 creative ideas for a ${p.eventType} event.
Budget: ${p.totalBudget} minor units (${p.currency}).
Vision: ${p.brief}`,
    },
  ];
}

function buildRefinePrompt(p: RefineParams): GroqMessage[] {
  return [
    {
      role: 'system',
      content: `You are PlanPal AI. Given a user refinement instruction, return a diff proposal.
Return ONLY valid JSON:
{"changes": [{"section": "budget"|"timeline"|"vendors", "action": "add"|"remove"|"update", "description": "string"}], "rationale": "string"}
Never auto-apply changes. Explain each proposed change clearly.`,
    },
    {
      role: 'user',
      content: `Current plan context: ${p.currentPlanSummary}
Event type: ${p.eventType}
User instruction: ${p.instruction}

Propose specific changes.`,
    },
  ];
}

export class GroqAIProvider implements AIProvider {
  async generateDraftPlan(p: GeneratePlanParams): Promise<AIDraftPlan> {
    const raw = await callGroq(buildDraftPlanPrompt(p), config.AI_MAX_TOKENS);
    const parsed = JSON.parse(raw) as AIDraftPlan;
    if (Array.isArray(parsed.ideas)) {
      parsed.ideas = parsed.ideas.map((idea) => ({
        ...idea,
        category: sanitizeIdeaCategory(idea.category),
        estimate: true as const,
      }));
    }
    return parsed;
  }

  async generateIdeas(p: GenerateIdeasParams): Promise<AIDraftPlan['ideas']> {
    const raw = await callGroq(buildIdeasPrompt(p), config.AI_MAX_TOKENS);
    const parsed = JSON.parse(raw) as { ideas: AIDraftPlan['ideas'] };
    const ideas = parsed.ideas ?? [];
    return ideas.map((idea) => ({
      ...idea,
      category: sanitizeIdeaCategory(idea.category),
      estimate: true as const,
    }));
  }

  async generateRefineDiff(p: RefineParams): Promise<RefineDiff> {
    const raw = await callGroq(buildRefinePrompt(p), config.AI_MAX_TOKENS);
    const parsed = JSON.parse(raw) as RefineDiff;
    return parsed;
  }
}
