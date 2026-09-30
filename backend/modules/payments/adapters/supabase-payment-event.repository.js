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

export async function record(payload) {
  const { data, error } = await supabase.from("payment_events").insert(payload).select().single();
  throwIfSupabaseError(error, "No se pudo guardar el evento TropiPay");
  return data;
}
