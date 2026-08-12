import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import {
  enrichComboItems,
  formatDetailValue,
  getItemDetails,
  getItemName,
  getItemQuantity,
  normalizeItems
} from "./order-item-details.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_DEFAULT = path.join(__dirname, "../assets/logo-negocio.png");

export async function generatePDF(order, options = {}) {
  const items = await enrichComboItems(normalizeItems(order.items));
  const copies = Math.max(1, Number(options.copies || 1));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42, size: "A4" });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", err => reject(err));

    try {
      for (let copy = 0; copy < copies; copy++) {
        if (copy > 0) doc.addPage();
        renderHeader(doc, order);
        renderOrderDetails(doc, order);
        renderItems(doc, items);
        renderTotal(doc, order.total);
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function renderHeader(doc, order) {
  try {
    doc.image(LOGO_DEFAULT, (doc.page.width - 90) / 2, 34, { width: 90 });
    doc.moveDown(5);
  } catch {
    doc.moveDown();
  }

  doc.font("Helvetica-Bold").fontSize(18).text("ORDEN READY EXPRESS NOW", { align: "center" });
  doc.font("Helvetica").fontSize(9).text(`Fecha: ${formatDate(order.created_at)}`, { align: "center" });
  doc.moveDown(1.5);
}

function renderOrderDetails(doc, order) {
  sectionTitle(doc, "Datos de la orden");

  const rows = [
    ["Estado", order.status],
    ["Cliente / remitente", order.customer_name || order.sender_name],
    ["Email", order.customer_email],
    ["Telefono cliente", order.customer_phone || order.sender_phone],
    ["Receptor", order.receiver_name],
    ["Telefono receptor", order.receiver_phone],
    ["Direccion", order.customer_address],
    ["Notas de entrega", order.delivery_notes]
  ];

  rows.forEach(([label, data]) => drawKeyValue(doc, label, data));
  doc.moveDown();
}

function renderItems(doc, items) {
  sectionTitle(doc, "Items");

  if (!items.length) {
    doc.font("Helvetica").fontSize(10).text("Sin items registrados");
    doc.moveDown();
    return;
  }

  items.forEach((item, index) => {
    ensureSpace(doc, 86);
    const quantity = getItemQuantity(item);
    const name = getItemName(item);
    const title = quantity > 1 ? `${index + 1}. ${quantity} x ${name}` : `${index + 1}. ${name}`;

    doc.font("Helvetica-Bold").fontSize(10).text(title);
    doc.font("Helvetica").fontSize(9);

    const extra = getItemDetails(item);
    if (extra.length) {
      doc.font("Helvetica").fontSize(9).fillColor("#444");
      extra.forEach(([key, data]) => doc.text(`${key}: ${formatDetailValue(data)}`));
      doc.fillColor("#000");
    }

    doc.moveDown(0.7);
  });
}

function renderTotal(doc, total) {
  ensureSpace(doc, 58);
  doc.moveDown(0.5);
  doc.rect(340, doc.y, 210, 38).fill("#f2f2f2");
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(12);
  doc.text("TOTAL:", 356, doc.y - 28);
  doc.text(formatMoney(total), 435, doc.y - 14, { width: 105, align: "right" });
}

function sectionTitle(doc, title) {
  ensureSpace(doc, 34);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#000").text(title);
  doc.moveTo(42, doc.y + 3).lineTo(553, doc.y + 3).strokeColor("#dddddd").stroke();
  doc.moveDown(0.6);
}

function drawKeyValue(doc, label, data) {
  if (data === null || data === undefined || data === "") return;
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#222").text(`${label}: `, { continued: true });
  doc.font("Helvetica").fillColor("#000").text(String(data));
}

function formatMoney(valueToFormat) {
  if (valueToFormat === null || valueToFormat === undefined || valueToFormat === "") return "-";
  const number = Number(valueToFormat);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : String(valueToFormat);
}

function formatDate(date) {
  if (!date) return "-";
  return new Date(date).toLocaleString("es-VE", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function ensureSpace(doc, requiredHeight) {
  if (doc.y + requiredHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}
