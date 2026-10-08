# Imagen única de producción: web (Vite compilado, servido por la API) + API (NestJS) + OCR local
# (PaddleOCR/FastAPI en 127.0.0.1:8000). Solo se expone el puerto 3000.
# PostgreSQL y el almacenamiento S3 (instancia RustFS o bucket de AWS, se elige en la web) son externos. Contexto de build: raíz del monorepo.
#   docker build -t automed .
#   docker run -p 3000:3000 -v automed-models:/models --env-file .env automed
# (Docker de desarrollo con hot reload: docker-compose.yml.)

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

# ---- 3. Entorno Python del OCR local (mismo Python del sistema que la imagen final) ----
FROM node:22-slim AS ocr
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
RUN python3 -m venv /opt/venv
COPY services/ocr-local/requirements.txt /tmp/requirements.txt
RUN /opt/venv/bin/pip install -r /tmp/requirements.txt \
    # paddlex resuelve opencv-contrib-python (con GUI, pide libgl1): se cambia por la variante headless de la MISMA versión.
 && /opt/venv/bin/pip uninstall -y opencv-contrib-python opencv-python opencv-python-headless opencv-contrib-python-headless \
 && /opt/venv/bin/pip install opencv-contrib-python-headless==4.10.0.84 \
 && find /opt/venv -type d -name __pycache__ -prune -exec rm -rf {} + \
 && find /opt/venv -name '*.pyc' -delete

# ---- 4. Imagen final ----
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl bash python3 \
      tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng libgomp1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ocr /opt/venv /opt/venv
COPY services/ocr-local/app /srv/ocr-local/app

ENV NODE_ENV=production \
    PORT=3000 \
    FRONTEND_BUILD_PATH=/app/frontend \
    OCR_LOCAL_URL=http://127.0.0.1:8000 \
    PADDLE_PDX_CACHE_HOME=/models \
    OCR_LOCAL_ENGINE=paddle \
    OCR_LANG=es \
    OCR_FALLBACK=true \
    PDF_TEXT_MODE=node \
    PYTHONDONTWRITEBYTECODE=1

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
