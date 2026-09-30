import { supabase } from "../../config/supabase.js";
import { createBadRequest, throwIfSupabaseError } from "../../utils/http-error.js";
import { applyStoreMarkup, DEFAULT_PRICING } from "../../utils/store-pricing.js";

// El precio, el nombre y los componentes de cada artículo salen del catálogo,
// nunca del navegador: el cliente solo decide qué artículo y cuántas unidades.
const SOURCES = {
  combo: {
    table: "food_combos",
    columns: "id,nombre,precio,detalles,disponible",
    name: row => row.nombre
  },
  producto: {
    table: "Productos",
    columns: "id,nombre,precio,detalles,disponible",
    name: row => row.nombre
  },
  electro: {
    table: "Electrodomesticos",
    columns: "id,item,tipo,precio,disponible",
    name: row => [row.item, row.tipo].filter(Boolean).join(" — ")
  }
};

const normalizeName = value => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function parseComponentQuantity(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const match = String(value ?? "").match(/^\s*(\d+(?:[.,]\d+)?)/);
  return match ? Number(match[1].replace(",", ".")) : 1;
}

// Misma lógica que el catálogo del frontend (products.js → normalizeComboItems)
export function comboItemsFromRow(row) {
  const details = row?.detalles;
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  return Object.entries(details)
    .map(([nombre, cantidad]) => ({ nombre, cantidad: parseComponentQuantity(cantidad) }))
    .filter(component => component.nombre);
}

// Tablas candidatas para un artículo. Con `source` es exacta; los carritos guardados
// antes de este cambio no lo traen y se prueban las tablas verificando además el nombre.
export function candidateSources(item) {
  if (SOURCES[item?.source]) return { sources: [item.source], verifyName: false };
  const id = String(item?.id ?? "");
  if (id.startsWith("combo-")) return { sources: ["combo"], verifyName: true };
  const byCategory = normalizeName(item?.category) === "productos varios" ? ["electro", "producto"] : ["producto", "electro"];
  return { sources: ["combo", ...byCategory], verifyName: true };
}

async function fetchCatalogRows(source, ids) {
  const { table, columns } = SOURCES[source];
  const { data, error } = await supabase.from(table).select(columns).in("id", ids);
  throwIfSupabaseError(error, "No se pudo verificar el catálogo");
  return data || [];
}

const roundMoney = value => Math.round(Number(value) * 100) / 100;

// `pricing`: recargo de la tienda (configuracion_precios). El precio cobrado es el mismo
// precio final que muestra el catálogo, para todos los métodos de pago.
export async function priceItemsFromCatalog(items, { fetchRows = fetchCatalogRows, pricing = DEFAULT_PRICING } = {}) {
  const lookups = items.map(item => ({ item, ...candidateSources(item) }));

  // Una consulta por tabla con todos los ids que podrían estar en ella
  const idsBySource = new Map();
  for (const { item, sources } of lookups) {
    const id = item.id;
    if (id === undefined || id === null || id === "") {
      throw createBadRequest(`"${item.nombre}" no tiene identificador de catálogo. Vacía el carrito y vuelve a añadirlo.`);
    }
    sources.forEach(source => idsBySource.set(source, [...(idsBySource.get(source) || []), String(id)]));
  }
  const rowsBySource = new Map();
  await Promise.all([...idsBySource].map(async ([source, ids]) => {
    const rows = await fetchRows(source, [...new Set(ids)]);
    rowsBySource.set(source, new Map(rows.map(row => [String(row.id), row])));
  }));

  return lookups.map(({ item, sources, verifyName }) => {
    let match = null;
    for (const source of sources) {
      const row = rowsBySource.get(source)?.get(String(item.id));
      if (!row) continue;
      if (verifyName && normalizeName(SOURCES[source].name(row)) !== normalizeName(item.nombre)) continue;
      match = { source, row };
      break;
    }

    if (!match) {
      throw createBadRequest(`"${item.nombre}" ya no está en el catálogo. Actualiza tu carrito e inténtalo de nuevo.`);
    }
    const { source, row } = match;
    if (row.disponible === false) {
      throw createBadRequest(`"${SOURCES[source].name(row)}" ya no está disponible. Quítalo del carrito para continuar.`);
    }
    const basePrice = Number(row.precio);
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      throw createBadRequest(`"${SOURCES[source].name(row)}" no tiene precio disponible. Contáctanos por WhatsApp.`);
    }
    const precio = applyStoreMarkup(basePrice, pricing);

    const priced = {
      ...item,
      source,
      nombre: SOURCES[source].name(row) || item.nombre,
      precio,
      precio_total: roundMoney(precio * item.cantidad)
    };
    if (source === "combo") priced.combo_items = comboItemsFromRow(row);
    else delete priced.combo_items;
    return priced;
  });
}
