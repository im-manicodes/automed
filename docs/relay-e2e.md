# Relay: cifrado extremo a extremo (protocolo y modelo de amenazas)

Aplica a «Usar desde el celular» (`apps/relay`, `apps/relay/bootstrap`, `apps/desktop/src/relay-*.ts`, `front-bundle.ts`, `apps/web/src/lib/e2e.ts`).
Datos de salud: el relay es un punto público y se asume NO confiable para el contenido.

## Idea
Toda petición de la API que hace el celular viaja dentro de un **sobre cifrado** (AES-256-GCM) que solo el celular y el escritorio pueden abrir.
Al relay solo llega `POST /d/<deviceId>/e` con bytes opacos y vuelve una respuesta igual de opaca. El relay ya no reenvía `/api/*` en claro (responde 404).

```
Celular --POST /d/<id>/e (sobre)--> Relay ==túnel WSS (frames)==> Escritorio --HTTP 127.0.0.1--> API
```

## Clave
- `K`: 32 bytes aleatorios generados por el escritorio al activar (`generateIdentity`, junto con `deviceId` y `secret` del túnel). Se guarda en `secrets.bin` (safeStorage).
- Va en el **fragmento** del QR: `https://<relay>/d/<deviceId>#k=<K en base64url>`. El navegador no envía el fragmento al servidor. `boot.js` (y `main.tsx` con `captureKeyFromHash` como respaldo) lo lee, lo guarda en `localStorage` (con respaldo en memoria si falla) y lo quita de la barra de direcciones.
- HKDF-SHA256 (salt `automed-e2e-v1`) deriva dos claves independientes: `c2d` (celular -> escritorio, info `c2d`) y `d2c` (info `d2c`). Un mensaje de una dirección nunca se acepta en la otra (sin reflejos).

## Formato (idéntico en `apps/desktop/src/e2e-crypto.ts`, `apps/web/src/lib/e2e.ts` y `apps/relay/bootstrap/boot.js`)
`[1 B versión=1][12 B nonce aleatorio][texto cifrado + etiqueta GCM de 16 B]`

- AAD petición: `am-e2e1|req|<deviceId>`. AAD respuesta: `am-e2e1|res|<deviceId>|` + nonce de la petición.
- Petición (claro, antes de cifrar): `[u32 BE largo][JSON {m: método, p: ruta /api…, h: cabeceras, t: ms epoch}][cuerpo]`.
  Cabeceras aceptadas dentro del sobre (lista blanca en el escritorio): `content-type`, `cookie`, `authorization`, `accept`.
- Respuesta: `[u32 BE largo][JSON {s: estado, h: cabeceras}][cuerpo]`. Cabeceras devueltas: `content-type`, `content-disposition`, `set-cookie`, `cache-control`.
- El sobre se cifra de una vez (sin streaming): tope 2 MiB por petición (el relay corta a 1 MiB) y 64 MiB por respuesta (PDF, Excel, imágenes de página).

## Garantías y cómo se logran
| Amenaza | Defensa |
|---|---|
| Relay (o quien lo comprometa) lee rutas, cuerpos, cookies, tokens, PDFs | Todo va dentro del sobre; el relay solo ve que hay un POST a `/e`, tamaños y tiempos |
| Modifica un mensaje | GCM autentica todo (incluido AAD); el escritorio/celular descartan lo que no descifra (400 sin detalles) |
| Repite una petición vieja | Nonce aleatorio de 96 bits visto una vez (`ReplayGuard`, 50 000 entradas), marca de tiempo `t` con ventana de +-5 min y cota inferior = arranque del cliente de túnel; 409 si falla |
| Cambia/duplica/reordena respuestas | La respuesta se ata (AAD) al nonce de SU petición; cada petición es independiente, así que reordenar no tiene efecto y una respuesta ajena no autentica |
| Refleja un mensaje en sentido contrario | Claves distintas por dirección + etiqueta `req`/`res` en el AAD |
| Suplanta al escritorio ante el celular | Sin `K` no puede producir una respuesta que autentique |
| QR/celular viejo tras desvincular | «Desvincular» borra `deviceId`, `secret` y `K`; el relay recuerda el `deviceId` como revocado (no se puede re-registrar). Reactivar crea identidad y clave nuevas |
| Registro abierto de dispositivos en el relay | `RELAY_REGISTRATION_TOKEN`: si está definido, un `deviceId` nuevo exige la cabecera `X-Registration-Token` (comparación en tiempo constante). Los ya registrados se autentican con su secreto |
| Fuerza bruta de login desde el celular | El relay ve la IP real y la pone en el frame `ReqHead.ip`; el cliente de túnel la reenvía a la API en `x-automed-relay-ip` junto con `x-automed-relay-token` (token aleatorio por arranque, `RELAY_IP_TOKEN`, solo lo conocen el escritorio y la API). `clientIp()` (`apps/api/src/auth/client-ip.ts`) solo usa la cabecera si el token coincide: un cliente directo a 127.0.0.1 no puede falsear su IP. Las cabeceras `x-automed-*` del sobre se descartan (lista blanca). Además el relay limita 600 peticiones/min por IP |

