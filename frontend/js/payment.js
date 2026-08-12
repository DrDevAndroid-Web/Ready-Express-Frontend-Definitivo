import { uploadPayment, cancelOrder } from "./api.js?v10";
import { cargarMetodosPago, obtenerMetodoPago } from "./payment-methods.js?v10";
import { generarPDFRecibo, cargarLibreriasPDF } from "./receipt-pdf.js?v10";

export const PENDING_PAYMENT_KEY = "ren_pending_payment";

let pendingOrderId = null;
let pendingTotal = 0;

export function savePendingPayment(orderId, total, items = []) {
  localStorage.setItem(
    PENDING_PAYMENT_KEY,
    JSON.stringify({
      orderId,
      total,
      items,
      createdAt: new Date().toISOString(),
    })
  );
}

export function getPendingPayment() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_PAYMENT_KEY));
  } catch {
    return null;
  }
}

export function hasPendingPayment() {
  const pending = getPendingPayment();
  return Boolean(pending?.orderId && Number.isFinite(Number(pending.total)));
}

export function clearPendingPayment() {
  localStorage.removeItem(PENDING_PAYMENT_KEY);
}

export function redirectToPendingPayment() {
  if (!hasPendingPayment()) return false;
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  if (currentPage !== "pago.html") {
    window.location.href = "./pago.html";
    return true;
  }
  return false;
}

export async function initPaymentPage() {
  const pending = getPendingPayment();
  const emptyState = document.getElementById("payment-empty-state");
  const paymentContent = document.getElementById("payment-content");

  if (!pending?.orderId || !Number.isFinite(Number(pending.total))) {
    if (emptyState) emptyState.style.display = "block";
    if (paymentContent) paymentContent.style.display = "none";
    return;
  }

  pendingOrderId = pending.orderId;
  pendingTotal = Number(pending.total);

  const orderIdEl = document.getElementById("payment-order-id");
  const totalEl = document.getElementById("payment-total");
  if (orderIdEl) orderIdEl.textContent = `#${pendingOrderId}`;
  if (totalEl) totalEl.textContent = `$${pendingTotal.toFixed(2)}`;

  if (emptyState) emptyState.style.display = "none";
  if (paymentContent) paymentContent.style.display = "block";

  resetPaymentForm();

  // Mostrar método de pago seleccionado
  const selectedMethodId = localStorage.getItem("ren_selected_payment_method");
  if (selectedMethodId) {
    const allMethods = await cargarMetodosPago();
    const selectedMethod = allMethods.find(m => m.id === selectedMethodId);
    if (selectedMethod) {
      const methodDisplay = document.getElementById("selected-payment-method");
      if (methodDisplay) {
        methodDisplay.textContent = selectedMethod.method_name;
      }
      // Guardar referencia del método para el ejemplo
      window.currentPaymentMethod = selectedMethod;
    }
  }

  bindPaymentEvents();
}

