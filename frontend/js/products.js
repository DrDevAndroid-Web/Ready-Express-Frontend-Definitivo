import { getProductos, getInfo, getCombos, getElectrodomesticos } from "./api.js?v11";
import { addItem } from "./cart.js?v12";

const ICON_MAP = {
  // Combos
  combos: "🍱", combo: "🍱",
  // Carnes y proteínas
  carnes: "🥩", proteinas: "🥩", proteina: "🥩", pollo: "🍗",
  // Embutidos y lácteos
  "embutidos y lacteos": "🥛", lacteos: "🥛", lacticos: "🥛",
  // Condimentos y aceites
  condimentos: "🧂", aceites: "🫒", aceite: "🫒",
  // Conservas
  "conservas y enlatados": "🥫", conservas: "🥫",
  // Pastas y granos
  pastas: "🍝", granos: "🍚", legumbres: "🍚",
  // Bebidas
  bebidas: "🥤",
  // Aseo y limpieza
  aseo: "🧹", limpieza: "🧹",
  // Varios / miscelánea
  otros: "📦", viveres: "🛒",
  // Electrodomésticos
  electrodomesticos: "⚡",
};

function getIcon(cat = "") {
  const k = cat.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return ICON_MAP[k] || "📦";
}

function parseDetalles(val) {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.join(" • ");
  if (typeof val === "object") {
    const items = Object.entries(val)
      .filter(([_, v]) => v)
      .map(([k, v]) => `<li>${k} ${v}</li>`)
      .join("");
    return items ? `<ul class="product-details-list">${items}</ul>` : "";
  }
  return String(val);
}

