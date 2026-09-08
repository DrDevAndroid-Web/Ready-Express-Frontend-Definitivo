import { API_BASE, createOrder } from "./api.js?v19";
import { getCart, getTotal, clearCart, closeCart } from "./cart.js?v19";
import { savePendingPayment } from "./payment.js?v19";
import { cargarMetodosPago, PAYMENT_FLOW_ASSISTED } from "./payment-methods.js?v19";
import { generarPDFRecibo, cargarLibreriasPDF } from "./receipt-pdf.js?v19";

const CHECKOUT_CHAT_CLIENT_KEY = "ren_checkout_chat_client";
const CHECKOUT_CHAT_SESSION_KEY = "ren_checkout_chat_session";

let currentOrderId = null;
let currentTotal = 0;
let currentSelectedMethod = null;
let currentSelectedMethodId = null;
let currentSelectedMethodFlow = "proof_upload";
let currentPaymentMethods = [];
let currentOrderReceiptData = null;
let checkoutStep = 1;

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

const CHECKOUT_STEP_KEY = "ren_checkout_step";
const CHECKOUT_FORM_KEY = "ren_checkout_form_data";

const FORM_FIELDS = [
  "sender_name",
  "sender_phone",
  "receiver_name",
  "customer_address",
  "receiver_phone",
  "delivery_notes"
];

// ── Persistencia ──────────────────────────────────────────────
function saveCheckoutStep(step) {
  storageSet(CHECKOUT_STEP_KEY, String(step));
}

function saveFormData(form) {
  const data = {};
  FORM_FIELDS.forEach(fieldName => {
    const field = form.elements[fieldName];
    if (field) data[fieldName] = field.value;
  });
  storageSet(CHECKOUT_FORM_KEY, JSON.stringify(data));
}

function restoreFormData(form) {
  const saved = storageGet(CHECKOUT_FORM_KEY);
  if (!saved) return;
  try {
    const data = JSON.parse(saved);
    FORM_FIELDS.forEach(fieldName => {
      const field = form.elements[fieldName];
      if (field && data[fieldName] !== undefined) field.value = data[fieldName];
    });
  } catch (err) {
    console.error("[checkout:restoreFormData]", err);
  }
}

function clearFormData() {
  storageRemove(CHECKOUT_FORM_KEY);
}

export function getCheckoutStep() {
  const saved = storageGet(CHECKOUT_STEP_KEY);
  return saved ? Math.min(parseInt(saved), 3) : 1;
}

export function hasSavedCheckoutStep() {
  return storageGet(CHECKOUT_STEP_KEY) !== null;
}

function clearCheckoutStep() {
  storageRemove(CHECKOUT_STEP_KEY);
}

function clearSelectedPaymentState() {
  storageRemove("ren_selected_payment_method");
  storageRemove("ren_selected_payment_method_id");
  storageRemove("ren_selected_payment_flow");
}

function clearCheckoutPersistence({ keepSelectedPayment = false } = {}) {
  clearCheckoutStep();
  clearFormData();
  if (!keepSelectedPayment) clearSelectedPaymentState();
}

export function openCheckoutAtSavedStep() {
  if (hasSavedCheckoutStep()) showCheckoutModal();
}

// ── Mini-resumen sticky ───────────────────────────────────────
function renderMiniSummary() {
  const cart = getCart();
  const el = document.getElementById("checkout-mini-summary");
  if (!el) return;
  const total = getTotal();
  const count = cart.reduce((s, i) => s + i.qty, 0);
  el.innerHTML = `
    <span class="mini-summary-items">${count} producto${count !== 1 ? "s" : ""}</span>
    <span class="mini-summary-total">Total: <strong>$${total.toFixed(2)}</strong></span>
  `;
}

// ── Stepper ───────────────────────────────────────────────────
function updateStepper(step) {
  document.querySelectorAll(".checkout-stepper-item").forEach(item => {
    const s = parseInt(item.dataset.step);
    item.classList.toggle("active", s === step);
    item.classList.toggle("done", s < step);
  });
}

// ── Validación por campo (onBlur) ─────────────────────────────
function showFieldError(fieldName, message) {
  const el = document.getElementById(`error-${fieldName}`);
  if (!el) return;
  el.textContent = message;
  el.style.display = message ? "block" : "none";
  const input = document.getElementById(fieldName);
  if (input) input.classList.toggle("input-error", !!message);
}

