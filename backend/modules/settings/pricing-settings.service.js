import { supabase } from "../../config/supabase.js";
import { createBadRequest, throwIfSupabaseError } from "../../utils/http-error.js";
import { getCached, invalidateCache, PUBLIC_CACHE_KEYS } from "../../utils/public-cache.js";
import { DEFAULT_PRICING, ROUNDING_MODES } from "../../utils/store-pricing.js";

const TABLE = "configuracion_precios";
const CACHE_KEY = "public:pricing-settings";
const COLUMNS = "recargo_porcentaje, redondeo, updated_at";

async function loadSettings() {
  const { data, error } = await supabase.from(TABLE).select(COLUMNS).eq("id", 1).maybeSingle();
  // Red de seguridad si el backend se despliega antes que 20260930_store_pricing_settings.sql
  if (error && (error.code === "42P01" || error.code === "PGRST205")) {
    console.error("[precios] Falta la migración de configuración de precios; se usa recargo 0");
    return { ...DEFAULT_PRICING };
  }
  throwIfSupabaseError(error, "No se pudo cargar la configuración de precios");
  return data ? { ...data, recargo_porcentaje: Number(data.recargo_porcentaje) } : { ...DEFAULT_PRICING };
}

export function getPricingSettings() {
  return getCached(CACHE_KEY, loadSettings, 30_000);
}

export async function updatePricingSettings(input = {}, userId = null) {
  const percentage = Number(input.recargo_porcentaje);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 50) {
    throw createBadRequest("El recargo debe ser un porcentaje entre 0 y 50");
  }
  const rounding = String(input.redondeo || "");
  if (!ROUNDING_MODES.includes(rounding)) throw createBadRequest("Tipo de redondeo no válido");

  const { data, error } = await supabase
    .from(TABLE)
    .upsert({ id: 1, recargo_porcentaje: Math.round(percentage * 100) / 100, redondeo: rounding, updated_at: new Date().toISOString(), updated_by: userId })
    .select(COLUMNS)
    .single();
  throwIfSupabaseError(error, "No se pudo guardar la configuración de precios");

  // Los precios públicos se recalculan en la siguiente petición
  invalidateCache(CACHE_KEY, PUBLIC_CACHE_KEYS.catalog, PUBLIC_CACHE_KEYS.foodCombos, PUBLIC_CACHE_KEYS.products, PUBLIC_CACHE_KEYS.appliances, PUBLIC_CACHE_KEYS.locations);
  return { ...data, recargo_porcentaje: Number(data.recargo_porcentaje) };
}
