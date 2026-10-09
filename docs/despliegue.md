# Despliegue y operación

Guía para dejar auto-med funcionando (1 usuario, 1 buzón de Outlook). Todo en español; los comandos se ejecutan desde la raíz del repo.

## 1. Requisitos
- Docker + Docker Compose v2 (servicios `rustfs`, `api`, `web` y `ocr-local`).
- Node 22 y pnpm 11 (solo para desarrollo local, migraciones manuales o el benchmark).
- Un PostgreSQL **externo** accesible desde la máquina y desde los contenedores (el compose no lo incluye).
- Una cuenta Microsoft (Outlook / Microsoft 365) y permiso para registrar una app en Entra ID (ver `docs/entra-id-registro.md`).
- Un proveedor de LLM: API key de Anthropic u OpenAI (pruebas) o AWS Bedrock (producción).
- Para OCR en producción: cuenta AWS con Textract. Para pruebas sin AWS: el servicio local `services/ocr-local` (PaddleOCR/Tesseract, solo CPU).

## 2. Configurar `.env` paso a paso
```bash
cp .env.example .env     # el .env vive en la RAÍZ y NO se sube a git
openssl rand -base64 32  # genera TOKEN_ENC_KEY
```
Un único `.env` lo leen la api, Prisma, docker compose y el benchmark.

| Variable | Qué es |
|---|---|
| `PORT` | Puerto de la API (3000). |
| `WEB_ORIGIN` | Origen del front (CORS y redirección tras el login). Dev: `http://localhost:5173`; con compose se fija a `http://localhost:5173 (dev) o :3000 (imagen única)`. |
| `DATABASE_URL` | Conexión a PostgreSQL **desde tu máquina** (desarrollo, migraciones, benchmark, tests). Usa `localhost`. |
| `DATABASE_URL_DOCKER` | La misma BD **vista desde el contenedor de la api**: normalmente `host.docker.internal` en lugar de `localhost` (compose añade `extra_hosts: host.docker.internal:host-gateway`). Es obligatoria para `docker compose up`. |
| *(almacenamiento)* | Ya no va en `.env`: se configura en la web (Ajustes -> Almacenamiento y asistente de bienvenida). En dev, el RustFS del compose usa `rustfsadmin` / `rustfsadmin` en `http://rustfs:9000`. **Cambia esas claves** fuera de tu máquina. |
| `TOKEN_ENC_KEY` | Clave AES-GCM (32 bytes en base64) para cifrar el refresh token de Microsoft. Si la cambias, hay que volver a conectar Outlook (Ajustes). |
| `JWT_SECRET` | **Obligatorio**, mínimo 32 caracteres (`openssl rand -base64 48`). Firma el JWT de sesión; sin él la API no arranca. Si lo cambias, todas las sesiones se cierran. |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | Duración del JWT de acceso (`15m`) y del refresh token (`30d`, rotativo). |
| `COOKIE_SECURE` | (opcional) `true`/`false` fuerza el atributo `Secure` de las cookies de sesión; vacío = se deduce de la URL de redirección de Microsoft configurada en Ajustes (https => Secure). En producción tras HTTPS: `true`. |
| `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_REDIRECT_URI` | (opcionales, ya no están en `.env.example`) Valores por defecto del OAuth de Microsoft; lo normal es pegarlos en **Ajustes -> Microsoft** (el panel manda sobre `.env`). Ver sección 6. |
| `SYNC_INTERVAL_MIN` | Cada cuántos minutos se sincroniza el correo (solo descarga/guarda; nunca analiza). `0` lo desactiva. |
| `JOBS_ENABLED`, `JOBS_CONCURRENCY`, `JOBS_POLL_MS`, `JOBS_MAX_ATTEMPTS`, `JOBS_BACKOFF_*`, `JOBS_LOCK_TIMEOUT_SEC` | Cola de trabajos en PostgreSQL. `JOBS_ENABLED=false` apaga el worker **y** el polling del sync (útil para verificar el despliegue sin tocar nada externo). |
| `PDF_TEXT_MODE`, `PDF_TEXT_MIN_CHARS` | (opcionales) Extractor de PDF digital en Node, dentro del proceso de la API (`node` por defecto; `off` = todo por OCR). Las páginas con capa de texto (>= `PDF_TEXT_MIN_CHARS` caracteres, 60 por defecto, y que no sean un escaneo con texto residual) pasan a markdown sin OCR (`OcrPage.engine='pdf-text'`, sin regiones a revisar); las escaneadas siguen por OCR. No hay servicio Python aparte. |
| `OCR_RENDER_DPI`, `OCR_CONFIDENCE_THRESHOLD`, `OCR_VISION_*`, `OCR_LOCAL_TIMEOUT_MS`, `TEXTRACT_MODE` | (opcionales, ya no están en `.env.example`) Valores por defecto de OCR; casi todo se cambia en Ajustes -> OCR. Ver `docs/benchmark-ocr.md`. |
| `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES`, `LLM_MAX_OUTPUT_TOKENS`, `LLM_TEMPERATURE`, `SYNTH_MAX_INPUT_TOKENS` | (opcionales) Límites y costo del LLM. |
| (no van en `.env`) | **Proveedor LLM, modelos, claves (Anthropic/OpenAI), URL de Ollama, región AWS y motor OCR (`local`/`textract`) se eligen en la web** (asistente de bienvenida en el primer inicio de sesión, Ajustes -> Inteligencia artificial y Ajustes -> OCR) y se guardan en la base de datos (claves cifradas). Las variables `LLM_*`, `*_API_KEY`, `OLLAMA_BASE_URL`, `AWS_REGION`, `OCR_ENGINE` aún se leen como valores por defecto, pero ya no se documentan. Las credenciales de Bedrock/Textract siguen siendo las estándar de AWS (rol o variables), no se piden en la web. |
| `AWS_REGION` (+ credenciales AWS estándar) | Región para Bedrock y Textract. |
| `VITE_API_URL` | Solo desarrollo del front (`pnpm dev`). |

