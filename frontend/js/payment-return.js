// Retorno de TropiPay (pago-confirmado / pago-rechazado) y acciones de reintento.
// La página nunca decide por la URL: pregunta el estado real al backend, que a su vez
// lo concilia con TropiPay. Las funciones de acción también las usa "Mi cuenta".
import { API_BASE, CARD_PAYMENTS_ENABLED } from "./config.js?v40";
import { authorizedFetch, getValidAccessToken } from "./session.js?v40";
import { cargarMetodosPago, PAYMENT_FLOW_ASSISTED, PAYMENT_FLOW_PROOF_UPLOAD } from "./payment-methods.js?v40";
import { hasPendingPayment, savePendingPayment } from "./payment.js?v40";

const WHATSAPP_NUMBER = "5356189395";
const POLL_INTERVAL_MS = 3000;
const POLL_WINDOW_MS = 30000;

export function whatsappUrl(text) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

export async function fetchTropipayStatus(paymentId) {
  const response = await authorizedFetch(`${API_BASE}/payments/tropipay/${encodeURIComponent(paymentId)}/status`, { cache: "no-store" });
  if (response.status === 401 || response.status === 404) return { denied: true };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// Devuelve el enlace de TropiPay al que ir (el mismo si sigue activo, o uno nuevo)
export async function retryTropipayPayment(paymentId) {
  const response = await authorizedFetch(`${API_BASE}/payments/tropipay/${encodeURIComponent(paymentId)}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ return_url_base: new URL(".", location.href).href })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "No se pudo reintentar el pago");
    error.status = response.status;
    throw error;
  }
  if (!body.payment_url) throw new Error("La pasarela de pago no devolvió un enlace. Inténtalo de nuevo.");
  return body.payment_url;
}

// Métodos con los que se puede pagar la misma orden si TropiPay no funcionó
export async function alternativeMethods() {
  const methods = await cargarMetodosPago();
  return methods.filter(m => m.payment_flow === PAYMENT_FLOW_PROOF_UPLOAD || m.payment_flow === PAYMENT_FLOW_ASSISTED);
}

// Zelle/TocoPay → pago.html (la subida acepta al dueño por sesión); asistidos → WhatsApp
export function payWithMethod(method, { orderId, reference, total }) {
  if (method.payment_flow === PAYMENT_FLOW_ASSISTED) {
    window.open(whatsappUrl(`Hola, quiero pagar el pedido ${reference} ($${Number(total).toFixed(2)}) con ${method.method_name}.`), "_blank", "noopener");
    return;
  }
  savePendingPayment(orderId, Number(total), [], method.method_name, "");
  try {
    localStorage.setItem("ren_selected_payment_method", method.method_name);
    localStorage.setItem("ren_selected_payment_method_id", String(method.id));
  } catch { /* almacenamiento bloqueado: pago.html deja elegir el método */ }
  location.href = "./pago.html";
}

// ── Página de retorno ──

const $ = selector => document.querySelector(selector);
// "fa-brands fa-whatsapp" lleva su propio estilo; el resto de iconos son sólidos
const iconHtml = icon => `<i class="${icon.startsWith("fa-brands") ? icon : `fa-solid ${icon}`}" aria-hidden="true"></i>`;

function setView({ icon, tone = "", title, message }) {
  const iconEl = $("#status-icon");
  iconEl.className = tone ? `status-icon is-${tone}` : "status-icon";
  iconEl.innerHTML = iconHtml(icon);
  $("#title").textContent = title;
  $("#message").textContent = message;
  $("#actions").replaceChildren();
  $("#other-methods").hidden = true;
  $("#other-methods").replaceChildren();
}

function showError(text) {
  const el = $("#error");
  el.className = text ? "auth-msg is-error" : "auth-msg";
  el.textContent = text;
}

function actionLink(label, icon, href, { secondary = true, external = false } = {}) {
  const link = document.createElement("a");
  link.className = secondary ? "auth-btn auth-btn--secondary" : "auth-btn";
  link.href = href;
  if (external) { link.target = "_blank"; link.rel = "noopener"; }
  link.innerHTML = iconHtml(icon);
  link.append(label);
  $("#actions").append(link);
  return link;
}

function actionButton(label, icon, onClick, { secondary = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = secondary ? "auth-btn auth-btn--secondary" : "auth-btn";
  button.innerHTML = iconHtml(icon);
  button.append(label);
  button.addEventListener("click", () => onClick(button));
  $("#actions").append(button);
  return button;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
    button.append(label);
  } else if (button.dataset.label) {
    button.innerHTML = button.dataset.label;
  }
}

function currentPageForLogin() {
  const page = location.pathname.split("/").pop() || "pago-rechazado.html";
  return `${page.endsWith(".html") ? page : `${page}.html`}${location.search}`;
}

async function renderOtherMethods(status) {
  const container = $("#other-methods");
  if (!container.hidden) { container.hidden = true; return; }
  container.replaceChildren();
  container.hidden = false;
  const methods = await alternativeMethods().catch(() => []);
  if (!methods.length) {
    container.textContent = "No hay otros métodos disponibles ahora mismo. Escríbenos por WhatsApp.";
    return;
  }
  const title = document.createElement("p");
  title.className = "payment-return-methods-title";
  title.textContent = "Elige cómo quieres pagar este mismo pedido:";
  container.append(title);
  for (const method of methods) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "auth-btn auth-btn--secondary";
    button.append(method.method_name);
    if (method.payment_flow === PAYMENT_FLOW_ASSISTED) {
      const note = document.createElement("small");
      note.textContent = " · por WhatsApp";
      button.append(note);
    }
    button.addEventListener("click", () => payWithMethod(method, { orderId: status.order_id, reference: status.order_reference, total: status.total }));
    container.append(button);
  }
}

function renderPaid() {
  setView({ icon: "fa-circle-check", tone: "success", title: "Pago confirmado", message: "Recibimos tu pago. Tu pedido pasa a preparación y te avisaremos de la entrega." });
  actionLink("Ver mis pedidos", "fa-box", "./cuenta.html#pedidos", { secondary: false });
  actionLink("Volver a la tienda", "fa-store", "./index.html");
}

// Motivos en los que volver a intentar con tarjeta no sirve: hay que cambiar de método o de datos
const NO_CARD_RETRY = new Set(["CARD_MIN_AMOUNT", "CARD_INVALID_AMOUNT"]);

function renderUnpaid(paymentId, status, { stillPending }) {
  const reference = status.order_reference || "";
  const failure = status.failure_code || "";
  setView(stillPending
    ? { icon: "fa-hourglass-half", title: "Tu pago aún no está confirmado", message: "Si acabas de pagar, la confirmación del banco puede tardar unos minutos. Si no llegaste a completar el pago, puedes intentarlo de nuevo." }
    : {
      icon: failure === "PAYMENT_REVIEW" ? "fa-magnifying-glass-dollar" : "fa-circle-xmark",
      tone: failure === "PAYMENT_REVIEW" ? undefined : "error",
      title: failure === "CARD_UNAVAILABLE" ? "No pudimos abrir el pago con tarjeta" : failure === "PAYMENT_REVIEW" ? "Estamos revisando tu pago" : "El pago no se completó",
      // El backend explica el motivo (fondos insuficientes, 3D Secure, datos de facturación...)
      message: status.failure_message || "No se pudo cobrar la tarjeta. Suele deberse a fondos insuficientes, a la verificación de seguridad del banco (3D Secure) o a un dato de la tarjeta. No se te ha cobrado nada."
    });

  if (failure === "CARD_PAYER_DATA") {
    actionLink("Revisar mis datos de facturación", "fa-user-pen", "./cuenta.html#perfil", { secondary: false });
  }
  if (!status.can_retry) {
    if (failure !== "PAYMENT_REVIEW") $("#message").textContent = "Este pago ya no se puede completar en línea. Escríbenos por WhatsApp y te ayudamos.";
  } else if (!CARD_PAYMENTS_ENABLED || NO_CARD_RETRY.has(failure)) {
    actionButton("Pagar con otro método", "fa-money-bill-transfer", () => renderOtherMethods(status));
  } else {
    actionButton("Reintentar pago con tarjeta", "fa-rotate-right", async button => {
      showError("");
      setBusy(button, true, "Abriendo el pago seguro...");
      try {
        location.href = await retryTropipayPayment(paymentId);
      } catch (error) {
        setBusy(button, false);
        if (error.status === 409) return checkStatus(paymentId, { poll: false });
        showError(error.message);
      }
    });
    actionButton("Pagar con otro método", "fa-money-bill-transfer", () => renderOtherMethods(status), { secondary: true });
  }
  if (stillPending) actionButton("Comprobar de nuevo", "fa-arrows-rotate", () => checkStatus(paymentId, { poll: false }), { secondary: true });
  actionLink("Escribir por WhatsApp", "fa-brands fa-whatsapp", whatsappUrl(`Hola, tuve un problema pagando el pedido ${reference} con tarjeta.`), { external: true });
  actionLink("Ver mis pedidos", "fa-box", "./cuenta.html#pedidos");
}

function renderDenied(loggedIn) {
  setView({ icon: "fa-lock", title: "Inicia sesión para ver este pago", message: loggedIn ? "Este pago no está asociado a la cuenta con la que has iniciado sesión." : "Por seguridad, el estado del pago solo se muestra a quien hizo el pedido." });
  if (!loggedIn) actionLink("Iniciar sesión", "fa-right-to-bracket", `./login-v25.html?return=${encodeURIComponent(currentPageForLogin())}`, { secondary: false });
  actionLink("Escribir por WhatsApp", "fa-brands fa-whatsapp", whatsappUrl(`Hola, necesito ayuda con el pago del pedido ${$("#order").textContent}.`), { external: true });
  actionLink("Volver a la tienda", "fa-store", "./index.html");
}

function renderUnknown(paymentId) {
  setView({ icon: "fa-circle-question", title: "No pudimos comprobar el pago", message: "Hubo un problema de conexión al consultar el estado. Si ya pagaste, no vuelvas a pagar: comprueba de nuevo en unos segundos." });
  if (paymentId) actionButton("Comprobar de nuevo", "fa-arrows-rotate", () => checkStatus(paymentId, { poll: false }));
  actionLink("Escribir por WhatsApp", "fa-brands fa-whatsapp", whatsappUrl(`Hola, necesito ayuda con el pago del pedido ${$("#order").textContent}.`), { external: true });
  actionLink("Ver mis pedidos", "fa-box", "./cuenta.html#pedidos");
}

function renderOrderReceived() {
  setView({ icon: "fa-clipboard-check", title: "Pedido recibido", message: "Tu pedido fue creado. El pago queda pendiente de revisión o de la confirmación del método seleccionado." });
  if (hasPendingPayment()) actionLink("Subir comprobante", "fa-upload", "./pago.html", { secondary: false });
  actionLink("Ver mis pedidos", "fa-box", "./cuenta.html#pedidos");
  actionLink("Volver a la tienda", "fa-store", "./index.html");
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// TropiPay puede redirigir antes de que llegue su aviso: se consulta durante ~30 s
async function checkStatus(paymentId, { poll = true } = {}) {
  showError("");
  setView({ icon: "fa-spinner fa-spin", title: "Verificando tu pago...", message: "Estamos confirmando tu pago con el banco. No cierres esta ventana." });
  const deadline = Date.now() + (poll ? POLL_WINDOW_MS : 0);
  let status = null;
  let failedRequest = false;

  do {
    try {
      status = await fetchTropipayStatus(paymentId);
      failedRequest = false;
    } catch {
      failedRequest = true;
    }
    if (status?.denied) return renderDenied(Boolean(await getValidAccessToken()));
    if (status?.order_reference) $("#order").textContent = status.order_reference;
    if (status && status.status !== "pending" && status.status !== "processing") break;
    if (Date.now() >= deadline) break;
    await wait(POLL_INTERVAL_MS);
  } while (Date.now() < deadline + POLL_INTERVAL_MS);

  if (!status) return renderUnknown(paymentId);
  if (status.status === "successful" || status.order_status === "paid") return renderPaid();
  if (failedRequest && (status.status === "pending" || status.status === "processing")) return renderUnknown(paymentId);
  // Llegar por pago-rechazado solo cambia el texto (el aviso de TropiPay puede no haber llegado);
  // confirmar un pago lo decide siempre el backend
  const cameFromRejection = location.pathname.includes("pago-rechazado");
  const open = status.status === "pending" || status.status === "processing";
  return renderUnpaid(paymentId, status, { stillPending: open && !cameFromRejection });
}

export async function initPaymentReturn() {
  const params = new URLSearchParams(location.search);
  const paymentId = params.get("payment");
  $("#order").textContent = params.get("order") || "-";

  // Pedidos con comprobante o pago asistido: solo se informa, no hay pago que verificar
  if (paymentId === "manual") return renderOrderReceived();
  if (!paymentId) return renderUnknown(null);
  if (!(await getValidAccessToken())) return renderDenied(false);
  return checkStatus(paymentId);
}
