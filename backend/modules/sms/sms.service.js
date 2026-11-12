import { isMuted } from "../../utils/mute.js";

const VERSABOLD_SMS_URL = process.env.VERSABOLD_SMS_URL;
const VERSABOLD_API_KEY = process.env.VERSABOLD_API_KEY;

async function sendOne(recipient, mstext) {
  if (!VERSABOLD_SMS_URL || !VERSABOLD_API_KEY) return;

  let res;
  try {
    res = await fetch(VERSABOLD_SMS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": VERSABOLD_API_KEY,
      },
      body: JSON.stringify({ recipient, mstext }),
    });
  } catch (error) {
    // Sin respuesta no sabemos si el proveedor aceptó el SMS.
    error.deliveryUncertain = true;
    throw error;
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`zdSMS error ${res.status}: ${body}`);
  }
}

function extractPaymentMethod(order) {
  const notes = String(order?.delivery_notes || "");
  const match = notes.match(/Metodo de pago seleccionado:\s*([^\n.]+)/i);
  return match?.[1]?.trim() || order?.payment_method || order?.paymentMethod || "-";
}

export async function notifyOrderSMS(order) {
  if (isMuted("sms")) return;
  const recipients = (process.env.SMS_NOTIFY_PHONES ?? "").split(",").map(p => p.trim()).filter(Boolean);
  if (!recipients.length) return;

  const reference = order.order_reference || order.id || "-";
  const mstext = `Nuevo pedido ${reference} de ${order.sender_name}: $${order.total}. Pago: ${extractPaymentMethod(order)}`;

  await Promise.allSettled(recipients.map(r => sendOne(r, mstext)));
}

export async function notifyInboundEmailSMS(email, { sentRecipients = [], onSent = async () => {} } = {}) {
  if (isMuted("sms")) return "skipped";
  if (!VERSABOLD_SMS_URL || !VERSABOLD_API_KEY) return "skipped";
  const recipients = (process.env.SMS_NOTIFY_PHONES ?? "").split(",").map(p => p.trim()).filter(Boolean);
  if (!recipients.length) return "skipped";
  const compact = value => String(value || "-").replace(/[\r\n\t\x00-\x1f\x7f]/g, " ").slice(0, 90);
  const message = `Nuevo email de ${compact(email.from)}: ${compact(email.subject)}. Revisa Emails en la app admin.`;
  const known = new Set(sentRecipients);
  for (const phone of [...new Set(recipients)]) {
    if (known.has(phone)) continue;
    await sendOne(phone, message);
    try {
      await onSent(phone);
    } catch (error) {
      error.deliveryUncertain = true;
      throw error;
    }
  }
  return "sent";
}