function normalize(item, defaultCategory) {
  // Parsear items del combo si existen
  const items = item.items || item.productos || [];
  const itemsText = Array.isArray(items) && items.length > 0
    ? items.map(i => {
        const nombre = i.nombre || i.name || i.item || "";
        const cantidad = i.cantidad || i.qty || i.quantity || 1;
        return `${cantidad}x ${nombre}`;
      }).join(", ")
    : "";

  const descripcion = parseDetalles(item.descripcion || item.description || item.detalle || item.detalles);
  const descFinal = itemsText ? (descripcion ? `${descripcion} └─ ${itemsText}` : itemsText) : descripcion;

  return {
    id: item.id,
    category: (item.categoria || item.category || defaultCategory || "General").trim(),
    nombre: item.nombre || item.name || item.titulo || "Sin nombre",
    precio: parseFloat(item.precio || item.price || item.costo || 0),
    descripcion: descFinal,
    imagen: item.img || item.imagen || item.imagen_url || item.image || item.image_url || null,
    disponible: item.disponible !== false,
  };
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

function renderCard(product) {
  const dataAttr = JSON.stringify(product).replace(/"/g, "&quot;");
  const priceDisplay = product.precio > 0 ? `$${product.precio.toFixed(2)}` : "Consultar precio";
  return `
    <div class="product-card">
      <div class="product-img">
        ${product.imagen
          ? `<img src="${product.imagen}" alt="${product.nombre}" loading="lazy">`
          : `<div class="img-placeholder"><span>📦</span><small>Imagen próximamente</small></div>`}
      </div>
      <div class="product-info">
        <h3 class="product-name">${product.nombre}</h3>
        ${product.descripcion ? `<div class="product-desc">${product.descripcion}</div>` : ""}
        <p class="product-price">${priceDisplay}</p>
        <div class="card-actions">
          <div class="qty-selector">
            <button class="qty-btn-card" onclick="window.changeQty(this,-1)" aria-label="Reducir cantidad">−</button>
            <span class="qty-display">1</span>
            <button class="qty-btn-card" onclick="window.changeQty(this,1)" aria-label="Aumentar cantidad">+</button>
          </div>
          <button class="add-btn" onclick="window.addToCart(${dataAttr},this)">Agregar</button>
        </div>
      </div>
    </div>`;
}

/* ════════ Combos section ════════ */
async function loadCombos() {
  const grid = document.getElementById("combos-grid");
  const errorEl = document.getElementById("combos-error");
  if (!grid) return;

  if (errorEl) errorEl.style.display = "none";
  grid.innerHTML = renderSkeleton(4);

  try {
    const raw = await getCombos();
    const data = raw?.data ?? raw ?? [];
    const items = data.map((i) => normalize(i, "Combos")).filter((i) => i.disponible);

    if (!items.length) {
      grid.innerHTML = `<div class="empty-state"><span>🍱</span><p>No hay combos disponibles en este momento</p></div>`;
      return;
    }
    grid.innerHTML = items.map(renderCard).join("");
  } catch (err) {
    grid.innerHTML = "";
    if (errorEl) {
      errorEl.style.display = "block";
      errorEl.textContent = "⚠️ No pudimos cargar los combos. Verifica tu conexión a internet o intenta de nuevo en unos momentos.";
    }
  }
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
  grid.innerHTML = products.map(renderCard).join("");
}

function applySearch(query) {
  const q = query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const results = allProducts.filter(p => {
    const nombre = (p.nombre || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const desc = (p.descripcion || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return nombre.includes(q) || desc.includes(q);
  });
  renderProductGrid(results);
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
  renderProductGrid(grouped[activeCategory] || []);
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
    `<button class="tab-btn${i === 0 ? " active" : ""}" data-category="${cat}">
      ${getIcon(cat)} ${cat}
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

async function loadProducts() {
  const grid = document.getElementById("products-grid");
  const errorEl = document.getElementById("products-error");
  if (!grid) return;

  if (errorEl) errorEl.style.display = "none";
  grid.innerHTML = renderSkeleton(6);

  try {
    const raw = await getProductos();
    const data = raw?.data ?? raw ?? [];
    const items = data.map((i) => normalize(i)).filter((i) => i.disponible);

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
        banner.innerHTML = parts.map((p) => `<span class="info-item">${p}</span>`).join("");
        banner.style.display = "flex";
      }
    }

    const phone = info.whatsapp || info.telefono || info.phone;
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
async function loadElectro() {
  const grid = document.getElementById("electro-grid");
  const errorEl = document.getElementById("electro-error");
  if (!grid) return;

  if (errorEl) errorEl.style.display = "none";
  grid.innerHTML = renderSkeleton(4);

  try {
    const raw = await getElectrodomesticos();
    const data = raw?.data ?? raw ?? [];
    const items = data
      .filter((i) => i.disponible !== false)
      .map((i) => ({
        id: i.id,
        category: "Productos Varios",
        nombre: [i.item, i.tipo].filter(Boolean).join(" — "),
        precio: parseFloat(i.precio || 0),
        descripcion: i.tipo || "",
        imagen: i.img || null,
        disponible: i.disponible !== false,
      }));

    if (!items.length) {
      grid.innerHTML = `<div class="empty-state"><span>⚡</span><p>No hay productos varios disponibles en este momento</p></div>`;
      return;
    }
    grid.innerHTML = items.map(renderCard).join("");
  } catch (err) {
    grid.innerHTML = "";
    if (errorEl) {
      errorEl.style.display = "block";
      errorEl.textContent = "⚠️ No pudimos cargar los productos varios. Verifica tu conexión a internet o intenta de nuevo en unos momentos.";
    }
  }
}

export function initProducts() {
  loadInfoBanner();
  loadCombos();
  loadProducts();
  loadElectro();
}

/* ════════ Global helpers for inline onclick ════════ */
window.changeQty = (btn, delta) => {
  const display = btn.parentElement.querySelector(".qty-display");
  if (!display) return;
  const next = Math.max(1, parseInt(display.textContent) + delta);
  display.textContent = next;
};

window.addToCart = (product, btn) => {
  if (product.precio <= 0) {
    alert("⚠️ Este producto no tiene precio disponible. Contáctanos por WhatsApp para más información: +53 5 8324155");
    return;
  }
  const qtyDisplay = btn.closest(".card-actions")?.querySelector(".qty-display");
  const qty = parseInt(qtyDisplay?.textContent || "1");
  addItem(product, qty);
  if (qtyDisplay) qtyDisplay.textContent = "1";
};
