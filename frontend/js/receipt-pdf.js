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
    doc.text(`Monto: $${order.total?.toFixed(2) || "0.00"}`, margin, yPosition);
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
    yPosition += 8;

    // Items
    doc.setFont(undefined, "bold");
    doc.setFontSize(11);
    doc.text("PRODUCTOS", margin, yPosition);
    yPosition += 8;

    doc.setFont(undefined, "normal");
    doc.setFontSize(10);

    if (order.items && order.items.length > 0) {
      order.items.forEach(item => {
        const cantidad = item.cantidad || item.qty || 1;
        const nombre = item.nombre || item.name || "-";
        const precio = item.precio || item.price || 0;
        const subtotal = Number(item.precio_total ?? item.total ?? precio * cantidad) || 0;

        const texto = `${cantidad}x ${nombre} - $${subtotal.toFixed(2)}`;
        ensurePageRoom(12);
        yPosition = addWrappedText(texto, margin + 5, yPosition, contentWidth - 5);
      });
    } else {
      doc.text("Sin productos disponibles en el recibo.", margin + 5, yPosition);
      yPosition += 6;
    }

    yPosition += 6;

    // Total
    ensurePageRoom(20);
    doc.setFont(undefined, "bold");
    doc.setFontSize(12);
    doc.text(`TOTAL: $${order.total?.toFixed(2) || "0.00"}`, margin, yPosition);
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
