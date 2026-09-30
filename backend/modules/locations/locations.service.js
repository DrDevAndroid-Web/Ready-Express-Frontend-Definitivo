import { supabase } from "../../config/supabase.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import { createBadRequest, createConflict, createNotFound, throwIfSupabaseError } from "../../utils/http-error.js";

const TABLE = "precios_localizacion";
let realtimeChannel = null;

export async function listLocations({ includeInactive = false } = {}) {
  let query = supabase.from(TABLE).select("*").order("orden", { ascending: true }).order("municipio", { ascending: true });
  if (!includeInactive) query = query.eq("activo", true);
  const { data, error } = await query;
  throwIfSupabaseError(error, "No se pudieron cargar las localizaciones");
  return data || [];
}

export async function getDeliveryLocation(id) {
  const locationId = String(id || "").trim();
  if (!locationId) throw createBadRequest("La localizacion de entrega es requerida");
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", locationId).eq("activo", true).maybeSingle();
  throwIfSupabaseError(error, "No se pudo validar la localizacion de entrega");
  if (!data) throw createNotFound("La localizacion de entrega no esta disponible");
  return data;
}

export async function createLocation(input = {}) {
  const payload = normalizeLocation(input);
  await assertMunicipalityAvailable(payload.municipio);
  if (payload.es_base) await assertNoBase();
  const { data, error } = await supabase.from(TABLE).insert(payload).select().single();
  throwIfSupabaseError(error, "No se pudo crear la localizacion");
  NotificationManager.broadcastLocationChanged();
  return data;
}

export async function updateLocation(id, input = {}) {
  const location = await findLocation(id);
  const payload = normalizeLocation(input, location);
  if (payload.municipio.toLowerCase() !== String(location.municipio).toLowerCase()) {
    await assertMunicipalityAvailable(payload.municipio, location.id);
  }
  if (location.es_base && (!payload.es_base || payload.recargo !== 0)) {
    throw createBadRequest("Guantanamo debe mantenerse como localizacion base con recargo cero");
  }
  if (payload.es_base && !location.es_base) await assertNoBase(location.id);
  const { data, error } = await supabase.from(TABLE).update(payload).eq("id", location.id).select().single();
  throwIfSupabaseError(error, "No se pudo actualizar la localizacion");
  NotificationManager.broadcastLocationChanged();
  return data;
}

export async function deleteLocation(id) {
  const location = await findLocation(id);
  if (location.es_base) throw createBadRequest("No se puede eliminar Guantanamo porque es la localizacion base");
  const { error } = await supabase.from(TABLE).delete().eq("id", location.id);
  throwIfSupabaseError(error, "No se pudo eliminar la localizacion");
  NotificationManager.broadcastLocationChanged();
  return { ok: true, id: location.id };
}

export function startLocationRealtime() {
  if (realtimeChannel) return realtimeChannel;
  realtimeChannel = supabase
    .channel("precios-localizacion-backend")
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, () => {
      NotificationManager.broadcastLocationChanged();
    })
    .subscribe(status => console.log(`[localizaciones:realtime] ${status}`));
  return realtimeChannel;
}

async function findLocation(id) {
  const locationId = String(id || "").trim();
  if (!locationId) throw createBadRequest("El id de la localizacion es requerido");
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", locationId).maybeSingle();
  throwIfSupabaseError(error, "No se pudo cargar la localizacion");
  if (!data) throw createNotFound("Localizacion no encontrada");
  return data;
}

async function assertMunicipalityAvailable(municipio, ignoreId = null) {
  // ilike sin comodines: comparación exacta sin distinguir mayúsculas ("%" o "_" no deben casar con otros)
  const exact = String(municipio ?? "").replace(/[\\%_]/g, "\\$&");
  const { data, error } = await supabase.from(TABLE).select("id").ilike("municipio", exact).limit(1).maybeSingle();
  throwIfSupabaseError(error, "No se pudo validar el municipio");
  if (data && String(data.id) !== String(ignoreId || "")) throw createConflict("Ya existe una localizacion con ese municipio");
}

async function assertNoBase(ignoreId = null) {
  const { data, error } = await supabase.from(TABLE).select("id").eq("es_base", true).limit(1).maybeSingle();
  throwIfSupabaseError(error, "No se pudo validar la localizacion base");
  if (data && String(data.id) !== String(ignoreId || "")) throw createConflict("Ya existe una localizacion base");
}

function normalizeLocation(input, current = {}) {
  const municipio = String(input.municipio ?? current.municipio ?? "").trim();
  const recargo = Number(input.recargo ?? current.recargo ?? 0);
  const orden = Number(input.orden ?? current.orden ?? 0);
  const activo = input.activo === undefined ? current.activo !== false : Boolean(input.activo);
  const esBase = input.es_base === undefined ? Boolean(current.es_base) : Boolean(input.es_base);
  if (!municipio) throw createBadRequest("El municipio es requerido");
  if (!Number.isFinite(recargo) || recargo < 0) throw createBadRequest("El recargo debe ser un numero mayor o igual que cero");
  if (!Number.isInteger(orden) || orden < 0) throw createBadRequest("El orden debe ser un entero mayor o igual que cero");
  if (esBase && recargo !== 0) throw createBadRequest("La localizacion base debe tener recargo cero");
  return { municipio, recargo, orden, activo, es_base: esBase };
}
