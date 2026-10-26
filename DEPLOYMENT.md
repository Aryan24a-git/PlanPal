# PlanPal — Deployment & Operations Specification

## 1. Environments & Configuration
- **Local Dev**: Node.js v24 + SQLite (`./data/planpal.db`).
- **Production / Staging**: Standalone Docker container with environment variables loaded from cloud secret manager.

### Required Environment Variables (Validated at startup)
- `PORT`: HTTP server listening port (default: 4000).
- `NODE_ENV`: Runtime mode (`development`, `staging`, `production`).
- `JWT_SECRET`: Secret key for signing session tokens (minimum 32 characters).
- `AI_PROVIDER`: Selected LLM adapter (`mock`, `groq`).
- `GROQ_API_KEY`: API key for Groq Cloud (required if `AI_PROVIDER=groq`).
- `GROQ_MODEL`: Model identifier (e.g. `openai/gpt-oss-120b`).
- `AI_DAILY_QUOTA_PER_USER`: Daily request limit per user (default: 20).
- `DATABASE_URL`: Path to SQLite database file (default `/data/planpal.db` in Docker).
- `CORS_ORIGIN`: Optional allowed origins for production CORS.

### Persistence & Instance Architecture (Finding 9)
- **SQLite Storage Requirement**: PlanPal uses SQLite with WAL mode. In cloud environments:
  - **Fly.io**: Mount a persistent volume at `/data` (`fly volumes create planpal_data --size 1`).
  - **Render**: Deploy with a paid persistent disk mounted at `/data` (Render free tier ephemeral disk will lose SQLite data on redeploy).
- **Single Instance Constraint**: Run strictly as a **single instance (`replicas = 1`)**. Multi-instance horizontal scaling with SQLite over networked filesystems (NFS/EFS) is unsafe due to SQLite file-locking invariants. For multi-node scale, swap the SQLite repository layer to PostgreSQL.

## 2. Containerization (Dockerfile)
```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY public ./public
RUN npx tsc

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
```

## 3. Observability & Health Checks
- **Health Endpoint**: `GET /api/health` returns status, timestamp, and process uptime.
- **Structured Logs**: Every request emits a single JSON line including `requestId`, `method`, `path`, `status`, `durationMs`, and timestamp. Sensitive parameters (passwords, tokens, briefs) are strictly omitted.
