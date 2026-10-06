# auto-med

Síntesis con IA de hilos de Outlook (tickets), con OCR de PDFs escaneados y corrección humana de las zonas dudosas.

> El análisis (OCR + IA) es siempre bajo petición del usuario: el correo se sincroniza y se guarda, pero ningún hilo se envía a OCR ni a un LLM hasta que lo pides (`POST /api/threads/:id/analyze`, o `seguimiento` para reanalizar hilos ya analizados cuando llegan mensajes nuevos).

## Estructura
```
apps/api   NestJS + Prisma + PostgreSQL
apps/web   Vite + React + Tailwind (mobile-first, español)
docs/      estado-del-proyecto.md, despliegue.md, benchmark-ocr.md, entra-id-registro.md
services/pdf-extract  PDF digital -> markdown con PyMuPDF (sin OCR; siempre activo en compose)
services/ocr-local  OCR local (PaddleOCR/Tesseract, perfil `ocr`, solo pruebas)
docker-compose.yml  rustfs, api, web (Postgres externo vía DATABASE_URL_DOCKER en .env)
docker-compose.dev.yml  hot reload en Docker (solo desarrollo, se activa con COMPOSE_FILE en .env)
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
# Con OCR_ENGINE=local en .env levanta también ocr-local; con LLM_PROVIDER=ollama, ollama + ollama-pull (GPU).
# `pdf-extract` (PDF digital -> markdown sin OCR) se levanta siempre; la API usa OCR solo en páginas escaneadas.
# Requiere COMPOSE_PROFILES=${OCR_ENGINE},${LLM_PROVIDER} en .env (ver .env.example).
```
### Desarrollo con Docker y hot reload
Añade a tu `.env` local (gitignored) esta línea (en `.env.example` está comentada; no la pongas en producción):
```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml
```
Después `docker compose up` (sin `--build` en cada cambio) usa `docker-compose.dev.yml`: la api corre `nest start --watch` con `src/` y `prisma/` montados, y la web corre el servidor de Vite. En dev entra por **http://localhost:5173** (no :8080); la api sigue en :3000 y `WEB_ORIGIN` se fija a `http://localhost:5173`. Reconstruye con `docker compose up --build` solo si cambian dependencias (`package.json`/lockfile). Si el hot reload no detecta cambios, añade `CHOKIDAR_USEPOLLING=true` al `.env`. El cliente Prisma se regenera en cada arranque de la api. Para volver al modo producción local, comenta la línea `COMPOSE_FILE` o usa `docker compose -f docker-compose.yml up -d --build`.

Guía completa (variables, Entra ID, Textract/Bedrock, backups, problemas): `docs/despliegue.md`. Medir el OCR con tus PDFs: `docs/benchmark-ocr.md`.

## Comandos
`pnpm build` · `pnpm lint` · `pnpm test` · `pnpm --filter api test:e2e-flow` (flujo completo con mocks, esquema temporal) · `pnpm --filter web test` (vitest) · `pnpm --filter api prisma:migrate`

## Configuración
Ver `.env.example` (raíz) (BD, S3/RustFS, `JWT_SECRET`, Microsoft Graph, `OCR_ENGINE`, `LLM_PROVIDER`). `JWT_SECRET` es obligatorio (`openssl rand -base64 48`).

## Variables de Microsoft (Entra ID)
Acepta cuentas de trabajo de cualquier inquilino y cuentas personales de Microsoft. En <https://entra.microsoft.com>:

1. **Identidad -> Aplicaciones -> Registros de aplicaciones -> Nuevo registro**. Nombre `auto-med`; tipos de cuenta: **Cuentas en cualquier directorio organizativo (multiinquilino) y cuentas personales de Microsoft**; URI de redirección: plataforma **Web**, `http://localhost:3000/api/auth/callback`.
2. `MS_CLIENT_ID`: en **Información general**, *Id. de aplicación (cliente)*.
3. `MS_TENANT_ID=common` (no uses el GUID del directorio: limitaría el acceso a ese inquilino).
4. `MS_CLIENT_SECRET`: **Certificados y secretos -> Nuevo secreto de cliente**; copia la columna **Valor** (solo se muestra una vez).
5. **Permisos de API -> Microsoft Graph -> Permisos delegados**: `Mail.Read`, `offline_access`, `User.Read`. No requieren consentimiento de administrador.
6. Comprueba en **Manifiesto** que `signInAudience` sea `AzureADandPersonalMicrosoftAccount`.
7. `.env` (raíz):
```
MS_TENANT_ID=common
MS_CLIENT_ID=<id de aplicación>
MS_CLIENT_SECRET=<valor del secreto>
MS_REDIRECT_URI=http://localhost:3000/api/auth/callback   # idéntica a la registrada (plataforma Web)
TOKEN_ENC_KEY=<openssl rand -base64 32>
JWT_SECRET=<openssl rand -base64 48>
```
Luego: `pnpm --filter api prisma:migrate`, crear usuario (abajo), `pnpm dev`, iniciar sesión y **Ajustes -> Conectar Outlook**. Detalle: `docs/entra-id-registro.md`.

## Primer usuario y conexión con Outlook
La app tiene su propio login (correo + contraseña); Outlook se conecta después desde **Ajustes -> Conectar Outlook**.
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

Variables del seed (todas opcionales, ver `.env.example`): `SEED_USER_EMAIL`, `SEED_USER_NAME`, `SEED_USER_PASSWORD`. Si están las tres y no es `NODE_ENV=production`, `db:seed` crea un usuario de DESARROLLO con las mismas validaciones/argon2id que `user:create` (si ya existe no lo toca; adopta la cuenta de Outlook huérfana igual que `user:create`, y lo avisa). Nunca imprime contraseñas ni hashes.

`db:seed:demo`: los tickets demo NO son correos reales; su cuenta `demo@demo.invalid` no tiene tokens de Microsoft, así que el sync no los toca ni los mezcla. No lo corras junto a datos reales con el sync activo salvo para probar la UI; límpialo con `db:seed:demo:clean`. Se niega en producción.

`db:reset`: muestra servidor, puerto, base y esquema (sin contraseña), se niega con `NODE_ENV=production`, y exige escribir el nombre exacto de la base. `--force --i-understand` existe solo para CI/esquemas temporales y se rechaza sobre `public`. Prisma además bloquea el reset si lo lanza un agente de IA: solo lo ejecuta el usuario.

## Estado
Ver `docs/estado-del-proyecto.md`. Convenciones y reglas para agentes: `CLAUDE.md` / `AGENTS.md`.
