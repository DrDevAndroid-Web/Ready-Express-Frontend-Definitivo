# Pendientes — ReadyExpressNow

---

## Sistema de Avisos por Telegram

### Por qué Telegram sobre el sistema actual

El sistema actual ya tiene SSE (para el dashboard web) y Push Notifications (para la APK admin). Telegram añade un canal separado que funciona aunque el dashboard esté cerrado, sin depender de la APK ni de tokens Expo. Es más robusto para avisos críticos.

---

### Cómo funcionaría

#### Arquitectura

```
Evento del sistema
  (orden creada / pago subido / pago aprobado / rechazado)
          │
          ▼
   orders.service.js  o  payments.service.js
          │
          ▼
   telegram.service.js   ← nuevo archivo
          │
          ▼
   Telegram Bot API
   https://api.telegram.org/bot{TOKEN}/sendMessage
          │
          ▼
   Chat o grupo de dueños en Telegram
```

#### Piezas necesarias

| Pieza | Qué es | Costo |
|---|---|---|
| Bot de Telegram | Se crea con @BotFather en Telegram | Gratis |
| `TELEGRAM_BOT_TOKEN` | Token que da @BotFather | - |
| `TELEGRAM_CHAT_ID` | ID del chat/grupo donde llegan los avisos | - |
| `telegram.service.js` | Archivo nuevo en `backend/modules/telegram/` | - |
| Integración en `orders.service.js` | Una línea en `notifyOrderCreated()` | - |
| Integración en `payments.service.js` | Una línea al aprobar y rechazar | - |

---

### Mensajes que se enviarían

#### 1. Nueva orden creada
```
🛒 *Nueva Orden* #a1b2c3d

👤 *Remitente:* Juan Pérez  
📞 *Teléfono:* +1 305 555 0000

📦 *Destinatario:* María García  
📞 *Teléfono:* +53 5 555 0000  
🏠 *Dirección:* Calle 5 #12, Guantánamo

🧾 *Items:*
• 2x Combo Familiar — $45.00
• 1x Combo Básico — $20.00

💰 *Total:* $65.00
📅 2026-07-30 14:32
```

#### 2. Comprobante de pago subido
```
📸 *Comprobante recibido* — Orden #a1b2c3d

👤 Juan Pérez
💳 Método: Zelle
💵 Monto declarado: $65.00

⏳ Pendiente de revisión en el dashboard.
```

#### 3. Pago aprobado
```
✅ *Pago Aprobado* — Orden #a1b2c3d

👤 Juan Pérez — $65.00
🖨️ PDF enviado a impresora.
```

#### 4. Pago rechazado
```
❌ *Pago Rechazado* — Orden #a1b2c3d

👤 Juan Pérez — $65.00
⚠️ Requiere contacto con el cliente.
```

---

### Implementación técnica

#### Archivo nuevo: `backend/modules/telegram/telegram.service.js`

```javascript
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export async function sendTelegramMessage(text) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) return;

  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
  });
}

export function buildNewOrderMessage(order) { /* ... */ }
export function buildPaymentReceivedMessage(order, payment) { /* ... */ }
export function buildPaymentApprovedMessage(order) { /* ... */ }
export function buildPaymentRejectedMessage(order) { /* ... */ }
```

#### En `orders.service.js` — función `notifyOrderCreated()`

```javascript
// Antes (solo email):
const results = await Promise.allSettled([
  sendEmail(order)
]);

// Después (email + Telegram):
const results = await Promise.allSettled([
  sendEmail(order),
  sendTelegramMessage(buildNewOrderMessage(order))
]);
```

#### En `payments.service.js` — al aprobar/rechazar

```javascript
// Al aprobar (junto con sendPrintableOrderEmail):
await Promise.allSettled([
  sendPrintableOrderEmail(order),
  sendTelegramMessage(buildPaymentApprovedMessage(order))
]);

// Al rechazar:
sendTelegramMessage(buildPaymentRejectedMessage(order)).catch(console.error);
```

#### Variables de entorno a agregar en `.env`

```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
TELEGRAM_CHAT_ID=-1001234567890
```

---

### Pasos para activarlo

1. Abrir Telegram y buscar `@BotFather`
2. Enviar `/newbot` → darle un nombre y username al bot
3. Copiar el token que devuelve → `TELEGRAM_BOT_TOKEN`
4. Crear un grupo con los dueños y agregar el bot como miembro
5. Obtener el `chat_id` del grupo (con `@userinfobot` o la API)
6. Agregar las dos variables al `.env` de producción
7. Implementar `telegram.service.js` e integrarlo en los servicios existentes

---

### Ventajas frente al sistema actual

| Canal | Requiere | Cuándo falla |
|---|---|---|
| SSE (dashboard web) | Dashboard abierto en browser | Si cierran el tab |
| Push (APK admin) | APK instalada + token Expo activo | Si desinstalan la app o el token expira |
| **Telegram** | Solo tener Telegram instalado | Casi nunca |
| Email (dueños) | Abrir el correo | Puede ir a spam o tardar |

Telegram es el canal más confiable para avisos operativos en tiempo real porque llega como mensaje directo y genera notificación push nativa.

---

## Otros pendientes

- [ ] Email al cliente cuando se rechaza su pago
- [ ] Renombrar `resend.js` a `printer-email.service.js` (no usa Resend API)
- [ ] Resolver los 14 issues pendientes del `backend/AUDIT_REPORT.md`
