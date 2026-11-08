import {
  getAccessToken, getCurrentUser, getMyProfile, updateMyProfile, getMyOrders,
  getMyAddresses, createMyAddress, updateMyAddress, deleteMyAddress, clearSession
} from "./auth.js?v55";
import { focusFirstInvalid, setLoading, showMessage } from "./auth-ui.js?v55";
import { alternativeMethods, payWithMethod, retryTropipayPayment } from "./payment-return.js?v55";
import { billingComplete, renderBillingFields } from "./billing-fields.js?v55";
import { CARD_PAYMENTS_ENABLED } from "./config.js?v56";
import { getMyReferralCode, getMyReferralSummary, getReferralPushPreferences, updateReferralPushPreferences } from "./api.js?v56";
import { bindReferralCtaTracking, saveReferralWalletState } from "./referrals.js?v56";

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
  cancelled: ["Sustituido", "muted"],
  amount_mismatch: ["En revisión", "warning"]
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
  $("#account-bottom-nav").hidden = true;
  $("#auth-required").hidden = false;
  if (reason) $("#auth-required-text").textContent = reason;
}
function handleError(error, messageEl) {
  if (isAuthError(error)) return showLoggedOut("Tu sesión expiró. Inicia sesión de nuevo para continuar.");
  if (messageEl) showMessage(messageEl, error.message || "No se pudo completar la operación", "error");
  else toast(error.message || "No se pudo completar la operación");
}

// Las rutas antiguas por hash siguen abriendo la misma sección.
const SECTIONS = ["pedidos", "direcciones", "perfil", "facturacion", "referidos"];
function currentView() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash === "facturacion" && !CARD_PAYMENTS_ENABLED) return "perfil";
  return SECTIONS.includes(hash) ? hash : "inicio";
}
function renderView({ focus = false } = {}) {
  const view = currentView();
  const active = view === "inicio" ? "pedidos" : view;
  $("#account-content").dataset.view = view;
  SECTIONS.forEach(section => {
    $(`#panel-${section}`).hidden = section !== active;
    document.querySelectorAll(`[data-section="${section}"]`).forEach(link => {
      if (section === active && view !== "inicio") link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  });
  if (focus) {
    window.scrollTo({ top: 0, behavior: "instant" });
    if (view === "inicio") $("#account-title").focus({ preventScroll: true });
    else $(`#${active}-title`).focus({ preventScroll: true });
  }
}
function setupNavigation() {
  document.querySelectorAll("[data-section]").forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      const section = link.dataset.section;
      if (currentView() === section) return;
      history.pushState({ accountFromHub: currentView() === "inicio" }, "", `#${section}`);
      renderView({ focus: true });
    });
  });
  const goBack = event => {
    event.preventDefault();
    if (currentView() === "inicio") return;
    if (history.state?.accountFromHub) history.back();
    else {
      history.replaceState(null, "", "#inicio");
      renderView({ focus: true });
    }
  };
  $("#account-back").addEventListener("click", goBack);
  $("#account-bottom-nav a[href='#inicio']").addEventListener("click", goBack);
  window.addEventListener("popstate", () => renderView({ focus: true }));
  window.addEventListener("hashchange", () => renderView({ focus: true }));
  renderView();
}

// ── Perfil ──
let billingFields = null;

async function loadProfile() {
  const profile = await getMyProfile();
  billingFields?.fill(profile);
  const form = $("#profile-form");
  for (const key of ["nombre", "apellidos", "telefono"]) form.elements[key].value = profile?.[key] || "";
  const email = profile?.email || getCurrentUser()?.email || "";
  $("#profile-email").textContent = email;
  if (CARD_PAYMENTS_ENABLED) $("#hub-billing-status").textContent = billingComplete(profile) ? "Completo" : "Pendiente";
  const firstName = profile?.nombre || "";
  $("#account-title").textContent = firstName ? `Hola, ${firstName}` : "Mi cuenta";
  $("#account-avatar").textContent = (firstName || email || "?").trim().charAt(0).toUpperCase();
}

