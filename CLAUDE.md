# auto-med — contexto para Claude Code

## Proyecto
Servicio para 1 usuario / 1 buzón de Outlook (Microsoft Graph, OAuth delegado). Sincroniza hilos por polling (delta queries), agrupa por `conversationId` en "tickets", hace OCR de PDFs escaneados (manuscrito incluido), y genera con un LLM una síntesis markdown acumulativa con plantilla editable. Zonas que el OCR no entiende se marcan con recuadro rojo para que el usuario las corrija (sobre todo desde el celular), lo que regenera la síntesis. Contenido sensible: producción con AWS Bedrock + Textract; pruebas con API keys. UI en español, mobile-first, lenguaje sencillo.

Plan completo: `/home/mani/.claude/plans/necesito-un-peque-o-software-swirling-taco.md` (7 fases). Estado: `docs/estado-del-proyecto.md`.

## Flujo de análisis (REGLA)
**El análisis es siempre bajo petición del usuario.** El sync de correo solo descarga y guarda correos y PDFs (RustFS); ningún hilo se rasteriza, pasa por OCR ni se envía a un LLM hasta que el usuario lo pide (`POST /api/threads/:id/analyze` o `POST /api/threads/analyze`). Estados de Thread: `sin_analizar` (defecto) -> `pendiente` -> `procesando` -> `listo | necesita_revision | error`. `seguimiento` (por hilo, opt-in) reanaliza solo al llegar mensajes nuevos a un hilo ya analizado; sin él se marca `tieneMensajesNuevos`. El barrido del pipeline solo recoge `pendiente`. Motivo: contenido sensible y muchos hilos antiguos cerrados.

## Síntesis incremental (REGLA)
Para reducir costo de LLM, un hilo ya analizado **nunca** se reenvía completo. Con síntesis previa utilizable, al LLM solo van: la síntesis markdown anterior, los mensajes NUEVOS (los que no están en `Synthesis.coveredMessageIds` de la última versión) con el OCR de SUS adjuntos nuevos, y la plantilla. Modo completo (`Synthesis.mode='full'`) solo sin síntesis previa utilizable o con `POST /api/threads/:id/synthesis/regenerate` (explícito, advierte mayor consumo). Cambiar la plantilla NO regenera: la actualización incremental sigue con el markdown y la plantilla anteriores y `GET /api/threads/:id/synthesis` expone `plantillaDesactualizada`. Corregir una región envía solo el documento afectado. Se respeta `SYNTH_MAX_INPUT_TOKENS` (novedades por tramos si no caben) y se guarda `inputTokensEstimados`/`mode` por versión. Los adjuntos ya procesados (sha256) no se vuelven a procesar ni a enviar a visión.

## Stack
- Monorepo pnpm (`pnpm-workspace.yaml`): `apps/api` (NestJS + Prisma 7 + PostgreSQL), `apps/web` (Vite + React + TS + Tailwind 4 + react-router).
- Almacenamiento de PDFs/páginas: RustFS (S3 compatible) vía `@aws-sdk/client-s3`, path-style, módulo `storage`. En BD solo `storageKey` + `sha256`.
- Interfaces intercambiables: `OcrEngine` (`OCR_ENGINE=local|textract`) y `LlmProvider` (`LLM_PROVIDER=bedrock|anthropic|openai`).
- docker-compose: rustfs, api (healthcheck `GET /api/health`), web y ocr-local (perfil `ocr`, solo dev). PostgreSQL es externo (`DATABASE_URL_DOCKER` desde el contenedor). Despliegue: `docs/despliegue.md`; benchmark OCR: `docs/benchmark-ocr.md`.

## Comandos
- `pnpm install` · `pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm test`
- API: `pnpm --filter api prisma:migrate` (dev), `prisma:deploy`, `prisma:generate`. Cliente Prisma generado en `apps/api/src/generated/prisma` (ignorado en git; `pnpm build` lo regenera).
- `docker compose up --build` (web en :8080, api en :3000, rustfs consola :9001; api/rustfs/ocr solo en 127.0.0.1).
- Tests: `pnpm test` (unit + e2e HTTP sin BD con supertest); flujo completo con mocks (sync -> OCR -> síntesis -> corrección -> incremental): `pnpm --filter api test:e2e-flow` (crea y borra un esquema temporal en la BD de `DATABASE_URL`; sin red).
- El build emite `apps/api/dist/main.js` (`tsconfig.build.json` fija `rootDir: src`); `start:prod` = `node dist/main.js`.
- Config por env: `.env` único en la raíz del monorepo (copiar de `.env.example`; lo leen api, Prisma, web y docker compose).

## Reglas de trabajo (OBLIGATORIAS)
1. Cada vez que se ejecute el plan, hacerlo **con subagentes**, eligiendo el modelo más adecuado por tarea: **haiku** (tareas mecánicas), **sonnet 5** (implementación estándar), **sonnet 5.5** (diseño/lógica compleja).
2. **Antes de cada fase** mostrar al usuario un resumen de lo que se va a ejecutar.
3. **Durante la ejecución** mostrar una barra de progreso cada 60 segundos (p.ej. `[██████░░░░] 60% — paso actual`).
4. Todo boilerplate de `apps/api` se genera **siempre con `nest g`** (module, service, controller, interface, etc.); no crear esos archivos a mano.
5. Actualizar `docs/estado-del-proyecto.md` (hecho / en curso / falta) en cada hito.
6. No hacer commit salvo que el usuario lo pida.

## Convenciones
- Código y comentarios técnicos en inglés o español consistente; textos de UI siempre en español sencillo ("Listo", "Necesita tu ayuda").
- Botones táctiles ≥ 44px (clases `.btn`); diseño mobile-first.
- Sin logs de contenido de correos/PDFs. Tokens cifrados AES-GCM (`TOKEN_ENC_KEY`).
- Seguridad (fase 7): toda ruta de `/api` exige sesión salvo `auth/login`, `auth/callback`, `auth/me` (solo informa si hay sesión), `auth/logout` y `health`. `configureApp` (`app.setup.ts`) aplica helmet, CORS solo a `WEB_ORIGIN`, límite JSON 256 kb. Cookie HttpOnly + SameSite=Lax (+ Secure por `COOKIE_SECURE` o `MS_REDIRECT_URI` https).
- Servicio OCR local: PaddleOCR exige `paddlex==3.0.3` y `langchain<0.3` (fijados en `requirements.txt`); si no carga cae a Tesseract y lo indica en `/health` (`fallback_reason`).
- Idempotencia por hash de contenido (no reprocesar hilos/PDFs sin cambios).
- Modelo de datos: `MailAccount → Thread → Message → Attachment → OcrPage → OcrRegion`, más `Synthesis`, `Template`, `Setting` (`apps/api/prisma/schema.prisma`).
