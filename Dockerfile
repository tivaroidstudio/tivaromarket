# One image, two processes (worker + web) via docker compose.
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile && pnpm --filter @tivaro/web build
ENV NODE_ENV=production
EXPOSE 3000 8787
