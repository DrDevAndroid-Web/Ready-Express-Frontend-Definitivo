import { createOrder } from "./api.js?v17";
import { getCart, getTotal, clearCart, closeCart } from "./cart.js?v17";
import { savePendingPayment } from "./payment.js?v17";
import { cargarMetodosPago } from "./payment-methods.js?v17";

let currentOrderId = null;
let currentTotal = 0;
let currentSelectedMethod = null;
let currentSelectedMethodId = null;
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
  if (step === 3 && validate && !validateCheckoutStep(2)) return false;

  checkoutStep = step;
  saveCheckoutStep(step);
  updateStepper(step);

  // Ocultar todo
  document.querySelectorAll("[data-checkout-step]").forEach(el => (el.style.display = "none"));
  const paymentStep = document.getElementById("checkout-payment-step");
  if (paymentStep) paymentStep.style.display = "none";

  if (step === 1 || step === 2) {
    const stepEl = document.querySelector(`[data-checkout-step="${step}"]`);
    if (stepEl) stepEl.style.display = "block";
  } else if (step === 3) {
    await renderPaymentMethods();
    if (paymentStep) paymentStep.style.display = "block";
  }

  // Scroll al inicio del modal body
  document.querySelector("#checkout-modal .modal-body")?.scrollTo({ top: 0, behavior: "smooth" });
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
  const savedStep = getCheckoutStep();
  goToCheckoutStep(savedStep, false);
}

// ── Inicialización ────────────────────────────────────────────
export function initCheckout() {
  const form = document.getElementById("checkout-form");
  if (form) setupBlurValidation(form);

  document.getElementById("checkout-btn")?.addEventListener("click", showCheckoutModal);
  document.getElementById("cart-checkout-btn")?.addEventListener("click", showCheckoutModal);

  document.getElementById("checkout-close")?.addEventListener("click", () => {
    closeModal("checkout-modal");
    clearCheckoutStep();
  });

  // Botón Siguiente (paso 1 → 2 y paso 2 → 3, mismo id reutilizado por paso)
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

  // Botón Atrás paso 2 → 1
  document.getElementById("checkout-back-step2-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    const f = document.getElementById("checkout-form");
    if (f) saveFormData(f);
    goToCheckoutStep(1, false);
  });

  // Botón Atrás paso 3 → 2
  document.getElementById("checkout-back-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    const f = document.getElementById("checkout-form");
    if (f) saveFormData(f);
    goToCheckoutStep(2, false);
  });

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
      if (checkoutStep === 3) await submitOrder(form);
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
    if (!metodos.length) {
      container.innerHTML = '<div class="alerta">Sin métodos de pago disponibles</div>';
      return;
    }

    container.innerHTML = metodos.map(m => `
      <div class="method-card" data-method="${m.method_name}" data-method-id="${m.id}"
           data-instructions="${escapeHtml(m.instructions || "")}"
           data-account="${escapeHtml(m.account_number || "")}">
        <div class="method-content">
          ${m.image_url
            ? `<img src="${m.image_url}" alt="${m.method_name}" class="method-image">`
            : `<div class="method-icon">${getIconoMetodo(m.method_name)}</div>`}
          <div class="method-info">
            <strong>${m.method_name}</strong>
            ${m.account_number ? `<small class="method-account">${m.account_number}</small>` : ""}
          </div>
        </div>
        <!-- Instrucciones en acordeón dentro de la tarjeta -->
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
    `).join("");

    // Restaurar selección previa si existe
    if (currentSelectedMethod) {
      const prevCard = container.querySelector(`[data-method="${currentSelectedMethod}"]`);
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

const ZELLE_AVISO = `Para que tu pago sea procesado correctamente:\n\n✅ Agrega el contacto exactamente con el nombre "Global Market Group"\n⚠️ No uses palabras como "remesa" o "dinero para Cuba" en el concepto\n⚠️ Si el nombre es diferente, la transferencia podría no acreditarse\n\nCualquier duda, escríbenos por WhatsApp antes de transferir.`;

function selectPaymentMethod(card) {
  document.querySelectorAll(".method-card").forEach(c => {
    c.classList.remove("selected");
    const instr = c.querySelector(".method-instructions");
    if (instr) instr.style.display = "none";
  });

  card.classList.add("selected");
  currentSelectedMethod = card.dataset.method;
  currentSelectedMethodId = card.dataset.methodId || null;

  const instrEl = card.querySelector(".method-instructions");
  const instrText = card.querySelector(".instructions-text");

  if (instrEl && instrText) {
    const isZelle = currentSelectedMethod.toLowerCase().includes("zelle");
    const base = card.dataset.instructions || "";
    const full = isZelle ? (base ? base + "\n\n" : "") + ZELLE_AVISO : base;
    instrText.style.whiteSpace = "pre-wrap";
    instrText.textContent = full || "";
    instrEl.style.display = full ? "block" : "none";
  }

  // Limpiar error de método
  const errorEl = document.getElementById("checkout-error");
  if (errorEl) errorEl.style.display = "none";

  storageSet("ren_selected_payment_method", currentSelectedMethod);
  if (currentSelectedMethodId) storageSet("ren_selected_payment_method_id", currentSelectedMethodId);
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = "✓ Copiado";
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 2000);
  }).catch(() => {
    // Fallback para navegadores sin clipboard API
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    btn.textContent = "✓ Copiado";
    setTimeout(() => { btn.textContent = "📋 Copiar"; }, 2000);
  });
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
    delivery_notes:   fieldValue(form, "delivery_notes"),
    items: cart.map(i => ({
      id:          i.id,
      nombre:      i.nombre,
      precio:      i.precio,
      cantidad:    i.qty,
      precio_total: i.precio * i.qty,
      category:    i.category,
    })),
    total:  getTotal(),
    status: "pending",
  };

  try {
    const order = await createOrder(orderData);
    currentOrderId = order.id;
    currentTotal   = orderData.total;

    savePendingPayment(currentOrderId, currentTotal, orderData.items);
    clearCart();
    clearCheckoutStep();
    clearFormData();

    // Feedback de éxito antes del redirect
    showSuccessOverlay();

    setTimeout(() => {
      closeModal("checkout-modal");
      form.reset();
      window.location.href = "./pago.html";
    }, 1800);

  } catch (err) {
    const errorEl = document.getElementById("checkout-error");
    if (errorEl) {
      errorEl.textContent = err.message || "❌ No pudimos crear tu pedido. Intenta de nuevo o contáctanos: +53 5 8324155";
      errorEl.style.display = "block";
    }
    btn.disabled = false;
    btn.textContent = "Confirmar pedido →";
  }
}

function showSuccessOverlay() {
  // Ocultar el paso 3 y mostrar overlay de éxito
  const paymentStep = document.getElementById("checkout-payment-step");
  if (paymentStep) paymentStep.style.display = "none";
  const overlay = document.getElementById("checkout-success-overlay");
  if (overlay) overlay.style.display = "block";
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

export function openModal(id) {
  document.getElementById(id)?.classList.add("open");
  document.getElementById("overlay")?.classList.add("show");
  document.body.style.overflow = "hidden";
}

export function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
  const anyOpen = document.querySelector(".modal.open, #cart-panel.open");
  if (!anyOpen) {
    document.getElementById("overlay")?.classList.remove("show");
    document.body.style.overflow = "";
  }
}