function validateField(field) {
  if (!field.validity.valid) {
    showFieldError(field.name, field.validationMessage);
    return false;
  }
  showFieldError(field.name, "");
  return true;
}

function setupBlurValidation(form) {
  FORM_FIELDS.forEach(fieldName => {
    const field = form.elements[fieldName];
    if (!field) return;
    field.addEventListener("blur", () => {
      if (field.required || field.value.trim()) validateField(field);
    });
    field.addEventListener("input", () => {
      if (field.classList.contains("input-error")) validateField(field);
    });
  });
}

// ── Validación por paso ───────────────────────────────────────
function validateCheckoutStep(step) {
  const stepEl = document.querySelector(`[data-checkout-step="${step}"]`);
  if (!stepEl) return true;

  let valid = true;
  stepEl.querySelectorAll("input[required], textarea[required]").forEach(field => {
    if (!field.checkValidity()) {
      showFieldError(field.name, field.validationMessage);
      valid = false;
    }
  });
  return valid;
}

// ── Navegación entre pasos ────────────────────────────────────
async function goToCheckoutStep(step, validate = true) {
  const form = document.getElementById("checkout-form");
  if (!form) return false;

  if (step === 2 && validate && !validateCheckoutStep(1)) return false;

  checkoutStep = step;
  saveCheckoutStep(step);
  updateStepper(step);

  // Ocultar todo
  document.querySelectorAll("[data-checkout-step]").forEach(el => (el.style.display = "none"));
  const paymentStep = document.getElementById("checkout-payment-step");
  if (paymentStep) paymentStep.style.display = "none";
  const confirmationStep = document.getElementById("checkout-success-overlay");
  if (confirmationStep) confirmationStep.style.display = "none";

  if (step === 1) {
    const stepEl = document.querySelector(`[data-checkout-step="${step}"]`);
    if (stepEl) stepEl.style.display = "block";
  } else if (step === 2) {
    await renderPaymentMethods();
    renderCheckoutReview();
    if (paymentStep) paymentStep.style.display = "block";
  } else if (step === 3) {
    if (confirmationStep) confirmationStep.style.display = "block";
  }

  // Scroll al inicio del modal body (fallback para iOS Safari que no soporta smooth)
  const modalBody = document.querySelector("#checkout-modal .modal-body");
  if (modalBody) {
    try { modalBody.scrollTo({ top: 0, behavior: "smooth" }); }
    catch { modalBody.scrollTop = 0; }
  }
  return true;
}

// ── Abrir modal ───────────────────────────────────────────────
export function showCheckoutModal() {
  const cart = getCart();
  if (cart.length === 0) return;

  closeCart();
  renderMiniSummary();

  const form = document.getElementById("checkout-form");
  if (form) restoreFormData(form);

  currentTotal = getTotal();
  openModal("checkout-modal");
  let savedStep = getCheckoutStep();
  if (savedStep === 3 && !currentOrderReceiptData) {
    clearCheckoutPersistence();
    currentSelectedMethod = null;
    currentSelectedMethodId = null;
    currentSelectedMethodFlow = "proof_upload";
    savedStep = 1;
  }
  goToCheckoutStep(savedStep, false);
}

// ── Inicialización ────────────────────────────────────────────
export function initCheckout() {
  const form = document.getElementById("checkout-form");
  if (form) setupBlurValidation(form);

  document.getElementById("checkout-btn")?.addEventListener("click", showCheckoutModal);
  document.getElementById("cart-checkout-btn")?.addEventListener("click", showCheckoutModal);

  document.getElementById("checkout-close")?.addEventListener("click", () => {
    if (checkoutStep === 3) {
      clearCheckoutPersistence();
    } else {
      clearCheckoutStep();
    }
    closeModal("checkout-modal");
  });

  // Botón Siguiente (datos de envío → pago)
  document.addEventListener("click", async (e) => {
    if (e.target.id !== "checkout-next-btn") return;
    e.preventDefault();
    const nextStep = checkoutStep + 1;
    if (!validateCheckoutStep(checkoutStep)) return;

    const btn = e.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const f = document.getElementById("checkout-form");
    if (f) saveFormData(f);

    await goToCheckoutStep(nextStep);

    btn.disabled = false;
    btn.textContent = originalText;
  });

  // Botón Atrás pago → datos de envío
  document.getElementById("checkout-back-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    const f = document.getElementById("checkout-form");
    if (f) saveFormData(f);
    goToCheckoutStep(1, false);
  });

  setupCheckoutAssistant();
  setupConfirmationActions();

  if (form) {
    FORM_FIELDS.forEach(fieldName => {
      const field = form.elements[fieldName];
      if (field) {
        field.addEventListener("change", () => saveFormData(form));
        field.addEventListener("blur", () => saveFormData(form));
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (checkoutStep === 2) await submitOrder(form);
    });
  }
}

