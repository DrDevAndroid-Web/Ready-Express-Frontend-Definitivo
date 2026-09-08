import {
  enrichComboItems,
  formatDetailValue,
  getItemDetails,
  getItemName,
  getItemQuantity,
  normalizeItems
} from "../../utils/order-item-details.js";

const TELEGRAM_API = () =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

const COMBO_EMOJIS = [
  [/cumplea/i, "🎂"],
  [/merienda|snack/i, "🥗"],
  [/pollo|carne|pescado/i, "🍗"],
  [/combo\s*\d+/i, "📦"]
];

function comboEmoji(name) {
  for (const [pattern, emoji] of COMBO_EMOJIS) {
    if (pattern.test(name)) return emoji;
  }
  return "📦";
}

function shortId(id) {
  return String(id || "").slice(0, 8);
}

function formatPhone(phone) {
  return phone ? `+${String(phone).replace(/^\+/, "")}` : "-";
}

function formatDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleString("es-VE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escape(text) {
  // Escapa caracteres reservados de MarkdownV2
  return String(text ?? "").replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function extractPaymentMethod(order) {
  const notes = String(order?.delivery_notes || "");
  const match = notes.match(/Metodo de pago seleccionado:\s*([^\n.]+)/i);
  return match?.[1]?.trim() || order?.payment_method || order?.paymentMethod || "-";
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados");
    return;
  }

  const response = await fetch(`${TELEGRAM_API()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2"
    })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(`Telegram API error ${response.status}: ${body?.description || "desconocido"}`);
  }
}

export async function notifyNewOrder(order) {
  const items = await enrichComboItems(normalizeItems(order.items));
  const lines = [];

  lines.push(`🛒 *Nueva Orden* \`${escape(shortId(order.id))}\``);
  lines.push("");
  lines.push(`👤 *Remitente:* ${escape(order.sender_name || order.customer_name || "-")}`);
  lines.push(`📞 ${escape(formatPhone(order.sender_phone || order.customer_phone))}`);
  lines.push("");
  lines.push(`📦 *Destinatario:* ${escape(order.receiver_name || "-")}`);
  lines.push(`📞 ${escape(formatPhone(order.receiver_phone))}`);
  lines.push(`🏠 ${escape(order.customer_address || "-")}`);

  if (order.delivery_notes) {
    lines.push(`📝 ${escape(order.delivery_notes)}`);
  }

  lines.push("");
  lines.push(`💳 *Método de pago:* ${escape(extractPaymentMethod(order))}`);
  lines.push("");
  lines.push("🧾 *Pedido:*");
  lines.push("");

  for (const item of items) {
    const name = getItemName(item);
    const qty = getItemQuantity(item);
    const price = Number(item.precio_total ?? item.precio ?? 0);
    const details = getItemDetails(item);
    const isCombo = details.length > 0;

    if (isCombo) {
      lines.push(`${comboEmoji(name)} *${escape(name)}* × ${escape(qty)} — \\$${escape(price.toFixed(2))}`);
      for (const [key, value] of details) {
        lines.push(`  ↳ ${escape(key)}: ${escape(formatDetailValue(value))}`);
      }
    } else {
      lines.push(`• ${escape(qty)}x ${escape(name)} — \\$${escape(price.toFixed(2))}`);
    }
  }

  lines.push("");
  lines.push(`💰 *Total: \\$${escape(Number(order.total).toFixed(2))}*`);
  lines.push(`📅 ${escape(formatDate(order.created_at))}`);

  await sendTelegramMessage(lines.join("\n"));
}

export async function notifyChatStartedTelegram(sessionId) {
  const lines = [
    "💬 *Usuario en chat*",
    "",
    `Sesión: \`${escape(shortId(sessionId))}\``,
    "Canal alterno por si falla el SMS\\."
  ];

  await sendTelegramMessage(lines.join("\n"));
}

export async function notifyPaymentReceived(order, payment) {
  const lines = [
    `📸 *Comprobante recibido* — Orden \`${escape(shortId(order.id))}\``,
    "",
    `👤 ${escape(order.sender_name || order.customer_name || "-")}`,
    `💳 Método: ${escape(payment.method || "-")}`,
    `💵 Monto declarado: \\$${escape(Number(payment.amount).toFixed(2))}`,
    "",
    "⏳ Pendiente de revisión en el dashboard\\."
  ];

  await sendTelegramMessage(lines.join("\n"));
}

export async function notifyPaymentApproved(order) {
  const lines = [
    `✅ *Pago Aprobado* — Orden \`${escape(shortId(order.id))}\``,
    "",
    `👤 ${escape(order.sender_name || order.customer_name || "-")} — \\$${escape(Number(order.total).toFixed(2))}`,
    "🖨️ PDF enviado a impresora\\."
  ];

  await sendTelegramMessage(lines.join("\n"));
}

export async function notifyOrderCancelled(order) {
  const lines = [
    `🚫 *Orden Cancelada* \`${escape(shortId(order.id))}\``,
    "",
    `👤 ${escape(order.sender_name || order.customer_name || "-")} — \\$${escape(Number(order.total).toFixed(2))}`,
    "⚠️ El cliente canceló el pedido desde la página de pago\\."
  ];

  await sendTelegramMessage(lines.join("\n"));
}

export async function notifyPaymentRejected(order) {
  const lines = [
    `❌ *Pago Rechazado* — Orden \`${escape(shortId(order.id))}\``,
    "",
    `👤 ${escape(order.sender_name || order.customer_name || "-")} — \\$${escape(Number(order.total).toFixed(2))}`,
    "⚠️ Requiere contacto con el cliente\\."
  ];

  await sendTelegramMessage(lines.join("\n"));
}
