/**
 * V2-01: Shared AppError hierarchy
 * Used by every route handler to produce consistent JSON envelopes.
 * Zero I/O - pure error definitions.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_TIMEOUT'
  | 'AI_MALFORMED'
  | 'INTERNAL_ERROR';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: Record<string, string[]>;
    retryAfter?: number;
  };
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly fieldErrors?: Record<string, string[]>,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
        ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super('VALIDATION_ERROR', message, 400, fieldErrors);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
    this.name = 'ConflictError';
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfter: number, message = 'Too many requests') {
    super('RATE_LIMITED', message, 429, undefined, retryAfter);
    this.name = 'RateLimitedError';
  }
}

export class AiQuotaError extends AppError {
  constructor(message: string, retryAfter?: number) {
    super('AI_QUOTA_EXCEEDED', message, 429, undefined, retryAfter);
    this.name = 'AiQuotaError';
  }
}

export class AiTimeoutError extends AppError {
  constructor(message = 'AI service timed out') {
    super('AI_TIMEOUT', message, 504);
    this.name = 'AiTimeoutError';
  }
}

export class AiMalformedError extends AppError {
  constructor(message = 'AI returned an unrecognisable response') {
    super('AI_MALFORMED', message, 502);
    this.name = 'AiMalformedError';
  }
}
