export async function generarPDFRecibo(order, metodoPago, comprobanteLogo, comprobanteImage) {
  try {
    const { jsPDF } = window.jspdf;
    const html2canvas = window.html2canvas;

    if (!jsPDF || !html2canvas) {
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

    // Logo
    if (comprobanteLogo) {
      try {
        doc.addImage(comprobanteLogo, "PNG", margin, yPosition, 40, 15);
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
    doc.text(`Método: ${metodoPago || "-"}`, margin, yPosition);
    yPosition += 12;

    // Datos del remitente
    doc.setFont(undefined, "bold");
    doc.text("REMITENTE", margin, yPosition);
    yPosition += 8;

    doc.setFont(undefined, "normal");
    doc.setFontSize(10);
    doc.text(`Nombre: ${order.customer_name || order.sender_name || "-"}`, margin, yPosition);
    yPosition += 6;
    doc.text(`Teléfono: ${order.customer_phone || order.sender_phone || "-"}`, margin, yPosition);
    yPosition += 6;
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
    doc.text(`Nombre: ${order.receiver_name || "-"}`, margin, yPosition);
    yPosition += 6;
    doc.text(`Teléfono: ${order.receiver_phone || "-"}`, margin, yPosition);
    yPosition += 6;
    doc.text(`Dirección: ${order.customer_address || "-"}`, margin, yPosition);
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
        const subtotal = precio * cantidad;

        const texto = `${cantidad}x ${nombre} - $${subtotal.toFixed(2)}`;
        doc.text(texto, margin + 5, yPosition);
        yPosition += 6;

        if (yPosition > pageHeight - margin - 20) {
          doc.addPage();
          yPosition = margin;
        }
      });
    }

    yPosition += 6;

    // Total
    doc.setFont(undefined, "bold");
    doc.setFontSize(12);
    doc.text(`TOTAL: $${order.total?.toFixed(2) || "0.00"}`, margin, yPosition);
    yPosition += 12;

    // Comprobante de pago
    if (comprobanteImage) {
      doc.setFont(undefined, "bold");
      doc.setFontSize(11);
      doc.text("COMPROBANTE DE PAGO", margin, yPosition);
      yPosition += 10;

      try {
        const maxImgWidth = 100;
        const imgHeight = 60;
        const imgX = margin + (pageWidth - margin * 2 - maxImgWidth) / 2;
        doc.addImage(comprobanteImage, "JPEG", imgX, yPosition, maxImgWidth, imgHeight);
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
  return new Promise((resolve) => {
    if (window.jspdf && window.html2canvas) {
      resolve();
      return;
    }

    // Cargar jsPDF
    const jsPdfScript = document.createElement("script");
    jsPdfScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    jsPdfScript.onload = () => {
      // Cargar html2canvas
      const html2canvasScript = document.createElement("script");
      html2canvasScript.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      html2canvasScript.onload = () => resolve();
      document.head.appendChild(html2canvasScript);
    };
    document.head.appendChild(jsPdfScript);
  });
}