// Datos de facturación de TropiPay: formulario aparte para que editar el perfil no los exija
function setupBillingForm() {
  if (!CARD_PAYMENTS_ENABLED) return;
  $("#hub-billing-link").hidden = false;
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
      $("#hub-billing-status").textContent = "Completo";
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
  $("#hub-addresses-count").textContent = String(addresses.length);
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
            <details class="account-more"><summary aria-label="Más opciones para ${escapeHtml(address.alias)}"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i><span>Más opciones</span></summary><button type="button" class="account-action is-danger" data-delete="${id}" aria-label="Eliminar dirección ${escapeHtml(address.alias)}">Eliminar dirección</button></details>
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

// Foto que sube el equipo desde la app de administración al entregar el pedido
function renderDeliveryPhoto(order) {
  const url = order.delivery_photo?.url ? escapeHtml(order.delivery_photo.url) : "";
  if (!url) return "";
  const reference = escapeHtml(order.order_reference || order.id);
  return `
      <div class="account-payment">
        <span><i class="fa-solid fa-camera" aria-hidden="true"></i> Foto de la entrega</span>
        <div class="account-card-actions">
          <a class="account-action" href="${url}" target="_blank" rel="noopener"><i class="fa-solid fa-eye" aria-hidden="true"></i>Ver</a>
          <button type="button" class="account-action" data-download="${url}" data-filename="entrega-${reference}.webp"><i class="fa-solid fa-download" aria-hidden="true"></i>Descargar</button>
          <button type="button" class="account-action" data-share="${url}"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i>Compartir</button>
        </div>
      </div>`;
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
    const canRetry = CARD_PAYMENTS_ENABLED && payment.id === latestTropipayId
      && ["pending", "processing", "failed"].includes(payment.status)
      && ORDER_AWAITING_PAYMENT.includes(order.status);
    const id = escapeHtml(payment.id);
    return `
      <div class="account-payment">
        <span><i class="fa-solid fa-credit-card" aria-hidden="true"></i> Pago con tarjeta <span class="account-badge is-${tone}">${escapeHtml(label)}</span></span>
        ${payment.id === latestTropipayId && payment.failure_message ? `<p class="account-payment-reason">${escapeHtml(payment.failure_message)}</p>` : ""}
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
  $("#hub-orders-count").textContent = String(orders.length);
  const container = $("#orders");
  container.setAttribute("aria-busy", "false");
  if (!orders.length) {
    container.innerHTML = `
      <div class="account-empty">
        <i class="fa-solid fa-box-open" aria-hidden="true"></i>
        <p><strong>Todavía no has hecho pedidos</strong></p>
        <p>Elige algo especial para tu familia. Aquí podrás seguir cada entrega.</p>
        <a class="auth-btn" href="./index.html#combos">Ver combos</a>
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
        ${renderDeliveryPhoto(order)}
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

function referralLink(code) {
  const url = new URL("./index.html", location.href);
  url.searchParams.set("ref", code);
  return url.href;
}

function renderReferralSummary(code, summary) {
  const container = $("#referral-content");
  if (!container) return;
  const link = referralLink(code.code);
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`Te invito a Ready Express Now. Entra con mi enlace: ${link}`)}`;
  const rewards = Array.isArray(summary?.rewards) ? summary.rewards : [];
  const referrals = Array.isArray(summary?.referrals) ? summary.referrals : [];
  const referred = summary?.referred;
  const promotion = summary?.referred_promotion;
  const referrerRewards = rewards.filter(item => item.reward_type === "referrer_credit");
  const pendingReferrals = referrals.filter(item => ["registered", "purchase_pending"].includes(item.status));
  const referralStatus = {
    pending: "Invitación pendiente", registered: "Registrado; falta la primera compra",
    purchase_pending: "Compra en proceso de confirmación", qualified: "Compra confirmada; recompensa en proceso",
    rewarded: "Recompensa acreditada", rejected: "No aprobado", cancelled: "Cancelado"
  };
  const rewardStatus = {
    pending: "En proceso", available: "Disponible", used: "Usado en una compra",
    reversed: "Anulado", expired: "Vencido", rejected: "No aprobado"
  };
  $("#hub-balance").textContent = `${money(summary?.balance)} ${summary?.currency || "USD"}`;
  const promotionText = promotion
    ? (promotion.reward_type === "discount_percent" ? `${Number(promotion.amount)}% de descuento en tu primera compra` : `${money(promotion.amount)} de descuento en tu primera compra`)
    : "Promoción de referido aplicada a tu primera compra";
  container.innerHTML = `
    ${referred ? `<div class="account-referral-promo" role="status"><strong>Entraste con un enlace de referido</strong><span>${escapeHtml(promotionText)}${referred.status === "registered" ? `. Se aplicará a tu primera compra${promotion?.minimum_purchase ? ` desde ${money(promotion.minimum_purchase)}` : ""}.` : "."}</span><small>${escapeHtml(referralStatus[referred.status] || "Promoción registrada")}</small></div>` : ""}
    <div class="account-card account-referral-balance">
      <p>Crédito disponible</p>
      <strong>${money(summary?.balance)} <small>${escapeHtml(summary?.currency || "USD")}</small></strong>
      <span>Úsalo en tu próxima compra.</span>
    </div>
    <div class="account-card account-invite-card">
      <p class="account-muted">Tu código de invitación</p>
      <strong class="account-invite-code">${escapeHtml(code.code)}</strong>
      <div class="account-invite-actions">
        <a class="auth-btn account-whatsapp-share" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener" data-referral-cta data-referral-placement="account_whatsapp"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Compartir por WhatsApp</a>
        <button type="button" class="account-action" id="copy-referral-link" data-link="${escapeHtml(link)}" data-referral-cta data-referral-placement="account_copy"><i class="fa-solid fa-copy" aria-hidden="true"></i> Copiar enlace</button>
      </div>
    </div>
    <div class="account-card account-activity">
      <h3>Ganancias y actividad</h3>
      ${referrerRewards.length ? `<ul class="account-list">${referrerRewards.map(item => `<li class="account-activity-item"><span><strong>${money(item.amount)} ${escapeHtml(item.currency || summary?.currency || "USD")}</strong><small>${escapeHtml(rewardStatus[item.status] || "Estado en revisión")}</small></span><time>${escapeHtml(dateText(item.created_at))}</time></li>`).join("")}</ul>` : ""}
      ${pendingReferrals.length ? `<p class="account-muted">${pendingReferrals.length} referido${pendingReferrals.length === 1 ? " está" : "s están"} registrado${pendingReferrals.length === 1 ? "" : "s"}; la ganancia se acredita cuando complete y pague su primera compra.</p>` : ""}
      ${referrals.length ? `<ul class="account-list account-referral-history">${referrals.map(item => `<li><span class="account-badge is-info">${escapeHtml(referralStatus[item.status] || "Estado en revisión")}</span><time class="account-muted">${escapeHtml(dateText(item.created_at))}</time></li>`).join("")}</ul>` : '<p class="account-muted">Todavía no tienes referidos registrados.</p>'}
    </div>`;
  const copy = async linkValue => {
    try { await navigator.clipboard.writeText(linkValue); toast("Enlace de referido copiado"); }
    catch { toast("No se pudo copiar el enlace"); }
  };
  $("#copy-referral-link")?.addEventListener("click", event => copy(event.currentTarget.dataset.link));
}

async function loadReferrals() {
  const container = $("#referral-content");
  if (!container) return;
  container.setAttribute("aria-busy", "true");
  container.innerHTML = '<div class="account-skeleton account-skeleton--short" aria-hidden="true"></div>';
  try {
    const summaryPromise = getMyReferralSummary().catch(error => {
      if (/tardó demasiado|timeout|sin conexión/i.test(error?.message || "")) return getMyReferralSummary();
      throw error;
    });
    const [code, summary] = await Promise.all([getMyReferralCode(), summaryPromise]);
    saveReferralWalletState(summary);
    renderReferralSummary(code, summary);
  } catch (error) {
    $("#hub-balance").textContent = "No disponible";
    if (isAuthError(error)) showLoggedOut("Tu sesión expiró. Inicia sesión de nuevo para continuar.");
    else {
      container.innerHTML = '<div class="account-card account-retry"><p>Tu saldo no se pudo cargar ahora.</p><button type="button" class="account-action" id="retry-referrals">Reintentar</button></div>';
      $("#retry-referrals").addEventListener("click", () => loadReferrals());
    }
  } finally {
    container.setAttribute("aria-busy", "false");
  }
}

function base64ToBytes(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

async function setupReferralPush() {
  const setting = $("#referral-push-setting");
  const checkbox = $("#referral-push-enabled");
  const message = $("#referral-push-message");
  if (!setting || !checkbox) return;
  setting.hidden = false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    checkbox.disabled = true;
    message.textContent = "Los avisos no están disponibles en este navegador. Puedes activarlos desde otro dispositivo compatible.";
    return;
  }
  try {
    const preferences = await getReferralPushPreferences();
    checkbox.checked = Boolean(preferences.referral_purchase_push_enabled);
    if (!preferences.enabled || !preferences.public_key) {
      checkbox.disabled = true;
      message.textContent = "Las notificaciones push aún no están configuradas en este entorno.";
      return;
    }
    checkbox.addEventListener("change", async () => {
      const enabling = checkbox.checked;
      checkbox.disabled = true;
      try {
        if (!enabling) {
          await updateReferralPushPreferences({ referral_purchase_push_enabled: false });
          message.textContent = "Notificaciones desactivadas.";
          return;
        }
        const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        if (permission !== "granted") throw new Error("El navegador no concedió permiso para las notificaciones");
        const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
        const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToBytes(preferences.public_key)
        });
        await updateReferralPushPreferences({
          referral_purchase_push_enabled: true,
          subscription: subscription.toJSON(),
          user_agent: navigator.userAgent
        });
        message.textContent = "Notificaciones activadas en este navegador.";
      } catch (error) {
        checkbox.checked = !enabling;
        message.textContent = error.message || "No se pudo activar la notificación.";
      } finally {
        checkbox.disabled = false;
      }
    });
  } catch (error) {
    checkbox.disabled = true;
    message.textContent = error.message || "No se pudo cargar la configuración de notificaciones.";
  }
}

// ── Inicio ──
function init() {
  bindReferralCtaTracking();
  if (!getCurrentUser() || !getAccessToken()) {
    showLoggedOut();
    return;
  }
  $("#auth-required").hidden = true;
  $("#account-content").hidden = false;
  $("#account-bottom-nav").hidden = false;

  setupNavigation();
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
  loadReferrals().catch(error => handleError(error));
  setupReferralPush().catch(error => console.warn("[referral-push]", error));
}

init();
