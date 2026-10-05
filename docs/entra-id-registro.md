# Registrar la app en Microsoft Entra ID

Necesitas una app registrada para que auto-med lea tu buzón con Microsoft Graph. Se usa OAuth **delegado** (inicias sesión una vez; la app guarda un refresh token cifrado) con permisos `Mail.Read` y `offline_access`.

## 1. Crear el registro
1. Entra a <https://entra.microsoft.com> con tu cuenta de la organización.
2. **Identidad > Aplicaciones > Registros de aplicaciones > Nuevo registro**.
3. Nombre: `auto-med`.
4. Tipos de cuenta compatibles: **Solo cuentas de este directorio organizativo (inquilino único)**.
5. URI de redirección: plataforma **Web**, valor `http://localhost:3000/api/auth/callback` (en producción usa tu URL HTTPS, p. ej. `https://auto-med.midominio.com/api/auth/callback`). Debe coincidir exactamente con `MS_REDIRECT_URI`.
6. **Registrar**.

## 2. Copiar los identificadores
En la página **Información general** copia:
- *Id. de aplicación (cliente)* -> `MS_CLIENT_ID`
- *Id. de directorio (inquilino)* -> `MS_TENANT_ID`

## 3. Crear el secreto de cliente
**Certificados y secretos > Nuevo secreto de cliente**, elige caducidad (máx. 24 meses) y copia el **Valor** (solo se muestra una vez) -> `MS_CLIENT_SECRET`. Anota la fecha de caducidad para renovarlo.

## 4. Permisos de API (delegados)
**Permisos de API > Agregar un permiso > Microsoft Graph > Permisos delegados**:
- `Mail.Read`
- `offline_access`
- `User.Read` (viene por defecto; se usa para leer tu correo y validar la cuenta)

Si tu tenant lo permite, pulsa **Conceder consentimiento de administrador**; si no, el consentimiento se te pedirá a ti la primera vez que inicies sesión (`Mail.Read` delegado normalmente no requiere admin).

## 5. Configurar la API
En `.env` (raíz) (nunca lo subas a git):
```
MS_TENANT_ID=<id de directorio>
MS_CLIENT_ID=<id de aplicación>
MS_CLIENT_SECRET=<valor del secreto>
MS_REDIRECT_URI=http://localhost:3000/api/auth/callback
TOKEN_ENC_KEY=<salida de: openssl rand -base64 32>
```
Arranca la API y abre `http://localhost:3000/api/auth/login`. Tras aceptar los permisos volverás a `WEB_ORIGIN` con la sesión iniciada. Luego `POST /api/mail/sync` (o espera el intervalo `SYNC_INTERVAL_MIN`).

## Fallback: acceso app-only (si el tenant bloquea el consentimiento de usuario)
Si aparece "Se necesita aprobación del administrador" y el admin no habilita el consentimiento delegado, se puede usar un permiso de **aplicación** (`Mail.Read` de tipo *Aplicación*, flujo client-credentials) **limitado a tu buzón** con una política de acceso a aplicaciones de Exchange. Este modo aún no está implementado en el código; se añadiría en un adaptador alterno de `AuthService`.

Texto sugerido para el administrador:

> Hola, necesito registrar la aplicación interna "auto-med" para leer (solo lectura) mi propio buzón con Microsoft Graph. Por favor: (1) concede consentimiento de administrador al permiso delegado `Mail.Read` (y `offline_access`) para la app con Id `<MS_CLIENT_ID>`; o, si la política no lo permite, (2) concede el permiso de aplicación `Mail.Read` y restríngelo únicamente a mi buzón (`<mi-correo>`) con una Application Access Policy de Exchange Online (`New-ApplicationAccessPolicy -AppId <MS_CLIENT_ID> -PolicyScopeGroupId <grupo-con-mi-buzón> -AccessRight RestrictAccess`). La app no escribe ni envía correos. Gracias.

## Notas de seguridad
- El refresh token se guarda cifrado con AES-256-GCM (`TOKEN_ENC_KEY`); si cambias la clave tendrás que volver a iniciar sesión.
- `ALLOWED_EMAIL` (opcional) restringe qué cuenta puede entrar; por defecto, la primera cuenta que inicia sesión queda como la única.
- Renueva el secreto de cliente antes de que caduque.