## 3. Levantar con Docker Compose
> `docker-compose.yml` es SOLO de desarrollo (hot reload, web en Vite :5173). Producción es la imagen única del `Dockerfile` raíz (web + api + OCR local en un contenedor, sin RustFS; solo expone :3000; volumen `/models`; el almacenamiento S3 —RustFS o AWS— se configura en la web; `docker run --env-file .env`).

```bash
docker compose up -d --build
docker compose ps          # api debe quedar "healthy"
curl localhost:3000/api/health    # {"status":"ok","db":true,"storage":true}
```
- Desarrollo (compose): web http://localhost:5173 (Vite); API directa :3000; consola RustFS :9001. Producción (imagen única): todo en http://localhost:3000.
- La api ejecuta `prisma migrate deploy` en cada arranque (aplica solo migraciones pendientes) y crea el bucket si no existe.
- `GET /api/health` es público y siempre responde 200; mira el cuerpo: `status: "degraded"` indica BD o RustFS inaccesibles. El `healthcheck` de compose solo comprueba que la api responde.
- Para verificar sin efectos externos: `JOBS_ENABLED=false docker compose up -d --build` (no sincroniza ni procesa).

### PostgreSQL del host
La api (en contenedor) debe poder llegar a Postgres en el host:
- `listen_addresses` debe incluir la interfaz del bridge de Docker (p. ej. `'*'` o `'localhost,172.17.0.1'`).
- `pg_hba.conf` debe permitir la subred de Docker (p. ej. `host automed automed 172.16.0.0/12 scram-sha-256`) y recargar (`SELECT pg_reload_conf();`).
- Si Postgres corre en otro contenedor con el puerto publicado, `host.docker.internal:5432` también funciona.
- Si el firewall del host bloquea el bridge, permite el puerto 5432 desde la red de Docker.

