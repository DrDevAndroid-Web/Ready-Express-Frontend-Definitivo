import {
  getAccessToken, getCurrentUser, getMyProfile, updateMyProfile, getMyOrders,
  getMyAddresses, createMyAddress, updateMyAddress, deleteMyAddress, clearSession
} from "./auth.js?v30";
import { focusFirstInvalid, setLoading, showMessage } from "./auth-ui.js?v30";
import { alternativeMethods, payWithMethod, retryTropipayPayment } from "./payment-return.js?v30";
import { renderBillingFields } from "./billing-fields.js?v30";

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = value => `$${Number(value || 0).toFixed(2)}`;
const dateText = value => {
  if (!value) return "";
  try { return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)); } catch { return ""; }
};

// ── Estados legibles: texto + icono + tono (el color nunca va solo) ──
const ORDER_STATUS = {
  pending: ["Pendiente de pago", "fa-clock", "warning"],
  awaiting_manual_payment: ["Te contactaremos para el pago", "fa-headset", "info"],
  processing: ["Procesando pago", "fa-spinner", "info"],
  payment_review: ["Comprobante en revisión", "fa-magnifying-glass", "info"],
  paid: ["Pagado", "fa-circle-check", "success"],
  payment_rejected: ["Pago rechazado", "fa-circle-xmark", "danger"],
  cancelled: ["Cancelado", "fa-ban", "muted"]
};
const DELIVERY_STATUS = {
  pending: ["Entrega pendiente", "fa-truck", "muted"],
  delivered: ["Entregado", "fa-house-circle-check", "success"],
  rejected: ["Incidencia en la entrega", "fa-triangle-exclamation", "danger"]
};
const MANUAL_PAYMENT_STATUS = {
  pending_review: ["En revisión", "info"],
  approved: ["Aprobado", "success"],
  rejected: ["Rechazado", "danger"]
};
const TROPIPAY_STATUS = {
  processing: ["Procesando", "info"],
  pending: ["Pendiente", "warning"],
  successful: ["Pagado", "success"],
  failed: ["Rechazado", "danger"],
  cancelled: ["Sustituido", "muted"]
};
// La orden aún puede pagarse (con TropiPay u otro método)
const ORDER_AWAITING_PAYMENT = ["pending", "processing", "payment_rejected"];

function badge([label, icon, tone]) {
  return `<span class="account-badge is-${tone}"><i class="fa-solid ${icon}" aria-hidden="true"></i>${escapeHtml(label)}</span>`;
}

// ── Toast ──
let toastTimer = null;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// ── Sesión expirada ──
function isAuthError(error) {
  return error?.status === 401;
}
function showLoggedOut(reason = "") {
  clearSession();
  $("#account-content").hidden = true;
  $("#auth-required").hidden = false;
  if (reason) $("#auth-required-text").textContent = reason;
}
function handleError(error, messageEl) {
  if (isAuthError(error)) return showLoggedOut("Tu sesión expiró. Inicia sesión de nuevo para continuar.");
  if (messageEl) showMessage(messageEl, error.message || "No se pudo completar la operación", "error");
  else toast(error.message || "No se pudo completar la operación");
}

// ── Pestañas (patrón WAI-ARIA tabs + deep link por hash) ──
const TABS = ["pedidos", "direcciones", "perfil"];
function selectTab(name, { focus = false, updateHash = true } = {}) {
  if (!TABS.includes(name)) name = "pedidos";
  TABS.forEach(tab => {
    const button = $(`#tab-${tab}`);
    const selected = tab === name;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`#panel-${tab}`).hidden = !selected;
    if (selected && focus) button.focus();
  });
  if (updateHash) history.replaceState(null, "", `#${name}`);
}
function setupTabs() {
  TABS.forEach((tab, index) => {
    const button = $(`#tab-${tab}`);
    button.addEventListener("click", () => selectTab(tab));
    button.addEventListener("keydown", event => {
      const moves = { ArrowRight: 1, ArrowLeft: -1 };
      if (event.key in moves) {
        event.preventDefault();
        selectTab(TABS[(index + moves[event.key] + TABS.length) % TABS.length], { focus: true });
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        selectTab(event.key === "Home" ? TABS[0] : TABS[TABS.length - 1], { focus: true });
      }
    });
  });
  window.addEventListener("hashchange", () => selectTab(location.hash.slice(1), { updateHash: false }));
  selectTab(location.hash.slice(1), { updateHash: false });
}

