# Registrar la app en Microsoft Entra ID

Necesitas una app registrada para que auto-med lea tu buzón con Microsoft Graph. Se usa OAuth **delegado** (conectas Outlook una vez; la app guarda un refresh token cifrado) con la app registrada como **cliente confidencial** (aplicación Web con secreto de cliente). Los datos del registro se pegan en la web, en **Ajustes -> Microsoft**; no hace falta tocar `.env`.

## 1. Crear el registro
1. Entra a <https://entra.microsoft.com> con tu cuenta de la organización.
2. **Identidad > Aplicaciones > Registros de aplicaciones > Nuevo registro**.
3. Nombre: `auto-med`.
4. Tipos de cuenta compatibles: **Cuentas en cualquier directorio organizativo y cuentas personales de Microsoft** (así se puede conectar un correo de trabajo de cualquier inquilino o un @outlook.com/@hotmail.com).
5. URI de redirección: plataforma **Web** (no "aplicaciones móviles y de escritorio"), valor `https://<tu-host>/api/auth/callback` (el host público donde sirves la app; es `<WEB_ORIGIN>/api/auth/callback`). En pruebas locales: `http://localhost:3000/api/auth/callback` con `pnpm dev`, o `http://localhost:8080/api/auth/callback` con `docker compose up`. Debe coincidir exactamente con la URI que pongas en Ajustes -> Microsoft (la web te sugiere la correcta).
6. **Registrar**.

## 2. Copiar los identificadores
En la página **Información general** copia:
- *Id. de aplicación (cliente)* -> campo «Id. de aplicación» en Ajustes -> Microsoft.
- *Id. de directorio (inquilino)*: **no se usa**; deja el inquilino en `common`. Un GUID limitaría el acceso a ese único inquilino y rompería las cuentas personales.

## 3. Crear el secreto de cliente
**Certificados y secretos > Nuevo secreto de cliente**, elige caducidad (máx. 24 meses) y copia el **Valor** (solo se muestra una vez) -> campo «Secreto de cliente» en Ajustes -> Microsoft. La app lo guarda cifrado (AES-GCM) y no lo vuelve a mostrar. Anota la fecha de caducidad para renovarlo.

## 4. Permisos de API (delegados)
Son los que pide la app (`SCOPES` en `apps/api/src/auth/microsoft.service.ts`: `offline_access Mail.Read User.Read`). **Permisos de API > Agregar un permiso > Microsoft Graph > Permisos delegados**:
- `Mail.Read` (lectura del correo)
- `offline_access` (refresh token para sincronizar sin volver a iniciar sesión)
- `User.Read` (viene por defecto; se usa para leer tu correo y validar la cuenta)

Si tu tenant lo permite, pulsa **Conceder consentimiento de administrador**; si no, el consentimiento se te pedirá a ti la primera vez que conectes Outlook (`Mail.Read` delegado normalmente no requiere admin). Con cuentas personales el secreto y la URI se configuran igual. El consentimiento es por cuenta: cada cuenta que se conecte acepta los permisos la primera vez.

## 5. Pegar los datos en la web
1. Crea tu usuario de la app: `docker compose exec api node dist/cli/user.js create --email <correo> --nombre <nombre>` (o `pnpm --filter api user:create -- ...`; pide la contraseña por prompt). Define antes `JWT_SECRET` (obligatorio; `openssl rand -base64 48`) y `TOKEN_ENC_KEY` (`openssl rand -base64 32`) en `.env`.
2. **Inicia sesión en la app** (correo + contraseña; el login de la app no usa Microsoft).
3. En **Ajustes -> Microsoft** rellena el id de aplicación, el inquilino (`common`), el secreto de cliente y la URI de redirección (por defecto la sugerida `<WEB_ORIGIN>/api/auth/callback`). Precedencia: panel > variables `MS_CLIENT_ID`, `MS_TENANT_ID`, `MS_CLIENT_SECRET`, `MS_REDIRECT_URI` de `.env` (siguen valiendo como valores por defecto).
4. Ve a **Ajustes -> Conectar Outlook**: la app te lleva a Microsoft y, tras aceptar los permisos, Microsoft vuelve a la URI de redirección (`/api/auth/callback`). Ese retorno exige que sigas con sesión iniciada en la app (cookie SameSite=Lax) y que sea el mismo usuario que inició la conexión; luego te devuelve a `WEB_ORIGIN/ajustes?outlook=conectado`.
5. Sincroniza (botón o cada `SYNC_INTERVAL_MIN`). **Desconectar** (Ajustes) borra solo los tokens de Microsoft y detiene la sincronización; conserva tickets, mensajes, adjuntos y síntesis.

## Fallback: acceso app-only (si el tenant bloquea el consentimiento de usuario)
Si aparece "Se necesita aprobación del administrador" y el admin no habilita el consentimiento delegado, se puede usar un permiso de **aplicación** (`Mail.Read` de tipo *Aplicación*, flujo client-credentials) **limitado a tu buzón** con una política de acceso a aplicaciones de Exchange. Este modo aún no está implementado en el código; se añadiría en un adaptador alterno de `AuthService`.

Texto sugerido para el administrador:

> Hola, necesito registrar la aplicación interna "auto-med" para leer (solo lectura) mi propio buzón con Microsoft Graph. Por favor: (1) concede consentimiento de administrador al permiso delegado `Mail.Read` (y `offline_access`) para la app con Id `<id de aplicación>`; o, si la política no lo permite, (2) concede el permiso de aplicación `Mail.Read` y restríngelo únicamente a mi buzón (`<mi-correo>`) con una Application Access Policy de Exchange Online (`New-ApplicationAccessPolicy -AppId <id de aplicación> -PolicyScopeGroupId <grupo-con-mi-buzón> -AccessRight RestrictAccess`). La app no escribe ni envía correos. Gracias.

## Notas de seguridad
- El refresh token y el secreto de cliente se guardan cifrados con AES-256-GCM (`TOKEN_ENC_KEY`); si cambias la clave tendrás que volver a pegar el secreto y conectar Outlook.
- Cada usuario de la app tiene una sola cuenta de Outlook; una misma cuenta de Outlook no puede conectarse a dos usuarios.
- Renueva el secreto de cliente antes de que caduque.
