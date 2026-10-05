# Estado del proyecto

## Hecho
- [x] Fase 1 — Andamiaje: monorepo pnpm, apps/api (NestJS, módulos vacíos con `nest g`, Prisma 7 + migración inicial, cliente S3/RustFS, esqueleto `OcrEngine`/`LlmProvider`, `.env.example`), apps/web (Vite + Tailwind + router, rutas placeholder), docker-compose + Dockerfiles, CLAUDE.md/AGENTS.md/README.md.

- [x] Fase 2 — Correo Microsoft: guía Entra ID (`docs/entra-id-registro.md`), login OAuth delegado (code + PKCE), refresh de tokens con cifrado AES-GCM, sesión de un usuario (cookie firmada), cliente Graph con paginación/429/401/410, delta sync de Inbox con deltaLink, Thread por `conversationId`, Message + todos los PDF adjuntos a RustFS (dedupe por sha256), polling (`SYNC_INTERVAL_MIN`) + `POST /api/mail/sync` sin solapamiento, `GET /api/threads` y `/api/threads/:id`. 24 tests unitarios con fixtures de Graph.

- [x] Fase 2b — Sincronización de Inbox + Enviados (`sentitems`): un deltaLink por carpeta (modelo `MailFolderSync`, migración `sync_por_carpeta` que conserva el deltaLink del inbox y rellena `Message.isFromMe`), cada Thread incluye mensajes propios y ajenos, un enviado puede crear ticket, `isFromMe` (remitente == email de la cuenta) expuesto en `GET /api/threads/:id`, PDFs enviados con el mismo tratamiento (sha256 + dedupe). 28 tests.

- [x] Fase 3 — Jobs y pipeline: cola en PostgreSQL (modelo `Job`, migración `jobs_cola`; claim atómico `FOR UPDATE SKIP LOCKED`, reintentos con backoff exponencial, recuperación de locks vencidos al arrancar y en cada barrido), worker (`apps/api/src/jobs`, `JOBS_CONCURRENCY`, polling), orquestador `process_thread` -> N x `process_attachment` (dedupe por sha256) -> `synthesize_thread`, idempotencia por hash de contenido del hilo, estados de Thread centralizados en `ThreadStateService` (pendiente -> procesando -> listo | necesita_revision | error; el valor `necesita_ayuda` del enum se renombró a `necesita_revision`), endpoints `GET /api/jobs/status` y `POST /api/threads/:id/reprocess`, `GET /api/threads` expone `status`/`updatedAt`. Enganches para fases 4 y 5: tokens `ATTACHMENT_PROCESSOR` y `THREAD_SYNTHESIZER` (hoy no-op) en `JobsModule`. Tests unitarios + integración opcional con PostgreSQL real (`TEST_DATABASE_URL`, `pnpm --filter api test:integration`).

- [x] Fase 4 — OCR: rasterizado con pdfjs-dist + @napi-rs/canvas (sin binarios del sistema, `OCR_RENDER_DPI`=250) a `pages/{sha256}/{n}.png` en RustFS; `OcrEngine` con salida por línea/palabra (bbox normalizada, confianza 0..1) y adaptadores `local` (HTTP a `services/ocr-local`: FastAPI + PaddleOCR CPU, Tesseract como fallback; perfil `ocr` en docker-compose) y `textract` (DetectDocumentText/AnalyzeDocument, SDK v3); selección por `OCR_ENGINE`. `OcrService` reemplaza al no-op de `ATTACHMENT_PROCESSOR` (dedupe por sha256, regiones `ok|dudoso` por `OCR_CONFIDENCE_THRESHOLD`, reintento opcional con visión `OCR_VISION_RETRY` vía `LlmProvider`, hoy `NoopLlmProvider`). Migración `ocr_paginas_regiones` (OcrPage.sha256 + unique sha256/página, engine; OcrRegion.source). Endpoints: `GET /api/attachments/:id/pages`, `GET /api/attachments/:id/pages/:n/image`, `PATCH /api/ocr/regions/:id` (marca `corregido` y reencola la síntesis de los hilos con ese sha256). Benchmark: `pnpm --filter api ocr:benchmark -- <dir>`. Ver pendientes de la fase 4.

