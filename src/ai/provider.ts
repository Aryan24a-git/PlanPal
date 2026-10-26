/**
 * V2-06: AI Provider interface and MockAIProvider.
 * SEC-004: Prompt isolation with delimited user content.
 * REL-001: AI failure never blocks manual planning.
 * PERF-003: Token estimation, bounded outputs.
 */
import type { AIDraftPlan } from '../schemas/index.js';

export interface AIProvider {
  generateDraftPlan(params: GeneratePlanParams): Promise<AIDraftPlan>;
  generateIdeas(params: GenerateIdeasParams): Promise<AIDraftPlan['ideas']>;
  generateRefineDiff(params: RefineParams): Promise<RefineDiff>;
}

export interface GeneratePlanParams {
  eventType: string;
  eventDate: string;
  guestEstimate: number;
  totalBudget: number;
  currency: string;
  brief: string;         // SEC-004: delimited before sending
  userId: string;        // for logging only — never included in prompt
}

export interface GenerateIdeasParams {
  eventType: string;
  brief: string;
  totalBudget: number;
  currency: string;
  userId: string;
}

export interface RefineParams {
  eventType: string;
  currentPlanSummary: string;
  instruction: string;   // SEC-004: delimited
  userId: string;
}

export interface RefineDiff {
  changes: Array<{
    section: 'budget' | 'timeline' | 'vendors';
    action: 'add' | 'remove' | 'update';
    description: string;
  }>;
  rationale: string;
}

// ─── Mock Provider (REL-001, test support) ───────────────────────────────────

export class MockAIProvider implements AIProvider {
  async generateDraftPlan(p: GeneratePlanParams): Promise<AIDraftPlan> {
    const half = Math.floor(p.totalBudget / 2);
    const quarter = Math.floor(p.totalBudget / 4);
    const rest = p.totalBudget - half - quarter;

    return {
      budgetCategories: [
        {
          name: 'Venue', allocatedAmount: half,
          items: [{ name: 'Venue rental', plannedAmount: half }],
        },
        {
          name: 'Catering', allocatedAmount: quarter,
          items: [{ name: 'Food & beverage', plannedAmount: quarter }],
        },
        {
          name: 'Other', allocatedAmount: rest,
          items: [{ name: 'Miscellaneous', plannedAmount: rest }],
        },
      ],
      timelineTasks: [
        { title: 'Set overall vision & style', daysBeforeEvent: 180, priority: 'high' },
        { title: 'Book venue', daysBeforeEvent: 120, priority: 'high' },
        { title: 'Send invitations', daysBeforeEvent: 60, priority: 'medium' },
        { title: 'Confirm catering', daysBeforeEvent: 30, priority: 'medium' },
        { title: 'Final headcount confirmation', daysBeforeEvent: 7, priority: 'high' },
      ],
      vendorChecklist: [
        { category: 'Venue & Reception', name: 'TBD Venue', notes: 'Get quotes from 3 venues' },
        { category: 'Catering & Bar', name: 'TBD Caterer', notes: 'Request tasting before booking' },
      ],
      ideas: [
        {
          category: 'theme',
          title: 'Garden Party Theme',
          description: `A lush outdoor setting with wildflower arrangements and rustic wooden accents. ${p.brief.slice(0, 50)}`,
          estLowMinor: Math.floor(p.totalBudget * 0.05),
          estHighMinor: Math.floor(p.totalBudget * 0.10),
          estimate: true,
        },
        {
          category: 'activity',
          title: 'Photo Booth Corner',
          description: 'A dedicated area with props and a backdrop for fun group photos.',
          estLowMinor: 5000,
          estHighMinor: 15000,
          estimate: true,
        },
      ],
    };
  }

  async generateIdeas(p: GenerateIdeasParams): Promise<AIDraftPlan['ideas']> {
    return [
      {
        category: 'menu',
        title: 'Themed Food Stations',
        description: `Interactive food stations aligned with your ${p.eventType} theme.`,
        estLowMinor: 10000,
        estHighMinor: 30000,
        estimate: true,
      },
      {
        category: 'decor',
        title: 'Personalised Centrepieces',
        description: 'Custom centrepieces that double as guest take-aways.',
        estLowMinor: 3000,
        estHighMinor: 8000,
        estimate: true,
      },
    ];
  }

  async generateRefineDiff(p: RefineParams): Promise<RefineDiff> {
    return {
      changes: [
        {
          section: 'budget',
          action: 'update',
          description: `Based on: "${p.instruction.slice(0, 80)}" — consider adjusting venue allocation by 10%.`,
        },
      ],
      rationale: 'Adjustment suggested based on your instruction. All figures are estimates — review and approve before applying.',
    };
  }
}
