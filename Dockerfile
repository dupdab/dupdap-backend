# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:20-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy sources and compile the NestJS app
COPY . .
RUN pnpm run build

# Drop dev dependencies to keep the runtime image lean
RUN pnpm prune --prod

# ---- Runtime stage ----
FROM node:20-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Run as the non-root user provided by the base image
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 3000

CMD ["node", "dist/main"]