// ── Perfil ──
let billingFields = null;

async function loadProfile() {
  const profile = await getMyProfile();
  billingFields?.fill(profile);
  const form = $("#profile-form");
  for (const key of ["nombre", "apellidos", "telefono"]) form.elements[key].value = profile?.[key] || "";
  const email = profile?.email || getCurrentUser()?.email || "";
  $("#profile-email").value = email;
  $("#account-email").textContent = email;
  const firstName = profile?.nombre || "";
  $("#account-title").textContent = firstName ? `Hola, ${firstName}` : "Mi cuenta";
  $("#account-avatar").textContent = (firstName || email || "?").trim().charAt(0).toUpperCase();
}

// Datos de facturación de TropiPay: formulario aparte para que editar el perfil no los exija
function setupBillingForm() {
  const form = $("#billing-form");
  const message = $("#billing-message");
  billingFields = renderBillingFields($("#billing-fields"));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    billingFields.syncValidity();
    if (!focusFirstInvalid(form)) return showMessage(message, "Completa los campos marcados.", "error");
    const button = form.querySelector("[type=submit]");
    showMessage(message, "");
    setLoading(button, true, "Guardando...");
    try {
      await updateMyProfile(Object.fromEntries(new FormData(form)));
      toast("Datos de facturación guardados");
    } catch (error) {
      handleError(error, message);
    } finally {
      setLoading(button, false);
    }
  });
}

function setupProfileForm() {
  const form = $("#profile-form");
  const message = $("#profile-message");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!focusFirstInvalid(form)) return showMessage(message, "Completa los campos marcados.", "error");
    const button = form.querySelector("[type=submit]");
    showMessage(message, "");
    setLoading(button, true, "Guardando...");
    try {
      const data = Object.fromEntries(new FormData(form));
      await updateMyProfile({ nombre: data.nombre, apellidos: data.apellidos, telefono: data.telefono });
      $("#account-title").textContent = `Hola, ${data.nombre}`;
      $("#account-avatar").textContent = data.nombre.trim().charAt(0).toUpperCase();
      toast("Perfil actualizado");
    } catch (error) {
      handleError(error, message);
    } finally {
      setLoading(button, false);
    }
  });
}

// ── Direcciones ──
let addresses = [];
let pendingDeleteId = null;

function renderAddresses() {
  const container = $("#addresses");
  container.setAttribute("aria-busy", "false");
  if (!addresses.length) {
    container.innerHTML = `
      <div class="account-empty">
        <i class="fa-solid fa-map-location-dot" aria-hidden="true"></i>
        <p><strong>Aún no tienes direcciones guardadas</strong></p>
        <p>Añade la dirección de tu familia en Cuba para no escribirla en cada pedido.</p>
      </div>`;
    return;
  }
  container.innerHTML = `<ul class="account-list">${addresses.map(address => {
    const id = escapeHtml(address.id);
    const details = [address.municipio, address.provincia].filter(Boolean).join(", ");
    const confirming = pendingDeleteId === address.id;
    return `
      <li class="account-card account-address${address.es_predeterminada ? " is-default" : ""}">
        <div class="account-address-head">
          <h3>${escapeHtml(address.alias)}</h3>
          ${address.es_predeterminada ? '<span class="account-badge is-success"><i class="fa-solid fa-star" aria-hidden="true"></i>Predeterminada</span>' : ""}
        </div>
        <p>${escapeHtml(address.direccion)}</p>
        ${details ? `<p class="account-muted">${escapeHtml(details)}</p>` : ""}
        ${address.referencia ? `<p class="account-muted">Referencia: ${escapeHtml(address.referencia)}</p>` : ""}
        ${address.telefono_contacto ? `<p class="account-muted"><i class="fa-solid fa-phone" aria-hidden="true"></i> ${escapeHtml(address.telefono_contacto)}</p>` : ""}
        ${confirming ? `
          <div class="account-confirm" role="group" aria-label="Confirmar eliminación de ${escapeHtml(address.alias)}">
            <p>¿Eliminar esta dirección? No se puede deshacer.</p>
            <div class="account-card-actions">
              <button type="button" class="account-action" data-cancel-delete="${id}">No, conservar</button>
              <button type="button" class="account-action is-danger" data-confirm-delete="${id}">Sí, eliminar</button>
            </div>
          </div>` : `
          <div class="account-card-actions">
            <button type="button" class="account-action" data-edit="${id}" aria-label="Editar dirección ${escapeHtml(address.alias)}"><i class="fa-solid fa-pen" aria-hidden="true"></i>Editar</button>
            <button type="button" class="account-action is-danger" data-delete="${id}" aria-label="Eliminar dirección ${escapeHtml(address.alias)}"><i class="fa-solid fa-trash" aria-hidden="true"></i>Eliminar</button>
          </div>`}
      </li>`;
  }).join("")}</ul>`;
}

