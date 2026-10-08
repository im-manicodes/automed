# auto-med

Síntesis con IA de hilos de Outlook (tickets), con OCR de PDFs escaneados y corrección humana de las zonas dudosas.

> El análisis (OCR + IA) es siempre bajo petición del usuario: el correo se sincroniza y se guarda, pero ningún hilo se envía a OCR ni a un LLM hasta que lo pides (`POST /api/threads/:id/analyze`, o `seguimiento` para reanalizar hilos ya analizados cuando llegan mensajes nuevos).

## Estructura
```
apps/api   NestJS + Prisma + PostgreSQL
apps/web   Vite + React + Tailwind (mobile-first, español)
docs/      estado-del-proyecto.md, despliegue.md, benchmark-ocr.md, entra-id-registro.md
services/ocr-local  OCR local en CPU (PaddleOCR/Tesseract; siempre activo en compose)
scripts/docker-clean.sh  poda caché de build e imágenes sin etiqueta (nunca toca volúmenes)
Dockerfile  imagen única de producción: web + api + OCR local (Postgres y S3 externos)
deploy/entrypoint.sh  arranque de la imagen única
docker-compose.yml  SOLO desarrollo (hot reload): web (Vite :5173), api, ocr-local y rustfs
```
El producto es la versión web, empaquetada en un único contenedor.

## Arranque rápido (desarrollo)
```bash
pnpm install
cp .env.example .env
docker compose up -d rustfs   # Postgres es externo: define DATABASE_URL en .env
pnpm --filter api prisma:deploy
pnpm dev                                  # api :3000, web :5173
```

## Desarrollo con Docker (docker-compose.yml)
El compose es SOLO para desarrollo, con hot reload:
```bash
docker compose up --build   # web http://localhost:5173 (Vite); api :3000 con nest --watch
```
Servicios: `web`, `api`, `ocr-local`, `rustfs`. Ollama NO va en contenedor: corre en tu equipo y pones su URL en la web (Ajustes -> Inteligencia artificial; p. ej. `http://host.docker.internal:11434/v1`, con `OLLAMA_HOST=0.0.0.0` y `OLLAMA_CONTEXT_LENGTH=8192`). Reconstruye con `--build` solo si cambian dependencias; con `CHOKIDAR_USEPOLLING=true` en `.env` si el hot reload no detecta cambios. Espacio: la imagen de `ocr-local` es pesada; usa `./scripts/docker-clean.sh` tras cada build.

## Producción (imagen única)
```bash
docker build -t automed .
docker run -d --name automed -p 3000:3000 -v automed-models:/models --env-file .env automed
```
Un solo contenedor con web + api + OCR local (PaddleOCR); solo expone :3000 (ponlo detrás de un proxy con HTTPS). `/models` guarda los modelos del OCR. PostgreSQL es externo (`DATABASE_URL`). El almacenamiento de archivos es externo y se elige en la web (Ajustes -> Almacenamiento o el asistente de bienvenida): una instancia RustFS o un bucket de AWS S3. Pon `WEB_ORIGIN` con tu URL pública, `COOKIE_SECURE=true` y Detalle en `docs/despliegue.md`.

## Comandos
`pnpm build` · `pnpm lint` · `pnpm test` · `pnpm --filter api test:e2e-flow` (flujo completo con mocks, esquema temporal) · `pnpm --filter web test` (vitest) · `pnpm --filter api prisma:migrate`

## Configuración
Ver `.env.example` (raíz) (BD, S3/RustFS, `JWT_SECRET`). El proveedor de IA, los modelos, las claves, el motor OCR y el OAuth de Microsoft se configuran en la web (bienvenida / Ajustes), no en `.env`. `JWT_SECRET` es obligatorio (`openssl rand -base64 48`).

## Conexión con Microsoft (Entra ID)
Registra la app en <https://entra.microsoft.com> como aplicación **Web** con secreto de cliente (guía paso a paso: `docs/entra-id-registro.md`) y pega los datos en la web, en **Ajustes -> Microsoft**: id de aplicación (cliente), inquilino (`common`), secreto de cliente (se guarda cifrado y no se vuelve a mostrar) y URI de redirección. La web sugiere `<WEB_ORIGIN>/api/auth/callback` (`http://localhost:8080/api/auth/callback` con compose; `http://localhost:3000/api/auth/callback` en pruebas con `pnpm dev`); debe ser idéntica a la registrada. Permisos delegados: `Mail.Read`, `offline_access`, `User.Read` (sin consentimiento de administrador). Los `MS_*` de `.env` siguen valiendo como valores por defecto, pero el panel manda.

En `.env` solo hacen falta `TOKEN_ENC_KEY` (`openssl rand -base64 32`) y `JWT_SECRET` (`openssl rand -base64 48`).