// ── Métodos de pago ───────────────────────────────────────────
async function renderPaymentMethods() {
  const container = document.getElementById("checkout-methods-container");
  if (!container) return;

  container.innerHTML = '<div style="text-align:center;padding:20px"><span class="spinner"></span></div>';

  try {
    const metodos = await cargarMetodosPago();
    currentPaymentMethods = metodos;
    if (!metodos.length) {
      container.innerHTML = '<div class="alerta">Sin métodos de pago disponibles</div>';
      return;
    }

    const directMethods = metodos.filter(m => (m.payment_flow || "proof_upload") !== PAYMENT_FLOW_ASSISTED);
    const assistedMethods = metodos.filter(m => (m.payment_flow || "proof_upload") === PAYMENT_FLOW_ASSISTED);
    container.innerHTML = `
      ${renderPaymentGroup(
        "Pago ahora y subo comprobante",
        "Crea tu pedido y luego adjunta la captura del pago.",
        directMethods
      )}
      ${renderPaymentGroup(
        "Necesito ayuda para pagar",
        "Creamos tu pedido y el equipo te escribe por WhatsApp.",
        assistedMethods
      )}
    `;

    // Restaurar selección previa si existe
    if (currentSelectedMethod) {
      const prevCard = container.querySelector(`[data-method="${cssEscape(currentSelectedMethod)}"]`);
      if (prevCard) selectPaymentMethod(prevCard);
    }

    container.querySelectorAll(".method-card").forEach(card => {
      card.addEventListener("click", () => selectPaymentMethod(card));
    });

    container.querySelectorAll(".btn-copy-account").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        copyToClipboard(btn.dataset.account, btn);
      });
    });

  } catch (err) {
    console.error("[checkout] Error cargando métodos:", err);
    container.innerHTML = '<div class="alerta">Error cargando métodos de pago</div>';
  }
}

function renderPaymentGroup(title, description, methods) {
  if (!methods.length) return "";
  return `
    <section class="checkout-payment-group">
      <div class="checkout-payment-group-heading">
        <h5>${title}</h5>
        <p>${description}</p>
      </div>
      <div class="checkout-method-list">
        ${methods.map(m => `
      <div class="method-card" data-method="${m.method_name}" data-method-id="${m.id}"
           data-payment-flow="${m.payment_flow || "proof_upload"}"
           data-instructions="${escapeHtml(m.instructions || "")}"
           data-account="${escapeHtml(m.account_number || "")}">
        <div class="method-content">
          ${m.image_url
            ? `<img src="${m.image_url}" alt="${m.method_name}" class="method-image">`
            : `<div class="method-icon">${getIconoMetodo(m.method_name)}</div>`}
          <div class="method-info">
            <strong>${m.method_name}</strong>
            ${m.account_number ? `<small class="method-account">${m.account_number}</small>` : ""}
            ${m.payment_flow === PAYMENT_FLOW_ASSISTED ? `<small class="method-account">Contacto por WhatsApp</small>` : ""}
          </div>
        </div>
        <div class="method-instructions" style="display:none">
          ${m.account_number ? `
            <div class="method-account-copy">
              <span class="account-number-text">${m.account_number}</span>
              <button type="button" class="btn-copy-account" data-account="${escapeHtml(m.account_number)}" aria-label="Copiar número">
                📋 Copiar
              </button>
            </div>` : ""}
          <div class="instructions-text"></div>
        </div>
      </div>
        `).join("")}
      </div>
    </section>
  `;
}

const ZELLE_AVISO = `Para que tu pago sea procesado correctamente:\n\n✅ Agrega el contacto exactamente con el nombre "Global Market Group"\n⚠️ No uses palabras como "remesa" o "dinero para Cuba" en el concepto\n⚠️ Si el nombre es diferente, la transferencia podría no acreditarse\n\nCualquier duda, escríbenos por WhatsApp antes de transferir.`;

