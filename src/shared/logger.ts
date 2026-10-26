/**
 * V2-01: Structured JSON logger with redaction allow-list.
 * SEC-008: NEVER log passwords, tokens, API keys, brief text, or cookies.
 * OBS-001: Every request log includes requestId, route, status, durationMs.
 */

const ALLOWED_LOG_FIELDS = new Set([
  'requestId', 'method', 'path', 'status', 'durationMs',
  'timestamp', 'level', 'message', 'userId', 'eventId',
  'action', 'tokenEstimate', 'provider', 'latencyMs', 'outcome',
  'code', 'name', 'stack',
]);

const REDACT_PATTERN = /pass|token|secret|key|authorization|cookie|brief|jwt/i;

function sanitize(obj: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT_PATTERN.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = sanitize(v, depth + 1);
    }
  }
  return out;
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function log(level: LogLevel, message: string, meta: Record<string, unknown> = {}): void {
  const safe = sanitize(meta) as Record<string, unknown>;
  const entry: Record<string, unknown> = { level, message, timestamp: new Date().toISOString() };
  for (const [k, v] of Object.entries(safe)) {
    if (ALLOWED_LOG_FIELDS.has(k)) entry[k] = v;
  }
  // eslint-disable-next-line no-console
  process.stdout.write(JSON.stringify(entry) + '\n');
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
};

export { sanitize, REDACT_PATTERN };
