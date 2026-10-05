# Estado del proyecto

## Hecho
- [x] Fase 1 — Andamiaje: monorepo pnpm, apps/api (NestJS, módulos vacíos con `nest g`, Prisma 7 + migración inicial, cliente S3/RustFS, esqueleto `OcrEngine`/`LlmProvider`, `.env.example`), apps/web (Vite + Tailwind + router, rutas placeholder), docker-compose + Dockerfiles, CLAUDE.md/AGENTS.md/README.md.

- [x] Fase 2 — Correo Microsoft: guía Entra ID (`docs/entra-id-registro.md`), login OAuth delegado (code + PKCE), refresh de tokens con cifrado AES-GCM, sesión de un usuario (cookie firmada), cliente Graph con paginación/429/401/410, delta sync de Inbox con deltaLink, Thread por `conversationId`, Message + todos los PDF adjuntos a RustFS (dedupe por sha256), polling (`SYNC_INTERVAL_MIN`) + `POST /api/mail/sync` sin solapamiento, `GET /api/threads` y `/api/threads/:id`. 24 tests unitarios con fixtures de Graph.

- [x] Fase 2b — Sincronización de Inbox + Enviados (`sentitems`): un deltaLink por carpeta (modelo `MailFolderSync`, migración `sync_por_carpeta` que conserva el deltaLink del inbox y rellena `Message.isFromMe`), cada Thread incluye mensajes propios y ajenos, un enviado puede crear ticket, `isFromMe` (remitente == email de la cuenta) expuesto en `GET /api/threads/:id`, PDFs enviados con el mismo tratamiento (sha256 + dedupe). 28 tests.

## En curso
- Nada.

## Falta
- [ ] Fase 3 — Jobs y pipeline
- [ ] Fase 4 — OCR (local + Textract, regiones, reintento visión)
- [ ] Fase 5 — Síntesis (LlmProvider Bedrock/API key, plantilla)
- [ ] Fase 6 — UI completa (login, visor PDF, corrección)
- [ ] Fase 7 — Hardening y entrega

## Pendientes de la fase 2
- Probar contra un tenant real (registrar la app en Entra ID, rellenar `.env` de la raíz, `pnpm --filter api prisma:migrate`, abrir `/api/auth/login`).
- Sin migración nueva: no hay unicidad (messageId, graphId) en Attachment; la idempotencia se hace por consulta.
- Fallback app-only documentado pero no implementado.
- El estado PKCE vive en memoria (se pierde al reiniciar la API durante un login).