### Ollama (URL externa, editable en la web)
Ollama NO forma parte del compose: lo instalas donde quieras (el equipo que hace de host, otro servidor de tu red, etc.) y pones su URL en **Ajustes -> Inteligencia artificial**. El contenido sensible no sale de tu red. Para el Ollama del propio host desde el contenedor `api` la URL es `http://host.docker.internal:11434/v1` (el compose añade `extra_hosts: host.docker.internal:host-gateway`); fuera de Docker (`pnpm dev`), `http://localhost:11434/v1`.
1. En el servidor de Ollama, que escuche fuera de loopback y use un contexto suficiente: `OLLAMA_HOST=0.0.0.0` y `OLLAMA_CONTEXT_LENGTH=8192` (con systemd: `sudo systemctl edit ollama` y añade `Environment="OLLAMA_HOST=0.0.0.0"` / `Environment="OLLAMA_CONTEXT_LENGTH=8192"`, luego `sudo systemctl restart ollama`). Es un ajuste único en ese servidor, como con Postgres. Abre el puerto 11434 en el firewall solo a quien lo necesite.
2. **Autodetección:** al abrir el asistente (o Ajustes -> IA) la API prueba la URL configurada y, en Docker, `host.docker.internal`, el gateway de la red del contenedor y `localhost` (`GET /api/settings/ia/hardware`: `ollama.urlDetectada`, `ollama.motivo`). Si ninguna responde, la web muestra los pasos para exponer Ollama.
3. La app descarga el modelo recomendado `qwen3-vl:4b-instruct` (~3,3 GB; requiere Ollama >= 0.12.7; usa la variante `-instruct`: el tag `qwen3-vl:4b` es la de razonamiento) en ese servidor.
4. El contexto por defecto de Ollama (4096) trunca las síntesis: `SYNTH_MAX_INPUT_TOKENS` (Ajustes -> IA) debe quedar por debajo de `OLLAMA_CONTEXT_LENGTH` menos margen (p. ej. 6000).
Prueba desde el contenedor: `docker compose exec api node -e "fetch('http://host.docker.internal:11434/api/version').then(r=>r.text()).then(console.log)"`. Alternativas sin Ollama propio: OpenAI/Anthropic por API key, o Bedrock (producción) con credenciales AWS.

### Espacio en disco y builds
- La imagen de `ocr-local` (PaddlePaddle) es la más pesada y se construye en dos etapas (builder + imagen final) para que el pico de disco sea bajo. Presupuesto en reposo: ~4-5 GB (ocr-local ~2 GB, resto ~1,5 GB, más lo que crezca el volumen `rustfsdata`). Con poco espacio, construye de a un servicio (`docker compose build ocr-local`) y vigila `df -h /`.
- **Espacio en disco:** tras cada `--build` ejecuta `./scripts/docker-clean.sh` (poda caché de build e imágenes sin etiqueta; nunca toca volúmenes).
- Límite de la caché de BuildKit en `/etc/docker/daemon.json`: `{"builder": {"gc": {"enabled": true, "defaultKeepStorage": "5GB"}}}` y `sudo systemctl restart docker`.

### Servicio OCR local (`ocr-local`, siempre activo en la versión web)
```bash
docker compose up -d ocr-local     # :8000 (sin perfil: ya corre con `docker compose up`); la api lo usa por http://ocr-local:8000
curl localhost:8000/health    # {"ok":true,"engine":"paddle","fallback_reason":null}
```
- La imagen pesa ~2 GB (PaddlePaddle + Tesseract; build en dos etapas); los modelos se descargan al primer arranque al volumen `ocrmodels`.
- `engine` indica el motor activo. Si PaddleOCR no carga, el servicio cae a Tesseract **y lo dice** en `fallback_reason` y en los logs. `OCR_LOCAL_ENGINE=tesseract` fuerza Tesseract.

