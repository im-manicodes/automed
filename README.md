# auto-med

Síntesis con IA de hilos de Outlook (tickets), con OCR de PDFs escaneados y corrección humana de las zonas dudosas.

## Estructura
```
apps/api   NestJS + Prisma + PostgreSQL
apps/web   Vite + React + Tailwind (mobile-first, español)
docs/      estado-del-proyecto.md
docker-compose.yml  rustfs, api, web (Postgres externo vía DATABASE_URL en .env)
```

## Arranque rápido (desarrollo)
```bash
pnpm install
cp .env.example .env
docker compose up -d rustfs   # Postgres es externo: define DATABASE_URL en .env
pnpm --filter api prisma:deploy
pnpm dev                                  # api :3000, web :5173
```

## Todo con Docker
```bash
docker compose up --build   # web http://localhost:8080
```

## Comandos
`pnpm build` · `pnpm lint` · `pnpm test` · `pnpm --filter api prisma:migrate`

## Configuración
Ver `.env.example` (raíz) (BD, S3/RustFS, Microsoft Graph, `OCR_ENGINE`, `LLM_PROVIDER`).

## Estado
Ver `docs/estado-del-proyecto.md`. Convenciones y reglas para agentes: `CLAUDE.md` / `AGENTS.md`.
