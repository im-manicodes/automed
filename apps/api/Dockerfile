# Contexto de build: raíz del monorepo
FROM node:22-slim AS build
RUN corepack enable && apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api...
COPY apps/api apps/api
RUN pnpm --filter api build
# Solo dependencias de producción (incluye `prisma`, necesario para `migrate deploy` al arrancar).
RUN pnpm --filter api --legacy deploy --prod /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/prisma /out/prisma \
 && cp apps/api/prisma.config.ts /out/prisma.config.ts

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo/apps/api
COPY --from=build --chown=node:node /out ./
# Sin root: la app solo necesita leer su código y hablar con la red.
USER node
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/main.js"]
