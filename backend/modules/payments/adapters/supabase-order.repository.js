import { supabase } from "../../../config/supabase.js";
import { throwIfSupabaseError } from "../../../utils/http-error.js";

export async function findPrintState(orderId) {
  const { data, error } = await supabase.from("orders").select("id, printed_at, status, payment_status").eq("id", orderId).single();
  throwIfSupabaseError(error, "No se pudo cargar el estado de impresión");
  return data;
}

export async function updatePaymentState(orderId, status, orderStatus) {
  const { error } = await supabase.from("orders").update({ payment_status: status, status: orderStatus }).eq("id", orderId);
  throwIfSupabaseError(error, "No se pudo actualizar el estado de la orden");
}

export async function markPrinted(orderId) {
  const { error } = await supabase.from("orders").update({ printed_at: new Date().toISOString() }).eq("id", orderId);
  throwIfSupabaseError(error, "No se pudo marcar la orden como impresa");
}
