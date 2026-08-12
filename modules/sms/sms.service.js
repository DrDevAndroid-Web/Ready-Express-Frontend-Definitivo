const VERSABOLD_SMS_URL = process.env.VERSABOLD_SMS_URL;
const VERSABOLD_API_KEY = process.env.VERSABOLD_API_KEY;

async function sendOne(recipient, mstext) {
  if (!VERSABOLD_SMS_URL || !VERSABOLD_API_KEY) return;

  const res = await fetch(VERSABOLD_SMS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": VERSABOLD_API_KEY,
    },
    body: JSON.stringify({ recipient, mstext }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`zdSMS error ${res.status}: ${body}`);
  }
}

export async function notifyOrderSMS(order) {
  const recipients = (process.env.SMS_NOTIFY_PHONES ?? "").split(",").map(p => p.trim()).filter(Boolean);
  if (!recipients.length) return;

  const mstext = `Nuevo pedido de ${order.sender_name}: $${order.total}`;

  await Promise.allSettled(recipients.map(r => sendOne(r, mstext)));
}
