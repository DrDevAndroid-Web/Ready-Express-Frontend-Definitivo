# Ready Express Domicilio

App Android de operaciones para domiciliarios, creada con Expo SDK 58.

## Perfiles EAS

- `preview`: genera APK interna y apunta al backend de producción.
- `production`: genera APK de producción y aumenta automáticamente la versión Android.

Comandos:

```bash
eas build --platform android --profile preview
eas build --platform android --profile production
```

## Notificaciones push

La app registra el Expo Push Token en `POST /api/notifications/push-token`. El backend acepta ahora los roles `admin`, `operador`, `repartidor` y `domicilio` para registrar ese token.

El proyecto EAS de domicilio es independiente del de administración porque Expo exige que cada `projectId` coincida con su `slug`. Para producción hay que configurar en este proyecto EAS las credenciales FCM del mismo proyecto Firebase y registrar el paquete Android:

```text
com.readyexpressnow.domicilio
```

No se debe reutilizar literalmente el `google-services.json` de administración: ese archivo identifica `com.readyexpressnow.admin`. Se reutiliza el mismo proyecto Firebase, pero cada paquete necesita su propia aplicación Android registrada.

## Base de datos

Aplicar desde Supabase:

```text
backend/migrations/20261113_delivery_operations_marketing.sql
```

La migración crea historial de estados, asignaciones, GPS interno, preferencias de emails, campañas y entregas de campañas.

El GPS se guarda para futuras funciones operativas y no se incluye en las rutas de cuenta ni en las respuestas del cliente.
