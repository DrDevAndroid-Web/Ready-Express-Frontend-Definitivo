import nodemailer from "nodemailer";
import {
  enrichComboItems,
  formatDetailValue,
  getItemDetails,
  getItemName,
  getItemQuantity,
  normalizeItems
} from "../../utils/order-item-details.js";

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

export async function sendEmail(order) {
  const transporter = createTransporter();
  const content = await buildOrderEmail(order);
  const ownerEmails = getOwnerEmails();

  if (!ownerEmails.length) {
    throw new Error("No hay direcciones de dueños configuradas en .env (OWNER_EMAIL_1, OWNER_EMAIL_2, OWNER_EMAIL_3)");
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: ownerEmails.join(","),
    subject: "Nueva Orden Ready Express Now",
    text: content.text,
    html: content.html
  });
}

function getOwnerEmails() {
  const emails = [
    process.env.OWNER_EMAIL_1,
    process.env.OWNER_EMAIL_2,
    process.env.OWNER_EMAIL_3
  ].filter(email => email && email.trim());

  return emails;
}

export async function sendCancelledOrderEmail(order) {
  const transporter = createTransporter();
  const ownerEmails = getOwnerEmails();

  if (!ownerEmails.length) return;

  const shortId = String(order.id || "").slice(0, 8);
  const senderName = order.sender_name || order.customer_name || "-";
  const total = `$${Number(order.total || 0).toFixed(2)}`;

  const text = [
    "READY EXPRESS NOW",
    "ORDEN CANCELADA",
    "==============================",
    `Orden: ${order.id || "-"}`,
    `Fecha cancelacion: ${formatDate(new Date().toISOString())}`,
    "",
    "CLIENTE",
    `Nombre: ${senderName}`,
    `Telefono: ${order.sender_phone || order.customer_phone || "-"}`,
    "",
    "DESTINATARIO",
    `Nombre: ${order.receiver_name || "-"}`,
    `Telefono: ${order.receiver_phone || "-"}`,
    `Direccion: ${order.customer_address || "-"}`,
    "",
    `TOTAL CANCELADO: ${total}`,
    "=============================="
  ].join("\n");

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="font-family:Arial, Helvetica, sans-serif; color:#111; line-height:1.4;">
    <h2 style="margin:0 0 6px; color:#c0392b;">🚫 Orden Cancelada — Ready Express Now</h2>
    <p style="margin:0 0 16px; color:#555;">${escapeHtml(formatDate(new Date().toISOString()))}</p>
    ${buildInfoTable([
      ["Orden", `#${shortId}`],
      ["Total cancelado", total]
    ])}
    <h3>Cliente</h3>
    ${buildInfoTable([
      ["Nombre", senderName],
      ["Telefono", order.sender_phone || order.customer_phone || "-"]
    ])}
    <h3>Destinatario</h3>
    ${buildInfoTable([
      ["Nombre", order.receiver_name || "-"],
      ["Telefono", order.receiver_phone || "-"],
      ["Direccion", order.customer_address || "-"]
    ])}
    <p style="color:#888; margin-top:16px;">El cliente canceló el pedido desde la página de pago.</p>
  </body>
</html>`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: ownerEmails.join(","),
    subject: `Orden Cancelada #${shortId} — Ready Express Now`,
    text,
    html
  });
}

export async function buildOrderEmail(order) {
  const items = await enrichComboItems(normalizeItems(order.items));
  const text = [
    "READY EXPRESS NOW",
    "NUEVA ORDEN",
    "==============================",
    `Orden: ${order.id || "-"}`,
    `Fecha: ${formatDate(order.created_at)}`,
    `Estado: ${order.status || "-"}`,
    "",
    "CLIENTE / REMITENTE",
    `Nombre: ${order.customer_name || order.sender_name || "-"}`,
    `Email: ${order.customer_email || "-"}`,
    `Telefono: ${order.customer_phone || order.sender_phone || "-"}`,
    "",
    "DESTINATARIO / ENTREGA",
    `Nombre: ${order.receiver_name || "-"}`,
    `Telefono: ${order.receiver_phone || "-"}`,
    `Direccion: ${order.customer_address || "-"}`,
    ...(order.delivery_notes ? [`Notas: ${order.delivery_notes}`] : []),
    "",
    "ITEMS",
    ...formatItemsText(items),
    "",
    `TOTAL: $${formatNumber(order.total)}`,
    "=============================="
  ].join("\n");

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="font-family:Arial, Helvetica, sans-serif; color:#111; line-height:1.4;">
    <h2 style="margin:0 0 6px;">Nueva orden Ready Express Now</h2>
    <p style="margin:0 0 16px; color:#555;">${escapeHtml(formatDate(order.created_at))}</p>
    ${buildInfoTable([
      ["Orden", order.id || "-"],
      ["Estado", order.status || "-"],
      ["Total", `$${formatNumber(order.total)}`]
    ])}
    <h3>Cliente / remitente</h3>
    ${buildInfoTable([
      ["Nombre", order.customer_name || order.sender_name || "-"],
      ["Email", order.customer_email || "-"],
      ["Telefono", order.customer_phone || order.sender_phone || "-"]
    ])}
    <h3>Destinatario / entrega</h3>
    ${buildInfoTable([
      ["Nombre", order.receiver_name || "-"],
      ["Telefono", order.receiver_phone || "-"],
      ["Direccion", order.customer_address || "-"],
      ...(order.delivery_notes ? [["Notas", order.delivery_notes]] : [])
    ])}
    <h3>Items</h3>
    ${buildItemsHtml(items)}
  </body>
</html>`;

  return { text, html };
}

function formatItemsText(items) {
  if (!items.length) return ["- Sin items"];

  return items.flatMap((item, index) => {
    const quantity = getItemQuantity(item);
    const name = getItemName(item);
    const details = getItemDetails(item);
    const header = quantity > 1 ? `${index + 1}. ${quantity} x ${name}` : `${index + 1}. ${name}`;
    return [header, ...details.map(([key, value]) => `   ${key}: ${formatDetailValue(value)}`)];
  });
}

function buildItemsHtml(items) {
  if (!items.length) return `<p>Sin items</p>`;

  return items.map((item, index) => {
    const quantity = getItemQuantity(item);
    const name = getItemName(item);
    const details = getItemDetails(item);
    const header = quantity > 1 ? `${index + 1}. ${quantity} x ${name}` : `${index + 1}. ${name}`;

    return `<div style="border:1px solid #ddd; padding:10px; margin:0 0 10px;">
      <div style="font-weight:700;">${escapeHtml(header)}</div>
      ${details.length ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-top:8px; width:100%;">${details.map(([key, value]) => `<tr>
        <td style="border:1px solid #ddd; padding:6px; font-weight:700; width:36%;">${escapeHtml(key)}</td>
        <td style="border:1px solid #ddd; padding:6px;">${escapeHtml(formatDetailValue(value))}</td>
      </tr>`).join("")}</table>` : ""}
    </div>`;
  }).join("");
}

function buildInfoTable(rows) {
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; margin:8px 0 16px;">
    ${rows.map(([label, value]) => `<tr>
      <td style="border:1px solid #ddd; padding:7px; font-weight:700; width:32%;">${escapeHtml(label)}</td>
      <td style="border:1px solid #ddd; padding:7px;">${escapeHtml(value)}</td>
    </tr>`).join("")}
  </table>`;
}

function formatDate(date) {
  if (!date) return "-";
  return new Date(date).toLocaleString("es-VE", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
