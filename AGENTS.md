# auto-med — contexto para agentes (Codex, Antigravity, otros)

## Proyecto
Servicio para 1 usuario / 1 buzón de Outlook (Microsoft Graph, OAuth delegado). Sincroniza hilos por polling (delta queries), agrupa por `conversationId` en "tickets", hace OCR de PDFs escaneados (manuscrito incluido), y genera con un LLM una síntesis markdown acumulativa con plantilla editable. Zonas que el OCR no entiende se marcan con recuadro rojo para que el usuario las corrija (sobre todo desde el celular), lo que regenera la síntesis. Contenido sensible: producción con AWS Bedrock + Textract; pruebas con API keys. UI en español, mobile-first, lenguaje sencillo.

Plan completo: `/home/mani/.claude/plans/necesito-un-peque-o-software-swirling-taco.md` (7 fases). Estado: `docs/estado-del-proyecto.md`.

## Stack
- Monorepo pnpm (`pnpm-workspace.yaml`): `apps/api` (NestJS + Prisma 7 + PostgreSQL), `apps/web` (Vite + React + TS + Tailwind 4 + react-router).
- Almacenamiento de PDFs/páginas: RustFS (S3 compatible) vía `@aws-sdk/client-s3`, path-style, módulo `storage`. En BD solo `storageKey` + `sha256`.
- Interfaces intercambiables: `OcrEngine` (`OCR_ENGINE=local|textract`) y `LlmProvider` (`LLM_PROVIDER=bedrock|anthropic|openai`).
- docker-compose: rustfs, api, web (PostgreSQL es externo, vía DATABASE_URL) (ocr-local pendiente, fase 4).

## Comandos
- `pnpm install` · `pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm test`
- API: `pnpm --filter api prisma:migrate` (dev), `prisma:deploy`, `prisma:generate`. Cliente Prisma generado en `apps/api/src/generated/prisma` (ignorado en git; `pnpm build` lo regenera).
- `docker compose up --build` (web en :8080, api en :3000, rustfs consola :9001).
- Config por env: `.env` único en la raíz del monorepo (copiar de `.env.example`; lo leen api, Prisma, web y docker compose).

## Reglas de trabajo (OBLIGATORIAS; replican CLAUDE.md)
1. Cada vez que se ejecute el plan, delegar en subagentes si la herramienta lo permite, eligiendo el modelo más adecuado por tarea: **haiku** (tareas mecánicas), **sonnet 5** (implementación estándar), **sonnet 5.5** (diseño/lógica compleja).
2. **Antes de cada fase** mostrar al usuario un resumen de lo que se va a ejecutar.
3. **Durante la ejecución** mostrar una barra de progreso cada 60 segundos (p.ej. `[██████░░░░] 60% — paso actual`).
4. Todo boilerplate de `apps/api` se genera **siempre con `nest g`** (module, service, controller, interface, etc.); no crear esos archivos a mano.
5. Actualizar `docs/estado-del-proyecto.md` (hecho / en curso / falta) en cada hito.
6. No hacer commit salvo que el usuario lo pida.

## Convenciones
- Código y comentarios técnicos en inglés o español consistente; textos de UI siempre en español sencillo ("Listo", "Necesita tu ayuda").
- Botones táctiles ≥ 44px (clases `.btn`); diseño mobile-first.
- Sin logs de contenido de correos/PDFs. Tokens cifrados AES-GCM (`TOKEN_ENC_KEY`).
- Idempotencia por hash de contenido (no reprocesar hilos/PDFs sin cambios).
- Modelo de datos: `MailAccount → Thread → Message → Attachment → OcrPage → OcrRegion`, más `Synthesis`, `Template`, `Setting` (`apps/api/prisma/schema.prisma`).
