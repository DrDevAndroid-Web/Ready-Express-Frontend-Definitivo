# Módulo Resend

## Activación

1. Aplicar manualmente `backend/migrations/20261112_resend_inbound.sql` en el proyecto Supabase usado por el backend. La aplicación no ejecuta esta migración automáticamente.
2. Configurar en el backend `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_WEBHOOK_SECRET`, `VERSABOLD_SMS_URL`, `VERSABOLD_API_KEY` y `SMS_NOTIFY_PHONES`. `RESEND_FROM` debe usar `versabold.com`. No copiar secretos a la APK.
3. En Resend, configurar el webhook `https://readyexpressnowbackend.versabold.com/api/webhooks/resend` con `email.received` y los demás eventos `email.*`, incluidos `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.suppressed` y `email.failed`. El secreto debe corresponder a este webhook.
4. El webhook es público, pero solo acepta firmas Svix válidas sobre el cuerpo original. Los endpoints de administración requieren Bearer de Supabase y rol `admin`.

## Contrato para APK Admin

Todas las rutas llevan `/api` y devuelven JSON:

- `GET /admin/emails?limit=20&after=<uuid>`: recibidos desde Resend; `{data: [...], has_more: boolean, next_cursor: string|null}`.
- `GET /admin/emails/:id`: detalle recibido, HTML saneado, `attachments` con metadatos y URL temporal de descarga, `replies` enviadas desde esta API y `sms_status` (`pending`, `processing`, `sent`, `skipped` o `null` para históricos sin webhook).
- `POST /admin/emails/:id/reply`: `{text?, html?, cc?: string[], bcc?: string[], subject?: string}`. Debe haber `text` o `html`. Admite header opcional `Idempotency-Key` (8–120 caracteres ASCII alfanuméricos, `_` o `-`) para reintentos seguros. Responde `201` con la respuesta persistida.
- `GET /admin/emails/sent?limit=20&after=<uuid>`: enviados desde Resend, mismo shape de paginación. Cada elemento incluye `delivery_status` y `recipient_statuses: [{email,status,occurred_at,reason}]`.
- `GET /admin/emails/sent/:id`: detalle enviado, HTML saneado, `delivery_status`, `recipient_statuses` y `events` guardados por webhook.

La lista histórica de enviados usa `last_event` de Resend cuando no hay eventos propios. Para correos históricos con varios destinatarios, el estado individual sin webhook queda `unknown`; el estado global puede reflejar `last_event`. Los eventos nuevos se guardan por `(webhook_id, recipient)` y se muestran por `email_id` y destinatario. `delivered` significa que el servidor de correo aceptó el mensaje; no confirma que apareció en la bandeja de entrada. Si la APK muestra HTML, debe usar un contenedor aislado sin scripts ni navegación libre; el backend aplica `sanitize-html` antes de devolverlo.

## Idempotencia SMS

Solo `email.received` genera SMS. El evento se inserta por `email_id`; una actualización condicional reclama el trabajo. Cada teléfono confirmado se guarda en `resend_inbound_sms_alerts`, por lo que un retry tras un fallo HTTP conocido reanuda los teléfonos faltantes. No se mantiene una transacción abierta durante la llamada de red. Si el proveedor acepta un SMS pero falla la confirmación o la escritura, el estado queda `processing` para revisión manual: no se reenvía automáticamente. Sin una clave de idempotencia soportada por el proveedor SMS, no se puede garantizar entrega exactamente una vez ante fallos de red ambiguos. Revisar filas `processing` antiguas antes de desbloquearlas.
