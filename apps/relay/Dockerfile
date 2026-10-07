# Contexto de build: raíz del monorepo. El relay reenvía el túnel y sirve SOLO el arranque (apps/relay/bootstrap);
# el front de apps/web lo entrega el escritorio por el canal cifrado (docs/relay-e2e.md), ya no se construye aquí.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/relay/package.json apps/relay/
RUN pnpm install --frozen-lockfile --filter relay...
COPY apps/relay apps/relay
RUN pnpm --filter relay build

FROM node:22-slim
WORKDIR /app
COPY apps/relay/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /repo/apps/relay/dist ./dist
COPY apps/relay/bootstrap ./bootstrap
ENV PORT=8080 RELAY_DATA_DIR=/data RELAY_TRUST_PROXY=1
RUN mkdir /data && chown node /data
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "dist/main.js"]