## Primer usuario y conexión con Outlook
La app tiene su propio login (correo + contraseña); Outlook se conecta después desde **Ajustes -> Conectar Outlook** (tras rellenar Ajustes -> Microsoft).
```bash
pnpm --filter api prisma:deploy
pnpm --filter api user:create -- --email tu@correo.com --nombre "Tu nombre"   # pide la contraseña (sin eco)
# con Docker: docker compose exec api node dist/cli/user.js create --email tu@correo.com --nombre "Tu nombre"
```
Olvidaste la contraseña: `pnpm --filter api user:reset-password -- --email tu@correo.com`.

## Base de datos (scripts `db:*`)
| Script (raíz) | Qué hace |
|---|---|
| `pnpm db:generate` | `prisma generate` (cliente en `apps/api/src/generated/prisma`) |
| `pnpm db:migrate [-- --name x]` | `prisma migrate dev` (crea y aplica migración; solo desarrollo) |
| `pnpm db:migrate:create [-- --name x]` | `migrate dev --create-only` (genera el SQL sin aplicarlo) |
| `pnpm db:deploy` | `prisma migrate deploy` (producción/CI; solo aplica pendientes) |
| `pnpm db:status` | `prisma migrate status` (solo lectura; sale con 1 si hay migraciones pendientes) |
| `pnpm db:seed` | seed base idempotente: plantilla activa, ajustes y usuario de desarrollo opcional (`SEED_*`) |
| `pnpm db:seed:demo` | datos FICTICIOS (ids `demo-`, asuntos `[DEMO]`) + imágenes en RustFS; solo desarrollo |
| `pnpm db:seed:demo:clean` | borra solo lo demo (BD por prefijo de id y objetos S3 `demo/`) |
| `pnpm db:reset` | PELIGROSO: borra todo el esquema destino, reaplica migraciones y corre el seed base |
| `pnpm db:studio` · `db:validate` · `db:format` | `prisma studio` / `validate` / `format` |

Se ejecutan desde la raíz (o desde cualquier subcarpeta con `pnpm -w db:status`) y delegan a `apps/api`; leen el `.env` raíz. Argumentos: `pnpm run db:migrate -- --name mi_cambio`. Los scripts `db:seed*` corren con `tsx` sobre `apps/api/prisma/seed.ts` y `prisma/seed-demo.ts` (demo en `prisma/seed/`; no necesitan `pnpm build`); `db:reset` sí compila y corre `dist/cli/db-reset.js`, que tras el reset lanza `prisma db seed`. En Docker (la imagen incluye `prisma/` y `tsx`): `docker compose exec api pnpm exec prisma db seed`. `prisma.config.ts` registra el seed (`migrations.seed: 'tsx prisma/seed.ts'`, relativo a `apps/api`).

Variables del seed (todas opcionales; ya no figuran en `.env.example`: defínelas solo en tu `.env` local de desarrollo o en CI): `SEED_USER_EMAIL`, `SEED_USER_NAME`, `SEED_USER_PASSWORD`. Si están las tres y no es `NODE_ENV=production`, `db:seed` crea un usuario de DESARROLLO con las mismas validaciones/argon2id que `user:create` (si ya existe no lo toca; adopta la cuenta de Outlook huérfana igual que `user:create`, y lo avisa). Nunca imprime contraseñas ni hashes.

`db:seed:demo`: los tickets demo NO son correos reales; su cuenta `demo@demo.invalid` no tiene tokens de Microsoft, así que el sync no los toca ni los mezcla. No lo corras junto a datos reales con el sync activo salvo para probar la UI; límpialo con `db:seed:demo:clean`. Se niega en producción.

`db:reset`: muestra servidor, puerto, base y esquema (sin contraseña), se niega con `NODE_ENV=production`, y exige escribir el nombre exacto de la base. `--force --i-understand` existe solo para CI/esquemas temporales y se rechaza sobre `public`. Prisma además bloquea el reset si lo lanza un agente de IA: solo lo ejecuta el usuario.

## Reporte diario en Excel
Genera un Excel con el censo de pacientes hospitalizados (novedades del día, altas una sola vez) desde la app (`/api/reports`; descarga autenticada) o a una hora configurable (Ajustes `reporte.*`). Las columnas se editan en la plantilla de tipo "Reporte Excel". Usa solo los resúmenes ya existentes: no analiza hilos por su cuenta. **Contiene datos de salud de pacientes**: guarda el archivo (RustFS `reportes/`) y los respaldos con el mismo cuidado que los correos; en producción usa Bedrock. Requiere la dependencia `exceljs` (reconstruye la imagen de la api). Además, desde un ticket analizado y en `listo` se puede «Añadir al Excel»: la IA prepara un borrador de la actualización (una llamada con la síntesis vigente), el usuario lo revisa y confirma, y queda en la hoja acumulativa «Eventos» (`/api/threads/:id/event-draft`, `/api/threads/:id/events`, `DELETE /api/events/:id`). Tras actualizar aplica la migración `20261012100000_eventos_hospitalizacion` (en Docker con hot reload: `docker compose restart api`).

## Estado
Ver `docs/estado-del-proyecto.md`. Convenciones y reglas para agentes: `CLAUDE.md` / `AGENTS.md`.
