FROM node:24-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY public ./public
RUN npx tsc

FROM node:24-alpine AS runner
RUN apk add --no-cache python3 make g++
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
