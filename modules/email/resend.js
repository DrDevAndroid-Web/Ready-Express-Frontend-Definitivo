import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resend } from "resend";
import sharp from "sharp";
import nodemailer from "nodemailer";
import { generatePDF } from "../../utils/pdf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_PATH = path.resolve(__dirname, "../../assets/logo-negocio.png");

export async function resendEmail(order, emailContent, to) {
  const resend = createResendClient();
  const from = getResendFrom();

  const recipients = to || getOwnerEmails();
  if (!recipients.length) {
    throw new Error("No hay direcciones de dueños configuradas en .env (OWNER_EMAIL_1, OWNER_EMAIL_2, OWNER_EMAIL_3)");
  }

  const { error } = await resend.emails.send({
    from,
    to: recipients.join(","),
    subject: `Orden aprobada ${shortId(order.id)}`,
    html: emailContent.html,
    text: emailContent.text
  });

  if (error) {
    throw new Error(error.message || "Error enviando email con Resend");
  }
}

export async function sendPrintableOrderEmail(order, to = process.env.IMPRESORA_EMAIL) {
  if (!to) {
    throw new Error("IMPRESORA_EMAIL no esta configurado en .env");
  }

  const pdf = await generatePDF(order, { copies: 2 });
  const transporter = createSmtpTransporter();

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: `Orden aprobada ${shortId(order.id)}`,
    text: `Orden aprobada ${order.id || "-"}\nAdjunto PDF con todos los detalles para impresion.\n`,
    attachments: [
      {
        filename: `orden-${shortId(order.id) || "readyexpress"}.pdf`,
        content: pdf,
        contentType: "application/pdf"
      }
    ]
  });
}

function createSmtpTransporter() {
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

export async function buildPrintableOrderEmail(order) {
  const printableText = `${formatPrintableOrder(order)}\nGracias por su compra\n`;
  const logoDataUri = await getLogoDataUri();

  return {
    html: buildPrintableHtml(order, logoDataUri),
    text: printableText
  };
}

function createResendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY no esta configurado en .env");
  }

  return new Resend(process.env.RESEND_API_KEY);
}

function getResendFrom() {
  if (!process.env.RESEND_FROM) {
    throw new Error("RESEND_FROM no esta configurado en .env");
  }

  const from = process.env.RESEND_FROM.trim();
  const email = extractEmail(from);

  if (!email.endsWith("@versabold.com")) {
    throw new Error("RESEND_FROM debe usar el dominio verificado versabold.com");
  }

  return from.includes("<") ? from : `Ready Express Now <${from}>`;
}

function getOwnerEmails() {
  const emails = [
    process.env.OWNER_EMAIL_1,
    process.env.OWNER_EMAIL_2,
    process.env.OWNER_EMAIL_3
  ].filter(email => email && email.trim());

  return emails;
}

