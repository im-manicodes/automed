# auto-med

Síntesis con IA de hilos de Outlook (tickets), con OCR de PDFs escaneados y corrección humana de las zonas dudosas.

> El análisis (OCR + IA) es siempre bajo petición del usuario: el correo se sincroniza y se guarda, pero ningún hilo se envía a OCR ni a un LLM hasta que lo pides (`POST /api/threads/:id/analyze`, o `seguimiento` para reanalizar hilos ya analizados cuando llegan mensajes nuevos).

## Estructura
```
apps/api   NestJS + Prisma + PostgreSQL
apps/web   Vite + React + Tailwind (mobile-first, español)
apps/desktop  instalable de escritorio (Electron; Postgres embebido; Windows y Linux)
docs/      estado-del-proyecto.md, despliegue.md, benchmark-ocr.md, entra-id-registro.md, instalable.md
services/pdf-extract  PDF digital -> markdown con PyMuPDF (sin OCR; siempre activo en compose)
services/ocr-local  OCR local (PaddleOCR/Tesseract, perfil `ocr`, solo pruebas)
docker-compose.yml  rustfs, api, web (Postgres externo vía DATABASE_URL_DOCKER en .env)
Dockerfile  imagen única de producción (API + frontend + pdf-extract); la publica el CI en GHCR
docker-compose.dev.yml  hot reload en Docker (solo desarrollo, se activa con COMPOSE_FILE en .env)
deploy/dokku  bootstrap.sh y env.example para preparar Dokku en el Droplet
.github/workflows/deploy.yml  CI/CD: build -> GHCR -> Dokku (DigitalOcean)
.github/workflows/release-desktop.yml  release del instalable (tag `v*` o manual; release en borrador)
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
# `ocr-local` (OCR local en CPU) y `pdf-extract` arrancan siempre; `relay` NO arranca solo: actívalo con `--profile relay`. Ollama no va en Docker: usa el instalado en tu equipo (docs/despliegue.md).
# `pdf-extract` (PDF digital -> markdown sin OCR) se levanta siempre; la API usa OCR solo en páginas escaneadas.
# o con COMPOSE_PROFILES=relay en .env (opcional, ver .env.example). El proveedor de IA y el OCR se eligen en la web.
```
### Desarrollo con Docker y hot reload
Añade a tu `.env` local (gitignored) esta línea (en `.env.example` está comentada; no la pongas en producción):
```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml
```
Después `docker compose up` (sin `--build` en cada cambio) usa `docker-compose.dev.yml`: la api corre `nest start --watch` con `src/` y `prisma/` montados, y la web corre el servidor de Vite. En dev entra por **http://localhost:5173** (no :8080); la api sigue en :3000 y `WEB_ORIGIN` se fija a `http://localhost:5173`. Reconstruye con `docker compose up --build` solo si cambian dependencias (`package.json`/lockfile). Si el hot reload no detecta cambios, añade `CHOKIDAR_USEPOLLING=true` al `.env`. El cliente Prisma se regenera en cada arranque de la api. Para volver al modo producción local, comenta la línea `COMPOSE_FILE` o usa `docker compose -f docker-compose.yml up -d --build`.

Guía completa (variables, Entra ID, Textract/Bedrock, backups, problemas): `docs/despliegue.md`. Medir el OCR con tus PDFs: `docs/benchmark-ocr.md`.

