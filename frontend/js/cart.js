import { getCartSnapshot, persistCart, subscribeCart, getCartStorageStatus } from "./cart-store.js?v68";
import { createCartShare, getCartShare } from "./api.js?v68";

import { renderReferralCartNotice } from "./referrals.js?v68";

let cart = getCartSnapshot();
let pendingSharedCart = null;

function saveCart(nextCart = cart) {
  const saved = persistCart(nextCart);
  if (!saved) showCartStorageWarning();
  return saved;
}

function showCartStorageWarning() {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = "No pudimos guardar el carrito en este dispositivo. No cierres la página.";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 4500);
}

subscribeCart(nextCart => {
  cart = nextCart;
  if (document.readyState !== "loading") {
    renderCart();
    updateCartBadge();
  }
});

function parseComponentQuantity(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const match = String(value ?? "").match(/^\s*(\d+(?:[.,]\d+)?)/);
  return match ? Number(match[1].replace(",", ".")) : 1;
}

function getComboComponents(item) {
  const raw = item?.combo_items || item?.items || item?.productos || item?.componentes;
  if (Array.isArray(raw)) {
    return raw.map(component => ({
      nombre: component.nombre || component.name || component.item || component.producto || "",
      cantidad: parseComponentQuantity(component.cantidad ?? component.quantity ?? component.qty ?? 1),
    })).filter(component => component.nombre && component.cantidad > 0);
  }

  if (item?.detalles && typeof item.detalles === "object" && !Array.isArray(item.detalles)) {
    return Object.entries(item.detalles).map(([nombre, cantidad]) => ({
      nombre,
      cantidad: parseComponentQuantity(cantidad),
    })).filter(component => component.nombre);
  }

  return [];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderComboDetails(item) {
  const components = getComboComponents(item);
  if (!components.length) return "";

  return `
    <details class="cart-item-components">
      <summary class="cart-item-components-label">Incluido en el combo <span aria-hidden="true">⌄</span></summary>
      <ul>${components.map(component => `
        <li>${escapeHtml(component.nombre)} <strong>×${component.cantidad}</strong></li>
      `).join("")}</ul>
    </details>`;
}

export function addItem(product, qty = 1) {
  const existing = cart.find((i) => String(i.id) === String(product.id) && i.category === product.category);
  if (existing) existing.qty += qty;
  else cart.push({ ...product, qty });
  saveCart();
  renderCart();
  updateCartBadge();
  showCartFeedback(product.nombre, qty);
}

export function removeItem(id, category) {
  cart = cart.filter((i) => !(String(i.id) === String(id) && i.category === category));
  saveCart();
  renderCart();
  updateCartBadge();
}

export function updateQty(id, category, delta) {
  const item = cart.find((i) => String(i.id) === String(id) && i.category === category);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) removeItem(id, category);
  else {
    saveCart();
    renderCart();
    updateCartBadge();
  }
}

export function clearCart() {
  const previous = cart;
  cart = [];
  if (!saveCart()) cart = previous;
  renderCart();
  updateCartBadge();
  return cart.length === 0;
}

export function getCart() {
  return getCartSnapshot();
}

export function getTotal() {
  return cart.reduce((sum, item) => sum + Number(item.precio || 0) * Number(item.qty || 0), 0);
}

export function getItemCount() {
  return cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
}

function updateCartBadge() {
  const badge = document.getElementById("cart-badge");
  const floatingBadge = document.getElementById("floating-cart-badge");
  const count = getItemCount();
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? "flex" : "none";
  }
  if (floatingBadge) {
    floatingBadge.textContent = count;
    floatingBadge.style.display = count > 0 ? "flex" : "none";
  }
}

function showCartFeedback(name, qty = 1) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = qty > 1 ? `${qty}× "${name}" agregado al carrito` : `"${name}" agregado al carrito`;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

