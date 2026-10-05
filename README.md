# auto-med

Síntesis con IA de hilos de Outlook (tickets), con OCR de PDFs escaneados y corrección humana de las zonas dudosas.

> El análisis (OCR + IA) es siempre bajo petición del usuario: el correo se sincroniza y se guarda, pero ningún hilo se envía a OCR ni a un LLM hasta que lo pides (`POST /api/threads/:id/analyze`, o `seguimiento` para reanalizar hilos ya analizados cuando llegan mensajes nuevos).

## Estructura
```
apps/api   NestJS + Prisma + PostgreSQL
apps/web   Vite + React + Tailwind (mobile-first, español)
docs/      estado-del-proyecto.md, despliegue.md, benchmark-ocr.md, entra-id-registro.md
services/ocr-local  OCR local (PaddleOCR/Tesseract, perfil `ocr`, solo pruebas)
docker-compose.yml  rustfs, api, web (Postgres externo vía DATABASE_URL_DOCKER en .env)
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
docker compose up -d --build   # web http://localhost:8080; api healthy en /api/health
docker compose --profile ocr up -d ocr-local   # opcional: OCR local
```
Guía completa (variables, Entra ID, Textract/Bedrock, backups, problemas): `docs/despliegue.md`. Medir el OCR con tus PDFs: `docs/benchmark-ocr.md`.

## Comandos
`pnpm build` · `pnpm lint` · `pnpm test` · `pnpm --filter api test:e2e-flow` (flujo completo con mocks, esquema temporal) · `pnpm --filter web test` (vitest) · `pnpm --filter api prisma:migrate`

## Configuración
Ver `.env.example` (raíz) (BD, S3/RustFS, `JWT_SECRET`, Microsoft Graph, `OCR_ENGINE`, `LLM_PROVIDER`). `JWT_SECRET` es obligatorio (`openssl rand -base64 48`).

## Primer usuario y conexión con Outlook
La app tiene su propio login (correo + contraseña); Outlook se conecta después desde **Ajustes -> Conectar Outlook**.
```bash
pnpm --filter api prisma:deploy
pnpm --filter api user:create -- --email tu@correo.com --nombre "Tu nombre"   # pide la contraseña (sin eco)
# con Docker: docker compose exec api node dist/cli/user.js create --email tu@correo.com --nombre "Tu nombre"
```
Olvidaste la contraseña: `pnpm --filter api user:reset-password -- --email tu@correo.com`.

## Estado
Ver `docs/estado-del-proyecto.md`. Convenciones y reglas para agentes: `CLAUDE.md` / `AGENTS.md`.
