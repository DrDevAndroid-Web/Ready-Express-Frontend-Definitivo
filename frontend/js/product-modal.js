// Ficha de producto (combos y electrodomésticos) en un <dialog> nativo: foco atrapado y Esc.
// En móvil es una hoja inferior. Bloquea el scroll de fondo fijando el body (en iOS
// overflow:hidden no basta) y el botón "atrás" del móvil la cierra en vez de salir.

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const ICON_CLOSE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const MAX_QTY = 99;

let current = null;
let lockedScrollY = 0;

function lockScroll() {
  lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  const body = document.body;
  body.classList.add("product-modal-open");
  body.style.position = "fixed";
  body.style.top = `-${lockedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
}

function unlockScroll() {
  const body = document.body;
  body.classList.remove("product-modal-open");
  ["position", "top", "left", "right", "width"].forEach(prop => body.style.removeProperty(prop));
  // html tiene scroll-behavior:smooth: se desactiva un momento para volver sin animación
  const html = document.documentElement;
  const previous = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  void body.offsetHeight; // WebKit: recalcular el alto antes de desplazar (si no, se queda en 0)
  window.scrollTo(0, lockedScrollY);
  html.style.scrollBehavior = previous;
}

function featuresHtml(features) {
  if (!features.length) return "";
  return `
    <section class="product-modal__section">
      <h3 class="product-modal__subtitle">Características</h3>
      <dl class="product-modal__specs">
        ${features.map(f => `<div><dt>${escapeHtml(f.nombre)}</dt><dd>${escapeHtml(f.valor || "—")}</dd></div>`).join("")}
      </dl>
    </section>`;
}

function componentsHtml(components) {
  if (!components.length) return "";
  return `
    <section class="product-modal__section">
      <h3 class="product-modal__subtitle">Incluye <span class="product-modal__count">${components.length} ${components.length === 1 ? "artículo" : "artículos"}</span></h3>
      <ul class="product-modal__components">
        ${components.map(c => `<li><span>${escapeHtml(c.nombre)}</span>${c.valor ? `<span class="product-modal__qty-tag">${escapeHtml(c.valor)}</span>` : ""}</li>`).join("")}
      </ul>
    </section>`;
}

function money(value) {
  return `$${Number(value).toFixed(2)}`;
}

/**
 * @param {object} options
 * @param {object} options.product  producto tal como se agrega al carrito
 * @param {{ descripcion?: string, componentes?: Array<{nombre:string,valor?:string}>, caracteristicas?: Array<{nombre:string,valor?:string}> }} [options.ficha]
 * @param {(product: object, qty: number) => void} options.onAdd
 * @param {string} [options.whatsappUrl] para productos sin precio
 */
export function openProductModal({ product, ficha = {}, onAdd, whatsappUrl = "" }) {
  if (current) return current;

  const hasPrice = Number(product.precio) > 0;
  const titleId = `product-modal-title-${Date.now()}`;
  const dialog = document.createElement("dialog");
  dialog.className = "product-modal";
  dialog.setAttribute("aria-labelledby", titleId);

  const descripcion = String(ficha.descripcion || "").trim();
  dialog.innerHTML = `
    <div class="product-modal__sheet">
      <span class="product-modal__grabber" aria-hidden="true"></span>
      <button type="button" class="product-modal__close" aria-label="Cerrar" data-close>${ICON_CLOSE}</button>
      <div class="product-modal__body" tabindex="-1" autofocus>
        <div class="product-modal__media">
          ${product.imagen
            ? `<img src="${escapeHtml(product.imagen)}" alt="${escapeHtml(product.nombre)}" decoding="async">`
            : `<div class="img-placeholder"><span>📦</span><small>Imagen próximamente</small></div>`}
        </div>
        <div class="product-modal__info">
          ${product.category ? `<span class="product-modal__chip">${escapeHtml(product.category)}</span>` : ""}
          <h2 class="product-modal__title" id="${titleId}">${escapeHtml(product.nombre)}</h2>
          <p class="product-modal__price">${hasPrice ? money(product.precio) : "Consultar precio"}</p>
          ${descripcion ? `<p class="product-modal__desc">${escapeHtml(descripcion)}</p>` : ""}
          ${componentsHtml(ficha.componentes || [])}
          ${featuresHtml(ficha.caracteristicas || [])}
        </div>
      </div>
      <div class="product-modal__footer">
        ${hasPrice ? `
          <div class="qty-selector product-modal__qty" role="group" aria-label="Cantidad">
            <button type="button" class="qty-btn-card" data-qty="-1" aria-label="Reducir cantidad">−</button>
            <span class="qty-display" aria-live="polite">1</span>
            <button type="button" class="qty-btn-card" data-qty="1" aria-label="Aumentar cantidad">+</button>
          </div>
          <button type="button" class="add-btn product-modal__add" data-add>Agregar · <span data-total>${money(product.precio)}</span></button>`
        : `<a class="add-btn product-modal__add" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener">Consultar por WhatsApp</a>`}
      </div>
    </div>`;

  const opener = document.activeElement;
  let qty = 1;
  let historyPushed = false;
  let closed = false;

  const qtyEl = dialog.querySelector(".qty-display");
  const totalEl = dialog.querySelector("[data-total]");
  const minusBtn = dialog.querySelector('[data-qty="-1"]');
  const renderQty = () => {
    if (qtyEl) qtyEl.textContent = String(qty);
    if (totalEl) totalEl.textContent = money(qty * Number(product.precio));
    if (minusBtn) minusBtn.disabled = qty <= 1;
  };

  function finish() {
    if (closed) return;
    closed = true;
    window.removeEventListener("popstate", onPopState);
    if (dialog.open) dialog.close();
    dialog.remove();
    unlockScroll();
    if (current === ctrl) current = null;
    opener?.focus?.({ preventScroll: true });
  }

  function onPopState() {
    historyPushed = false;
    finish();
  }

  const ctrl = {
    // Con una entrada propia en el historial se cierra con history.back() para no dejarla
    // colgando; popstate llama a finish().
    close() {
      if (historyPushed) history.back();
      else finish();
    }
  };

  dialog.addEventListener("click", event => {
    if (event.target === dialog) return ctrl.close(); // toque en el fondo
    const qtyBtn = event.target.closest("[data-qty]");
    if (qtyBtn) {
      qty = Math.min(MAX_QTY, Math.max(1, qty + Number(qtyBtn.dataset.qty)));
      renderQty();
      return;
    }
    if (event.target.closest("[data-close]")) return ctrl.close();
    if (event.target.closest("[data-add]")) {
      const added = qty;
      ctrl.close();
      onAdd?.(product, added);
    }
  });
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    ctrl.close();
  });

  const img = dialog.querySelector(".product-modal__media img");
  img?.addEventListener("error", () => {
    img.parentElement.innerHTML = '<div class="img-placeholder"><span>📦</span><small>Imagen no disponible</small></div>';
  }, { once: true });

  // El historial va antes de fijar el body: Safari guarda la posición de scroll de la
  // entrada al hacer pushState y la restaura con history.back(); con el body fijado sería 0.
  try {
    history.pushState({ productModal: true }, "");
    historyPushed = true;
    window.addEventListener("popstate", onPopState);
  } catch {
    // Sin historial (iframe restringido): se cierra igual con la X, Esc o el fondo
  }

  document.body.appendChild(dialog);
  lockScroll();
  renderQty();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else {
    dialog.setAttribute("open", "");
    dialog.classList.add("is-fallback");
  }
  dialog.querySelector(".product-modal__body").scrollTop = 0;

  current = ctrl;
  return ctrl;
}
