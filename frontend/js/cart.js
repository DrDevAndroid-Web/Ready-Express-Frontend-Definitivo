const STORAGE_KEY = "ren_cart";

let cart = loadCart();

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
}

export function addItem(product, qty = 1) {
  const existing = cart.find((i) => String(i.id) === String(product.id) && i.category === product.category);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({ ...product, qty });
  }
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
  cart = [];
  saveCart();
  renderCart();
  updateCartBadge();
}

export function getCart() {
  return cart;
}

export function getTotal() {
  return cart.reduce((sum, i) => sum + i.precio * i.qty, 0);
}

export function getItemCount() {
  return cart.reduce((sum, i) => sum + i.qty, 0);
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

  if (!list) return;

  if (cart.length === 0) {
    list.innerHTML = "";
    if (emptyMsg) emptyMsg.style.display = "block";
    if (checkoutBtn) checkoutBtn.disabled = true;
    if (totalEl) totalEl.textContent = "$0.00";
    return;
  }

  if (emptyMsg) emptyMsg.style.display = "none";
  if (checkoutBtn) checkoutBtn.disabled = false;

  list.innerHTML = cart
    .map(
      (item, index) => `
    <div class="cart-item" data-index="${index}">
      <div class="cart-item-img">
        ${item.imagen ? `<img src="${item.imagen}" alt="">` : `<div class="img-placeholder-sm"></div>`}
      </div>
      <div class="cart-item-info">
        <p class="cart-item-name">${item.nombre}</p>
        <p class="cart-item-price">$${(item.precio * item.qty).toFixed(2)}</p>
      </div>
      <div class="cart-item-qty">
        <button class="qty-btn" data-index="${index}" data-delta="-1">−</button>
        <span>${item.qty}</span>
        <button class="qty-btn" data-index="${index}" data-delta="1">+</button>
      </div>
      <button class="cart-item-remove" data-index="${index}">✕</button>
    </div>
  `
    )
    .join("");

  list.querySelectorAll(".qty-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = cart[parseInt(btn.dataset.index)];
      if (item) updateQty(item.id, item.category, parseInt(btn.dataset.delta));
    });
  });

  list.querySelectorAll(".cart-item-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = cart[parseInt(btn.dataset.index)];
      if (item) removeItem(item.id, item.category);
    });
  });

  if (totalEl) totalEl.textContent = `$${getTotal().toFixed(2)}`;
}

export function initCart() {
  renderCart();
  updateCartBadge();

  const cartBtn = document.getElementById("cart-btn");
  const cartPanel = document.getElementById("cart-panel");
  const cartClose = document.getElementById("cart-close");
  const overlay = document.getElementById("overlay");

  cartBtn?.addEventListener("click", () => {
    cartPanel?.classList.add("open");
    overlay?.classList.add("show");
  });

  cartClose?.addEventListener("click", closeCart);
  overlay?.addEventListener("click", closeCart);
}

export function closeCart() {
  document.getElementById("cart-panel")?.classList.remove("open");
  document.getElementById("overlay")?.classList.remove("show");
}
