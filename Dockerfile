# Imagen única de producción: API (NestJS) + front compilado (Vite) + pdf-extract (Python/PyMuPDF).
# Contexto de build: raíz del monorepo.
#   docker build -t automed .
# Postgres y el almacenamiento S3 (RustFS/Spaces/S3) se configuran por variables de entorno.

# ---- 1. Front ----
FROM node:22-slim AS web
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web...
COPY apps/web apps/web
RUN pnpm --filter web build

# ---- 2. API (solo dependencias de producción; incluye `prisma` para migrate deploy) ----
FROM node:22-slim AS api
RUN corepack enable && apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api...
COPY apps/api apps/api
RUN pnpm --filter api build
RUN pnpm --filter api --legacy deploy --prod /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/prisma /out/prisma \
 && cp apps/api/prisma.config.ts /out/prisma.config.ts

# ---- 3. Imagen final ----
FROM node:22-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*
# pdf-extract: PyMuPDF es AGPL-3.0 (uso interno; ver docs/despliegue.md).
COPY services/pdf-extract/requirements.txt /srv/pdf-extract/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r /srv/pdf-extract/requirements.txt
COPY services/pdf-extract/app /srv/pdf-extract/app

ENV NODE_ENV=production \
    PORT=3000 \
    FRONTEND_BUILD_PATH=/app/frontend \
    PDF_EXTRACT_URL=http://127.0.0.1:8001 \
    PDF_TEXT_MIN_CHARS=60

WORKDIR /repo/apps/api
COPY --from=api --chown=node:node /out ./
COPY --from=web /repo/apps/web/dist /app/frontend
COPY deploy/entrypoint.sh /entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["/entrypoint.sh"]
