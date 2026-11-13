export async function generarPDFRecibo(order, metodoPago, comprobanteLogo, comprobanteImage) {
  try {
    const { jsPDF } = window.jspdf;

    if (!jsPDF) {
      throw new Error("Librerías PDF no cargadas");
    }

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4"
    });

    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let yPosition = margin;
    const contentWidth = pageWidth - margin * 2;

    const ensurePageRoom = (height = 12) => {
      if (yPosition + height > pageHeight - margin) {
        doc.addPage();
        yPosition = margin;
      }
    };

    const addWrappedText = (text, x, y, maxWidth, lineHeight = 6) => {
      const lines = doc.splitTextToSize(String(text ?? "-"), maxWidth);
      doc.text(lines, x, y);
      return y + lines.length * lineHeight;
    };

    // Logo
    if (comprobanteLogo) {
      try {
        doc.addImage(comprobanteLogo, getImageFormat(comprobanteLogo), margin, yPosition, 40, 15);
        yPosition += 25;
      } catch (err) {
        console.warn("No se pudo agregar logo:", err);
        yPosition += 10;
      }
    }

    // Título
    doc.setFontSize(18);
    doc.setFont(undefined, "bold");
    doc.text("RECIBO DE PEDIDO", margin, yPosition);
    yPosition += 12;

    // Info de orden
    doc.setFontSize(11);
    doc.setFont(undefined, "normal");
    doc.text(`Orden: #${order.id || "-"}`, margin, yPosition);
    yPosition += 8;
    doc.text(`Monto total: $${formatMoney(order.total)}`, margin, yPosition);
    yPosition += 8;
    yPosition = addWrappedText(`Metodo: ${metodoPago || "-"}`, margin, yPosition, contentWidth);
    yPosition += 12;

    // Datos del remitente
    doc.setFont(undefined, "bold");
    doc.text("REMITENTE", margin, yPosition);
    yPosition += 8;

    doc.setFont(undefined, "normal");
    doc.setFontSize(10);
    yPosition = addWrappedText(`Nombre: ${order.customer_name || order.sender_name || "-"}`, margin, yPosition, contentWidth);
    yPosition = addWrappedText(`Telefono: ${order.customer_phone || order.sender_phone || "-"}`, margin, yPosition, contentWidth);
    if (order.customer_email) {
      doc.text(`Email: ${order.customer_email}`, margin, yPosition);
      yPosition += 6;
    }
    yPosition += 6;

    // Datos del receptor
    doc.setFont(undefined, "bold");
    doc.setFontSize(11);
    doc.text("RECEPTOR", margin, yPosition);
    yPosition += 8;

    doc.setFont(undefined, "normal");
    doc.setFontSize(10);
    yPosition = addWrappedText(`Nombre: ${order.receiver_name || "-"}`, margin, yPosition, contentWidth);
    yPosition = addWrappedText(`Telefono: ${order.receiver_phone || "-"}`, margin, yPosition, contentWidth);
    yPosition = addWrappedText(`Direccion: ${order.customer_address || "-"}`, margin, yPosition, contentWidth);
    yPosition = addWrappedText(`Municipio: ${order.delivery_municipality || "-"}`, margin, yPosition, contentWidth);
    yPosition += 8;

    // Items
    doc.setFont(undefined, "bold");
    doc.setFontSize(11);
    doc.text("PRODUCTOS", margin, yPosition);
    yPosition += 8;

    doc.setFont(undefined, "normal");
    doc.setFontSize(10);

    const consolidatedItems = consolidateDeliveryItems(order.items);
    if (consolidatedItems.length > 0) {
      consolidatedItems.forEach(item => {
        ensurePageRoom(8);
        yPosition = addWrappedText(`${item.quantity}x ${item.name}`, margin + 5, yPosition, contentWidth - 5);
      });
    } else {
      doc.text("Sin productos disponibles en el recibo.", margin + 5, yPosition);
      yPosition += 6;
    }

    yPosition += 6;

    const deliverySurcharge = Number(order.delivery_surcharge || 0);
    const productsSubtotal = Number(order.products_subtotal ?? (Number(order.total || 0) - deliverySurcharge));
    ensurePageRoom(28);
    doc.setFont(undefined, "normal");
    yPosition = addWrappedText(`Subtotal de productos: $${formatMoney(productsSubtotal)}`, margin, yPosition, contentWidth);
    yPosition = addWrappedText(`Entrega (${order.delivery_municipality || "municipio no indicado"}): ${deliverySurcharge > 0 ? `+$${formatMoney(deliverySurcharge)}` : "sin recargo"}`, margin, yPosition, contentWidth);
    yPosition += 4;

    // Total
    ensurePageRoom(20);
    doc.setFont(undefined, "bold");
    doc.setFontSize(12);
    doc.text(`TOTAL: $${formatMoney(order.total)}`, margin, yPosition);
    yPosition += 12;

    // Comprobante de pago
    if (comprobanteImage) {
      ensurePageRoom(85);
      doc.setFont(undefined, "bold");
      doc.setFontSize(11);
      doc.text("COMPROBANTE DE PAGO", margin, yPosition);
      yPosition += 10;

      try {
        const maxImgWidth = 100;
        const imgHeight = 60;
        const imgX = margin + (pageWidth - margin * 2 - maxImgWidth) / 2;
        doc.addImage(comprobanteImage, getImageFormat(comprobanteImage), imgX, yPosition, maxImgWidth, imgHeight);
        yPosition += imgHeight + 10;
      } catch (err) {
        console.warn("No se pudo agregar comprobante:", err);
      }
    }

    // Pie
    yPosition += 10;
    doc.setFont(undefined, "italic");
    doc.setFontSize(9);
    doc.text("Gracias por tu compra. Ready Express Now", margin, pageHeight - 10);

    // Descargar
    const filename = `recibo-${order.id || "pedido"}.pdf`;
    doc.save(filename);

    return true;
  } catch (err) {
    console.error("Error generando PDF:", err);
    throw err;
  }
}