function buildTocopayNotice(account) {
  const accountLine = account
    ? `Usa esta cuenta/tarjeta: ${account}`
    : "Usa la cuenta/tarjeta que aparece en este metodo de pago.";

  return `Para pagar por Tocopay:\n\n1. Entra a tocopay.com e inicia sesion o crea tu cuenta.\n2. Anade como beneficiario a Ernesto, gerente de ventas.\n3. ${accountLine}\n4. Completa el pago en Tocopay y toma una captura clara del comprobante.\n5. Vuelve a Ready Express Now y sube esa captura para validar tu pedido.\n\nTocopay es una plataforma externa e independiente. Ready Express Now no esta afiliada ni asociada a Tocopay; solo usamos tu comprobante para validar el pago de tu pedido.`;
}

function selectPaymentMethod(card) {
  document.querySelectorAll(".method-card").forEach(c => {
    c.classList.remove("selected");
    const instr = c.querySelector(".method-instructions");
    if (instr) instr.style.display = "none";
  });

  card.classList.add("selected");
  currentSelectedMethod = card.dataset.method;
  currentSelectedMethodId = card.dataset.methodId || null;
  currentSelectedMethodFlow = card.dataset.paymentFlow || "proof_upload";

  const instrEl = card.querySelector(".method-instructions");
  const instrText = card.querySelector(".instructions-text");

  if (instrEl && instrText) {
    const methodName = currentSelectedMethod.toLowerCase();
    const isZelle = methodName.includes("zelle");
    const isTocopay = methodName.includes("tocopay");
    const base = card.dataset.instructions || "";
    const full = isZelle
      ? (base ? base + "\n\n" : "") + ZELLE_AVISO
      : isTocopay
        ? buildTocopayNotice(card.dataset.account)
        : base;
    instrText.style.whiteSpace = "pre-wrap";
    instrText.textContent = full || "";
    instrEl.style.display = full ? "block" : "none";
  }

  // Limpiar error de método
  const errorEl = document.getElementById("checkout-error");
  if (errorEl) errorEl.style.display = "none";

  storageSet("ren_selected_payment_method", currentSelectedMethod);
  if (currentSelectedMethodId) storageSet("ren_selected_payment_method_id", currentSelectedMethodId);
  storageSet("ren_selected_payment_flow", currentSelectedMethodFlow);
  updateSubmitButton();
  renderCheckoutReview();
}

function copyToClipboard(text, btn) {
  const markCopied = () => {
    const original = btn.textContent;
    btn.textContent = "✓ Copiado";
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 2000);
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(markCopied).catch(() => iosFallbackCopy(text, btn, markCopied));
  } else {
    iosFallbackCopy(text, btn, markCopied);
  }
}

function iosFallbackCopy(text, btn, onSuccess) {
  // En iOS Safari, seleccionar un input es necesario para que el copy funcione
  const input = document.createElement("input");
  input.setAttribute("readonly", "");
  input.value = text;
  input.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
  document.body.appendChild(input);
  input.focus();
  input.setSelectionRange(0, text.length);
  const ok = document.execCommand("copy");
  document.body.removeChild(input);
  if (ok) { onSuccess(); }
  else { btn.textContent = "Copia: " + text; }
}