async function renderizarMetodosPago() {
  const metodos = await cargarMetodosPago();
  const contenedor = document.getElementById("metodos-pago-container");

  if (!contenedor) return;

  if (!metodos.length) {
    contenedor.innerHTML = '<div class="alerta">Sin métodos de pago disponibles</div>';
    return;
  }

  contenedor.innerHTML = metodos.map(metodo => `
    <div class="method-card" data-method="${metodo.id}" data-method-name="${metodo.method_name}" data-ejemplo="${getImagenEjemplo(metodo.method_name)}">
      <div class="method-content">
        ${metodo.image_url ? `<img src="${metodo.image_url}" alt="${metodo.method_name}" class="method-image">` : `<div class="method-icon">${getIconoMetodo(metodo.method_name)}</div>`}
        <div class="method-info">
          <strong>${metodo.method_name}</strong>
          ${metodo.account_number ? `<small>${metodo.account_number}</small>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  // Agregar event listeners para mostrar imagen de ejemplo
  document.querySelectorAll(".method-card").forEach(card => {
    card.addEventListener("click", () => {
      const ejemploSrc = card.dataset.ejemplo;
      const imgEjemplo = document.getElementById("img-ejemplo-comprobante");
      if (imgEjemplo && ejemploSrc) {
        imgEjemplo.src = ejemploSrc;
      }
    });
  });
}

function getIconoMetodo(nombre) {
  const iconos = {
    'zelle': '💳',
    'tocopay': '💰',
    'paypal': '🅿️',
    'stripe': '💸'
  };
  return iconos[nombre.toLowerCase()] || '💵';
}

function getImagenEjemplo(nombreMetodo) {
  const mapeo = {
    'zelle': './images/ejemplo-zelle.png',
    'tocopay': './images/ejemplo-tocopay.png'
  };
  return mapeo[nombreMetodo.toLowerCase()] || '';
}

function bindPaymentEvents() {
  // Modal para ver ejemplo de comprobante
  document.getElementById("btn-ver-ejemplo")?.addEventListener("click", (e) => {
    e.preventDefault();
    const modal = document.getElementById("example-proof-modal");
    if (modal) {
      modal.style.visibility = "visible";
      // Mostrar imagen de ejemplo del método seleccionado
      if (window.currentPaymentMethod) {
        const mapeoEjemplos = {
          'zelle': './images/ejemplo-zelle.png',
          'tocopay': './images/ejemplo-tocopay.png'
        };
        const key = window.currentPaymentMethod.method_name.toLowerCase();
        const ejemploSrc = mapeoEjemplos[key] || './images/ejemplo-zelle.png';
        document.getElementById("proof-example-1").src = ejemploSrc;
      }
    }
  });

  // Cerrar modal de ejemplo
  document.getElementById("close-example-modal")?.addEventListener("click", () => {
    const modal = document.getElementById("example-proof-modal");
    if (modal) modal.style.visibility = "hidden";
  });

  // Cerrar modal al hacer clic fuera
  document.getElementById("example-proof-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "example-proof-modal") {
      e.target.style.visibility = "hidden";
    }
  });

  // Botón cancelar
  document.getElementById("btn-cancelar-pago")?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!confirm("¿Estás seguro de que deseas cancelar? Se perderán los datos del pedido.")) return;

    const pending = getPendingPayment();
    if (pending?.orderId) {
      try {
        await cancelOrder(pending.orderId);
      } catch (err) {
        console.warn("[cancel] No se pudo notificar al servidor:", err.message);
      }
    }

    clearPendingPayment();
    window.location.href = "./index.html";
  });

  initDropzone();

  const form = document.getElementById("payment-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitPayment(form);
  });

  document.getElementById("success-close")?.addEventListener("click", () => {
    window.location.href = "./index.html";
  });
}

function resetPaymentForm() {
  const form = document.getElementById("payment-form");
  if (form) form.reset();

  const preview = document.getElementById("file-preview");
  if (preview) {
    preview.src = "";
    preview.style.display = "none";
  }

  const dropzone = document.getElementById("dropzone");
  if (dropzone) dropzone.classList.remove("has-file");

  const errorEl = document.getElementById("payment-error");
  if (errorEl) errorEl.style.display = "none";
}

function initDropzone() {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("payment-file");
  const preview = document.getElementById("file-preview");

  if (!dropzone || !fileInput || !preview) return;

  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });

  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) setFile(file, fileInput, preview, dropzone);
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) setFile(file, fileInput, preview, dropzone);
  });
}

function setFile(file, input, preview, dropzone) {
  if (!file.type.startsWith("image/")) {
    showPaymentError("⚠️ Solo aceptamos imágenes (JPG, PNG). Por favor sube una captura de pantalla clara del comprobante.");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showPaymentError("⚠️ La imagen es muy grande (máx 5 MB). Intenta con una captura más pequeña o comprimida.");
    return;
  }

  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;

  const reader = new FileReader();
  reader.onload = (e) => {
    preview.src = e.target.result;
    preview.style.display = "block";
    dropzone.classList.add("has-file");
  };
  reader.readAsDataURL(file);
}

