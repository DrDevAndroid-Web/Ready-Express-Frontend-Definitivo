import { supabase } from "../../../config/supabase.js";
import { throwIfSupabaseError } from "../../../utils/http-error.js";

export async function exists(paymentTransactionId, eventType) {
  const { data, error } = await supabase
    .from("payment_events")
    .select("id")
    .eq("payment_transaction_id", paymentTransactionId)
    .eq("event_type", eventType)
    .limit(1)
    .maybeSingle();
  throwIfSupabaseError(error, "No se pudo comprobar la idempotencia del evento");
  return Boolean(data);
}

// Devuelve null si otro proceso (webhook o conciliación) ya registró el mismo
// idempotency_key: el índice único hace de cerrojo entre ambos.
export async function record(payload) {
  let { data, error } = await supabase.from("payment_events").insert(payload).select().single();

  // Red de seguridad si falta la migración 20260923_payment_event_idempotency.sql
  if (error?.code === "PGRST204" && error.message?.includes("idempotency_key")) {
    const { idempotency_key: _omit, ...legacyPayload } = payload;
    ({ data, error } = await supabase.from("payment_events").insert(legacyPayload).select().single());
  }

  if (error?.code === "23505") return null;
  throwIfSupabaseError(error, "No se pudo guardar el evento TropiPay");
  return data;
}
