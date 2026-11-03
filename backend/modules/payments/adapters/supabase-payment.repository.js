import { supabase } from "../../../config/supabase.js";
import { throwIfSupabaseError } from "../../../utils/http-error.js";

// El acceso (checkout_token o cliente propietario) lo comprueba el caso de uso
export async function findOrderById(orderId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  throwIfSupabaseError(error, "No se pudo cargar la orden para TropiPay");
  return data;
}

export async function countByOrder(orderId) {
  const { count, error } = await supabase
    .from("payment_transactions")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("provider", "tropipay");
  throwIfSupabaseError(error, "No se pudieron contar los intentos de pago");
  return count || 0;
}

// El enlace abierto más reciente. Una fila "processing" sin enlace (la llamada a TropiPay
// se cortó) no cuenta: con .maybeSingle() sobre varias filas la orden quedaba bloqueada.
export async function findPendingByOrder(orderId) {
  const { data, error } = await supabase
    .from("payment_transactions")
    .select("*")
    .eq("order_id", orderId)
    .eq("provider", "tropipay")
    .in("status", ["pending", "processing"])
    .not("payment_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfSupabaseError(error, "No se pudo comprobar el pago TropiPay existente");
  return data;
}

// Pagos con enlace que aún pueden haberse cobrado sin que llegara el webhook
export async function findReconcilable({ since, before, limit = 50 }) {
  const { data, error } = await supabase
    .from("payment_transactions")
    .select("*, orders(id, checkout_token, customer_id, order_reference, total, status, payment_status, printed_at)")
    .eq("provider", "tropipay")
    .in("status", ["pending", "processing", "failed"])
    .not("provider_payment_id", "is", null)
    .gte("created_at", since)
    .lte("created_at", before)
    .order("created_at", { ascending: true })
    .limit(limit);
  throwIfSupabaseError(error, "No se pudieron cargar los pagos TropiPay por conciliar");
  return data || [];
}

// Transacciones que se quedaron en "processing" sin enlace (la creación se cortó a medias)
export async function failStaleWithoutLink({ before }) {
  const { data, error } = await supabase
    .from("payment_transactions")
    .update({ status: "failed", raw_payload: { source: "reconcile", message: "La creación del enlace no terminó" }, updated_at: new Date().toISOString() })
    .eq("provider", "tropipay")
    .eq("status", "processing")
    .is("provider_payment_id", null)
    .lte("created_at", before)
    .select("id");
  throwIfSupabaseError(error, "No se pudieron cerrar los pagos TropiPay sin enlace");
  return data || [];
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
  if (providerPaymentId) {
    const byProvider = await supabase
      .from("payment_transactions")
      .select("*")
      .eq("provider_payment_id", providerPaymentId)
      .maybeSingle();
    throwIfSupabaseError(byProvider.error, "No se pudo localizar la transacción TropiPay");
    if (byProvider.data) {
      // Si llegan ambos identificadores, deben describir la misma transacción.
      if (reference && byProvider.data.external_reference !== reference) return null;
      return byProvider.data;
    }
  }

  if (!reference) return null;
  const byReference = await supabase
    .from("payment_transactions")
    .select("*")
    .eq("external_reference", reference)
    .maybeSingle();
  throwIfSupabaseError(byReference.error, "No se pudo localizar la transacción TropiPay");
  return byReference.data || null;
}

export async function updatePayment(id, updates) {
  const { data, error } = await supabase.from("payment_transactions").update(updates).eq("id", id).select().single();
  throwIfSupabaseError(error, "No se pudo actualizar el pago TropiPay");
  return data;
}