/**
 * Genera una orden de entrega interna con los componentes de combos y los
 * productos independientes consolidados por nombre y presentación.
 */
export async function generarPDFOrdenEntrega(order, comprobanteLogo) {
  try {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) throw new Error("Librerías PDF no cargadas");

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const ensureRoom = (height = 8) => {
      if (y + height > pageHeight - margin - 10) {
        doc.addPage();
        y = margin;
      }
    };
    const write = (value, x = margin, size = 10, lineHeight = 5) => {
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(String(value ?? "-"), contentWidth - (x - margin));
      ensureRoom(lines.length * lineHeight + 2);
      doc.text(lines, x, y);
      y += lines.length * lineHeight;
    };

    if (comprobanteLogo) {
      try {
        doc.addImage(comprobanteLogo, getImageFormat(comprobanteLogo), margin, y, 40, 15);
        y += 23;
      } catch { /* el documento continúa sin logo */ }
    }

    doc.setFont(undefined, "bold");
    write("ORDEN DE ENTREGA", margin, 18, 8);
    doc.setFont(undefined, "normal");
    write(`Orden: #${order.order_reference || order.id || "-"}`, margin, 11);
    write(`Fecha: ${formatDeliveryDate(order.created_at)}`, margin, 10);
    y += 3;

    doc.setFont(undefined, "bold");
    write("ENTREGA", margin, 12, 6);
    doc.setFont(undefined, "normal");
    write(`Recibe: ${order.receiver_name || "-"}`, margin, 10);
    write(`Teléfono: ${order.receiver_phone || "-"}`, margin, 10);
    write(`Dirección: ${order.customer_address || "-"}`, margin, 10);
    write(`Municipio: ${order.delivery_municipality || "-"}`, margin, 10);
    if (order.delivery_notes) write(`Notas: ${order.delivery_notes}`, margin, 10);
    y += 5;

    doc.setFont(undefined, "bold");
    write("PRODUCTOS A PREPARAR", margin, 12, 6);
    doc.setFont(undefined, "normal");
    const lines = consolidateDeliveryItems(order.items);
    if (!lines.length) {
      write("- No hay productos registrados", margin + 5, 10);
    } else {
      lines.forEach(item => {
        ensureRoom(8);
        write(`${item.quantity}  ${item.name}`, margin + 5, 11, 6);
      });
    }

    y += 6;
    doc.setFont(undefined, "italic");
    doc.setFontSize(9);
    doc.text("Marcar cada producto al preparar el pedido.", margin, Math.min(y, pageHeight - 20));
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.text("Ready Express Now", margin, pageHeight - 10);

    const reference = order.order_reference || order.id || "pedido";
    doc.save(`orden-entrega-${reference}.pdf`);
    return true;
  } catch (err) {
    console.error("Error generando orden de entrega:", err);
    throw err;
  }
}

function consolidateDeliveryItems(items) {
  const grouped = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const itemQuantity = Number(item?.cantidad ?? item?.quantity ?? item?.qty ?? 1) || 1;
    const components = Array.isArray(item?.combo_items) ? item.combo_items : [];
    if (components.length) {
      components.forEach(component => {
        addDeliveryLine(grouped, component?.nombre || component?.name || component?.item, Number(component?.cantidad ?? component?.quantity ?? component?.qty ?? 1) * itemQuantity);
      });
    } else {
      addDeliveryLine(grouped, item?.nombre || item?.name || item?.item, itemQuantity);
    }
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function addDeliveryLine(grouped, rawName, quantity) {
  const name = String(rawName || "").trim();
  if (!name || !Number.isFinite(quantity) || quantity <= 0) return;
  const key = normalizeDeliveryName(name);
  const existing = grouped.get(key);
  if (existing) existing.quantity += quantity;
  else grouped.set(key, { name, quantity });
}

function normalizeDeliveryName(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/(\d)\s+(lb|kg|g|ml|l)\b/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDeliveryDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("es-CU", {
    timeZone: "America/Havana",
    dateStyle: "short",
    timeStyle: "short"
  });
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

export function cargarLibreriasPDF() {
  return new Promise((resolve, reject) => {
    if (window.jspdf) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => reject(new Error("No se pudieron cargar las librerias PDF")), 12000);

    const jsPdfScript = document.createElement("script");
    jsPdfScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    jsPdfScript.onload = () => {
      clearTimeout(timeout);
      if (window.jspdf) resolve();
      else reject(new Error("jsPDF no quedo disponible"));
    };
    jsPdfScript.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("No se pudo descargar jsPDF"));
    };
    document.head.appendChild(jsPdfScript);
  });
}

function getImageFormat(dataUrl) {
  const header = String(dataUrl || "").slice(0, 40).toLowerCase();
  if (header.includes("image/png")) return "PNG";
  if (header.includes("image/webp")) return "WEBP";
  return "JPEG";
}
