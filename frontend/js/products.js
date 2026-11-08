import { getCatalog, getInfo } from "./api.js?v58";
import { addItem } from "./cart.js?v58";
import { openProductModal } from "./product-modal.js?v58";

const CONTACT_WHATSAPP = "5356189395";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

const ICON_MAP = {
  // Combos
  combos: "fa-box-open", combo: "fa-box-open",
  // Carnes y proteínas
  carnes: "fa-drumstick-bite", proteinas: "fa-drumstick-bite", proteina: "fa-drumstick-bite", pollo: "fa-drumstick-bite",
  // Embutidos y lácteos
  "embutidos y lacteos": "fa-cheese", lacteos: "fa-cheese", lacticos: "fa-cheese",
  // Condimentos y aceites
  condimentos: "fa-mortar-pestle", aceites: "fa-bottle-droplet", aceite: "fa-bottle-droplet",
  // Conservas
  "conservas y enlatados": "fa-box", conservas: "fa-box",
  // Pastas y granos
  pastas: "fa-bowl-food", granos: "fa-wheat-awn", legumbres: "fa-wheat-awn",
  // Bebidas
  bebidas: "fa-bottle-water",
  // Aseo y limpieza
  aseo: "fa-pump-soap", limpieza: "fa-pump-soap",
  // Varios / miscelánea
  otros: "fa-box", viveres: "fa-basket-shopping",
  // Electrodomésticos
  electrodomesticos: "fa-plug-circle-bolt",
};

function getIcon(cat = "") {
  const k = cat.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return `<i class="fa-solid ${ICON_MAP[k] || "fa-box"}" aria-hidden="true"></i>`;
}

const CATALOG_PAGE_SIZE = 8;
let visibleProductCount = CATALOG_PAGE_SIZE;
let renderedProducts = [];
let visibleElectroCount = CATALOG_PAGE_SIZE;
let renderedElectro = [];
let allCombos = [];
let allElectro = [];

function parseDetalles(val) {
  if (!val) return "";
  if (typeof val === "string") return escapeHtml(val);
  if (Array.isArray(val)) return val.map(escapeHtml).join(" • ");
  if (typeof val === "object") {
    const items = Object.entries(val)
      .filter(([_, v]) => v)
      .map(([k, v]) => `<li>${escapeHtml(k)} ${escapeHtml(v)}</li>`)
      .join("");
    return items ? `<ul class="product-details-list">${items}</ul>` : "";
  }
  return escapeHtml(String(val));
}

function parseComponentQuantity(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const match = String(value ?? "").match(/^\s*(\d+(?:[.,]\d+)?)/);
  return match ? Number(match[1].replace(",", ".")) : 1;
}

function normalizeComboItems(item) {
  const raw = item.items || item.productos || item.componentes;
  if (Array.isArray(raw)) {
    return raw.map(component => ({
      nombre: component.nombre || component.name || component.item || component.producto || "",
      cantidad: parseComponentQuantity(component.cantidad ?? component.quantity ?? component.qty ?? 1),
    })).filter(component => component.nombre && Number.isFinite(component.cantidad) && component.cantidad > 0);
  }
  const details = item.detalles;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return Object.entries(details).map(([nombre, cantidad]) => ({
      nombre,
      cantidad: parseComponentQuantity(cantidad),
    })).filter(component => component.nombre);
  }
  return [];
}

function normalize(item, defaultCategory) {
  // Parsear items del combo si existen
  const items = normalizeComboItems(item);
  const itemsText = Array.isArray(items) && items.length > 0
    ? items.map(i => {
        const nombre = i.nombre || i.name || i.item || "";
        const cantidad = i.cantidad || i.qty || i.quantity || 1;
        return escapeHtml(`${cantidad}x ${nombre}`);
      }).join(", ")
    : "";

  const descripcion = parseDetalles(item.descripcion || item.description || item.detalle || item.detalles);
  // `detalles` ya se renderiza como lista. No repitas los mismos componentes
  // en una segunda linea: `combo_items` se conserva para checkout y facturas.
  const descFinal = descripcion || itemsText;

  return {
    id: item.id,
    category: (item.categoria || item.category || defaultCategory || "General").trim(),
    nombre: item.nombre || item.name || item.titulo || "Sin nombre",
    precio: parseFloat(item.precio || item.price || item.costo || 0),
    descripcion: descFinal,
    combo_items: items,
    imagen: item.img || item.imagen || item.imagen_url || item.image || item.image_url || null,
    disponible: item.disponible !== false,
  };
}

