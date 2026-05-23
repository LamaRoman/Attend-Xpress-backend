# syntax=docker/dockerfile:1.6
# ─────────────────────────────────────────────────────────────────────────────
# Smart Attendance — Backend Dockerfile
# Multi-stage build: compile TypeScript with full dev deps, ship a slim
# runtime image with only production deps + the compiled output.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: deps (cached when package*.json is unchanged) ──────────────────
FROM node:20-alpine AS deps

# Prisma needs OpenSSL at install time for engine selection on alpine
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy only the manifests so npm ci is cached when package.json doesn't change
COPY package.json package-lock.json ./
COPY prisma ./prisma

# postinstall runs `prisma generate` — it needs the schema, copied above.
RUN npm ci

# ── Stage 2: builder (TypeScript compile) ───────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

# `npm run build` is `prisma generate && tsc` — generate runs again here
# against the copied schema so the client matches what we ship.
RUN npm run build

# Strip dev deps from the node_modules we'll carry into the runtime image.
# (Faster than running `npm ci --omit=dev` from scratch in a third stage.)
RUN npm prune --omit=dev

# ── Stage 3: runtime ────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# tini for proper PID-1 signal handling; openssl/libc6-compat for Prisma.
RUN apk add --no-cache openssl libc6-compat tini

# Run as a non-root user. node:alpine ships a `node` user with UID 1000.
WORKDIR /app
RUN chown -R node:node /app

# Copy only what we need at runtime
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package.json ./

USER node

ENV NODE_ENV=production
ENV PORT=5001

EXPOSE 5001

# Container-level healthcheck. Hits the /health endpoint, which now reports
# DB + Redis status and returns 503 if either is down (when configured).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --spider --tries=1 http://localhost:5001/api/v1/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]

# `npm run start` runs `prisma migrate deploy && node dist/server.js`.
# See DEPLOYMENT.md for the rationale and the zero-downtime caveat for
# destructive migrations.
CMD ["npm", "run", "start"]
