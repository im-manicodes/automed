# auto-med instalable de escritorio

Guía para instalar y usar auto-med en tu propio computador (Windows o Linux), sin servidor. Al final hay una sección de operación y de solución de problemas.

> **Estado.** El paquete de Linux se construyó y pasó una prueba de humo automática. Lo demás (Windows, ventana real, instalación del `.deb`, OCR local real) **no se ha probado todavía**. Mira la sección [Qué NO está probado todavía](#qué-no-está-probado-todavía).

## Qué es y qué necesita

auto-med instalable trae todo en un solo programa: la ventana, la base de datos (PostgreSQL embebido), el almacenamiento de PDFs y la API. Tus correos, PDFs y resúmenes se guardan en tu equipo.

Necesitas:
- **Sistema:** Windows 10 o superior (64 bits), o Linux de 64 bits (x64). macOS no está soportado.
- **Internet:** para sincronizar tu correo de Outlook y para los servicios de IA en la nube (OpenAI, Anthropic, AWS Bedrock, Amazon Textract). Con IA local (Ollama) el resumen no sale de tu equipo, pero igual necesitas internet para conectar Outlook y para descargar modelos y paquetes la primera vez.
- **Memoria para IA local (Ollama):** como regla, a partir de 8 GB de RAM puedes usar el modelo local recomendado (Qwen3-VL 4B). Con menos memoria usa una IA en la nube. La pantalla de configuración de IA muestra una recomendación según tu equipo.
- **Python (solo si eliges el OCR en tu computador):** versión 3.9 a 3.12; la de referencia es la 3.11. No viene incluido (ver más abajo).

## Instalar

### Windows
1. Descarga el instalador `auto-med-<versión>-win-x64.exe` desde la página de Releases del repositorio.
2. Ábrelo. Como el instalador **no está firmado**, Windows puede mostrar "Windows protegió su PC" (SmartScreen). Pulsa **Más información** y luego **Ejecutar de todas formas**. Haz esto solo si descargaste el archivo de la release oficial de tu proyecto.
3. La instalación es por usuario (no pide permisos de administrador). Al terminar se abre la aplicación.
4. Algunos antivirus pueden revisar con lentitud o avisar por los programas de PostgreSQL que incluye; si pasa, ver [Solución de problemas](#solución-de-problemas).

### Linux
- **AppImage** (sirve en cualquier distribución):
  ```bash
  chmod +x auto-med-*-linux-x86_64.AppImage
  ./auto-med-*-linux-x86_64.AppImage
  ```
  Si el sistema no tiene FUSE y no abre, ejecútalo con `--appimage-extract-and-run`.
- **deb** (Debian, Ubuntu y derivadas):
  ```bash
  sudo apt install ./auto-med_*.deb
  ```
  (El nombre real del archivo es `auto-med-<versión>-linux-amd64.deb`.) Después busca "auto-med" en el menú de aplicaciones o ejecuta `auto-med`.

## Primer arranque

1. **Crear tu usuario.** La primera vez la app muestra la pantalla de primer uso: escribe tu nombre, tu correo y una contraseña (mínimo 10 caracteres). Es el usuario de la aplicación; no es tu cuenta de Outlook. Esta pantalla solo aparece mientras no exista ningún usuario.
2. **Asistente de bienvenida.** Te guía por tres decisiones:
   - **IA para los resúmenes:**
     - *Ollama local* (recomendado): modelo `qwen3-vl:4b-instruct` (Qwen3-VL 4B). Requiere Ollama 0.12.7 o superior. No uses el tag `qwen3-vl:4b`: es la variante de razonamiento y no sirve bien para resúmenes.
     - *OpenAI* o *Anthropic*: pegas tu clave de API en el panel (se guarda cifrada y no se vuelve a mostrar).
     - *AWS Bedrock*: usa credenciales de AWS (ver [Credenciales de AWS](#credenciales-de-aws-textract-y-bedrock)).
   - **Lectura de PDFs escaneados (OCR):** tres opciones.
     - *En tu computador* (PaddleOCR; necesita Python, ver abajo).
     - *Amazon Textract* (necesita credenciales de AWS).
     - *Configurar después*: los PDFs digitales (con texto) funcionan igual; si analizas una página escaneada, la app te pedirá configurar el OCR en Ajustes.
   - **Conectar Outlook:** en Ajustes, "Conectar Outlook". Se abre tu navegador para iniciar sesión en Microsoft y aceptar permisos de solo lectura de correo; luego vuelves a la aplicación. **Requisito del desarrollador:** esto solo funciona si el instalable se construyó con un `client id` de Microsoft Entra registrado (ver `docs/entra-id-registro.md`). En el repositorio ese valor está vacío; con el valor vacío Outlook no se puede conectar.

El análisis (OCR + IA) sigue siendo **siempre bajo petición tuya**: sincronizar el correo solo descarga y guarda.

## Instalar Python (solo para OCR en tu computador)

La app necesita Python 3.9 a 3.12 (referencia: 3.11). **Python 3.13 o superior no sirve** con los paquetes de OCR fijados. La app lo detecta, te muestra la guía de tu sistema y un botón "Verificar de nuevo".

### Windows
- Opción A: descarga el instalador de Python 3.11 desde <https://www.python.org/downloads/windows/> y, en la primera pantalla, **marca "Add python.exe to PATH"** antes de pulsar Install.
- Opción B (PowerShell o Terminal): `winget install Python.Python.3.11`
- Pulsa "Verificar de nuevo" en la app (si no lo detecta, cierra y abre auto-med: el PATH se lee al arrancar).

### Linux
- Debian/Ubuntu con Python 3.11 disponible: `sudo apt install python3.11 python3.11-venv`
- Si tu distribución trae otra versión entre 3.9 y 3.12, basta con instalar su paquete `venv` (por ejemplo `sudo apt install python3-venv`).
- Si tu distribución no tiene una versión compatible (por ejemplo solo trae 3.13), usa un repositorio alternativo (como el PPA "deadsnakes" en Ubuntu) o `pyenv`. La app muestra estas indicaciones; revisa su texto, que es el que vale para tu equipo.
- Que falte `venv` es la causa más común de fallos en Linux: instala `python3.X-venv`.

### Qué hace "Preparar el OCR"
Al pulsar el botón, la app crea un entorno virtual en `python/venv` dentro de su carpeta de datos e instala ahí los paquetes de PaddleOCR y PaddlePaddle con `pip`. Después, en el primer uso, descarga los modelos de reconocimiento a `python/models`.
- **Necesita internet** y **tarda** (varios minutos o más según tu conexión).
- La descarga total es **grande: más de 1 GB** (no se ha medido la cifra exacta). Ten espacio en disco.
- Se muestra el progreso y los errores en español. Si falla, el mensaje indica la causa (sin red, disco lleno, versión de Python).
- Python y estos paquetes **no vienen dentro del instalador**: se instalan en tu equipo.

## Instalar o actualizar Ollama (IA local)

1. Descarga Ollama desde <https://ollama.com/download> e instálalo. **Versión mínima: 0.12.7** (necesaria para Qwen3-VL). Si ya lo tienes y es más viejo, vuelve a instalar la última versión desde la misma página.
2. Opcional: descarga el modelo a mano con `ollama pull qwen3-vl:4b-instruct`. No es necesario: la app puede descargarlo desde el asistente.
3. En el asistente elige "Ollama" y pulsa "Probar".

## Credenciales de AWS (Textract y Bedrock)

Para Amazon Textract (OCR) y AWS Bedrock (IA) la app acepta una clave de acceso y su secreto, que escribes en el panel (Asistente o Ajustes -> Inteligencia artificial). Se guardan cifradas en tu base de datos local y no se vuelven a mostrar. Si no las escribes, la app usa la cadena de credenciales normal de AWS de tu equipo (variables de entorno, perfil, etc.).

Qué permisos necesita el usuario de AWS (que **debe verificar quien administra tu cuenta de AWS**; aquí no se da una política exacta):
- **Textract:** las acciones `textract:DetectDocumentText` y `textract:AnalyzeDocument`.
- **Bedrock:** la acción `bedrock:InvokeModel` sobre los modelos que uses (y acceso a esos modelos habilitado en la región elegida).

Recomendación: crea un usuario de AWS solo para auto-med con los permisos mínimos y revoca la clave si pierdes el equipo. Los documentos son datos de salud: confirma con quien corresponda que enviarlos a un servicio en la nube está permitido.

## Dónde se guardan tus datos

Todo está en la carpeta de datos de la aplicación (`userData` de Electron):

| Sistema | Carpeta |
|---|---|
| Linux | `~/.config/auto-med` |
| Windows | `%APPDATA%\auto-med` |

> Verificado en Linux con el paquete real: la carpeta se llama `auto-med` (el nombre se fija con `app.setName` en `apps/desktop/src/main.ts`). En Windows no se ha comprobado; si dudas, usa el menú **Abrir carpeta de datos**.

Contenido:
- `pg-data/`: la base de datos PostgreSQL (correos, hilos, resúmenes, ajustes).
- `storage/`: los PDFs y las imágenes de páginas.
- `python/`: el entorno de Python (`venv`) y los modelos de OCR (`models`), si preparaste el OCR local.
- `secrets.bin`: las claves internas de la app (JWT, cifrado de tokens, contraseña de la base). Se cifran con el almacén seguro del sistema (llavero / DPAPI) cuando existe.
- `logs/`: registros de la app. No contienen el contenido de correos ni PDFs.

### Respaldo
La app **no tiene** "exportar respaldo". Para respaldar: **cierra la app por completo** y copia la carpeta de datos entera. Para restaurar, cierra la app y reemplaza la carpeta. `secrets.bin` va atado a tu usuario del sistema: si lo restauras en otro usuario o equipo, puede que no se pueda leer y los datos queden inaccesibles. Los respaldos contienen datos de salud: guárdalos con el mismo cuidado.

### Desinstalar
- **Windows:** Configuración -> Aplicaciones -> auto-med -> Desinstalar.
- **Linux:** borra el AppImage, o `sudo apt remove auto-med` si instalaste el deb.
- **Los datos NO se borran** al desinstalar (a propósito). Si quieres eliminarlos, borra la carpeta de datos a mano.

## Solución de problemas

- **No abre o dice que el puerto está ocupado.** La app elige sola un puerto libre en 127.0.0.1, así que normalmente no hay conflicto. Si falla al abrir, cierra otras instancias de auto-med (solo se permite una) y reinténtalo. Mira `logs/` en la carpeta de datos.
- **La base de datos no arranca / quedó un proceso huérfano.** Tras un cierre brusco puede quedar un proceso `postgres` vivo o un archivo `postmaster.pid` obsoleto. La app limpia el archivo obsoleto sola. Si sigue fallando, cierra los procesos `postgres` de auto-med desde el Administrador de tareas (Windows) o con `pkill postgres` revisando antes que no sean de otro programa (Linux), y vuelve a abrir.
- **Antivirus.** Puede bloquear o ralentizar los ejecutables de PostgreSQL incluidos o el instalador sin firma. Permite la carpeta de instalación y la carpeta de datos si es necesario.
- **Linux sin almacén de secretos.** Si no hay llavero (libsecret / GNOME Keyring / KWallet), la app guarda `secrets.bin` como archivo con permisos solo para tu usuario y muestra una advertencia. Funciona, pero las claves no quedan cifradas por el sistema; protege tu carpeta personal (disco cifrado, contraseña de sesión).
- **Python no detectado.** Instala Python 3.9 a 3.12 (ver arriba), en Windows con "Add python.exe to PATH", reinicia auto-med y pulsa "Verificar de nuevo". Si instalaste solo 3.13 o superior, instala además 3.11.
- **"No se pudo crear el entorno" en Linux.** Falta el paquete `venv` (`sudo apt install python3.11-venv`).
- **El OCR local cae a Tesseract.** Si PaddleOCR no carga, el servicio local usa Tesseract (menos preciso en manuscrito) y lo indica en su estado con el campo `fallback_reason`; la app lo muestra. Revisa ese mensaje y vuelve a ejecutar "Preparar el OCR". Para mejor lectura de manuscritos considera Amazon Textract.
- **Ollama desactualizado.** Si al descargar o usar `qwen3-vl:4b-instruct` aparece un error de versión, actualiza Ollama a 0.12.7 o superior.
- **Outlook no se conecta.** Verifica que el instalable se construyó con un `client id` de Entra (ver `docs/entra-id-registro.md`). En cuentas de empresa, el administrador del inquilino puede tener que aprobar el permiso.

## Qué NO está probado todavía

- **Windows:** el instalador NSIS está configurado y el workflow de release ejecuta una prueba de humo en `windows-latest`, pero **nadie lo ha instalado ni usado**. No se han comprobado SmartScreen, antivirus, el PATH de Python ni la desinstalación.
- **Ventana real:** la prueba automática (Linux) arranca la app sin pantalla (xvfb) y consulta `/api/health`; no se ha comprobado el uso con ventana real, ni el flujo de primer usuario o el asistente en el paquete.
- **Instalación del `.deb`:** el `.deb` se construyó, pero no se instaló.
- **OCR local real con PaddlePaddle:** no se ha ejecutado "Preparar el OCR" ni la lectura de un PDF escaneado con el entorno gestionado, ni se midió la descarga.
- **Conexión con Outlook:** necesita el `client id` de Entra, aún sin registrar.

Faltan también (fuera de esta entrega): iconos propios, firma y notarización, auto-actualización, exportar respaldo y macOS.

## Para quien construye el instalable

- Comandos desde la raíz: `pnpm desktop:build`, `pnpm desktop:dist:linux` (AppImage + deb), `pnpm desktop:dist:win` (NSIS x64; el workflow lo construye en `windows-latest`), `pnpm desktop:smoke` (prueba de humo del binario desempaquetado con una carpeta de datos temporal).
- La salida queda en `apps/desktop/release/`.
- El workflow `.github/workflows/release-desktop.yml` (tag `v*` o ejecución manual) construye en Linux y Windows, ejecuta la prueba de humo y crea una release **en borrador** con los archivos. No usa más secretos que `GITHUB_TOKEN`.
- Antes de repartir el instalable, registra la app en Entra y pon el `client id` en `apps/desktop/build-config.json` (`msClientId`).
- Modo de prueba: la variable `AUTOMED_DATA_DIR` redirige la carpeta de datos; úsala siempre para pruebas, nunca contra tus datos reales.