// Ficha que muestra el modal, guardada aparte para no inflar el carrito ni el pedido.
// clave "source:id" → { product, ficha }
const detailRegistry = new Map();

function detailKey(product) {
  return `${product.source}:${product.id}`;
}

function comboComponents(item) {
  const details = item.detalles;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return Object.entries(details)
      .map(([nombre, valor]) => ({ nombre: String(nombre).trim(), valor: String(valor ?? "").trim() }))
      .filter(component => component.nombre);
  }
  return normalizeComboItems(item).map(component => ({ nombre: component.nombre, valor: String(component.cantidad) }));
}

function electroFeatures(item) {
  const raw = item.caracteristicas;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(feature => ({ nombre: String(feature?.nombre ?? "").trim(), valor: String(feature?.valor ?? "").trim() }))
    .filter(feature => feature.nombre);
}

function registerDetail(product, ficha) {
  detailRegistry.set(detailKey(product), { product, ficha });
}

function openDetail(key) {
  const entry = detailRegistry.get(key);
  if (!entry) return;
  openProductModal({
    product: entry.product,
    ficha: entry.ficha,
    whatsappUrl: `https://wa.me/${CONTACT_WHATSAPP}?text=${encodeURIComponent(`Hola, quiero consultar el precio de: ${entry.product.nombre}`)}`,
    onAdd: (product, qty) => addItem(product, qty)
  });
}

function bindDetailGrid(grid) {
  if (!grid || grid.dataset.detailBound) return;
  grid.dataset.detailBound = "1";
  grid.addEventListener("click", event => {
    const opener = event.target.closest("[data-detail]");
    if (opener && grid.contains(opener)) openDetail(opener.dataset.detail);
  });
}

function renderSkeleton(count = 6) {
  return Array(count).fill(0).map(() => `
    <div class="product-card skeleton">
      <div class="product-img skeleton-box"></div>
      <div class="product-info">
        <div class="skeleton-line" style="width:70%"></div>
        <div class="skeleton-line" style="width:40%"></div>
        <div class="skeleton-line" style="width:90%;height:12px"></div>
      </div>
    </div>`).join("");
}

const selectedQuantities = new Map();

function renderCard(product, { detail = false, eager = false } = {}) {
  const dataAttr = escapeHtml(JSON.stringify(product));
  const priceDisplay = product.precio > 0 ? `$${product.precio.toFixed(2)}` : "Consultar precio";
  const key = detail ? escapeHtml(detailKey(product)) : "";
  const media = product.imagen
    ? `<img src="${escapeHtml(product.imagen)}" alt="${escapeHtml(product.nombre)}" loading="${eager ? "eager" : "lazy"}" decoding="async">`
    : `<div class="img-placeholder"><span>📦</span><small>Imagen próximamente</small></div>`;
  // La imagen abre la ficha con el ratón o el dedo; para teclado y lector de pantalla
  // el botón accesible es el nombre (así no hay dos paradas de tabulación iguales).
  return `
    <div class="product-card${detail ? " has-detail" : ""}" data-quantity-key="${escapeHtml(detailKey(product))}">
      ${detail
        ? `<button type="button" class="product-img product-open" data-detail="${key}" tabindex="-1" aria-hidden="true">
            ${media}
            <span class="product-open-hint"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>Ver detalles</span>
          </button>`
        : `<div class="product-img">${media}</div>`}
      <div class="product-info">
        <h3 class="product-name">${detail
          ? `<button type="button" class="product-name-btn" data-detail="${key}" aria-haspopup="dialog">${escapeHtml(product.nombre)}</button>`
          : escapeHtml(product.nombre)}</h3>
        ${product.descripcion ? `<div class="product-desc">${product.descripcion}</div>` : ""}
        <p class="product-price">${priceDisplay}</p>
        <div class="card-actions">
          <div class="qty-selector">
            <button class="qty-btn-card" onclick="window.changeQty(this,-1)" aria-label="Reducir cantidad">−</button>
            <span class="qty-display">${selectedQuantities.get(detailKey(product)) || 1}</span>
            <button class="qty-btn-card" onclick="window.changeQty(this,1)" aria-label="Aumentar cantidad">+</button>
          </div>
          <button class="add-btn" aria-label="Agregar ${escapeHtml(product.nombre || "producto")} al carrito" onclick="window.addToCart(${dataAttr},this)">Agregar al carrito</button>
        </div>
      </div>
    </div>`;
}

