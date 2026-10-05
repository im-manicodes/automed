# Estado del proyecto

## Hecho
- [x] Fase 1 — Andamiaje: monorepo pnpm, apps/api (NestJS, módulos vacíos con `nest g`, Prisma 7 + migración inicial, cliente S3/RustFS, esqueleto `OcrEngine`/`LlmProvider`, `.env.example`), apps/web (Vite + Tailwind + router, rutas placeholder), docker-compose + Dockerfiles, CLAUDE.md/AGENTS.md/README.md.

- [x] Fase 2 — Correo Microsoft: guía Entra ID (`docs/entra-id-registro.md`), login OAuth delegado (code + PKCE), refresh de tokens con cifrado AES-GCM, sesión de un usuario (cookie firmada), cliente Graph con paginación/429/401/410, delta sync de Inbox con deltaLink, Thread por `conversationId`, Message + todos los PDF adjuntos a RustFS (dedupe por sha256), polling (`SYNC_INTERVAL_MIN`) + `POST /api/mail/sync` sin solapamiento, `GET /api/threads` y `/api/threads/:id`. 24 tests unitarios con fixtures de Graph.

- [x] Fase 2b — Sincronización de Inbox + Enviados (`sentitems`): un deltaLink por carpeta (modelo `MailFolderSync`, migración `sync_por_carpeta` que conserva el deltaLink del inbox y rellena `Message.isFromMe`), cada Thread incluye mensajes propios y ajenos, un enviado puede crear ticket, `isFromMe` (remitente == email de la cuenta) expuesto en `GET /api/threads/:id`, PDFs enviados con el mismo tratamiento (sha256 + dedupe). 28 tests.

- [x] Fase 3 — Jobs y pipeline: cola en PostgreSQL (modelo `Job`, migración `jobs_cola`; claim atómico `FOR UPDATE SKIP LOCKED`, reintentos con backoff exponencial, recuperación de locks vencidos al arrancar y en cada barrido), worker (`apps/api/src/jobs`, `JOBS_CONCURRENCY`, polling), orquestador `process_thread` -> N x `process_attachment` (dedupe por sha256) -> `synthesize_thread`, idempotencia por hash de contenido del hilo, estados de Thread centralizados en `ThreadStateService` (pendiente -> procesando -> listo | necesita_revision | error; el valor `necesita_ayuda` del enum se renombró a `necesita_revision`), endpoints `GET /api/jobs/status` y `POST /api/threads/:id/reprocess`, `GET /api/threads` expone `status`/`updatedAt`. Enganches para fases 4 y 5: tokens `ATTACHMENT_PROCESSOR` y `THREAD_SYNTHESIZER` (hoy no-op) en `JobsModule`. Tests unitarios + integración opcional con PostgreSQL real (`TEST_DATABASE_URL`, `pnpm --filter api test:integration`).

## En curso
- Nada.

## Falta
- [ ] Fase 4 — OCR (local + Textract, regiones, reintento visión)
- [ ] Fase 5 — Síntesis (LlmProvider Bedrock/API key, plantilla)
- [ ] Fase 6 — UI completa (login, visor PDF, corrección)
- [ ] Fase 7 — Hardening y entrega

## Pendientes de la fase 2
- Probar contra un tenant real (registrar la app en Entra ID, rellenar `.env` de la raíz, `pnpm --filter api prisma:migrate`, abrir `/api/auth/login`).
- Sin migración nueva: no hay unicidad (messageId, graphId) en Attachment; la idempotencia se hace por consulta.
- Fallback app-only documentado pero no implementado.
- El estado PKCE vive en memoria (se pierde al reiniciar la API durante un login).

## Pendientes de la fase 3
- Fase 4: implementar `AttachmentProcessor` (rasterizar + `OcrEngine`, crear OcrPage/OcrRegion con `dudoso`) y reemplazar `NoopAttachmentProcessor`. Los adjuntos con mismo sha256 comparten resultado: las OcrPage viven en un solo Attachment (consultar por sha256).
- Fase 5: implementar `ThreadSynthesizer` (LlmProvider + plantilla) y reemplazar `NoopThreadSynthesizer`.
- Mientras sean no-op, un hilo nuevo pasa solo a `listo` sin síntesis real.
- El worker corre dentro del proceso de la API (varias réplicas son seguras gracias a SKIP LOCKED).
- Los tests de integración de la cola requieren `NODE_OPTIONS=--experimental-vm-modules` (Prisma 7 + Jest CJS) y se saltan sin `TEST_DATABASE_URL`.