function extractEmail(from) {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

function formatPrintableOrder(order) {
  const items = normalizeItems(order.items);
  const lines = [
    "READY EXPRESS NOW",
    "ORDEN APROBADA",
    "==============================",
    `Orden: ${order.id || "-"}`,
    `Fecha: ${formatDate(order.created_at)}`,
    `Estado: ${order.status || "-"}`,
    "",
    "REMITENTE",
    `Nombre: ${order.customer_name || order.sender_name || "-"}`,
    `Email: ${order.customer_email || "-"}`,
    `Telefono: ${order.customer_phone || order.sender_phone || "-"}`,
    "",
    "RECEPTOR / ENTREGA",
    `Nombre: ${order.receiver_name || "-"}`,
    `Telefono: ${order.receiver_phone || "-"}`,
    `Direccion: ${order.customer_address || "-"}`,
    ...(order.delivery_notes ? [`Notas: ${order.delivery_notes}`] : []),
    "",
    "ITEMS"
  ];

  if (!items.length) {
    lines.push("- Sin items");
  } else {
    items.forEach((item, index) => {
      const quantity = item.cantidad || item.quantity || item.qty || 1;
      const name = item.nombre || item.name || item.descripcion || item.item || "Item";
      const price = item.precio ?? item.price ?? item.precio_total ?? item.total ?? "";
      lines.push(`${index + 1}. ${quantity} x ${name}${price !== "" ? ` - $${formatNumber(price)}` : ""}`);
    });
  }

  lines.push(
    "",
    "------------------------------",
    `TOTAL: $${formatNumber(order.total)}`,
    "==============================",
    ""
  );

  return lines.join("\n");
}

function buildPrintableHtml(order, logoDataUri) {
  const items = normalizeItems(order.items);
  const orderId = escapeHtml(order.id || "-");
  const status = escapeHtml(order.status || "-");
  const total = escapeHtml(formatNumber(order.total));
  const logoMarkup = logoDataUri
    ? `<img src="${logoDataUri}" width="160" alt="Ready Express Now" style="display:block; width:160px; max-width:60%; height:auto; margin:0 auto 16px;">`
    : `<div style="font-size:22px; font-weight:700; text-align:center; margin-bottom:16px;">Ready Express Now</div>`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Orden aprobada ${orderId}</title>
  </head>
  <body style="margin:0; padding:0; background:#ffffff; color:#111111; font-family:Arial, Helvetica, sans-serif;">
    <div style="max-width:680px; margin:0 auto; padding:22px 18px;">
      <div style="text-align:center;">
        ${logoMarkup}
        <div style="font-size:20px; font-weight:700; margin-bottom:4px;">Orden aprobada</div>
        <div style="font-size:13px; color:#555555;">${escapeHtml(formatDate(order.created_at))}</div>
      </div>

      ${buildInfoTable([
        ["Orden", orderId],
        ["Estado", status],
        ["Total", `$${total}`]
      ])}

      ${buildSection("Datos de la persona que envia", [
        ["Nombre", order.customer_name || order.sender_name || "-"],
        ["Email", order.customer_email || "-"],
        ["Telefono", order.customer_phone || order.sender_phone || "-"]
      ])}

      ${buildSection("Datos de la persona que recibe", [
        ["Nombre", order.receiver_name || "-"],
        ["Telefono", order.receiver_phone || "-"],
        ["Direccion", order.customer_address || "-"],
        ...(order.delivery_notes ? [["Notas", order.delivery_notes]] : [])
      ])}

      <div style="margin-top:18px;">
        <div style="font-size:15px; font-weight:700; margin-bottom:8px;">Productos</div>
        ${buildItemsTable(items)}
      </div>

      <div style="border-top:1px solid #dddddd; margin-top:22px; padding-top:16px; text-align:center; font-size:18px; font-weight:700;">
        Gracias por su compra
      </div>
    </div>
  </body>
</html>`;
}

function buildSection(title, rows) {
  return `<div style="margin-top:18px;">
    <div style="font-size:15px; font-weight:700; margin-bottom:8px;">${escapeHtml(title)}</div>
    ${buildInfoTable(rows)}
  </div>`;
}

function buildInfoTable(rows) {
  const body = rows
    .map(([label, value]) => `<tr>
      <td style="width:36%; padding:7px 8px; border:1px solid #dddddd; font-size:13px; font-weight:700; vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:7px 8px; border:1px solid #dddddd; font-size:13px; vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`)
    .join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse; margin-top:12px;">${body}</table>`;
}

function buildItemsTable(items) {
  if (!items.length) {
    return `<div style="border:1px solid #dddddd; padding:8px; font-size:13px;">Sin items</div>`;
  }

  const rows = items.map((item, index) => {
    const quantity = item.cantidad || item.quantity || item.qty || 1;
    const name = item.nombre || item.name || item.descripcion || item.item || "Item";
    const price = item.precio ?? item.price ?? item.precio_total ?? item.total ?? "";
    const rowTotal = item.precio_total ?? item.total ?? "";

    return `<tr>
      <td style="padding:7px 8px; border:1px solid #dddddd; font-size:13px; text-align:center;">${index + 1}</td>
      <td style="padding:7px 8px; border:1px solid #dddddd; font-size:13px;">${escapeHtml(name)}</td>
      <td style="padding:7px 8px; border:1px solid #dddddd; font-size:13px; text-align:center;">${escapeHtml(quantity)}</td>
      <td style="padding:7px 8px; border:1px solid #dddddd; font-size:13px; text-align:right;">${price !== "" ? `$${escapeHtml(formatNumber(price))}` : "-"}</td>
      <td style="padding:7px 8px; border:1px solid #dddddd; font-size:13px; text-align:right;">${rowTotal !== "" ? `$${escapeHtml(formatNumber(rowTotal))}` : "-"}</td>
    </tr>`;
  }).join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; border-collapse:collapse;">
    <thead>
      <tr>
        <th style="padding:7px 8px; border:1px solid #dddddd; font-size:12px;">#</th>
        <th style="padding:7px 8px; border:1px solid #dddddd; font-size:12px; text-align:left;">Producto</th>
        <th style="padding:7px 8px; border:1px solid #dddddd; font-size:12px;">Cant.</th>
        <th style="padding:7px 8px; border:1px solid #dddddd; font-size:12px; text-align:right;">Precio</th>
        <th style="padding:7px 8px; border:1px solid #dddddd; font-size:12px; text-align:right;">Subtotal</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function getLogoDataUri() {
  try {
    const buffer = await sharp(LOGO_PATH)
      .resize({ width: 220, withoutEnlargement: true })
      .png()
      .toBuffer();

    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    return "";
  }
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

function shortId(id) {
  return id ? String(id).slice(0, 8) : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