## 4. Cambiar a Textract (producción)
1. En la web (Ajustes -> OCR) elige Textract y la región (`AWS_REGION` con Textract); `TEXTRACT_MODE=detect` (o `analyze`) es override opcional en `.env`.
2. Credenciales AWS estándar para el proceso de la api: rol IAM (si corre en AWS) o `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` en el `.env`.
3. IAM mínimo (sin acceso a S3; las imágenes se envían como bytes):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["textract:DetectDocumentText", "textract:AnalyzeDocument"],
    "Resource": "*"
  }]
}
```
(Si solo usas `TEXTRACT_MODE=detect`, basta `textract:DetectDocumentText`.) Textract síncrono limita a 10 MB por imagen: si una página lo supera, baja `OCR_RENDER_DPI`.
4. Con Textract, el contenedor `ocr-local` puede quedar sin usar (no lo necesita).

## 5. Bedrock como LLM
1. En la web (bienvenida o Ajustes -> Inteligencia artificial) elige Bedrock y la región.
2. **Verifica el ID del modelo en tu región**: el valor por defecto `anthropic.claude-sonnet-5-5` es una suposición. En la consola de Bedrock > *Model catalog* (o con `aws bedrock list-foundation-models --region <r> --by-provider anthropic` y `aws bedrock list-inference-profiles --region <r>`) copia el **Model ID** o el **ID del perfil de inferencia** (p. ej. `us.anthropic....`) y ponlo en el modelo de cada tarea en Ajustes -> Inteligencia artificial. Confirma que tu cuenta tiene acceso al modelo en esa región.
3. IAM mínimo (la API Converse usa `bedrock:InvokeModel`):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["bedrock:InvokeModel"],
    "Resource": [
      "arn:aws:bedrock:<region>::foundation-model/<model-id>",
      "arn:aws:bedrock:<region>:<cuenta>:inference-profile/<profile-id>"
    ]
  }]
}
```
Con un perfil de inferencia entre regiones, el permiso debe cubrir el perfil **y** el modelo base en las regiones que el perfil use (suele hacerse con `arn:aws:bedrock:*::foundation-model/<model-id>`).
4. Prueba con un hilo corto antes de analizar muchos.

## 6. Registro en Entra ID y config de Microsoft desde Ajustes
Sigue `docs/entra-id-registro.md` (registro de app web con secreto de cliente, permisos delegados `Mail.Read`, `offline_access` y `User.Read`, URI de redirección). Registra la app como "Cuentas en cualquier directorio organizativo y cuentas personales de Microsoft".

Los datos NO hace falta ponerlos en `.env`: se pegan en **Ajustes -> Microsoft** (id de aplicación, inquilino `common`, secreto de cliente y URI de redirección; el secreto se guarda cifrado y no se vuelve a mostrar). La web sugiere la URI de redirección `<WEB_ORIGIN>/api/auth/callback` (con compose, `http://localhost:5173 (dev) o :3000 (imagen única)/api/auth/callback`; en producción tu URL HTTPS pública), que debe coincidir exactamente con la registrada en Entra. Precedencia: panel > `MS_*` de `.env` (siguen valiendo como valores por defecto). El consentimiento es por cuenta conectada. Si el tenant de esa cuenta exige aprobación de administrador, el documento incluye el texto para pedirla.

## 7. Primer arranque
1. `docker compose up -d --build` (la API aplica las migraciones al arrancar; requiere `JWT_SECRET` en `.env`).
2. **Crea tu usuario** (la contraseña se pide por prompt, sin eco, mín. 10 caracteres; nunca por argumentos):
   ```bash
   docker compose exec api node dist/cli/user.js create --email tu@correo.com --nombre "Tu nombre"
   # sin Docker (desde la raíz): pnpm --filter api user:create -- --email tu@correo.com --nombre "Tu nombre"
   ```
   Si ya existía una cuenta de Outlook de antes de la fase 8, queda asignada a este primer usuario (con sus tickets). Para restablecer una contraseña: `docker compose exec api node dist/cli/user.js reset-password --email tu@correo.com` (cierra todas sus sesiones).
