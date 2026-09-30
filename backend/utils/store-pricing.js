// Precio final de la tienda = precio configurado + recargo, redondeado siempre hacia arriba
// (el redondeo nunca debe dejar el precio por debajo de lo que cubre las comisiones).
// Es el mismo para todos los métodos de pago y se calcula igual en el catálogo y en el pedido.

export const ROUNDING_MODES = ["ninguno", "centimos_99", "entero"];
export const DEFAULT_PRICING = Object.freeze({ recargo_porcentaje: 0, redondeo: "centimos_99" });

export function applyStoreMarkup(basePrice, settings = DEFAULT_PRICING) {
  const base = Number(basePrice);
  const percentage = Number(settings?.recargo_porcentaje) || 0;
  // Sin recargo no se toca nada (tampoco se redondea): los precios quedan como en el catálogo
  if (!Number.isFinite(base) || base <= 0 || percentage <= 0) return base;

  // Trabajar en centavos enteros evita errores de coma flotante
  const cents = Math.ceil(Math.round(base * (100 + percentage) * 100) / 100 - 1e-9);
  if (settings.redondeo === "entero") return Math.ceil(cents / 100);
  if (settings.redondeo === "centimos_99") return (Math.ceil((cents + 1) / 100) * 100 - 1) / 100;
  return cents / 100;
}

// Copia de las filas con el precio final en `field` y el configurado en `${field}_base`
export function withStorePrices(rows, settings, field = "precio") {
  return (rows || []).map(row => row?.[field] === undefined || row?.[field] === null
    ? row
    : { ...row, [field]: applyStoreMarkup(row[field], settings), [`${field}_base`]: Number(row[field]) });
}
