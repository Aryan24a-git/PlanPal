/**
 * Q2: Shared HTTP route helpers — parameter sanitization, auth context, and schema validation.
 */
import type { Request } from 'express';
import type { ZodType } from 'zod';
import type { AuthRequest } from '../middleware/auth.js';
import { ValidationError, UnauthorizedError } from '../shared/errors.js';

export const param = (req: Request, k: string): string => {
  const val = req.params[k];
  if (Array.isArray(val)) return val[0] ?? '';
  return val ?? '';
};

export function currentUserId(req: AuthRequest): string {
  if (!req.userId) {
    throw new UnauthorizedError('requireAuth must precede this route');
  }
  return req.userId;
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
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