3. Abre http://localhost:5173 (dev) o :3000 (imagen única), **inicia sesión** con ese correo y contraseña, rellena **Ajustes -> Microsoft** (ver sección 6), ve a **Ajustes -> Conectar Outlook** y acepta los permisos de Microsoft. Volverás a Ajustes con "Outlook conectado".
4. **Sincronizar** (botón en Tickets, o espera `SYNC_INTERVAL_MIN`). Los hilos aparecen como *Sin analizar*; no se ha enviado nada a OCR ni al LLM.
5. Abre **un hilo de prueba** (de preferencia sin datos sensibles) y pulsa **Analizar**. Espera a *Listo* o *Necesita tu ayuda*.
6. Si hay dudas, abre la revisión, corrige y verifica que la síntesis se actualiza (solo con lo nuevo).
7. Revisa y ajusta la plantilla en **Plantilla**.

## 7b. Scripts de base de datos (`db:*`)

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

En producción usa solo `db:deploy` (y `db:seed` si quieres la plantilla/ajustes por defecto; el usuario se crea con `user:create`).

## 8. Backups
- **PostgreSQL**: `pg_dump -Fc -h <host> -U <usuario> automed > automed-$(date +%F).dump`; restaurar con `pg_restore -c -d automed archivo.dump`. Incluye correos, OCR, correcciones, síntesis y el refresh token cifrado (guarda también `TOKEN_ENC_KEY` en un lugar seguro: sin ella los tokens guardados no se pueden descifrar).
- **Layout de RustFS y migración**: los objetos se guardan por hilo: `hilos/<threadId>/pdf_<n>/original.pdf` y `hilos/<threadId>/pdf_<n>/pagina_<k>.png` (bucket `automed`; consola :9001). Lo guardado antes del cambio (`attachments/<sha>.pdf`, `pages/<sha>/<n>.png`) sigue funcionando (el visor cae a la clave antigua), pero conviene migrarlo. Tras actualizar: `docker compose restart api` y luego, en este orden: (1) simulación, no cambia nada: `docker compose exec api node dist/cli/storage-migrate.js`; (2) migrar: `docker compose exec api node dist/cli/storage-migrate.js --apply` (copia y actualiza la BD; idempotente, se puede repetir); (3) cuando verifiques que las imágenes de la revisión cargan, borrar lo antiguo sin referencias: `... --apply --delete-old`. En desarrollo: `pnpm --filter api storage:migrate [-- --apply [--delete-old]]`. Haz antes una copia de la BD y del volumen.
- **RustFS**: los PDFs y páginas viven en el volumen `auto-med_rustfsdata`. Copia en frío: `docker run --rm -v auto-med_rustfsdata:/data -v "$PWD":/backup alpine tar czf /backup/rustfs-$(date +%F).tgz -C /data .` (detén `rustfs` antes para consistencia). Alternativa: `mc mirror`/`aws s3 sync --endpoint-url http://localhost:9000 s3://automed ./backup-s3`.
- Las páginas rasterizadas se regeneran desde los PDFs; los PDFs originales también están en Outlook.
- Prueba restaurar de vez en cuando.

## 8b. Reporte diario en Excel (datos sensibles de salud)
El reporte (`/api/reports`) contiene nombres, diagnósticos, montos y pendientes de pacientes hospitalizados. Los `.xlsx` se guardan en RustFS bajo `reportes/AAAA-MM-DD/` (incluye esas rutas en tus políticas de acceso y backups) y solo se descargan con sesión. En producción el LLM debe ser Bedrock (elegido en la web); con Ollama/API keys son solo pruebas. La API nueva depende de `exceljs`: tras actualizar usa `docker compose up -d --build api` (en dev con hot reload también hay que reconstruir la imagen para instalar la dependencia). La bitácora de eventos (tabla `HospitalEvent`, migración `20261012100000_eventos_hospitalizacion`) también contiene datos de pacientes: inclúyela en los respaldos de la base; la migración se aplica con `prisma:deploy` o reiniciando la api (`docker compose restart api`). La programación diaria usa `Setting` `reporte.programado|hora|zona` (zona por defecto `America/Mexico_City`) y se evalúa en el worker de la API, por lo que la API debe estar encendida a esa hora (si estaba apagada, se genera al volver a arrancar el mismo día).

