# Registrar la app en Microsoft Entra ID

Necesitas una app registrada para que auto-med lea tu buzón con Microsoft Graph. Se usa OAuth **delegado** (conectas Outlook una vez; la app guarda un refresh token cifrado) con permisos `Mail.Read` y `offline_access`.

## 1. Crear el registro
1. Entra a <https://entra.microsoft.com> con tu cuenta de la organización.
2. **Identidad > Aplicaciones > Registros de aplicaciones > Nuevo registro**.
3. Nombre: `auto-med`.
4. Tipos de cuenta compatibles: **Cuentas en cualquier directorio organizativo y cuentas personales de Microsoft** (así se puede conectar un correo de trabajo de cualquier inquilino o un @outlook.com/@hotmail.com).
5. URI de redirección: plataforma **Web**, valor `http://localhost:3000/api/auth/callback` (en producción usa tu URL HTTPS, p. ej. `https://auto-med.midominio.com/api/auth/callback`). Debe coincidir exactamente con `MS_REDIRECT_URI`.
6. **Registrar**.

## 2. Copiar los identificadores
En la página **Información general** copia:
- *Id. de aplicación (cliente)* -> `MS_CLIENT_ID`
- *Id. de directorio (inquilino)*: **no se usa**; deja `MS_TENANT_ID=common`. Un GUID limitaría el acceso a ese único inquilino y rompería las cuentas personales.

## 3. Crear el secreto de cliente
**Certificados y secretos > Nuevo secreto de cliente**, elige caducidad (máx. 24 meses) y copia el **Valor** (solo se muestra una vez) -> `MS_CLIENT_SECRET`. Anota la fecha de caducidad para renovarlo.

## 4. Permisos de API (delegados)
**Permisos de API > Agregar un permiso > Microsoft Graph > Permisos delegados**:
- `Mail.Read`
- `offline_access`
- `User.Read` (viene por defecto; se usa para leer tu correo y validar la cuenta)

Si tu tenant lo permite, pulsa **Conceder consentimiento de administrador**; si no, el consentimiento se te pedirá a ti la primera vez que inicies sesión (`Mail.Read` delegado normalmente no requiere admin).

Nota: con cuentas personales el secreto y la URI de redirección se configuran igual. El consentimiento es por cuenta: cada cuenta que se conecte acepta los permisos la primera vez (en organizaciones que exijan aprobación de administrador, lo concede ese inquilino).

## 5. Configurar la API
En `.env` (raíz) (nunca lo subas a git):
```
MS_TENANT_ID=common
MS_CLIENT_ID=<id de aplicación>
MS_CLIENT_SECRET=<valor del secreto>
MS_REDIRECT_URI=http://localhost:3000/api/auth/callback
TOKEN_ENC_KEY=<salida de: openssl rand -base64 32>
```
Define también `JWT_SECRET` (obligatorio; `openssl rand -base64 48`). El flujo ahora es:
1. Crea tu usuario de la app: `pnpm --filter api user:create -- --email <correo> --nombre <nombre>` (pide la contraseña por prompt).
2. **Inicia sesión en la app** (correo + contraseña; el login de la app ya no usa Microsoft).
3. Ve a **Ajustes -> Conectar Outlook**: la app llama a `POST /api/mail/connect`, te lleva a Microsoft y, tras aceptar los permisos, Microsoft vuelve a `MS_REDIRECT_URI` (`/api/auth/callback`; misma URI de siempre). Ese retorno exige que sigas con sesión iniciada en la app (cookie SameSite=Lax) y que sea el mismo usuario que inició la conexión; luego te devuelve a `WEB_ORIGIN/ajustes?outlook=conectado`.
4. Sincroniza (botón o cada `SYNC_INTERVAL_MIN`). **Desconectar** (Ajustes) borra solo los tokens de Microsoft y detiene la sincronización; conserva tickets, mensajes, adjuntos y síntesis.

## Fallback: acceso app-only (si el tenant bloquea el consentimiento de usuario)
Si aparece "Se necesita aprobación del administrador" y el admin no habilita el consentimiento delegado, se puede usar un permiso de **aplicación** (`Mail.Read` de tipo *Aplicación*, flujo client-credentials) **limitado a tu buzón** con una política de acceso a aplicaciones de Exchange. Este modo aún no está implementado en el código; se añadiría en un adaptador alterno de `AuthService`.

Texto sugerido para el administrador:

> Hola, necesito registrar la aplicación interna "auto-med" para leer (solo lectura) mi propio buzón con Microsoft Graph. Por favor: (1) concede consentimiento de administrador al permiso delegado `Mail.Read` (y `offline_access`) para la app con Id `<MS_CLIENT_ID>`; o, si la política no lo permite, (2) concede el permiso de aplicación `Mail.Read` y restríngelo únicamente a mi buzón (`<mi-correo>`) con una Application Access Policy de Exchange Online (`New-ApplicationAccessPolicy -AppId <MS_CLIENT_ID> -PolicyScopeGroupId <grupo-con-mi-buzón> -AccessRight RestrictAccess`). La app no escribe ni envía correos. Gracias.

## Notas de seguridad
- El refresh token se guarda cifrado con AES-256-GCM (`TOKEN_ENC_KEY`); si cambias la clave tendrás que volver a conectar Outlook.
- Cada usuario de la app tiene una sola cuenta de Outlook; una misma cuenta de Outlook no puede conectarse a dos usuarios. `ALLOWED_EMAIL` y `SESSION_SECRET` ya no existen (quien entra a la app es quien tiene usuario y contraseña).
- Renueva el secreto de cliente antes de que caduque.
