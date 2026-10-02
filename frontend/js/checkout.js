import { API_BASE, createOrder, createTropipayPayment, getLocalizaciones } from "./api.js?v35";
import { getCart, getTotal, clearCart, closeCart } from "./cart.js?v35";
import { savePendingPayment } from "./payment.js?v35";
import { cargarMetodosPago, CARD_METHOD_LABEL, getTropipayMinAmount, PAYMENT_FLOW_ASSISTED, PAYMENT_FLOW_TROPIPAY } from "./payment-methods.js?v35";
import { generarPDFRecibo, cargarLibreriasPDF } from "./receipt-pdf.js?v35";
import { getAccessToken, getCurrentUser, getMyProfile, updateMyProfile } from "./auth.js?v35";
import { billingComplete, billingSummary, maxBirthDate } from "./billing-fields.js?v35";
import { setupCountrySelect } from "./country-select.js?v35";
import { bindMethodLogoFallback, methodLogoHtml, svgIcon } from "./method-icons.js?v35";

const CHECKOUT_CHAT_CLIENT_KEY = "ren_checkout_chat_client";
const CHECKOUT_CHAT_SESSION_KEY = "ren_checkout_chat_session";

let currentOrderId = null;
let currentTotal = 0;
let currentSelectedMethod = storageGet("ren_selected_payment_method") || null;
let currentSelectedMethodId = storageGet("ren_selected_payment_method_id") || null;
let currentSelectedMethodFlow = storageGet("ren_selected_payment_flow") || "proof_upload";
let currentPaymentMethods = [];
let currentOrderReceiptData = null;
let checkoutStep = 1;
let deliveryLocations = [];
let deliveryLocationsLoaded = false;
let locationEvents = null;
const DELIVERY_LOCATIONS_CACHE_KEY = "ren_delivery_locations";

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

function getDeliverySubtotal() {
  return getTotal();
}

function getSelectedLocation(form) {
  const id = fieldValue(form, "delivery_location_id");
  return deliveryLocations.find(location => String(location.id) === String(id)) || null;
}

function displayMunicipalityName(name) {
  return String(name || "Municipio").replace(/^El Savador$/i, "El Salvador");
}

function calculateCheckoutTotal(form) {
  return getDeliverySubtotal() + Number(getSelectedLocation(form)?.recargo || 0);
}

function renderDeliveryLocations(form, selectedId = "") {
  const select = form?.elements?.delivery_municipality;
  const hidden = form?.elements?.delivery_location_id;
  if (!select || !hidden) return;
  const previous = selectedId || hidden.value || storageGet("ren_delivery_location_id") || "";
  select.innerHTML = '<option value="">Selecciona un municipio</option>' + deliveryLocations.map(location =>
    `<option value="${escapeHtml(String(location.id))}">${escapeHtml(displayMunicipalityName(location.municipio))}</option>`
  ).join("");
  const selected = deliveryLocations.find(location => String(location.id) === String(previous))
    || deliveryLocations.find(location => location.es_base)
    || deliveryLocations[0];
  if (selected) {
    select.value = selected.id;
    hidden.value = selected.id;
    storageSet("ren_delivery_location_id", String(selected.id));
  }
  updateDeliveryPricing(form);
}

function updateDeliveryPricing(form) {
  const selected = getSelectedLocation(form);
  const surcharge = Number(selected?.recargo || 0);
  const note = document.getElementById("delivery-surcharge-note");
  const amount = document.getElementById("delivery-surcharge-amount");
  const card = document.getElementById("delivery-pricing-card");
  if (amount) amount.textContent = surcharge > 0 ? `+$${surcharge.toFixed(2)}` : "$0.00";
  if (note) note.textContent = selected
    ? (surcharge > 0
      ? `${displayMunicipalityName(selected.municipio)}: este importe se suma al subtotal de tus productos.`
      : `${displayMunicipalityName(selected.municipio)}: entrega dentro de la ciudad sin recargo adicional.`)
    : "Selecciona un municipio para ver el importe.";
  card?.classList.toggle("has-surcharge", surcharge > 0);
  currentTotal = calculateCheckoutTotal(form);
  renderMiniSummary();
  renderCheckoutReview();
}

