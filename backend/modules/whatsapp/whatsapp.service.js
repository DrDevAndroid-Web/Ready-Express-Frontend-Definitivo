export async function sendWhatsApp(order) {
  const phone = process.env.WHATSAPP_PHONE;
  const apiKey = process.env.WHATSAPP_APIKEY;

  if (!phone || !apiKey) {
    throw new Error("WHATSAPP_PHONE o WHATSAPP_APIKEY no estan configurados");
  }

  const msg = formatWhatsAppOrder(order);
  const url = new URL("https://api.callmebot.com/whatsapp.php");
  url.searchParams.set("phone", phone);
  url.searchParams.set("text", msg);
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url);
  const text = await response.text();

  if (!response.ok || /error/i.test(text)) {
    throw new Error(`CallMeBot respondio: ${text || response.statusText}`);
  }
}

function formatWhatsAppOrder(order) {
  const items = normalizeItems(order.items);
  const lines = [
    "Nueva orden Ready Express Now",
    `ID: ${order.id || "-"}`,
    "",
    "REMITENTE",
    `Nombre: ${order.customer_name || order.sender_name || "-"}`,
    `Tel: ${order.customer_phone || order.sender_phone || "-"}`,
    `Email: ${order.customer_email || "-"}`,
    "",
    "RECEPTOR / ENTREGA",
    `Nombre: ${order.receiver_name || "-"}`,
    `Tel: ${order.receiver_phone || "-"}`,
    `Direccion: ${order.customer_address || "-"}`,
    ...(order.delivery_notes ? [`Notas: ${order.delivery_notes}`] : []),
    "",
    `Total: ${formatMoney(order.total)}`,
    "",
    "Items:"
  ];

  if (!items.length) {
    lines.push("- Sin items");
  } else {
    items.forEach((item, index) => {
      const quantity = item.cantidad || item.quantity || item.qty || 1;
      const name = item.nombre || item.name || item.descripcion || item.item || "Item";
      const subtotal = item.precio_total ?? item.subtotal ?? item.total ?? "";
      lines.push(`${index + 1}. ${quantity} x ${name}${subtotal !== "" ? ` - ${formatMoney(subtotal)}` : ""}`);
    });
  }

  return lines.join("\n");
}

function normalizeItems(items) {
  if (Array.isArray(items)) return items;
  if (!items) return [];

  if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [{ nombre: items }];
    }
  }

  return [items];
}

function formatMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : String(value || "-");
}
