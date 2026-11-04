import { supabase } from "../../../config/supabase.js";
import { throwIfSupabaseError } from "../../../utils/http-error.js";

const PUBLIC_COLUMNS = Object.freeze({
  food_combos: "id,nombre,precio,img,detalles,disponible",
  Productos: "id,nombre,precio,img,detalles,categoria,disponible",
  // La tabla histórica usa `item` (no `nombre`) para el nombre del electrodoméstico.
  // Mantener el nombre real aquí evita que la consulta administrativa falle con 42703.
  Electrodomesticos: "id,item,tipo,precio,img,descripcion,caracteristicas,disponible"
});

export function list(table) {
  return supabase.from(table).select(PUBLIC_COLUMNS[table] || "id,nombre,precio,img,disponible");
}
export function listPublic(table, columns) { return supabase.from(table).select(columns).eq("disponible", true); }
export async function insert(table, payload, message) { const { data, error } = await supabase.from(table).insert(payload).select(); throwIfSupabaseError(error, message); return data; }
export async function update(table, id, payload, message) { const { data, error } = await supabase.from(table).update(payload).eq("id", id).select(); throwIfSupabaseError(error, message); return data; }
export async function remove(table, id, message) { const { error } = await supabase.from(table).delete().eq("id", id); throwIfSupabaseError(error, message); }
export async function imageUrl(table, id, message) { const { data, error } = await supabase.from(table).select("img").eq("id", id).maybeSingle(); throwIfSupabaseError(error, message); return data?.img || null; }
export async function idExists(table, id, message) { const { data, error } = await supabase.from(table).select("id").eq("id", id).maybeSingle(); throwIfSupabaseError(error, message); return Boolean(data); }
export async function nextId(table, message) { const { data, error } = await supabase.from(table).select("id").order("id", { ascending: false }).limit(1).maybeSingle(); throwIfSupabaseError(error, message); return Number(data?.id || 0) + 1; }
export async function getInfo() {
  const { data, error } = await supabase.from("informacion_cambiante").select("*");
  if (error) return { data, error };

  // La tabla histórica no tiene una migración local que documente todas sus
  // columnas. Conservamos la consulta para compatibilidad, pero filtramos la
  // respuesta antes de que llegue al endpoint público.
  const publicKeys = [
    "id", "horario", "schedule", "telefono", "phone", "whatsapp",
    "direccion", "address", "email", "instagram", "facebook"
  ];
  return {
    data: (data || []).map(row => Object.fromEntries(
      publicKeys.filter(key => Object.prototype.hasOwnProperty.call(row, key)).map(key => [key, row[key]])
    )),
    error: null
  };
}

export async function getPaymentMethods() {
  const { data, error } = await supabase
    .from("payment_methods")
    .select("id,method_name,account_number,instructions,image_url,is_active,order_index")
    .eq("is_active", true)
    .order("order_index", { ascending: true });
  if (error) return [];
  return data || [];
}