// ── Envío del pedido ──────────────────────────────────────────
async function submitOrder(form) {
  const btn = form.querySelector('button[type="submit"]');
  const cart = getCart();

  if (!currentSelectedMethod) {
    const errorEl = document.getElementById("checkout-error");
    if (errorEl) {
      errorEl.textContent = "Por favor selecciona un método de pago";
      errorEl.style.display = "block";
    }
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creando pedido...';

  const senderName  = fieldValue(form, "sender_name");
  const senderPhone = fieldValue(form, "sender_phone");

  const orderData = {
    customer_name:    senderName,
    customer_phone:   senderPhone,
    customer_address: fieldValue(form, "customer_address"),
    customer_email:   fieldValue(form, "customer_email"),
    sender_name:      senderName,
    sender_phone:     senderPhone,
    receiver_name:    fieldValue(form, "receiver_name"),
    receiver_phone:   fieldValue(form, "receiver_phone"),
    delivery_notes:   buildDeliveryNotes(fieldValue(form, "delivery_notes")),
    items: cart.map(i => ({
      id:          i.id,
      nombre:      i.nombre,
      precio:      i.precio,
      cantidad:    i.qty,
      precio_total: i.precio * i.qty,
      category:    i.category,
    })),
    total:  getTotal(),
    status: currentSelectedMethodFlow === PAYMENT_FLOW_ASSISTED ? "awaiting_manual_payment" : "pending",
  };

  try {
    const order = await createOrder(orderData);
    currentOrderId = order.id;
    currentTotal   = orderData.total;
    currentOrderReceiptData = {
      ...orderData,
      id: order.id,
      created_at: order.created_at || new Date().toISOString()
    };

    if (currentSelectedMethodFlow !== PAYMENT_FLOW_ASSISTED) {
      savePendingPayment(currentOrderId, currentTotal, orderData.items);
    }
    clearCart();
    clearCheckoutStep();

    showSuccessOverlay(currentSelectedMethodFlow === PAYMENT_FLOW_ASSISTED, order);

  } catch (err) {
    const errorEl = document.getElementById("checkout-error");
    if (errorEl) {
      errorEl.textContent = err.message || "❌ No pudimos crear tu pedido. Intenta de nuevo o contáctanos: +53 56189395";
      errorEl.style.display = "block";
    }
    btn.disabled = false;
    btn.textContent = "Confirmar pedido →";
  }
}

function buildDeliveryNotes(notes) {
  const paymentLine = `Metodo de pago seleccionado: ${currentSelectedMethod || "No especificado"}.`;
    if (currentSelectedMethodFlow === PAYMENT_FLOW_ASSISTED) {
      const assistedLine = "Pago asistido: contactar al cliente por WhatsApp para enviar datos de transferencia y validar comprobante manualmente.";
      return [notes, paymentLine, assistedLine].filter(Boolean).join("\n\n");
    }
  return [notes, paymentLine].filter(Boolean).join("\n\n");
}

function showSuccessOverlay(isAssisted = false) {
  checkoutStep = 3;
  saveCheckoutStep(3);
  updateStepper(3);
  document.querySelectorAll("[data-checkout-step]").forEach(el => (el.style.display = "none"));
  const paymentStep = document.getElementById("checkout-payment-step");
  if (paymentStep) paymentStep.style.display = "none";
  const overlay = document.getElementById("checkout-success-overlay");
  if (overlay) {
    const text = document.getElementById("checkout-confirmation-text");
    const total = document.getElementById("checkout-confirm-total");
    const method = document.getElementById("checkout-confirm-method");
    const next = document.getElementById("checkout-confirm-next");
    const primary = document.getElementById("checkout-confirm-primary");
    if (text) text.textContent = `Tu pedido #${currentOrderId} está listo.`;
    if (total) total.textContent = `$${Number(currentTotal || 0).toFixed(2)}`;
    if (method) method.textContent = currentSelectedMethod || "-";
    if (next) {
      next.textContent = isAssisted
        ? "Nuestro equipo se pondrá en contacto con usted a la brevedad. Para cualquier duda, puede contactarnos al +53 56189395."
        : "Subir comprobante";
    }
    if (primary) primary.textContent = isAssisted ? "Volver a la tienda" : "Continuar a subir comprobante";
    overlay.style.display = "block";
  }
}

// ── Helpers ───────────────────────────────────────────────────
function getIconoMetodo(nombre) {
  const iconos = { zelle: "💳", tocopay: "💰", paypal: "🅿️", stripe: "💸" };
  return iconos[nombre.toLowerCase()] || "💵";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function fieldValue(form, name) {
  return form.elements[name]?.value?.trim() || "";
}

function updateSubmitButton() {
  const btn = document.getElementById("checkout-submit-btn");
  if (!btn) return;
  if (!currentSelectedMethod) {
    btn.textContent = "Selecciona un método";
    return;
  }
  btn.textContent = currentSelectedMethodFlow === PAYMENT_FLOW_ASSISTED
    ? "Crear pedido y recibir ayuda"
    : "Crear pedido y subir comprobante";
}

function renderCheckoutReview() {
  const el = document.getElementById("checkout-review-card");
  const form = document.getElementById("checkout-form");
  if (!el || !form) return;
  const count = getCart().reduce((s, i) => s + i.qty, 0);
  const receiver = fieldValue(form, "receiver_name") || "Por completar";
  const address = fieldValue(form, "customer_address") || "Por completar";
  el.innerHTML = `
    <div class="checkout-review-row"><span>Total</span><strong>$${getTotal().toFixed(2)}</strong></div>
    <div class="checkout-review-row"><span>Productos</span><strong>${count}</strong></div>
    <div class="checkout-review-row"><span>Recibe</span><strong>${escapeHtml(receiver)}</strong></div>
    <div class="checkout-review-row"><span>Dirección</span><strong>${escapeHtml(address)}</strong></div>
    <div class="checkout-review-row"><span>Método</span><strong>${escapeHtml(currentSelectedMethod || "Selecciona uno")}</strong></div>
  `;
}

function setupConfirmationActions() {
  document.getElementById("checkout-confirm-primary")?.addEventListener("click", () => {
    const form = document.getElementById("checkout-form");
    closeModal("checkout-modal");
    form?.reset();
    if (currentSelectedMethodFlow === PAYMENT_FLOW_ASSISTED) {
      clearCheckoutPersistence();
      window.location.href = "./index.html";
    } else {
      clearCheckoutPersistence({ keepSelectedPayment: true });
      window.location.href = "./pago.html";
    }
  });

  document.getElementById("checkout-confirm-download")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await downloadCheckoutReceipt(e.currentTarget);
  });
}

