import { supabase } from "../../../config/supabase.js";
import { throwIfSupabaseError } from "../../../utils/http-error.js";

export async function findOrderForCheckout(orderId, checkoutToken) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("checkout_token", checkoutToken)
    .single();
  throwIfSupabaseError(error, "No se pudo cargar la orden para TropiPay");
  return data;
}

export async function findPendingByOrder(orderId) {
  const { data, error } = await supabase
    .from("payment_transactions")
    .select("*")
    .eq("order_id", orderId)
    .eq("provider", "tropipay")
    .in("status", ["pending", "processing"])
    .maybeSingle();
  throwIfSupabaseError(error, "No se pudo comprobar el pago TropiPay existente");
  return data;
}

export async function createPayment(payload) {
  const { data, error } = await supabase.from("payment_transactions").insert(payload).select().single();
  throwIfSupabaseError(error, "No se pudo crear la transacción TropiPay");
  return data;
}

export async function findById(id) {
  const { data, error } = await supabase
    .from("payment_transactions")
    .select("*, orders(id, checkout_token, customer_id, order_reference, total, status, payment_status, printed_at)")
    .eq("id", id)
    .single();
  throwIfSupabaseError(error, "No se pudo consultar el pago");
  return data;
}

export async function findByProviderReference(reference, providerPaymentId) {
  let query = supabase.from("payment_transactions").select("*");
  query = reference ? query.eq("external_reference", reference) : query.eq("provider_payment_id", providerPaymentId);
  const { data, error } = await query.maybeSingle();
  throwIfSupabaseError(error, "No se pudo localizar la transacción TropiPay");
  return data;
}

export async function updatePayment(id, updates) {
  const { data, error } = await supabase.from("payment_transactions").update(updates).eq("id", id).select().single();
  throwIfSupabaseError(error, "No se pudo actualizar el pago TropiPay");
  return data;
}