## 9. Actualizar
```bash
git pull
docker compose up -d --build     # reconstruye y aplica migraciones al arrancar
docker compose ps && curl localhost:3000/api/health
```
Haz backup de la BD antes de actualizar si hay migraciones nuevas (`apps/api/prisma/migrations`). Las migraciones son hacia adelante (`migrate deploy`).

## 9b. Notas manuscritas y resúmenes largos
Todo se configura desde la web, sin reiniciar (el `.env` solo da valores por defecto):
1. En producción elige el motor **Textract** en Ajustes -> OCR y, en «Opciones avanzadas de lectura», el modo «Formularios y tablas (mejor con letra a mano)».
2. Activa «Releer con IA las partes dudosas (letra a mano)» en las mismas opciones, y elige un modelo con visión para la tarea «vision» en Ajustes -> IA.
3. Si una nota tiene muchas partes dudosas, sube «Máximo de partes a releer» (defecto 30; 80 para una nota completa). «Calidad de lectura» a 300 DPI ayuda con letra pequeña (más lento).
4. Cuidado con el coste y la privacidad: cada parte dudosa hace una llamada de visión. Son datos de salud; en producción usa Bedrock.
5. Sigue corrigiendo las zonas con recuadro rojo desde el celular: lo que corriges tiene prioridad y solo se regenera el documento afectado.
6. Si el resumen falla por longitud, sube «Longitud máxima de cada resumen» en Ajustes -> IA (defecto 16000; algunos modelos aceptan menos).
7. Leer páginas completas como imagen (visión por página completa) queda como siguiente fase; no está hecho.

## 10. Solución de problemas
| Síntoma | Causa probable / qué hacer |
|---|---|
| `docker compose up` dice "Define DATABASE_URL_DOCKER" | Falta la variable en `.env` raíz. |
| api no queda `healthy`; logs: "Can't reach database server" | Postgres del host no acepta conexiones desde Docker: ver "PostgreSQL del host"; revisa usuario/clave y `host.docker.internal`. |
| `/api/health` responde `db:false` | Igual que arriba, o la BD cambió de contraseña. |
| `storage:false` | RustFS no arrancó o las claves S3 no coinciden con las del volumen existente (RustFS conserva las claves con las que se creó). |
| Conectar Outlook: `redirect_uri` no coincide | La URL de redirección en Ajustes -> Microsoft debe ser idéntica a la registrada en Entra. |
| Tras iniciar sesión vuelve a la pantalla de entrada | Cookie no enviada: con HTTPS pon `COOKIE_SECURE=true` y usa el mismo host; revisa `WEB_ORIGIN`. |
| "La conexión con Outlook caducó" | Ajustes -> Conectar Outlook de nuevo (token revocado, o cambiaste `TOKEN_ENC_KEY`). |
| La API no arranca: "JWT_SECRET falta o es demasiado corto" | Define `JWT_SECRET` (>= 32 caracteres) en `.env`. |
| "Demasiados intentos" al iniciar sesión | Límite de 5 intentos por minuto por IP y correo; espera un minuto. |
| Login 403 "Origen no permitido" | El navegador envía un `Origin` distinto de `WEB_ORIGIN`; ajústalo al origen real del front. |
| Hilos siempre en *Sin analizar* | Es lo esperado: el análisis es solo bajo petición (botón **Analizar**). |
| Análisis en *Error* | Mira `GET /api/jobs/status` y los logs de la api (no contienen contenido de correos). Reintenta con Analizar. |
| OCR local devuelve `engine: tesseract` | PaddleOCR no cargó: lee `fallback_reason` en `/health`. Funciona, pero con menos precisión en manuscrito. |
| Textract: `AccessDenied` / imagen > 10 MB | Revisa IAM (sección 4) y baja `OCR_RENDER_DPI`. |
| Bedrock: `ValidationException` / modelo no encontrado | ID de modelo o perfil incorrecto para la región (sección 5). |
| Muchas "dudas" en documentos limpios | Ajusta `OCR_CONFIDENCE_THRESHOLD` con `docs/benchmark-ocr.md`. |