## Despliegue en producción (GitHub Actions + GHCR + Dokku en DigitalOcean)
Cada push a `main` construye **una sola imagen** (`Dockerfile` de la raíz: API + frontend compilado + `pdf-extract`) y la sube a GitHub Container Registry (`ghcr.io/<owner>/<repo>`). Esa imagen es portable: se puede correr con `docker run`, Docker Compose o cualquier plataforma que acepte imágenes. Aquí se despliega con **Dokku** en un Droplet de DigitalOcean: la app `automed` (única pública, con HTTPS de Let's Encrypt), `rustfs` (almacenamiento) y un Postgres del plugin oficial, unidos por una red interna. Los secretos de la app viven en la config de Dokku, no en GitHub. Los pasos 1 a 5 se hacen una sola vez; después basta con `git push`.

> **Aún sin servidor:** mientras no definas la variable de repositorio `DEPLOY_ENABLED=true` (paso 4), cada push solo construye y publica la imagen, sin intentar desplegar.

La imagen lee su configuración de variables de entorno (ver `.env.example` y `deploy/dokku/env.example`) y necesita un PostgreSQL y un almacenamiento S3 (`S3_ENDPOINT`, `S3_BUCKET`, claves). Al arrancar aplica las migraciones y sirve la app en el puerto 3000 (`/api/health` para comprobarla). Como `pdf-extract` va dentro, `PDF_TEXT_MODE=off` lo desactiva.

> Necesitas: un dominio (o subdominio) cuyo DNS controles, cuenta de DigitalOcean, este repositorio en GitHub y los datos de producción (Entra ID, AWS Bedrock/Textract; ver `docs/despliegue.md`).

### 1. Crear el Droplet e instalar Dokku
1. En DigitalOcean crea un Droplet **Ubuntu 24.04** (mínimo 4 GB de RAM) y anota su IP.
2. En tu DNS crea un registro **A** (p. ej. `automed.tudominio.com`) hacia esa IP.
3. Entra por SSH como root, abre solo lo necesario e instala Dokku con el comando oficial de <https://dokku.com/docs/getting-started/installation/> (descarga `bootstrap.sh` de la versión vigente y ejecútalo; necesitas Dokku 0.35 o superior).
```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```
(Docker se instala con Dokku.) Solo se publican 80 y 443; Postgres y RustFS no son accesibles desde fuera.

### 2. Crear la clave SSH de GitHub Actions
En tu máquina (clave nueva, solo para esto, sin contraseña):
```bash
ssh-keygen -t ed25519 -f ./deploy_key -C "github-actions" -N ""
scp ./deploy_key.pub root@<IP-DEL-DROPLET>:/root/deploy_key.pub
ssh-keyscan -t ed25519 <IP-DEL-DROPLET>      # guarda la salida: es DOKKU_KNOWN_HOSTS
```
`deploy_key` (privada) va a un secret de GitHub; luego bórrala de tu máquina o guárdala en un gestor de contraseñas. No la subas al repositorio.

### 3. Preparar Dokku con el script de arranque
1. Crea un token para que el Droplet descargue las imágenes: GitHub -> Settings -> Developer settings -> **Personal access tokens (classic)** -> permiso único `read:packages`.
2. Copia a tu servidor el script y la plantilla de variables, y rellénala:
```bash
scp deploy/dokku/bootstrap.sh deploy/dokku/env.example root@<IP-DEL-DROPLET>:/root/
ssh root@<IP-DEL-DROPLET>
cd /root && mv env.example automed.env && chmod 600 automed.env && nano automed.env
```
Rellena como mínimo `DOMAIN`, `LETSENCRYPT_EMAIL`, `S3_ACCESS_KEY` y `S3_SECRET_KEY` (aleatorios largos: `openssl rand -base64 24`), `TOKEN_ENC_KEY` (`openssl rand -base64 32`), `JWT_SECRET` (`openssl rand -base64 48`), los datos de Microsoft (`MS_REDIRECT_URI=https://<DOMAIN>/api/auth/callback`) y, si usas AWS, las credenciales estándar (el proveedor LLM y el motor OCR se eligen luego en la web). Formato `CLAVE=valor`, sin comillas ni espacios.
3. Ejecuta el script (instala los plugins de Postgres y Let's Encrypt, crea la red interna, las apps, la base de datos, el volumen de RustFS y toda la configuración; se puede repetir):
```bash
GHCR_USER=<tu-usuario-de-github> GHCR_TOKEN=<el-token> ./bootstrap.sh /root/automed.env
dokku ssh-keys:add github-actions < /root/deploy_key.pub
```
4. En **Entra ID** (Registros de aplicaciones -> tu app -> Autenticación) añade la URI de redirección web `https://<DOMAIN>/api/auth/callback`, idéntica a `MS_REDIRECT_URI`.

### 4. Configurar GitHub
En el repositorio, **Settings -> Environments -> New environment** llamado `production`:

| Tipo | Nombre | Valor |
|---|---|---|
| Secret | `DOKKU_HOST` | IP o dominio del Droplet |
| Secret | `DOKKU_SSH_KEY` | contenido completo de `deploy_key` (privada) |
| Secret | `DOKKU_KNOWN_HOSTS` | salida de `ssh-keyscan` del paso 2 |
| Variable | `APP_DOMAIN` | tu dominio (`automed.tudominio.com`), para el chequeo final de salud |
| Variable | `DEPLOY_ENABLED` | `true` cuando el servidor esté listo; actívala al terminar el paso 3 |

En **Settings -> Actions -> General -> Workflow permissions** deja "Read and write permissions" (el job de construcción ya pide `packages: write`).

### 5. Primer despliegue
```bash
git push origin main
```
Sigue el avance en la pestaña **Actions**. El workflow construye la imagen y la despliega en `automed` (la app aplica las migraciones al arrancar). Cuando termine el primer despliegue, en el Droplet activa el HTTPS y crea el primer usuario:
```bash
dokku letsencrypt:enable automed && dokku letsencrypt:cron-job --add
dokku enter automed web node dist/cli/user.js create --email tu@correo.com --nombre "Tu nombre"
curl https://<DOMAIN>/api/health        # {"status":"ok","db":true,"storage":true}
```
Abre `https://<DOMAIN>`, inicia sesión y entra a **Ajustes -> Conectar Outlook**. El job final de Actions verifica `/api/health` por HTTPS, así que el primer despliegue fallará en ese paso hasta que actives Let's Encrypt (el despliegue en sí ya está hecho); vuelve a lanzar el workflow después.

### Operación diaria
- **Actualizar:** `git push origin main`. Dokku despliega sin caída: si el contenedor nuevo no arranca, deja el anterior.
- **Estado y logs:** `dokku ps:report automed`, `dokku logs automed -t`.
- **Volver a una versión anterior:** `dokku git:from-image automed ghcr.io/<owner>/<repo>:<sha-del-commit-bueno>` (cada commit queda etiquetado en GHCR con su SHA). Si ese commit incluía migraciones de BD ya aplicadas, no se deshacen solas.
- **Cambiar variables:** `dokku config:set automed CLAVE=valor` (reinicia la app) o edita `automed.env` y repite `./bootstrap.sh`.
- **Respaldos:** son datos de salud. Activa los **backups del Droplet** en DigitalOcean (incluyen el volumen de RustFS y los datos de Postgres) y haz volcados puntuales: `dokku postgres:export automed-db > respaldo.dump`. El plugin también permite respaldos programados a un S3 (`dokku postgres:backup-schedule`).

### Problemas frecuentes
| Síntoma | Causa probable |
|---|---|
| Actions falla con `Host key verification failed` | `DOKKU_KNOWN_HOSTS` vacío o de otra IP; repite `ssh-keyscan -t ed25519 <host>`. |
| `Permission denied (publickey)` | No ejecutaste `dokku ssh-keys:add` con la pública, o el secret `DOKKU_SSH_KEY` no es la privada completa. |
| `denied` o `unauthorized` al bajar la imagen | El token de `bootstrap.sh` caducó o no tiene `read:packages`; repite el script con uno nuevo. |
| La app no arranca | Falta una variable (`dokku config automed`) o BD inaccesible; revisa `dokku logs automed`. |
| El login con Microsoft vuelve con error | `MS_REDIRECT_URI` distinta a la registrada en Entra ID. |
| Error de certificado | El registro A no apunta al Droplet o 80/443 están bloqueados; revisa `dokku letsencrypt:list`. |
| 502 o error al guardar archivos | La app no alcanza RustFS o Postgres: `dokku network:report automed` y `dokku ps:report rustfs`. |

Detalle técnico del flujo: sección "CI/CD" de `docs/despliegue.md`.

## Comandos
`pnpm build` · `pnpm lint` · `pnpm test` · `pnpm --filter api test:e2e-flow` (flujo completo con mocks, esquema temporal) · `pnpm --filter web test` (vitest) · `pnpm --filter api prisma:migrate`

## Configuración
Ver `.env.example` (raíz) (BD, S3/RustFS, `JWT_SECRET`, Microsoft Graph). El proveedor de IA, los modelos, las claves y el motor OCR se configuran en la web (bienvenida / Ajustes), no en `.env`. `JWT_SECRET` es obligatorio (`openssl rand -base64 48`).

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

Variables del seed (todas opcionales; ya no figuran en `.env.example`: defínelas solo en tu `.env` local de desarrollo o en CI): `SEED_USER_EMAIL`, `SEED_USER_NAME`, `SEED_USER_PASSWORD`. Si están las tres y no es `NODE_ENV=production`, `db:seed` crea un usuario de DESARROLLO con las mismas validaciones/argon2id que `user:create` (si ya existe no lo toca; adopta la cuenta de Outlook huérfana igual que `user:create`, y lo avisa). Nunca imprime contraseñas ni hashes.

`db:seed:demo`: los tickets demo NO son correos reales; su cuenta `demo@demo.invalid` no tiene tokens de Microsoft, así que el sync no los toca ni los mezcla. No lo corras junto a datos reales con el sync activo salvo para probar la UI; límpialo con `db:seed:demo:clean`. Se niega en producción.

`db:reset`: muestra servidor, puerto, base y esquema (sin contraseña), se niega con `NODE_ENV=production`, y exige escribir el nombre exacto de la base. `--force --i-understand` existe solo para CI/esquemas temporales y se rechaza sobre `public`. Prisma además bloquea el reset si lo lanza un agente de IA: solo lo ejecuta el usuario.

## Reporte diario en Excel
Genera un Excel con el censo de pacientes hospitalizados (novedades del día, altas una sola vez) desde la app (`/api/reports`; descarga autenticada) o a una hora configurable (Ajustes `reporte.*`). Las columnas se editan en la plantilla de tipo "Reporte Excel". Usa solo los resúmenes ya existentes: no analiza hilos por su cuenta. **Contiene datos de salud de pacientes**: guarda el archivo (RustFS `reportes/`) y los respaldos con el mismo cuidado que los correos; en producción usa Bedrock. Requiere la dependencia `exceljs` (reconstruye la imagen de la api). Además, desde un ticket analizado y en `listo` se puede «Añadir al Excel»: la IA prepara un borrador de la actualización (una llamada con la síntesis vigente), el usuario lo revisa y confirma, y queda en la hoja acumulativa «Eventos» (`/api/threads/:id/event-draft`, `/api/threads/:id/events`, `DELETE /api/events/:id`). Tras actualizar aplica la migración `20261012100000_eventos_hospitalizacion` (en Docker con hot reload: `docker compose restart api`).

## Instalable de escritorio
`apps/desktop` empaqueta auto-med como programa para un solo usuario, sin servidor: Electron con PostgreSQL embebido, PDFs en disco y la API como proceso interno. Los datos quedan en la carpeta de datos de la app (en Linux `~/.config/...`, en Windows `%APPDATA%\...`; ver la guía).

```bash
./scripts/build-desktop.sh         # construye el instalable de TU sistema (instala las dependencias solo; necesita Node 22)
./scripts/build-desktop.sh all     # Linux + Windows en GitHub Actions (necesita `gh`); Windows no se puede construir desde Linux
pnpm desktop:dist:linux   # AppImage + deb en apps/desktop/release/
pnpm desktop:dist:win     # instalador NSIS x64 (.exe)
pnpm desktop:smoke        # prueba de humo del binario desempaquetado (carpeta de datos temporal)
```
Estado: el paquete de Linux se construyó y pasa la prueba de humo; **Windows no se ha probado**. Guía de instalación y operación: [`docs/instalable.md`](docs/instalable.md). Las releases en borrador las crea `.github/workflows/release-desktop.yml` al subir un tag `v*` (o a mano). Para conectar Outlook hay que registrar la app en Entra ID y fijar el `client id` en `apps/desktop/build-config.json` (ver `docs/entra-id-registro.md`).

## Estado
Ver `docs/estado-del-proyecto.md`. Convenciones y reglas para agentes: `CLAUDE.md` / `AGENTS.md`.