export function renderCart() {
  const list = document.getElementById("cart-items");
  const totalEl = document.getElementById("cart-total");
  const emptyMsg = document.getElementById("cart-empty");
  const checkoutBtn = document.getElementById("cart-checkout-btn");
  const shareBtn = document.getElementById("cart-share-btn");
  if (!list) return;

  if (cart.length === 0) {
    list.innerHTML = "";
    if (emptyMsg) emptyMsg.style.display = "block";
    if (checkoutBtn) checkoutBtn.disabled = true;
    if (shareBtn) shareBtn.disabled = true;
    if (totalEl) totalEl.textContent = "$0.00";
    renderReferralCartNotice(0);
    return;
  }

  if (emptyMsg) emptyMsg.style.display = "none";
  if (checkoutBtn) checkoutBtn.disabled = false;
  if (shareBtn) shareBtn.disabled = false;

  list.innerHTML = cart.map((item, index) => `
    <div class="cart-item" data-index="${index}">
      <div class="cart-item-img">
        ${item.imagen ? `<img src="${escapeHtml(item.imagen)}" alt="">` : `<div class="img-placeholder-sm"></div>`}
      </div>
      <div class="cart-item-info">
        <p class="cart-item-name">${escapeHtml(item.nombre)}</p>
        ${renderComboDetails(item)}
        <p class="cart-item-price">$${(Number(item.precio || 0) * Number(item.qty || 0)).toFixed(2)}</p>
      </div>
      <div class="cart-item-qty">
        <button type="button" class="qty-btn" data-index="${index}" data-delta="-1" aria-label="Reducir cantidad de ${escapeHtml(item.nombre)}">−</button>
        <span>${item.qty}</span>
        <button type="button" class="qty-btn" data-index="${index}" data-delta="1" aria-label="Aumentar cantidad de ${escapeHtml(item.nombre)}">+</button>
      </div>
      <button type="button" class="cart-item-remove" data-index="${index}" aria-label="Quitar ${escapeHtml(item.nombre)} del carrito">✕</button>
    </div>
  `).join("");

  list.querySelectorAll(".qty-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = cart[parseInt(btn.dataset.index, 10)];
      if (item) updateQty(item.id, item.category, parseInt(btn.dataset.delta, 10));
    });
  });

  list.querySelectorAll(".cart-item-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = cart[parseInt(btn.dataset.index, 10)];
      if (item) removeItem(item.id, item.category);
    });
  });

  if (totalEl) totalEl.textContent = `$${getTotal().toFixed(2)}`;
  renderReferralCartNotice(getTotal());
}

export function initCart() {
  if (!getCartStorageStatus().ok) showCartStorageWarning();
  renderCart();
  updateCartBadge();
  document.getElementById("cart-share-btn")?.addEventListener("click", shareCart);
  document.getElementById("share-cart-close")?.addEventListener("click", closeShareCartModal);
  document.getElementById("share-cart-copy-btn")?.addEventListener("click", copyShareCartLink);
  document.getElementById("share-cart-modal")?.addEventListener("click", event => {
    if (event.target.id === "share-cart-modal") closeShareCartModal();
  });
  document.getElementById("shared-cart-merge-accept")?.addEventListener("click", acceptSharedCart);
  document.getElementById("shared-cart-merge-decline")?.addEventListener("click", declineSharedCart);
  document.getElementById("shared-cart-merge-close")?.addEventListener("click", declineSharedCart);
  document.getElementById("shared-cart-merge-modal")?.addEventListener("click", event => {
    if (event.target.id === "shared-cart-merge-modal") declineSharedCart();
  });
  void importSharedCart();

  const cartBtn = document.getElementById("cart-btn");
  const cartPanel = document.getElementById("cart-panel");
  const cartClose = document.getElementById("cart-close");
  const overlay = document.getElementById("overlay");

  cartBtn?.addEventListener("click", () => {
    cartPanel?.classList.add("open");
    cartPanel?.setAttribute("aria-hidden", "false");
    cartBtn?.setAttribute("aria-expanded", "true");
    overlay?.classList.add("show");
    document.body.classList.add("modal-open");
  });

  cartClose?.addEventListener("click", closeCart);
  overlay?.addEventListener("click", closeCart);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && cartPanel?.classList.contains("open")) closeCart();
  });
}

async function shareCart() {
  const button = document.getElementById("cart-share-btn");
  if (!cart.length || button?.disabled) return;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Preparando enlace...";
  try {
    const result = await createCartShare(getCart());
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("cart_share", result.token);
    const input = document.getElementById("share-cart-url");
    const status = document.getElementById("share-cart-status");
    if (input) input.value = url.href;
    if (status) status.textContent = "";
    document.getElementById("share-cart-modal")?.removeAttribute("hidden");
    document.body.classList.add("modal-open");
    input?.focus();
    input?.select();
  } catch (error) {
    if (error?.status === 401 || error?.originalError?.status === 401) {
      window.location.href = "./login-v25.html?return=checkout";
      return;
    }
    const toast = document.getElementById("toast");
    if (toast) {
      toast.textContent = error.message || "No se pudo compartir el carrito.";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 4500);
    }
  } finally {
    if (button) {
      button.disabled = !cart.length;
      button.textContent = original || "Compartir carrito";
    }
  }
}