/* ════════ Combos section ════════ */
async function loadCombos(source = null) {
  const grid = document.getElementById("combos-grid");
  const errorEl = document.getElementById("combos-error");
  if (!grid) return;

  if (errorEl) errorEl.style.display = "none";
  grid.innerHTML = renderSkeleton(4);

  try {
    const data = Array.isArray(source) ? source : [];
    const items = data
      .filter((i) => i.disponible !== false)
      .map((i) => {
        const product = { ...normalize(i, "Combos"), source: "combo" };
        registerDetail(product, { componentes: comboComponents(i) });
        return product;
      });

    allCombos = items;

    if (!items.length) {
      grid.innerHTML = `<div class="empty-state"><span>🍱</span><p>No hay combos disponibles en este momento</p></div>`;
      return;
    }
    renderComboItems(items);
  } catch (err) {
    grid.innerHTML = "";
    if (errorEl) {
      errorEl.style.display = "block";
      errorEl.textContent = "⚠️ No pudimos cargar los combos. Verifica tu conexión a internet o intenta de nuevo en unos momentos.";
    }
  }
}

function renderComboItems(items) {
  const grid = document.getElementById("combos-grid");
  if (!grid) return;
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state"><span>🍱</span><p>No se encontraron combos</p></div>`;
    return;
  }
  grid.innerHTML = items.map((item, index) => renderCard(item, { detail: true, eager: index < 4 })).join("");
  bindDetailGrid(grid);
}

/* ════════ Productos section (grouped by categoria) ════════ */
let grouped = {};
let allProducts = [];
let activeCategory = "";

function showCategory(cat) {
  activeCategory = cat;
  const searchInput = document.getElementById("products-search");
  const query = searchInput ? searchInput.value.trim() : "";
  if (query) {
    applySearch(query);
  } else {
    renderProductGrid(grouped[cat] || []);
  }
}

function renderProductGrid(products) {
  const grid = document.getElementById("products-grid");
  if (!grid) return;
  if (!products.length) {
    grid.innerHTML = `<div class="empty-state"><span>🛒</span><p>No se encontraron productos</p></div>`;
    return;
  }
  renderedProducts = products;
  visibleProductCount = CATALOG_PAGE_SIZE;
  renderVisibleProducts();
}

function renderVisibleProducts() {
  const grid = document.getElementById("products-grid");
  const more = document.getElementById("products-load-more");
  if (!grid) return;
  grid.innerHTML = renderedProducts.slice(0, visibleProductCount).map(renderCard).join("");
  if (more) more.hidden = visibleProductCount >= renderedProducts.length;
}

function initCatalogPagination() {
  document.getElementById("products-load-more")?.addEventListener("click", () => {
    visibleProductCount += CATALOG_PAGE_SIZE;
    renderVisibleProducts();
  });
  document.getElementById("electro-load-more")?.addEventListener("click", () => {
    visibleElectroCount += CATALOG_PAGE_SIZE;
    renderVisibleElectro();
  });
}