async function loadAddresses() {
  addresses = await getMyAddresses();
  renderAddresses();
}

function openAddressEditor(address = null) {
  const editor = $("#address-editor");
  const form = $("#address-form");
  form.reset();
  form.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
  showMessage($("#address-message"), "");
  form.elements.id.value = address?.id || "";
  if (address) {
    for (const key of ["alias", "direccion", "provincia", "municipio", "referencia", "telefono_contacto"]) form.elements[key].value = address[key] || "";
    form.elements.es_predeterminada.checked = Boolean(address.es_predeterminada);
  } else {
    form.elements.es_predeterminada.checked = addresses.length === 0;
  }
  $("#address-editor-title").textContent = address ? `Editar «${address.alias}»` : "Nueva dirección";
  editor.hidden = false;
  $("#add-address").setAttribute("aria-expanded", "true");
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  editor.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
  form.elements.alias.focus({ preventScroll: true });
}

function closeAddressEditor() {
  $("#address-editor").hidden = true;
  $("#add-address").setAttribute("aria-expanded", "false");
  $("#add-address").focus();
}

function setupAddresses() {
  $("#add-address").addEventListener("click", () => {
    if ($("#address-editor").hidden) openAddressEditor(); else closeAddressEditor();
  });
  $("#cancel-address").addEventListener("click", closeAddressEditor);

  const form = $("#address-form");
  const message = $("#address-message");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!focusFirstInvalid(form)) return showMessage(message, "Completa el alias y la dirección.", "error");
    const button = form.querySelector("[type=submit]");
    setLoading(button, true, "Guardando...");
    try {
      const data = Object.fromEntries(new FormData(form));
      data.es_predeterminada = form.elements.es_predeterminada.checked;
      const id = data.id;
      delete data.id;
      if (id) await updateMyAddress(id, data); else await createMyAddress(data);
      await loadAddresses();
      closeAddressEditor();
      toast(id ? "Dirección actualizada" : "Dirección guardada");
    } catch (error) {
      handleError(error, message);
    } finally {
      setLoading(button, false);
    }
  });

  $("#addresses").addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;
    const { edit, delete: remove, confirmDelete, cancelDelete } = button.dataset;
    if (edit) {
      openAddressEditor(addresses.find(item => String(item.id) === edit));
    } else if (remove) {
      pendingDeleteId = addresses.find(item => String(item.id) === remove)?.id ?? null;
      renderAddresses();
      $(`[data-cancel-delete="${CSS.escape(remove)}"]`)?.focus();
    } else if (cancelDelete) {
      pendingDeleteId = null;
      renderAddresses();
      $(`[data-delete="${CSS.escape(cancelDelete)}"]`)?.focus();
    } else if (confirmDelete) {
      setLoading(button, true, "Eliminando...");
      try {
        await deleteMyAddress(confirmDelete);
        pendingDeleteId = null;
        await loadAddresses();
        toast("Dirección eliminada");
        $("#add-address").focus();
      } catch (error) {
        setLoading(button, false);
        handleError(error);
      }
    }
  });
}