## Cookies
Las cookies de sesión (`am_access`, `am_refresh`) viajan dentro del sobre: el relay no las ve. Como el navegador no puede guardarlas, `lib/e2e.ts` lleva una tabla propia (`localStorage`, `am_jar_<deviceId>`) que respeta `Path`, `Max-Age`/`Expires` y borrado. Consecuencia: en modo relay las cookies ya no son HttpOnly para el JavaScript de la página; la mitigación es la CSP del relay (`script-src 'self'`, sin scripts de terceros) y que el código solo llega verificado (ver «Front servido por el escritorio») y que la clave E2E está igual de expuesta a un XSS.

## Imágenes y descargas
`<img src>` no puede descifrar. En modo relay `usePaginaImagen` (única excepción a «solo useQuery/useMutation») pide la imagen con `apiBlob`, la descifra a un Blob y usa su `blob:` URL. Las descargas (Excel/PDF) ya pasaban por `apiBlob`.

## Lo que el cifrado NO protege
- Metadatos: que existe un dispositivo, hora, frecuencia y tamaños de las peticiones, IP del celular.
- Disponibilidad: el relay puede cortar o descartar mensajes (no puede alterarlos).
- Celular perdido con la clave guardada y sesión abierta: desvincular desde el escritorio y cerrar sesión.
- Repetición de lo capturado hasta 5 min antes de un reinicio del escritorio: acotada por la cota de arranque; el sobre solo reproduce una petición que el usuario ya hizo.
- Todos los celulares que escanean el QR comparten `K` y el acceso; desvincular saca a todos (varios celulares con clave propia queda como mejora).
- Clave y reloj: si el reloj del celular se desvía > 5 min, las peticiones se rechazan (409, «Revisa la fecha y hora de tu celular»).
- Un relay comprometido que reemplace el arranque o el service worker (primera carga y comprobaciones de actualización del SW) sigue pudiendo servir código que robe la clave: ver «Límite residual» abajo. El front (`apps/web`) YA NO lo sirve el relay.

## Front servido por el escritorio (fase 4)
Objetivo: que un relay comprometido NO pueda servir el JavaScript grande de `apps/web` alterado. El relay solo sirve un **arranque** mínimo y estable; el front lo entrega el escritorio por el mismo canal cifrado.

```
1. GET /d/<id>/      -> relay: index.html (idéntico para todos) -> <script type=module src=/boot.js>
2. boot.js           -> guarda K (#k=), registra /d/<id>/sw.js (fija index.html y boot.js)
3. boot.js           -> POST /d/<id>/e  {GET /_front/manifest}  ==túnel==>  escritorio (FrontBundle)
4. boot.js           -> verifica manifiesto + pide y verifica cada archivo (/_front/f/<ruta>) -> Cache API
5. boot.js           -> inserta <script type=module src=/d/<id>/_app/assets/...> ; el SW los sirve de la caché verificada
```

### Decisión de diseño: AEAD con `K` en vez de firma asimétrica
Cada respuesta `/_front/*` viaja en el sobre E2E (AES-256-GCM con `K`, atada al nonce de su petición). Solo quien tiene `K` (el escritorio) puede producir una que autentique, y `K` nunca llega al relay. Una firma con par de claves (clave pública en el QR) no añadiría nada: quien roba `K` ya lee todo, y quien no la tiene no puede forjar nada; solo agregaría código y otra clave que gestionar. Encima del AEAD se verifica un **manifiesto** (`front-bundle.ts`): `{v, d: deviceId, version, builtAt, entry:{scripts,styles}, files:{ruta:{sha256,size,type}}}`. Se rechaza (y no se ejecuta nada) si: el JSON o sus campos son inválidos, `d` no es este dispositivo, una ruta es sospechosa (`..`, vacía), el `entry` apunta a un archivo no listado, o el hash/tamaño de un archivo no coincide. Es defensa en profundidad (consistencia del conjunto, archivos corruptos) y habilita el anti-retroceso.

### Anti-retroceso y versiones
`builtAt` (mayor fecha de modificación del front empaquetado) es monótono: el arranque guarda un «piso» `{builtAt, hash del manifiesto}` por dispositivo y rechaza uno menor, o el mismo `builtAt` con otro contenido («La app que llegó es más antigua…»). Escanear un QR con otra clave borra piso y caché. Como el front lo entrega el escritorio, **coincide siempre con la API local**: se acabó el problema de versiones desalineadas front/API (una actualización del escritorio se descarga en la siguiente apertura del celular; solo cambian los archivos distintos).