async function downloadCheckoutReceipt(btn) {
  if (!currentOrderReceiptData) return;
  const originalText = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Generando comprobante...";
  }

  try {
    await cargarLibreriasPDF();
    const logo = await loadCheckoutLogo();
    await generarPDFRecibo(currentOrderReceiptData, currentSelectedMethod || "-", logo, null);
    clearCheckoutPersistence();
  } catch (err) {
    console.error("[checkout:receipt]", err);
    alert("No pudimos generar el comprobante ahora. Tu pedido ya fue creado correctamente.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText || "Descargar comprobante de compra";
    }
  }
}

async function loadCheckoutLogo() {
  const logoImg = document.querySelector(".navbar-logo img");
  if (!logoImg?.src) return null;
  try {
    const response = await fetch(logoImg.src);
    const blob = await response.blob();
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function setupCheckoutAssistant() {
  const form = document.getElementById("checkout-ai-form");
  const input = document.getElementById("checkout-ai-input");
  const chips = document.getElementById("checkout-ai-chips");

  chips?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-question]");
    if (!btn) return;
    await askCheckoutAssistant(btn.dataset.question);
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = input?.value?.trim();
    if (!question) return;
    input.value = "";
    await askCheckoutAssistant(question);
  });
}

async function askCheckoutAssistant(question) {
  const responseEl = document.getElementById("checkout-ai-response");
  if (!responseEl) return;
  responseEl.style.display = "block";
  responseEl.textContent = "Consultando...";

  try {
    const sessionId = await getCheckoutChatSession();
    const res = await fetch(`${API_BASE}/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        message: question,
        context: buildCheckoutAIContext()
      })
    });
    if (!res.ok) throw new Error("No se pudo consultar al asistente");
    const data = await res.json();
    responseEl.textContent = data.assistantMessage?.content || data.reply || "No pude responder ahora. Intenta otra vez.";
  } catch (err) {
    responseEl.textContent = "No pude conectar con el asistente. Si tienes dudas, escríbenos por WhatsApp.";
  }
}

async function getCheckoutChatSession() {
  const saved = storageGet(CHECKOUT_CHAT_SESSION_KEY);
  if (saved) return saved;

  const res = await fetch(`${API_BASE}/chat/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: storageGet(CHECKOUT_CHAT_CLIENT_KEY),
      sessionId: saved,
      surface: "checkout"
    })
  });
  if (!res.ok) throw new Error("No se pudo iniciar chat");
  const data = await res.json();
  if (data.clientId) storageSet(CHECKOUT_CHAT_CLIENT_KEY, data.clientId);
  if (data.sessionId) storageSet(CHECKOUT_CHAT_SESSION_KEY, data.sessionId);
  return data.sessionId;
}

function buildCheckoutAIContext() {
  return {
    surface: "checkout",
    step: checkoutStep === 2 ? "payment" : "delivery_data",
    cartTotal: Number(getTotal().toFixed(2)),
    selectedPaymentMethod: currentSelectedMethod,
    selectedPaymentFlow: currentSelectedMethodFlow,
    availablePaymentMethods: currentPaymentMethods.map(m => ({
      id: m.id,
      name: m.method_name,
      flow: m.payment_flow || "proof_upload"
    }))
  };
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

export function openModal(id) {
  document.getElementById(id)?.classList.add("open");
  document.getElementById("overlay")?.classList.add("show");
  // En iOS, overflow:hidden en body no bloquea el scroll de elementos fixed.
  // Usamos una clase CSS con touch-action y position en su lugar.
  document.body.classList.add("modal-open");
}

export function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
  const anyOpen = document.querySelector(".modal.open, #cart-panel.open");
  if (!anyOpen) {
    document.getElementById("overlay")?.classList.remove("show");
    document.body.classList.remove("modal-open");
  }
}
