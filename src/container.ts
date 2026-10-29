/**
 * Q6: Composition Root & Dependency Injection Container.
 * Creates and connects all service singletons in a single declarative place.
 */
import { AuthService } from './services/authService.js';
import { EventService } from './services/eventService.js';
import { BudgetService } from './services/budgetService.js';
import { TimelineService } from './services/timelineService.js';
import { VendorService } from './services/vendorService.js';
import { PlanService, IdeaService } from './services/planService.js';
import { AIService } from './services/aiService.js';
import { createRequireAuth } from './middleware/auth.js';

export interface Container {
  authService: AuthService;
  vendorService: VendorService;
  eventService: EventService;
  budgetService: BudgetService;
  timelineService: TimelineService;
  ideaService: IdeaService;
  planService: PlanService;
  aiService: AIService;
  requireAuth: ReturnType<typeof createRequireAuth>;
}

export function createContainer(): Container {
  const authService = new AuthService();
  const requireAuth = createRequireAuth(authService);
  const vendorService = new VendorService();
  const eventService = new EventService(vendorService);
  const budgetService = new BudgetService();
  const timelineService = new TimelineService();
  const ideaService = new IdeaService();
  const planService = new PlanService();
  const aiService = new AIService();

  return {
    authService,
    requireAuth,
    vendorService,
    eventService,
    budgetService,
    timelineService,
    ideaService,
    planService,
    aiService,
  };
}