// ── Pedidos ──
function itemsSummary(items) {
  let list = items;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = []; } }
  if (!Array.isArray(list) || !list.length) return "";
  const names = list.map(item => `${item.cantidad ?? item.qty ?? 1}× ${item.nombre || item.name || "Producto"}`);
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${shown} y ${names.length - 2} más` : shown;
}

function renderPayments(order) {
  const payments = order.payments || { manual: [], tropipay: [] };
  const reference = escapeHtml(order.order_reference || order.id);
  const manual = (payments.manual || []).map(payment => {
    const [label, tone] = MANUAL_PAYMENT_STATUS[payment.validation_status] || ["Recibido", "info"];
    const url = payment.signed_url ? escapeHtml(payment.signed_url) : "";
    return `
      <div class="account-payment">
        <span><i class="fa-solid fa-receipt" aria-hidden="true"></i> Comprobante ${escapeHtml(payment.method || "")} <span class="account-badge is-${tone}">${label}</span></span>
        ${url ? `
          <div class="account-card-actions">
            <a class="account-action" href="${url}" target="_blank" rel="noopener"><i class="fa-solid fa-eye" aria-hidden="true"></i>Ver</a>
            <button type="button" class="account-action" data-download="${url}" data-filename="comprobante-${reference}.jpg"><i class="fa-solid fa-download" aria-hidden="true"></i>Descargar</button>
            <button type="button" class="account-action" data-share="${url}"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i>Compartir</button>
          </div>` : ""}
      </div>`;
  }).join("");
  // Solo el intento más reciente (la lista llega ordenada) ofrece reintentar
  const latestTropipayId = payments.tropipay?.[0]?.id;
  const tropipay = (payments.tropipay || []).map(payment => {
    const [label, tone] = TROPIPAY_STATUS[payment.status] || [payment.status || "Pendiente", "info"];
    const canRetry = payment.id === latestTropipayId
      && ["pending", "processing", "failed"].includes(payment.status)
      && ORDER_AWAITING_PAYMENT.includes(order.status);
    const id = escapeHtml(payment.id);
    return `
      <div class="account-payment">
        <span><i class="fa-solid fa-credit-card" aria-hidden="true"></i> Pago con tarjeta <span class="account-badge is-${tone}">${escapeHtml(label)}</span></span>
        ${canRetry ? `
          <div class="account-card-actions">
            <button type="button" class="account-action" data-retry-payment="${id}"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>Reintentar pago</button>
            <button type="button" class="account-action" data-other-methods="${escapeHtml(order.id)}" aria-expanded="false"><i class="fa-solid fa-money-bill-transfer" aria-hidden="true"></i>Pagar con otro método</button>
          </div>
          <div class="account-card-actions" data-methods-for="${escapeHtml(order.id)}" hidden></div>` : ""}
      </div>`;
  }).join("");
  return manual || tropipay ? `<div class="account-payments">${manual}${tropipay}</div>` : "";
}

let ordersById = new Map();

async function loadOrders() {
  const orders = await getMyOrders();
  ordersById = new Map(orders.map(order => [String(order.id), order]));
  const container = $("#orders");
  container.setAttribute("aria-busy", "false");
  if (!orders.length) {
    container.innerHTML = `
      <div class="account-empty">
        <i class="fa-solid fa-box-open" aria-hidden="true"></i>
        <p><strong>Todavía no has hecho pedidos</strong></p>
        <p>Cuando envíes algo a tu familia, aquí verás el pago y la entrega.</p>
        <a class="auth-btn" href="./index.html">Ir a la tienda</a>
      </div>`;
    return;
  }
  container.innerHTML = `<ul class="account-list">${orders.map(order => {
    const status = ORDER_STATUS[order.status] || [order.status || "En proceso", "fa-circle-info", "info"];
    const delivery = DELIVERY_STATUS[order.delivery_status] || DELIVERY_STATUS.pending;
    const items = itemsSummary(order.items);
    const place = [order.receiver_name, order.delivery_municipality].filter(Boolean).join(" · ");
    return `
      <li class="account-card account-order">
        <div class="account-order-head">
          <div>
            <h3>${escapeHtml(order.order_reference || order.id)}</h3>
            <p class="account-muted">${escapeHtml(dateText(order.created_at))}</p>
          </div>
          <strong class="account-order-total">${money(order.total)}</strong>
        </div>
        <div class="account-badges">${badge(status)}${order.status === "cancelled" ? "" : badge(delivery)}</div>
        ${items ? `<p class="account-order-items">${escapeHtml(items)}</p>` : ""}
        ${place ? `<p class="account-muted"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> Para ${escapeHtml(place)}</p>` : ""}
        ${renderPayments(order)}
      </li>`;
  }).join("")}</ul>`;
}

async function downloadFile(url, filename, button) {
  setLoading(button, true, "Descargando...");
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error();
    const blobUrl = URL.createObjectURL(await response.blob());
    const link = Object.assign(document.createElement("a"), { href: blobUrl, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch {
    // Si el almacenamiento no permite descargar directamente, se abre en otra pestaña
    window.open(url, "_blank", "noopener");
  } finally {
    setLoading(button, false);
  }
}

let otherMethods = [];

async function toggleOtherMethods(button) {
  const orderId = button.dataset.otherMethods;
  const container = $(`[data-methods-for="${CSS.escape(orderId)}"]`);
  const open = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!open));
  container.hidden = open;
  if (open) return;
  if (!otherMethods.length) otherMethods = await alternativeMethods().catch(() => []);
  container.innerHTML = otherMethods.length
    ? otherMethods.map(method => `<button type="button" class="account-action" data-pay-with="${escapeHtml(method.id)}" data-order="${escapeHtml(orderId)}">${escapeHtml(method.method_name)}${method.payment_flow === "assisted" ? " · WhatsApp" : ""}</button>`).join("")
    : '<p class="account-muted">No hay otros métodos disponibles ahora. Escríbenos por WhatsApp.</p>';
}

function setupOrders() {
  $("#orders").addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.retryPayment) {
      setLoading(button, true, "Abriendo el pago seguro...");
      try {
        location.href = await retryTropipayPayment(button.dataset.retryPayment);
      } catch (error) {
        setLoading(button, false);
        if (error.status === 409) {
          toast(error.message);
          loadOrders().catch(handleError);
        } else {
          handleError(error);
        }
      }
    } else if (button.dataset.otherMethods) {
      await toggleOtherMethods(button);
    } else if (button.dataset.payWith) {
      const order = ordersById.get(button.dataset.order);
      const method = otherMethods.find(m => String(m.id) === button.dataset.payWith);
      if (order && method) payWithMethod(method, { orderId: order.id, reference: order.order_reference || order.id, total: order.total });
    } else if (button.dataset.download) {
      await downloadFile(button.dataset.download, button.dataset.filename, button);
    } else if (button.dataset.share) {
      const url = button.dataset.share;
      if (navigator.share) {
        try { await navigator.share({ title: "Comprobante Ready Express Now", url }); } catch { /* cancelado por el usuario */ }
      } else {
        try {
          await navigator.clipboard.writeText(url);
          toast("Enlace copiado. Caduca en 10 minutos.");
        } catch {
          toast("No se pudo copiar el enlace");
        }
      }
    }
  });
}

// ── Inicio ──
function init() {
  if (!getCurrentUser() || !getAccessToken()) {
    showLoggedOut();
    return;
  }
  $("#auth-required").hidden = true;
  $("#account-content").hidden = false;
  $("#account-email").textContent = getCurrentUser()?.email || "";

  setupTabs();
  setupProfileForm();
  setupBillingForm();
  setupAddresses();
  setupOrders();
  $("#logout").addEventListener("click", () => {
    clearSession();
    location.href = "./index.html";
  });

  loadProfile().catch(error => handleError(error));
  loadOrders().catch(error => {
    $("#orders").setAttribute("aria-busy", "false");
    $("#orders").innerHTML = '<p class="auth-msg is-error">No se pudieron cargar tus pedidos. Recarga la página para intentarlo de nuevo.</p>';
    handleError(error);
  });
  loadAddresses().catch(error => {
    $("#addresses").setAttribute("aria-busy", "false");
    $("#addresses").innerHTML = '<p class="auth-msg is-error">No se pudieron cargar tus direcciones.</p>';
    handleError(error);
  });
}

init();