async function loadDeliveryLocations(form, force = false) {
  if (deliveryLocationsLoaded && !force) return;
  if (!force) {
    try {
      const cached = JSON.parse(storageGet(DELIVERY_LOCATIONS_CACHE_KEY) || "null");
      if (Array.isArray(cached?.items) && cached.items.length) {
        deliveryLocations = cached.items;
        renderDeliveryLocations(form);
      }
    } catch {}
  }
  try {
    const data = await getLocalizaciones();
    deliveryLocations = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    deliveryLocationsLoaded = true;
    document.getElementById("retry-delivery-locations")?.setAttribute("hidden", "");
    storageSet(DELIVERY_LOCATIONS_CACHE_KEY, JSON.stringify({ items: deliveryLocations, updatedAt: new Date().toISOString() }));
    renderDeliveryLocations(form);
  } catch (error) {
    console.warn("[checkout:localizaciones]", error);
    if (!deliveryLocations.length && form?.elements?.delivery_municipality) {
      form.elements.delivery_municipality.innerHTML = '<option value="">No se pudieron cargar los municipios</option>';
      document.getElementById("retry-delivery-locations")?.removeAttribute("hidden");
    }
  }
}

function subscribeToLocationEvents() {
  if (locationEvents || typeof EventSource === "undefined") return;
  locationEvents = new EventSource(`${API_BASE}/localizaciones/events`);
  locationEvents.onmessage = event => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "localizaciones_updated") {
        deliveryLocationsLoaded = false;
        loadDeliveryLocations(document.getElementById("checkout-form"), true);
      }
    } catch {}
  };
  locationEvents.onerror = () => {
    try { locationEvents.close(); } catch {}
    locationEvents = null;
  };
}

const CHECKOUT_STEP_KEY = "ren_checkout_step";
const CHECKOUT_FORM_KEY = "ren_checkout_form_data";

const FORM_FIELDS = [
  "sender_first_name",
  "sender_last_name",
  "sender_phone",
  "customer_email",
  "payer_country_iso",
  "payer_address",
  "payer_city",
  "payer_state",
  "payer_postcode",
  "receiver_name",
  "customer_address",
  "receiver_phone",
  "delivery_notes",
  "delivery_location_id",
  "delivery_municipality"
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
  // Nombre completo para pago.html y el PDF del comprobante, que siguen leyendo sender_name
  data.sender_name = [data.sender_first_name, data.sender_last_name].map(v => (v || "").trim()).filter(Boolean).join(" ");
  storageSet(CHECKOUT_FORM_KEY, JSON.stringify(data));
}

