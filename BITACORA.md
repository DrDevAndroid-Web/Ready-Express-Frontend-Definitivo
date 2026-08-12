# Bitacora ReadyExpressNow

## 2026-07-24

### Backend
- Se elimino el envio por WhatsApp del flujo activo de creacion de ordenes.
- `createOrder` emite la notificacion SSE `order_created` inmediatamente despues de insertar la orden en Supabase, antes de ejecutar tareas lentas como email.
- `sendEmail(order)` dejo de adjuntar PDF. Ahora envia los datos de la orden en el cuerpo del correo, en texto plano y HTML.
- El cuerpo del correo incluye datos del cliente/remitente, destinatario/entrega, items, precios, subtotales y total.
- Los detalles de combos se expanden como pares `key: value` para evitar JSON crudo y facilitar revision operativa.
- El correo para impresora quedo usando SMTP con `nodemailer`.
- Resend quedo fuera del flujo activo de impresora.
- La impresora recibe un PDF adjunto con todos los detalles de la orden.
- El PDF tambien formatea detalles anidados de combos como pares legibles `key: value`.
- Commit publicado en backend: `a70023d` (`Update order email and printer delivery`).

### APK_ADMINISTRACION
- Se corrigio el error `Cannot read property 'abort' of null` al cerrar la conexion SSE, envolviendo `source.close()` con un guard seguro.
- Se valido la sintaxis de `App.js`.
- Se valido el bundle Android con `expo export --platform android` sin arrancar Metro manualmente.

### Auditoria SSE
- Backend registra las rutas:
  - `GET /api/notifications/subscribe`: abre stream SSE.
  - `GET /api/notifications/stats`: devuelve cantidad de clientes conectados.
  - `POST /api/notifications/test`: envia evento de prueba y requiere usuario autenticado.
- `subscribeToNotifications` configura `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `Access-Control-Allow-Origin: *` y `X-Accel-Buffering: no`.
- El stream envia un evento inicial `connection_established`.
- El backend mantiene la conexion viva con heartbeat cada 30 segundos.
- `NotificationManager` mantiene clientes SSE en memoria y emite eventos:
  - `payment_received`
  - `payment_approved`
  - `payment_rejected`
  - `order_created`
  - `order_delivered`
  - `test`
- La APK se conecta con `react-native-event-source` a `${apiBase}/notifications/subscribe`.
- La APK guarda notificaciones recibidas en SQLite y refresca ordenes/pagos segun el tipo de evento.
- La pantalla `notificaciones` muestra estado SSE, ultima notificacion y permite ejecutar prueba contra `/notifications/test`.

### Auditoria Push En APK
- La APK no tiene instalado `expo-notifications`.
- `app.json` no tiene plugin `expo-notifications`.
- No hay permisos/configuracion Android para push notifications nativas.
- No hay registro de token push, almacenamiento de token, ni ruta backend para asociar token de dispositivo.
- Estado actual: las notificaciones en tiempo real funcionan por SSE mientras la APK esta abierta/conectada; no existe push nativo para segundo plano o app cerrada.

### Validaciones Ejecutadas
- Backend: `npm.cmd test` paso con 64 pruebas aprobadas.
- APK: parseo Babel de `App.js` correcto.
- APK: `npx.cmd expo export --platform android` correcto.

## 2026-07-24 - Ajustes Email/PDF, Impresora Y Notificaciones Locales

### Backend
- Email operativo de nueva orden simplificado: ya no imprime precio ni subtotal por item.
- PDF operativo simplificado: ya no imprime ID de orden en encabezado, ID de item, categoria, precio unitario ni subtotal por item.
- Items y combos se muestran como nombre principal y debajo sus detalles en lineas `key: value`.
- Se agrego enriquecimiento de combos contra Supabase `food_combos` cuando la orden trae un item tipo combo sin `detalles`.
- El enriquecimiento permite que nombres como `Combo 18` coincidan con IDs normalizados tipo `combo-18`.
- Se agrego proteccion idempotente en aprobacion de pago: si el pago ya estaba aprobado, no se vuelve a enviar impresion.
- Auditoria de impresora: el backend no estaba configurado para dos copias; enviaba 1 email SMTP con 1 PDF adjunto al aprobar un pago.
- Se configuro de forma explicita que el PDF enviado a impresora tenga 2 copias internas cuando el pago se aprueba desde la APP.
- Commits publicados en backend:
  - `3905286` (`Simplify order print details`)
  - `79613b1` (`Print two approved order copies`)

### APK_ADMINISTRACION
- Se instalo `expo-notifications` compatible con Expo SDK 54.
- Se agrego plugin `expo-notifications` en `app.json`.
- Se configuro canal Android `readyexpress-admin-events`.
- La APK solicita permiso de notificaciones al iniciar sesion.
- Cada evento recibido por SSE ahora dispara una notificacion local en el dispositivo, excepto `connection_established`.
- Las notificaciones locales usan los datos del evento SSE (`order_created`, `payment_received`, `payment_approved`, `payment_rejected`, `order_delivered`, `test`).

### Validaciones Ejecutadas
- Backend: `npm.cmd test` paso con 64 pruebas aprobadas.
- APK: parseo Babel de `App.js`, `app.json` y `package.json` correcto.
- APK: `npx.cmd expo export --platform android` correcto con `expo-notifications`.

## 2026-07-24 - Subidas, PDF De Ordenes E Icono

### Backend
- `Request aborted` de Multer se maneja como HTTP 499 `Cliente cerro la conexion durante la subida`.
- Los abortos/cierres del cliente ya no se registran como `[api:error]` 500.
- Se mantiene el manejo existente de `LIMIT_FILE_SIZE` como 400.

### APK_ADMINISTRACION
- Las peticiones normales mantienen timeout de 25 segundos.
- Las peticiones con `FormData` usan timeout extendido de 90 segundos.
- Las imagenes seleccionadas se redimensionan y comprimen antes de subir:
  - Ancho maximo: 1600 px.
  - Formato: JPEG.
  - Calidad: 0.75.
- Si una mutacion tarda demasiado, ya no se encola automaticamente en SQLite como si fuera offline; la app refresca y pide confirmar antes de repetir.
- Se agrego descarga/exportacion PDF de ordenes desde la pestana Ordenes.
- El modal de PDF permite exportar:
  - Ordenes de esta semana.
  - Ordenes de este mes.
  - Todas las ordenes.
  - Una orden particular cuando el modal de esa orden esta abierto.
- Se instalaron `expo-image-manipulator`, `expo-print`, `expo-sharing` y `expo-file-system`.
- Se reemplazaron assets principales del icono de la app con `ico.png`.

### Validaciones Ejecutadas
- Backend: `npm.cmd test` paso con 64 pruebas aprobadas.
- APK: parseo Babel de `App.js`, `app.json` y `package.json` correcto.
- APK: `npx.cmd expo export --platform android` correcto.
