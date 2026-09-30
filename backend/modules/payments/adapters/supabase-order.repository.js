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

// Datos de facturación del perfil del cliente (customer_id de la orden = auth_user_id)
export async function findCustomerBilling(authUserId) {
  const { data, error } = await supabase
    .from("customer_profiles")
    .select("pais_iso, direccion_facturacion, ciudad, estado_region, codigo_postal, fecha_nacimiento, terminos_tropipay_at")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  throwIfSupabaseError(error, "No se pudieron cargar los datos de facturación del cliente");
  return data;
}

export async function updatePayerDetails(orderId, payerDetails) {
  const { error } = await supabase.from("orders").update({ payer_details: payerDetails }).eq("id", orderId);
  throwIfSupabaseError(error, "No se pudieron guardar los datos del pagador");
}

export async function markPrinted(orderId) {
  const { error } = await supabase.from("orders").update({ printed_at: new Date().toISOString() }).eq("id", orderId);
  throwIfSupabaseError(error, "No se pudo marcar la orden como impresa");
}