function closeShareCartModal() {
  document.getElementById("share-cart-modal")?.setAttribute("hidden", "");
  if (!document.getElementById("cart-panel")?.classList.contains("open")) document.body.classList.remove("modal-open");
}

async function copyShareCartLink() {
  const input = document.getElementById("share-cart-url");
  const status = document.getElementById("share-cart-status");
  if (!input?.value) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(input.value);
    else { input.select(); document.execCommand("copy"); }
    if (status) status.textContent = "Enlace copiado. Ya puedes enviarlo por WhatsApp.";
  } catch {
    input.focus();
    input.select();
    if (status) status.textContent = "Selecciona el enlace y cópialo manualmente.";
  }
}

async function importSharedCart() {
  const token = new URLSearchParams(location.search).get("cart_share");
  if (!token) return;
  try {
    const result = await getCartShare(token);
    const imported = Array.isArray(result.items) ? result.items : [];
    if (!imported.length) throw new Error("El carrito compartido está vacío.");
    if (cart.length) {
      pendingSharedCart = { items: imported, token };
      const currentCount = cart.reduce((total, item) => total + Number(item.qty || 0), 0);
      const sharedCount = imported.reduce((total, item) => total + Number(item.qty || 0), 0);
      const copy = document.getElementById("shared-cart-merge-copy");
      if (copy) copy.textContent = `Ya tienes ${currentCount} producto${currentCount === 1 ? "" : "s"} en tu carrito. Si aceptas, se sumarán ${sharedCount} producto${sharedCount === 1 ? "" : "s"} del enlace.`;
      document.getElementById("shared-cart-merge-modal")?.removeAttribute("hidden");
      document.body.classList.add("modal-open");
      return;
    }
    applySharedCart(imported);
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("cart_share");
    history.replaceState({}, "", cleanUrl.href);
  } catch (error) {
    const toast = document.getElementById("toast");
    if (toast) {
      toast.textContent = error.message || "El enlace del carrito caducó o no está disponible.";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 5000);
    }
  }
}

function applySharedCart(imported) {
  const merged = [...cart];
  imported.forEach(item => {
    const existing = merged.find(current => String(current.id) === String(item.id) && String(current.category || "") === String(item.category || ""));
    if (existing) existing.qty += Number(item.qty || 1);
    else merged.push({ ...item, qty: Number(item.qty || 1) });
  });
  if (!persistCart(merged)) throw new Error("No se pudo guardar el carrito compartido.");
  cart = getCartSnapshot();
  renderCart();
  updateCartBadge();
  const toast = document.getElementById("toast");
  if (toast) {
    toast.textContent = "🛒 Te compartieron una lista de compra. Ayuda a completar este pedido desde tu cuenta.";
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 5000);
  }
}

function acceptSharedCart() {
  if (!pendingSharedCart) return;
  try {
    applySharedCart(pendingSharedCart.items);
    finishSharedCartDecision();
  } catch (error) {
    const toast = document.getElementById("toast");
    if (toast) toast.textContent = error.message || "No se pudo añadir el carrito compartido.";
  }
}

function declineSharedCart() {
  if (!pendingSharedCart) return;
  finishSharedCartDecision();
}

function finishSharedCartDecision() {
  pendingSharedCart = null;
  document.getElementById("shared-cart-merge-modal")?.setAttribute("hidden", "");
  const shareModal = document.getElementById("share-cart-modal");
  if (!shareModal || shareModal.hasAttribute("hidden")) document.body.classList.remove("modal-open");
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete("cart_share");
  history.replaceState({}, "", cleanUrl.href);
}

export function closeCart() {
  const cartPanel = document.getElementById("cart-panel");
  const cartBtn = document.getElementById("cart-btn");
  cartPanel?.classList.remove("open");
  cartPanel?.setAttribute("aria-hidden", "true");
  cartBtn?.setAttribute("aria-expanded", "false");
  const anyOpen = document.querySelector(".modal.open, #cart-panel.open");
  if (!anyOpen) {
    document.getElementById("overlay")?.classList.remove("show");
    document.body.classList.remove("modal-open");
  }
}