- [x] Fase 5 — Síntesis: `LlmProvider` real (`apps/api/src/llm`) con adaptadores `anthropic` (@anthropic-ai/sdk), `bedrock` (Converse) y `openai`, seleccionados por `LLM_PROVIDER`; métodos `text()` y `vision()`, modelos por `LLM_MODEL_TEXT`/`LLM_MODEL_VISION`, reintentos con backoff (429/5xx/timeouts), timeouts, sin logs de contenido; `NoopLlmProvider` eliminado (la relectura con visión del OCR usa `vision()`). Plantillas versionadas (`Template.version`, una activa; plantilla por defecto en español con instrucciones por sección en comentarios `<!-- -->`): `GET/PUT /api/templates/active`, `POST /api/templates/reset`, `POST /api/templates/preview`. `SynthesisService`: línea de tiempo (isFromMe, citas/firmas recortadas) + OCR por página con `[ilegible #n · doc · p.k]` y `texto_usuario`, map-reduce sobre `SYNTH_MAX_INPUT_TOKENS`, guarda `Synthesis` (versión, hash de entrada, modelo, plantilla) y no llama al LLM si el hash no cambió; implementa `THREAD_SYNTHESIZER` (corregir una región regenera por el flujo de la fase 4). Endpoints `GET /api/threads/:id/synthesis` y `POST /api/threads/:id/synthesis/regenerate` (fuerza nueva versión vía cola). Migración `sintesis_plantillas`.

## En curso
- Nada.

## Falta
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

## Pendientes de la fase 4
- No probado en este entorno: PaddleOCR (sin pip/Docker build), Tesseract (no instalado) ni Textract real (sin credenciales); el servicio `services/ocr-local` está escrito contra la API de PaddleOCR 3.x (`predict`, claves `rec_texts/rec_scores/rec_polys`) y debe validarse con `docker compose --profile ocr up --build`.
- Validado: rasterizado real de PDF (pdfjs + canvas), tests unitarios, build, lint, migración aplicada.
- Fijar el umbral (`OCR_CONFIDENCE_THRESHOLD`) y elegir motor local con el benchmark sobre PDFs reales (fase 7).
- El reintento con visión es no-op hasta la fase 5 (`LLM_PROVIDER` real sustituye a `NoopLlmProvider` en `LlmModule`; debe aceptar `images`).
- El test del rasterizador necesita `pnpm --filter api test:raster` (pdfjs es ESM; Jest necesita `--experimental-vm-modules`); en `pnpm test` se omite.
- Textract síncrono limita a 10 MB por imagen; si una página PNG lo supera hay que bajar `OCR_RENDER_DPI`.
- Si se corrige una región mientras el hilo está `procesando`, no se reencola (la síntesis en curso podría no verla); reprocesar el hilo lo resuelve.
- Las correcciones del usuario no se editan una segunda vez en estado `corregido` salvo que se vuelva a llamar al PATCH (permitido).
- Cómo correr el benchmark: `pnpm --filter api ocr:benchmark -- /ruta/a/pdfs --engine local|textract [--dpi 250] [--threshold 0.85] [--max-pages N] [--csv salida.csv]` (usa el `.env` raíz; no guarda nada ni imprime texto de los documentos). Para `local` levantar antes `docker compose --profile ocr up -d ocr-local`.

## Pendientes de la fase 5
- No probado con APIs reales (Anthropic, Bedrock, OpenAI): solo SDK mockeado. Verificar al menos un hilo real con cada proveedor que vayas a usar.
- El ID por defecto de Bedrock (`anthropic.claude-sonnet-5-5`) es una suposición: confirma el ID/perfil de inferencia en tu región y ponlo en `LLM_MODEL_TEXT`.
- Claude 5.x y GPT-5 rechazan `temperature`: el adaptador la omite en esos modelos (lista en `llm-config.ts`, `modelAcceptsTemperature`). Sonnet 5.5 piensa en modo adaptativo por defecto; no se fija `effort` (se podría bajar para la relectura de recortes).
- La relectura de visión sigue pidiendo JSON `{text, confidence}` (OcrService necesita la confianza); el prompt exige transcripción literal.
- Estimación de tokens aproximada (4 caracteres/token); `SYNTH_MAX_INPUT_TOKENS` debe ir por debajo de la ventana real del modelo.
- La vista previa de plantilla llama al LLM real (una llamada corta con un hilo de ejemplo).
- Cambiar la plantilla no regenera hilos solos: el hash cambia, así que la próxima síntesis o `regenerate` genera versión nueva.