function applySearch(query) {
  const q = query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const matches = p => {
    const haystack = [p.nombre, p.descripcion, p.category, ...(p.combo_items || []).map(item => item.nombre)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
    return haystack.includes(q);
  };
  renderComboItems(allCombos.filter(matches));
  renderProductGrid(allProducts.filter(matches));
  renderElectroItems(allElectro.filter(matches));
}

function resetToFirstTab() {
  const tabsEl = document.querySelector(".tabs");
  tabsEl?.classList.remove("search-active");
  const firstTab = tabsEl?.querySelector(".tab-btn");
  if (firstTab) {
    tabsEl.querySelectorAll(".tab-btn").forEach(t => t.classList.remove("active"));
    firstTab.classList.add("active");
    activeCategory = firstTab.dataset.category;
  }
  renderComboItems(allCombos);
  renderProductGrid(grouped[activeCategory] || []);
  renderElectroItems(allElectro);
}

function handleSearchInput(query, clearBtn) {
  const tabsEl = document.querySelector(".tabs");
  if (query) {
    tabsEl?.classList.add("search-active");
    applySearch(query);
  } else {
    resetToFirstTab();
  }
  if (clearBtn) clearBtn.style.display = query ? "block" : "none";
}

function initProductSearch() {
  const input = document.getElementById("products-search");
  const clearBtn = document.getElementById("products-search-clear");
  const mobileInput = document.getElementById("mobile-nav-search");

  if (input) {
    input.addEventListener("input", () => {
      const query = input.value.trim();
      if (mobileInput) mobileInput.value = input.value;
      handleSearchInput(query, clearBtn);
    });

    clearBtn?.addEventListener("click", () => {
      input.value = "";
      if (mobileInput) mobileInput.value = "";
      resetToFirstTab();
      clearBtn.style.display = "none";
      input.focus();
    });
  }

  const mobileForm = document.getElementById("mobile-nav-search-form");
  if (mobileForm && mobileInput) {
    mobileForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const query = mobileInput.value.trim();
      if (!query) return;
      if (input) input.value = mobileInput.value;
      handleSearchInput(query, clearBtn);
      // cerrar menú y saltar a la sección
      document.getElementById("mobile-nav")?.classList.remove("active");
      document.getElementById("menu-btn")?.setAttribute("aria-expanded", "false");
      document.getElementById("bottom-menu-btn") && document.getElementById("menu-btn")?.setAttribute("aria-expanded", "false");
      document.getElementById("alimentos")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function buildTabs(cats) {
  const tabsEl = document.querySelector(".tabs");
  if (!tabsEl || !cats.length) return;

  tabsEl.innerHTML = cats.map((cat, i) =>
    `<button class="tab-btn${i === 0 ? " active" : ""}" data-category="${escapeHtml(cat)}">
      ${getIcon(cat)} ${escapeHtml(cat)}
    </button>`
  ).join("");

  tabsEl.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const searchInput = document.getElementById("products-search");
      const mobileInput = document.getElementById("mobile-nav-search");
      const clearBtn = document.getElementById("products-search-clear");
      if (searchInput) searchInput.value = "";
      if (mobileInput) mobileInput.value = "";
      if (clearBtn) clearBtn.style.display = "none";
      tabsEl.classList.remove("search-active");
      tabsEl.querySelectorAll(".tab-btn").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      showCategory(btn.dataset.category);
    });
  });
}

async function loadProducts(source = null) {
  const grid = document.getElementById("products-grid");
  const errorEl = document.getElementById("products-error");
  if (!grid) return;

  if (errorEl) errorEl.style.display = "none";
  grid.innerHTML = renderSkeleton(6);

  try {
    const data = Array.isArray(source) ? source : [];
    const items = data.map((i) => ({ ...normalize(i), source: "producto" })).filter((i) => i.disponible);

    if (!items.length) {
      grid.innerHTML = `<div class="empty-state"><span>🛒</span><p>No hay productos disponibles en este momento</p></div>`;
      return;
    }

    allProducts = items;
    grouped = items.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {});

    const cats = Object.keys(grouped);
    buildTabs(cats);
    showCategory(cats[0]);
    initProductSearch();
  } catch (err) {
    grid.innerHTML = "";
    if (errorEl) {
      errorEl.style.display = "block";
      errorEl.textContent = "⚠️ No pudimos cargar los productos. Verifica tu conexión a internet o intenta de nuevo en unos momentos.";
    }
  }
}

/* ════════ Info banner + WhatsApp links ════════ */
async function loadInfoBanner() {
  try {
    const raw = await getInfo();
    const data = raw?.data ?? raw ?? [];
    if (!data.length) return;

    const info = data[0];
    const banner = document.getElementById("info-banner");
    if (banner) {
      const parts = [];
      if (info.horario || info.schedule) parts.push(`🕒 ${info.horario || info.schedule}`);
      if (info.telefono || info.phone) parts.push(`📞 ${info.telefono || info.phone}`);
      if (info.anuncio || info.announcement) parts.push(`📢 ${info.anuncio || info.announcement}`);
      if (info.direccion || info.address) parts.push(`📍 ${info.direccion || info.address}`);
      if (parts.length) {
        banner.innerHTML = parts.map((p) => `<span class="info-item">${escapeHtml(p)}</span>`).join("");
        banner.style.display = "flex";
      }
    }

    const phone = CONTACT_WHATSAPP || info.whatsapp || info.telefono || info.phone;
    if (phone) {
      const clean = phone.replace(/\D/g, "");
      document.querySelectorAll("[data-whatsapp]").forEach((el) => {
        el.href = `https://wa.me/${clean}`;
      });
    }
  } catch {
    // Info banner is optional - fail silently
  }
}