### Service worker (`apps/relay/bootstrap/sw.js`)
- Fija (pin) `index.html` y `/boot.js` en la caché al instalarse (primer escaneo) y los sirve desde ahí.
- Sirve `/d/<id>/_app/*` SOLO desde la caché verificada (nunca de la red: sin front verificado responde 404).
- No intercepta `POST /e`, `/api` ni nada más; nunca guarda respuestas de la API ni datos. Su prueba (`front.e2e.test.ts`) lo comprueba con un entorno simulado.
- Sin conexión con la computadora (PC apagado) el arranque abre el front ya verificado, que muestra el aviso «PC apagado»; sin front verificado muestra «Tu computadora está apagada…» con Reintentar.
- Fallo de verificación (manifiesto, archivo, clave, versión): **falla cerrado**, no ejecuta nada y avisa en español.

### El arranque y su hash
Son tres archivos sin dependencias ni build (`apps/relay/bootstrap/`), idénticos para todos los dispositivos (`.gitattributes` evita cambios de fin de línea). El relay no tiene código para servir nada del front (`/d/<id>/_app/*` y `/assets/*` dan 404) y su CSP no permite `blob:` ni scripts en línea (`script-src 'self'`).

| Archivo | SHA-256 |
|---|---|
| `index.html` | `98c08b1ea31b2017a5148623e1febe81be23244d701a5b2c1fa98e72e1e15eda` |
| `boot.js` | `1224b4cf82d15d23316621adc8396ca2bd9fcaa9d107f420658191b96f96f7ef` |
| `sw.js` | `5aff357c6c981268fa1d399cac3ff6b365ef1853a493dd8a9e8c2dc4ed1e7237` |

Hash combinado (sha256 de las líneas `<archivo>:<sha256>\n` en ese orden): `ba7710c3b525faca9450a89ab183ab2af7a1c7ecb72291a6a07d607464ea06c7`.

Un test (`front.e2e.test.ts`) falla si los archivos cambian sin actualizar `apps/desktop/src/bootstrap-hashes.ts` y esta tabla. Para regenerarlos: `pnpm --filter relay bootstrap:hash`.

**Verificación por el usuario**: `curl -s https://<relay>/boot.js | sha256sum` (igual con `/d/<id>/` y `/d/<id>/sw.js`) debe dar los de la tabla. Además el escritorio lo hace solo (`relay-integrity.ts`): al activar y cada 6 h pide los tres archivos al relay y los compara con los de su versión; si difieren, «Usar desde el celular» muestra un aviso y, en «Comprobar el servicio», la huella esperada.

### Modelo de amenazas actualizado
| Amenaza | Estado |
|---|---|
| Relay sirve un front (`apps/web`) alterado | Imposible sin cambiar el arranque: el front lo entrega el escritorio cifrado y verificado; el relay no puede forjarlo ni modificarlo (GCM) |
| Relay altera/repite respuestas del front | No autentican (clave/nonce) -> falla cerrado; con caché previa tampoco se ejecuta algo nuevo |
| Relay (o error) sirve un front viejo | Rechazado por el piso `builtAt` |
| Cambio del arranque a todos los celulares | Más visible: 3 archivos pequeños con hash publicado; el escritorio lo detecta y avisa; auditable en minutos |

### Límite residual (importante)
- **La primera carga confía en el relay**: nada del navegador permite verificar el HTML/JS inicial. Un relay comprometido en ese momento (o un QR hacia un relay falso) puede servir un `boot.js` malicioso que robe `K`. Mitigaciones: relay propio, HTTPS, hash público y comprobación manual/automática del escritorio.
- **Las visitas posteriores quedan fijadas por el SW, pero no es absoluto**: el navegador vuelve a pedir `sw.js` al relay para buscar actualizaciones y esa petición no pasa por el SW; un relay activamente malicioso podría entregar un SW nuevo. Esto no se puede evitar en la web. El pin sí protege de cambios pasivos, del front en sí y evita volver a descargar el arranque.
- Un relay que muestre el arranque alterado SOLO a un celular concreto no lo detecta la comprobación del escritorio (se ve desde otro punto de red); sí lo detectaría quien compare el hash en ese celular.
- Si el usuario no hace nada y el relay sirve otra cosa, el celular no avisa por sí mismo (no puede verificar su propio arranque).
- Un XSS en el front verificado seguiría exponiendo `K` y las cookies de sesión (que viven en `localStorage`); por eso la CSP no admite scripts de terceros.
- Eliminarlo del todo exigiría una app nativa o una extensión que verifique el arranque fuera del control del relay.

La regla del front («toda petición con `useQuery`/`useMutation`») no cambia: `boot.js` NO es código de página (vive en `apps/relay/bootstrap`), y su `fetch` cifrado es la excepción documentada junto con `usePaginaImagen`.

## Sincronización del protocolo
`apps/relay/src/protocol.ts` y `apps/desktop/src/tunnel-protocol.ts` deben ser idénticos (lo comprueba `tunnel-protocol.test.ts`; al cambiar uno, copiar al otro). El formato del sobre vive en `e2e-crypto.ts` (escritorio) y `e2e.ts` (web); `e2e-crypto.test.ts` prueba su interoperabilidad, `relay.e2e.test.ts` el flujo completo y `front.e2e.test.ts` el arranque (`boot.js` <-> escritorio) con un relay malicioso de prueba.