async function submitPayment(form) {
  const btn = form.querySelector('button[type="submit"]');
  const method = localStorage.getItem("ren_selected_payment_method");
  const fileInput = document.getElementById("payment-file");

  hidePaymentError();

  if (!pendingOrderId || !pendingTotal) {
    showPaymentError("❌ No encontramos tu orden. Por favor vuelve a la tienda, verifica tu carrito y confirma tu pedido de nuevo.");
    return;
  }

  if (!method) {
    showPaymentError("❌ No se encontró el método de pago seleccionado. Por favor vuelve al carrito y confirma tu pedido nuevamente.");
    return;
  }

  if (!fileInput?.files?.length) {
    showPaymentError("📸 Por favor sube una captura clara del comprobante de pago donde se vea el monto, fecha y referencia.");
    return;
  }

  // Show loading state with spinner
  btn.disabled = true;
  btn.style.opacity = "0.6";
  const originalText = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span>Comprimiendo y enviando...';

  const formData = new FormData();
  formData.append("image", fileInput.files[0]);
  formData.append("order_id", pendingOrderId);
  formData.append("method", method);
  formData.append("amount", pendingTotal.toString());

  try {
    await uploadPayment(formData);
    btn.innerHTML = '<span style="color:var(--green)">✓</span> ¡Enviado exitosamente!';
    setTimeout(() => {
      showReceiptModal(form);
      clearPendingPayment();
    }, 800);
  } catch (err) {
    const message = err.message || `❌ No pudimos enviar tu comprobante. Por favor intenta de nuevo o contacta a nuestro equipo: 📱 +53 5 8324155`;
    showPaymentError(message);
    btn.disabled = false;
    btn.style.opacity = "1";
    btn.textContent = originalText;
  }
}

function showPaymentError(message) {
  const errorEl = document.getElementById("payment-error");
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.style.display = "block";
}

function hidePaymentError() {
  const errorEl = document.getElementById("payment-error");
  if (errorEl) errorEl.style.display = "none";
}

function showReceiptModal(form) {
  const modal = document.getElementById("receipt-modal");
  if (!modal) return;

  modal.style.visibility = "visible";

  const downloadBtn = document.getElementById("btn-descargar-recibo");
  const skipBtn = document.getElementById("btn-omitir-recibo");

  if (downloadBtn) {
    downloadBtn.onclick = async () => {
      await downloadReceipt();
      showSuccess();
      closeReceiptModal();
    };
  }

  if (skipBtn) {
    skipBtn.onclick = () => {
      showSuccess();
      closeReceiptModal();
    };
  }
}

function closeReceiptModal() {
  const modal = document.getElementById("receipt-modal");
  if (modal) modal.style.visibility = "hidden";
}

async function downloadReceipt() {
  try {
    await cargarLibreriasPDF();

    const checkoutFormData = JSON.parse(localStorage.getItem("ren_checkout_form_data") || "{}");
    const pendingPayment = getPendingPayment();

    const orderData = {
      id: pendingOrderId,
      total: pendingTotal,
      sender_name: checkoutFormData.sender_name || "-",
      sender_phone: checkoutFormData.sender_phone || "-",
      customer_name: checkoutFormData.sender_name || "-",
      customer_phone: checkoutFormData.sender_phone || "-",
      customer_email: checkoutFormData.customer_email || "-",
      receiver_name: checkoutFormData.receiver_name || "-",
      receiver_phone: checkoutFormData.receiver_phone || "-",
      customer_address: checkoutFormData.customer_address || "-",
      delivery_notes: checkoutFormData.delivery_notes || "",
      items: pendingPayment?.items || []
    };

    const methodId = localStorage.getItem("ren_selected_payment_method");
    const methodName = window.currentPaymentMethod?.method_name || "-";

    const preview = document.getElementById("file-preview");
    const comprobanteImage = preview?.src || null;

    const logoImg = document.querySelector(".navbar-logo img");
    let logo = null;
    if (logoImg?.src) {
      try {
        const response = await fetch(logoImg.src);
        const blob = await response.blob();
        logo = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.warn("Could not load logo:", err);
      }
    }

    await generarPDFRecibo(orderData, methodName, logo, comprobanteImage);
  } catch (err) {
    console.error("Error generating receipt:", err);
  }
}

function showSuccess() {
  const paymentContent = document.getElementById("payment-content");
  const screen = document.getElementById("success-screen");
  const orderRef = document.getElementById("success-order-ref");

  if (orderRef) orderRef.textContent = `#${pendingOrderId || "-"}`;
  if (paymentContent) paymentContent.style.display = "none";
  screen?.classList.add("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
