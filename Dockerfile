# Imagen única de producción: web (Vite compilado, servido por la API) + API (NestJS). Sin Python ni OCR
# horneado (el OCR local lo gestiona la API en el volumen /models). Solo se expone el puerto 3000.
# PostgreSQL y el almacenamiento S3 (instancia RustFS o bucket de AWS, se elige en la web) son externos. Contexto de build: raíz del monorepo.
#   docker build -t automed .
#   docker run -p 3000:3000 -v automed-models:/models --env-file .env automed
# (Docker de desarrollo con hot reload: docker-compose.yml.)

# Imagen base configurable (el CI usa un mirror para no depender de Docker Hub).
ARG NODE_IMAGE=node:22-slim

# ---- 1. Front ----
FROM ${NODE_IMAGE} AS web
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web...
COPY apps/web apps/web
RUN pnpm --filter web build

# ---- 2. API (solo dependencias de producción; incluye `prisma` y `tsx` para migrate deploy y el seed;
#      `src/` va porque prisma/seed.ts importa de ahí) ----
FROM ${NODE_IMAGE} AS api
RUN corepack enable && apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api...
COPY apps/api apps/api
# Fuente del OCR: el build de la API la empaqueta como asset (ocr-local.tgz) que el instalador usa en runtime
COPY services/ocr-local services/ocr-local
RUN pnpm --filter api build
RUN pnpm --filter api --legacy deploy --prod /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/prisma /out/prisma \
 && cp -r apps/api/src /out/src \
 && cp apps/api/prisma.config.ts /out/prisma.config.ts

# ---- 3. Imagen final ----
FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends openssl bash \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    FRONTEND_BUILD_PATH=/app/frontend \
    PDF_TEXT_MODE=node

WORKDIR /repo/apps/api
COPY --from=api --chown=node:node /out ./
COPY --from=web /repo/apps/web/dist /app/frontend
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /models && chown node:node /models
VOLUME ["/models"]
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["/entrypoint.sh"]
