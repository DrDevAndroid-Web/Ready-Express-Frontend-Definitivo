const DETAIL_FIELDS = new Set(["detalles", "details"]);
const HIDDEN_ITEM_FIELDS = new Set([
  "id",
  "nombre",
  "name",
  "descripcion",
  "item",
  "cantidad",
  "quantity",
  "qty",
  "precio",
  "price",
  "costo",
  "precio_total",
  "subtotal",
  "total",
  "imagen",
  "img",
  "image",
  "image_url",
  "imagen_url",
  "category",
  "categoria",
  "tipo"
]);

export function normalizeItems(items) {
  if (Array.isArray(items)) return items;
  if (!items) return [];

  if (typeof items === "string") {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [{ nombre: items }];
    }
  }

  return [items];
}

export function getItemName(item) {
  return item?.nombre || item?.name || item?.descripcion || item?.item || "Item";
}

export function getItemQuantity(item) {
  return item?.cantidad || item?.quantity || item?.qty || 1;
}

export async function enrichComboItems(items) {
  const list = normalizeItems(items);
  const needsLookup = list.some(item => isComboItem(item) && !hasDetails(item));
  if (!needsLookup) return list;

  try {
    const { supabase } = await import("../config/supabase.js");
    const { data, error } = await supabase
      .from("food_combos")
      .select("id,nombre,detalles");

    if (error || !Array.isArray(data)) return list;

    return list.map(item => {
      if (!isComboItem(item) || hasDetails(item)) return item;
      const combo = findMatchingCombo(item, data);
      if (!combo?.detalles) return item;
      return { ...item, detalles: combo.detalles };
    });
  } catch {
    return list;
  }
}

export function getItemDetails(item) {
  const details = [];

  Object.entries(item || {}).forEach(([key, value]) => {
    if (HIDDEN_ITEM_FIELDS.has(key) || value === null || value === undefined || value === "") return;

    if (DETAIL_FIELDS.has(key)) {
      Object.entries(normalizeDetailObject(value)).forEach(([detailKey, detailValue]) => {
        details.push([detailKey, detailValue]);
      });
      return;
    }

    details.push([key, value]);
  });

  return details;
}

export function normalizeDetailObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : { detalle: value };
    } catch {
      return { detalle: value };
    }
  }
  return typeof value === "object" ? value : { detalle: value };
}

export function formatDetailValue(value) {
  if (Array.isArray(value)) return value.map(formatDetailValue).join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, data]) => `${key}: ${formatDetailValue(data)}`)
      .join("; ");
  }
  return String(value);
}

function hasDetails(item) {
  return Object.keys(normalizeDetailObject(item?.detalles || item?.details)).length > 0;
}

function isComboItem(item) {
  const id = String(item?.id || "").toLowerCase();
  const category = String(item?.categoria || item?.category || item?.tipo || "").toLowerCase();
  const name = String(getItemName(item)).toLowerCase();
  return id.includes("combo") || category.includes("combo") || /^combo\b/.test(name);
}

function findMatchingCombo(item, combos) {
  const id = normalizeKey(item?.id);
  const name = normalizeKey(getItemName(item));

  return combos.find(combo => {
    const comboId = normalizeKey(combo.id);
    const comboName = normalizeKey(combo.nombre);
    return (id && id === comboId)
      || (name && name === comboName)
      || (name && comboName && name.includes(comboName))
      || (name && comboId && name.includes(comboId));
  });
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