function restoreFormData(form) {
  const saved = storageGet(CHECKOUT_FORM_KEY);
  if (!saved) return;
  try {
    const data = JSON.parse(saved);
    // Datos guardados antes de separar nombre y apellidos
    if (data.sender_name && !data.sender_first_name) {
      const [first, ...rest] = String(data.sender_name).trim().split(/\s+/);
      data.sender_first_name = first || "";
      data.sender_last_name = rest.join(" ");
    }
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
  if (!hasSavedCheckoutStep()) return;
  if (document.body?.dataset.checkoutPage !== "true") {
    window.location.href = "./checkout.html";
    return;
  }
  showCheckoutModal();
}

// ── Mini-resumen sticky ───────────────────────────────────────
function renderMiniSummary() {
  const cart = getCart();
  const el = document.getElementById("checkout-mini-summary");
  if (!el) return;
  const total = currentTotal || getTotal();
  const count = cart.reduce((s, i) => s + i.qty, 0);
  el.innerHTML = `
    <span class="mini-summary-items">${count} producto${count !== 1 ? "s" : ""}</span>
    <span class="mini-summary-total">Total USD: <strong>$${total.toFixed(2)}</strong></span>
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
  Array.from(form.elements).forEach(field => {
    if (!field.name || field.type === "hidden" || field.type === "submit" || field.type === "button") return;
    const event = field.type === "checkbox" ? "change" : "blur";
    field.addEventListener(event, () => {
      if (field.required || field.value.trim()) validateField(field);
    });
    field.addEventListener("input", () => {
      if (field.classList.contains("input-error")) validateField(field);
    });
  });
}

// ── Validación por paso ───────────────────────────────────────
// Paso de pago: remitente siempre; datos del pagador solo si el bloque TropiPay está activo
// (un <fieldset disabled> queda fuera de la validación nativa).
function validatePaymentStep() {
  const stepEl = document.getElementById("checkout-payment-step");
  if (!stepEl) return true;
  countrySelect?.syncValidity();
  let firstInvalid = null;
  stepEl.querySelectorAll("input[required], textarea[required], select[required]").forEach(field => {
    if (field.disabled) return;
    if (!field.checkValidity()) {
      showFieldError(field.name, field.type === "checkbox" ? "Debes aceptar los términos de la pasarela de pago para pagar con tarjeta" : field.validationMessage);
      firstInvalid ||= field;
    }
  });
  if (firstInvalid) {
    firstInvalid.focus();
    firstInvalid.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }
  return !firstInvalid;
}

let countrySelect = null;
let profilePrefillDone = false;
let customerProfile = null;

// Rellena solo campos vacíos con el perfil del cliente con sesión iniciada. Si el perfil
// ya tiene los datos de facturación (se piden en el registro), el bloque de TropiPay
// se reduce a un resumen: el cliente no vuelve a escribirlos.
async function prefillSenderFromProfile(form) {
  if (profilePrefillDone || !getAccessToken() || !form) return;
  profilePrefillDone = true;
  // Puede llegar al entrar en el paso 2, antes de elegir TropiPay: el selector de país debe existir ya
  setupTropipayPayerFields(form);
  try {
    const profile = await getMyProfile();
    customerProfile = profile;
    const email = profile?.email || getCurrentUser()?.email || "";
    const values = {
      sender_first_name: profile?.nombre,
      sender_last_name: profile?.apellidos,
      sender_phone: profile?.telefono,
      customer_email: email,
      payer_address: profile?.direccion_facturacion,
      payer_city: profile?.ciudad,
      payer_state: profile?.estado_region,
      payer_postcode: profile?.codigo_postal,
      payer_birth_date: profile?.fecha_nacimiento
    };
    Object.entries(values).forEach(([name, value]) => {
      const field = form.elements[name];
      if (field && !field.value.trim() && value) field.value = value;
    });
    if (profile?.pais_iso && !form.elements.payer_country_iso?.value) countrySelect?.select(profile.pais_iso, { silent: true });
    if (billingComplete(profile)) {
      // Lo enviado debe ser lo que dice el resumen, aunque hubiera datos de un intento anterior
      for (const name of ["payer_address", "payer_city", "payer_state", "payer_postcode", "payer_birth_date"]) form.elements[name].value = values[name] || "";
      countrySelect?.select(profile.pais_iso, { silent: true });
      form.elements.payer_terms.checked = true;
      showPayerSummary(profile);
    }
    saveFormData(form);
  } catch (err) {
    console.warn("[checkout:perfil]", err.message);
  }
}

function showPayerSummary(profile) {
  const summary = document.getElementById("tropipay-payer-summary");
  const inputs = document.getElementById("tropipay-payer-inputs");
  if (!summary || !inputs) return;
  document.getElementById("tropipay-payer-summary-text").textContent = billingSummary(profile);
  summary.hidden = false;
  inputs.hidden = true;
  const edit = document.getElementById("tropipay-payer-edit");
  edit.setAttribute("aria-expanded", "false");
  edit.onclick = () => {
    summary.hidden = true;
    inputs.hidden = false;
    edit.setAttribute("aria-expanded", "true");
    document.getElementById("payer_address")?.focus();
  };
}

// Cuentas antiguas sin datos de facturación: se guardan en el perfil para el próximo pago
function saveBillingToProfile(payer) {
  if (!customerProfile || billingComplete(customerProfile)) return Promise.resolve();
  return updateMyProfile({
    pais_iso: payer.country_iso,
    direccion_facturacion: payer.address,
    ciudad: payer.city,
    estado_region: payer.state,
    codigo_postal: payer.post_code,
    fecha_nacimiento: payer.birth_date,
    acepta_terminos_tropipay: payer.terms_accepted
  }).catch(err => console.warn("[checkout:facturacion]", err.message));
}

function setupTropipayPayerFields(form) {
  if (countrySelect || !form) return;
  document.getElementById("payer_birth_date")?.setAttribute("max", maxBirthDate());
  countrySelect = setupCountrySelect({
    input: document.getElementById("payer_country"),
    hidden: document.getElementById("payer_country_iso"),
    listbox: document.getElementById("payer_country-listbox"),
    toggle: document.getElementById("payer_country-toggle"),
    onChange: () => {
      showFieldError("payer_country", "");
      saveFormData(form);
    }
  });
}

// DNS + TLS hacia la pasarela por adelantado: la redirección llega antes
let tropipayPreconnected = false;
function preconnectTropipay() {
  if (tropipayPreconnected) return;
  tropipayPreconnected = true;
  ["https://tppay.me", "https://www.tropipay.com", "https://sandbox.tropipay.me"].forEach(href => {
    const link = Object.assign(document.createElement("link"), { rel: "preconnect", href, crossOrigin: "anonymous" });
    document.head.appendChild(link);
  });
}

function toggleTropipayPayerFields(show) {
  const fieldset = document.getElementById("tropipay-payer-fields");
  if (!fieldset) return;
  const wasHidden = fieldset.hidden;
  fieldset.hidden = !show;
  fieldset.disabled = !show;
  if (show) {
    preconnectTropipay();
    // El bloque está debajo de todos los métodos: llevarlo a la vista al elegir TropiPay
    if (wasHidden) {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      requestAnimationFrame(() => fieldset.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" }));
    }
    const form = document.getElementById("checkout-form");
    setupTropipayPayerFields(form);
    prefillSenderFromProfile(form);
  }
}

function validateCheckoutStep(step) {
  const stepEl = document.querySelector(`[data-checkout-step="${step}"]`);
  if (!stepEl) return true;

  let valid = true;
  stepEl.querySelectorAll("input[required], textarea[required], select[required]").forEach(field => {
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
    prefillSenderFromProfile(form);
    await renderPaymentMethods();
    renderCheckoutReview();
    if (paymentStep) paymentStep.style.display = "block";
  } else if (step === 3) {
    if (confirmationStep) confirmationStep.style.display = "block";
  }

  // Scroll al inicio del modal body (fallback para iOS Safari que no soporta smooth)
  const modalBody = document.querySelector("#checkout-modal .modal-body") || document.getElementById("checkout-page-main");
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

  currentTotal = calculateCheckoutTotal(form);
  loadDeliveryLocations(form);
  subscribeToLocationEvents();
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
  const isCheckoutPage = document.body?.dataset.checkoutPage === "true";
  const form = document.getElementById("checkout-form");
  if (form) {
    setupBlurValidation(form);
    loadDeliveryLocations(form);
    document.getElementById("retry-delivery-locations")?.addEventListener("click", () => {
      document.getElementById("retry-delivery-locations")?.setAttribute("hidden", "");
      loadDeliveryLocations(form, true);
    });
    subscribeToLocationEvents();
    form.elements.delivery_municipality?.addEventListener("change", () => {
      const selected = deliveryLocations.find(location => String(location.id) === String(form.elements.delivery_municipality.value));
      form.elements.delivery_location_id.value = selected?.id || "";
      storageSet("ren_delivery_location_id", selected?.id || "");
      updateDeliveryPricing(form);
      saveFormData(form);
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) loadDeliveryLocations(form, true);
    });
  }

  document.getElementById("checkout-btn")?.addEventListener("click", showCheckoutModal);
  document.getElementById("cart-checkout-btn")?.addEventListener("click", () => {
    if (getCart().length) window.location.href = "./checkout.html";
  });

  if (isCheckoutPage) {
    if (!getCart().length) {
      window.location.href = "./index.html";
      return;
    }
    if (form) restoreFormData(form);
    currentTotal = calculateCheckoutTotal(form);
    loadDeliveryLocations(form);
    subscribeToLocationEvents();
    const savedStep = getCheckoutStep();
    goToCheckoutStep(savedStep === 3 ? 1 : savedStep, false);
  }

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

    const flowOf = m => m.payment_flow || "proof_upload";
    const cardMethods = metodos.filter(m => flowOf(m) === PAYMENT_FLOW_TROPIPAY);
    const directMethods = metodos.filter(m => flowOf(m) === "proof_upload");
    const assistedMethods = metodos.filter(m => flowOf(m) === PAYMENT_FLOW_ASSISTED);
    container.innerHTML = `
      ${renderPaymentGroup(
        "Pagar ahora con tarjeta",
        (getAccessToken()
          ? "Pago seguro en línea; tu pedido se confirma al instante."
          : "Visa y Mastercard mediante TropiPay. Crea una cuenta gratuita para proteger el pago, conservar tu carrito y seguir el pedido.")
          + (getTropipayMinAmount() > 0 ? ` Pedido mínimo: $${getTropipayMinAmount().toFixed(2)}.` : ""),
        cardMethods
      )}
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

    // Volvió de iniciar sesión tras elegir tarjeta: dejarla seleccionada
    const pendingCard = getAccessToken() && storageGet(PENDING_CARD_KEY)
      ? container.querySelector(`[data-payment-flow="${PAYMENT_FLOW_TROPIPAY}"]`)
      : null;
    storageRemove(PENDING_CARD_KEY);
    if (pendingCard) {
      selectPaymentMethod(pendingCard);
    } else if (currentSelectedMethod) {
      const prevCard = container.querySelector(`[data-method="${cssEscape(currentSelectedMethod)}"]`);
      if (prevCard) selectPaymentMethod(prevCard);
    }

    bindMethodLogoFallback(container);
    container.querySelectorAll(".method-card").forEach(card => {
      card.addEventListener("click", () => selectPaymentMethod(card));
      card.addEventListener("keydown", event => {
        if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        selectPaymentMethod(card);
      });
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
      <div class="checkout-method-list" role="radiogroup" aria-label="${title}">
        ${methods.map(m => `
      <div class="method-card" role="radio" tabindex="0" aria-checked="false" data-method="${escapeHtml(m.method_name)}" data-method-id="${escapeHtml(String(m.id))}"
           data-payment-flow="${m.payment_flow || "proof_upload"}"
           data-instructions="${escapeHtml(m.instructions || "")}"
           data-account="${escapeHtml(m.account_number || "")}">
        <div class="method-content">
          ${methodLogoHtml(m)}
          <div class="method-info">
            <strong>${escapeHtml(m.display_name || m.method_name)}</strong>
            ${m.account_number ? `<small class="method-account">${escapeHtml(m.account_number)}</small>` : ""}
            ${m.payment_flow === PAYMENT_FLOW_ASSISTED ? `<small class="method-account">Contacto por WhatsApp</small>` : ""}
            ${m.payment_flow === PAYMENT_FLOW_TROPIPAY ? `<small class="method-account">Visa y Mastercard · confirmación inmediata · sin comprobante</small>` : ""}
            ${m.payment_flow === PAYMENT_FLOW_TROPIPAY && !getAccessToken() ? `<span class="method-auth-badge">${svgIcon("lock", 12)} Requiere una cuenta gratuita</span>` : ""}
          </div>
        </div>
        <div class="method-instructions" style="display:none">
          ${m.account_number ? `
            <div class="method-account-copy">
              <span class="account-number-text">${escapeHtml(m.account_number)}</span>
              <button type="button" class="btn-copy-account" data-account="${escapeHtml(m.account_number)}" aria-label="Copiar número">
                ${svgIcon("copy", 16)} Copiar
              </button>
            </div>` : ""}
          <div class="instructions-text"></div>
        </div>
      </div>
      ${m.payment_flow === PAYMENT_FLOW_TROPIPAY && !getAccessToken() ? cardAuthGateHtml() : ""}
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

  return `Para pagar por TocoPay:\n\n1. Entra a tocopay.com e inicia sesión o crea tu cuenta.\n2. Añade como beneficiario a Ernesto, gerente de ventas.\n3. ${accountLine}\n4. Completa el pago en TocoPay y toma una captura clara del comprobante.\n5. Vuelve a Ready Express Now y sube esa captura para validar tu pedido.\n\nTocoPay es una plataforma externa e independiente. Ready Express Now no está afiliada ni asociada a TocoPay; solo usamos tu comprobante para validar el pago de tu pedido.`;
}

const PENDING_CARD_KEY = "ren_pending_card_payment";

// Aviso dentro de la propia tarjeta: sin sesión no se puede pagar con tarjeta
function cardAuthGateHtml() {
  return `
        <div class="method-auth-gate" role="region" aria-label="Inicia sesión para pagar con tarjeta" hidden>
          <p class="method-auth-title">${svgIcon("lock", 18)} Continúa con una cuenta segura</p>
          <p>La cuenta protege tu pago y te permite seguir el pedido. <strong>Tu carrito y los datos del envío ya están guardados.</strong></p>
          <div class="method-auth-actions">
            <a class="method-auth-btn is-primary" href="./registro-v25.html?return=checkout">Crear cuenta y continuar</a>
            <a class="method-auth-btn" href="./login-v25.html?return=checkout">Ya tengo cuenta</a>
          </div>
          <p class="method-auth-note">¿Prefieres no crear cuenta? Puedes pagar con Zelle, TocoPay o con ayuda por WhatsApp.</p>
        </div>`;
}

function showCardAuthGate(card) {
  // El aviso va justo después de la tarjeta (no dentro: tiene enlaces y la tarjeta es role=radio)
  const gate = card.nextElementSibling?.classList.contains("method-auth-gate") ? card.nextElementSibling : null;
  if (!gate) return;
  const form = document.getElementById("checkout-form");
  if (form) saveFormData(form);
  storageSet(PENDING_CARD_KEY, "1");
  gate.hidden = false;
  card.classList.add("needs-auth");
  gate.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}

function selectPaymentMethod(card) {
  const requestedFlow = card.dataset.paymentFlow || "proof_upload";
  document.querySelectorAll(".method-card").forEach(c => {
    c.classList.remove("selected");
    c.classList.remove("needs-auth");
    c.setAttribute("aria-checked", "false");
    const instr = c.querySelector(".method-instructions");
    if (instr) instr.style.display = "none";
  });

  card.classList.add("selected");
  card.setAttribute("aria-checked", "true");
  currentSelectedMethod = card.dataset.method;
  currentSelectedMethodId = card.dataset.methodId || null;
  currentSelectedMethodFlow = card.dataset.paymentFlow || "proof_upload";

  document.querySelectorAll(".method-auth-gate").forEach(gate => { gate.hidden = true; });
  const needsAccount = requestedFlow === PAYMENT_FLOW_TROPIPAY && !getAccessToken();
  if (requestedFlow !== PAYMENT_FLOW_TROPIPAY) storageRemove(PENDING_CARD_KEY);
  toggleTropipayPayerFields(currentSelectedMethodFlow === PAYMENT_FLOW_TROPIPAY && !needsAccount);

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
  if (needsAccount) showCardAuthGate(card);
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

  if (currentSelectedMethodFlow === PAYMENT_FLOW_TROPIPAY && !getAccessToken()) {
    saveFormData(form);
    storageSet(PENDING_CARD_KEY, "1");
    window.location.href = "./registro-v25.html?return=checkout";
    return;
  }

  if (!validatePaymentStep()) return;

  // TropiPay rechaza importes por debajo de su mínimo: se avisa antes de crear el pedido
  const cardMinimum = getTropipayMinAmount();
  if (currentSelectedMethodFlow === PAYMENT_FLOW_TROPIPAY && cardMinimum > 0 && currentTotal < cardMinimum) {
    const errorEl = document.getElementById("checkout-error");
    if (errorEl) {
      errorEl.textContent = `❌ El pago con tarjeta requiere un pedido de al menos $${cardMinimum.toFixed(2)} (el tuyo es de $${currentTotal.toFixed(2)}). Añade más productos o elige otro método de pago.`;
      errorEl.style.display = "block";
    }
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Creando pedido...';

  const senderFirstName = fieldValue(form, "sender_first_name");
  const senderLastName  = fieldValue(form, "sender_last_name");
  const senderName  = `${senderFirstName} ${senderLastName}`.trim();
  const senderPhone = fieldValue(form, "sender_phone");
  const isTropipay  = currentSelectedMethodFlow === PAYMENT_FLOW_TROPIPAY;

  const orderData = {
    customer_name:    senderName,
    customer_phone:   senderPhone,
    customer_address: fieldValue(form, "customer_address"),
    customer_email:   isTropipay ? fieldValue(form, "customer_email") : "",
    sender_name:      senderName,
    sender_first_name: senderFirstName,
    sender_last_name:  senderLastName,
    payment_flow:     currentSelectedMethodFlow,
    payer: isTropipay ? {
      country_iso: fieldValue(form, "payer_country_iso"),
      address:     fieldValue(form, "payer_address"),
      city:        fieldValue(form, "payer_city"),
      state:       fieldValue(form, "payer_state"),
      post_code:   fieldValue(form, "payer_postcode"),
      birth_date:  fieldValue(form, "payer_birth_date"),
      terms_accepted: Boolean(form.elements.payer_terms?.checked)
    } : undefined,
    sender_phone:     senderPhone,
    receiver_name:    fieldValue(form, "receiver_name"),
      receiver_phone:   fieldValue(form, "receiver_phone"),
    delivery_location_id: fieldValue(form, "delivery_location_id"),
    delivery_municipality: fieldValue(form, "delivery_municipality"),
    products_subtotal: getDeliverySubtotal(),
    delivery_surcharge: Number(getSelectedLocation(form)?.recargo || 0),
    delivery_notes:   buildDeliveryNotes(fieldValue(form, "delivery_notes")),
    items: cart.map(i => ({
      id:          i.id,
      source:      i.source,
      nombre:      i.nombre,
      precio:      i.precio,
      cantidad:    i.qty,
      precio_total: i.precio * i.qty,
      category:    i.category,
      combo_items: i.combo_items || [],
    })),
    total:  currentTotal,
    status: currentSelectedMethodFlow === PAYMENT_FLOW_ASSISTED ? "awaiting_manual_payment" : "pending",
  };

  try {
    const order = await createOrder(orderData);
    currentOrderId = order.id;
    currentTotal   = Number(order.total ?? orderData.total);
    currentOrderReceiptData = {
      ...orderData,
      ...order,
      id: order.id,
      created_at: order.created_at || new Date().toISOString()
    };

    if (currentSelectedMethodFlow !== PAYMENT_FLOW_ASSISTED && !isTropipay) {
      savePendingPayment(currentOrderId, currentTotal, orderData.items, "", order.checkout_token);
    }
    clearCart();
    clearCheckoutStep();

    const reference = order.order_reference || order.id;
    if (currentSelectedMethodFlow === PAYMENT_FLOW_TROPIPAY) {
      btn.innerHTML = '<span class="spinner"></span> Abriendo el pago seguro...';
      const [payment] = await Promise.all([
        createTropipayPayment(order.id, order.checkout_token),
        saveBillingToProfile(orderData.payer)
      ]);
      if (!payment?.payment_url) throw new Error("La pasarela de pago no devolvió un enlace. Inténtalo de nuevo.");
      window.location.href = payment.payment_url;
      return;
    }

    const state = currentSelectedMethodFlow === PAYMENT_FLOW_ASSISTED ? "revision" : "revision";
    window.location.href = `./pago-confirmado.html?order=${encodeURIComponent(reference)}&estado=${state}&payment=manual`;

  } catch (err) {
    // El pedido ya existe y la pasarela falló: la página de pago rechazado explica el motivo
    // y deja reintentar con tarjeta o pagar este mismo pedido con otro método
    if (err.paymentId) {
      const params = new URLSearchParams({ order: err.orderReference || "", payment: err.paymentId });
      window.location.href = `./pago-rechazado.html?${params}`;
      return;
    }
    const errorEl = document.getElementById("checkout-error");
    if (errorEl) {
      errorEl.textContent = err.message || "❌ No pudimos crear tu pedido. Intenta de nuevo o contáctanos: +53 56189395";
      errorEl.style.display = "block";
    }
    btn.disabled = false;
    updateSubmitButton();
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
  btn.textContent = currentSelectedMethodFlow === PAYMENT_FLOW_TROPIPAY
    ? (getAccessToken() ? "Pagar con tarjeta →" : "Crear cuenta y continuar →")
    : currentSelectedMethodFlow === PAYMENT_FLOW_ASSISTED
      ? "Crear pedido y recibir ayuda"
      : "Crear pedido →";
}

function renderCheckoutReview() {
  const el = document.getElementById("checkout-review-card");
  const form = document.getElementById("checkout-form");
  if (!el || !form) return;
  const count = getCart().reduce((s, i) => s + i.qty, 0);
  const receiver = fieldValue(form, "receiver_name") || "Por completar";
  const sender = `${fieldValue(form, "sender_first_name")} ${fieldValue(form, "sender_last_name")}`.trim() || "Por completar";
  const address = fieldValue(form, "customer_address") || "Por completar";
  el.innerHTML = `
    <div class="checkout-review-row"><span>Productos</span><strong>$${getDeliverySubtotal().toFixed(2)}</strong></div>
    <div class="checkout-review-row"><span>Entrega</span><strong>$${Number(getSelectedLocation(form)?.recargo || 0).toFixed(2)}</strong></div>
    <div class="checkout-review-row total-row"><span>Total</span><strong>$${calculateCheckoutTotal(form).toFixed(2)}</strong></div>
    <div class="checkout-review-row"><span>Cantidad de productos</span><strong>${count}</strong></div>
    <div class="checkout-review-row"><span>Envía</span><strong>${escapeHtml(sender)}</strong></div>
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
  try {
    // PNG dedicado: jsPDF no admite el WebP del logo del menú
    const response = await fetch("./images/logo-pdf.png");
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
    await submitCheckoutAssistantQuestion();
  });

  document.getElementById("checkout-ai-submit")?.addEventListener("click", async () => {
    await submitCheckoutAssistantQuestion();
  });
}

async function submitCheckoutAssistantQuestion() {
  const input = document.getElementById("checkout-ai-input");
  if (!input) return;
    const question = input?.value?.trim();
    if (!question) return;
    input.value = "";
    await askCheckoutAssistant(question);
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
    selectedPaymentMethod: currentSelectedMethodFlow === PAYMENT_FLOW_TROPIPAY ? CARD_METHOD_LABEL : currentSelectedMethod,
    selectedPaymentFlow: currentSelectedMethodFlow,
    availablePaymentMethods: currentPaymentMethods.map(m => ({
      id: m.id,
      name: m.display_name || m.method_name,
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
