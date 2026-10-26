/**
 * V2-01: Zod-validated server config with fail-fast startup.
 * SEC-007: No secrets committed; all from environment.
 * Server-only module — never import from frontend code.
 */
import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  AI_PROVIDER: z.enum(['mock', 'groq']).default('mock'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  AI_DAILY_QUOTA_PER_USER: z.coerce.number().int().min(1).max(1000).default(20),
  SESSION_MAX_AGE_SEC: z.coerce.number().int().min(300).default(86400),
  DATABASE_URL: z.string().min(1).default('./data/planpal.db'),
  AI_MAX_TOKENS: z.coerce.number().int().min(100).max(8000).default(2000),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(30000),
  CORS_ORIGIN: z.string().optional(),
}).superRefine((c, ctx) => {
  if (c.AI_PROVIDER === 'groq' && !c.GROQ_API_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['GROQ_API_KEY'],
      message: 'required when AI_PROVIDER=groq',
    });
  }
});

export type AppConfig = z.infer<typeof ConfigSchema>;

const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'super-secret-dev-jwt-key-replace-in-prod-minimum-32-chars-length',
  'production-secret-key-replace-in-env-vault-min-32-chars',
  'change-this-in-production-min-32-chars',
  'your-super-secret-jwt-key-minimum-32-chars-length'
]);

function loadConfig(): AppConfig {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((e) => `  ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if ((result.data.NODE_ENV === 'production' || result.data.NODE_ENV === 'staging') && KNOWN_PLACEHOLDER_SECRETS.has(result.data.JWT_SECRET)) {
    throw new Error('JWT_SECRET must not use a known default or placeholder secret in production or staging.');
  }
  return result.data;
}

// Singleton — evaluated once at startup
export const config: AppConfig = loadConfig();