/* ════════ Productos Varios (Electrodomesticos) section ════════ */
async function loadElectro(source = null) {
  const grid = document.getElementById("electro-grid");
  const errorEl = document.getElementById("electro-error");
  if (!grid) return;

  if (errorEl) errorEl.style.display = "none";
  grid.innerHTML = renderSkeleton(4);

  try {
    const data = Array.isArray(source) ? source : [];
    const items = data
      .filter((i) => i.disponible !== false)
      .map((i) => {
        const product = {
          id: i.id,
          source: "electro",
          category: "Productos Varios",
          nombre: [i.item, i.tipo].filter(Boolean).join(" — "),
          precio: parseFloat(i.precio || 0),
          descripcion: i.tipo || "",
          imagen: i.img || null,
          disponible: i.disponible !== false,
        };
        registerDetail(product, { descripcion: i.descripcion || "", caracteristicas: electroFeatures(i) });
        return product;
      });

    allElectro = items;

    if (!items.length) {
      grid.innerHTML = `<div class="empty-state"><span>⚡</span><p>No hay productos varios disponibles en este momento</p></div>`;
      return;
    }
    renderElectroItems(items);
  } catch (err) {
    grid.innerHTML = "";
    if (errorEl) {
      errorEl.style.display = "block";
      errorEl.textContent = "⚠️ No pudimos cargar los productos varios. Verifica tu conexión a internet o intenta de nuevo en unos momentos.";
    }
  }
}

export function initProducts() {
  initCatalogPagination();
  loadInfoBanner();
  loadCatalog();
}

function renderVisibleElectro() {
  const grid = document.getElementById("electro-grid");
  const more = document.getElementById("electro-load-more");
  if (!grid) return;
  grid.innerHTML = renderedElectro.slice(0, visibleElectroCount).map(item => renderCard(item, { detail: true })).join("");
  bindDetailGrid(grid);
  if (more) more.hidden = visibleElectroCount >= renderedElectro.length;
}

function renderElectroItems(items) {
  const grid = document.getElementById("electro-grid");
  if (!grid) return;
  renderedElectro = items;
  visibleElectroCount = CATALOG_PAGE_SIZE;
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state"><span>⚡</span><p>No se encontraron productos varios</p></div>`;
    const more = document.getElementById("electro-load-more");
    if (more) more.hidden = true;
    return;
  }
  renderVisibleElectro();
}

async function loadCatalog() {
  try {
    const raw = await getCatalog();
    const catalog = raw?.data ?? raw ?? {};
    await Promise.all([
      loadCombos(catalog.combos),
      loadProducts(catalog.productos),
      loadElectro(catalog.electrodomesticos)
    ]);
  } catch {
    ["combos-error", "products-error", "electro-error"].forEach(id => {
      const node = document.getElementById(id);
      if (node) {
        node.style.display = "block";
        node.textContent = "⚠️ No pudimos cargar el catálogo. Intenta nuevamente en unos momentos.";
      }
    });
    ["combos-grid", "products-grid", "electro-grid"].forEach(id => {
      const node = document.getElementById(id);
      if (node) node.innerHTML = "";
    });
  }
}

/* ════════ Global helpers for inline onclick ════════ */
window.changeQty = (btn, delta) => {
  const display = btn.parentElement.querySelector(".qty-display");
  if (!display) return;
  const next = Math.max(1, parseInt(display.textContent) + delta);
  display.textContent = next;
  const key = btn.closest(".product-card")?.dataset.quantityKey;
  if (key) selectedQuantities.set(key, next);
};

window.addToCart = (product, btn) => {
  if (product.precio <= 0) {
    alert("⚠️ Este producto no tiene precio disponible. Contáctanos por WhatsApp para más información: +53 56189395");
    return;
  }
  const qtyDisplay = btn.closest(".card-actions")?.querySelector(".qty-display");
  const qty = parseInt(qtyDisplay?.textContent || "1");
  addItem(product, qty);
  if (qtyDisplay) qtyDisplay.textContent = "1";
  selectedQuantities.delete(detailKey(product));
};
