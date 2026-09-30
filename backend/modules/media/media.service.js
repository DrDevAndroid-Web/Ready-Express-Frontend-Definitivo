import sharp from "sharp";
import { createHash } from "node:crypto";
import { supabase } from "../../config/supabase.js";
import { createBadRequest, createConflict, createNotFound, throwIfSupabaseError } from "../../utils/http-error.js";

const DELIVERY_BUCKET = process.env.DELIVERY_CONFIRMATIONS_BUCKET || "delivery-confirmations";

export async function uploadDeliveryConfirmation(orderId, file, uploadedBy) {
  if (!file?.buffer) throw createBadRequest("La foto de entrega es requerida");
  if (!String(file.mimetype || "").startsWith("image/")) throw createBadRequest("La evidencia debe ser una imagen");
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, order_reference, customer_id")
    .eq("id", orderId)
    .single();
  throwIfSupabaseError(orderError, "No se pudo cargar la orden");
  if (!order) throw createNotFound("Orden no encontrada");
  const { data: payment, error: paymentError } = await supabase
    .from("payment_transactions")
    .select("id, order_id, provider, status")
    .eq("order_id", orderId)
    .eq("provider", "tropipay")
    .eq("status", "successful")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfSupabaseError(paymentError, "No se pudo verificar el pago TropiPay de la orden");
  if (!payment) throw createConflict("La orden no tiene un pago TropiPay exitoso asociado");
  const { data: existing, error: existingError } = await supabase
    .from("delivery_confirmations")
    .select("id, status")
    .eq("payment_transaction_id", payment.id)
    .maybeSingle();
  throwIfSupabaseError(existingError, "No se pudo comprobar la evidencia existente");
  if (existing) throw createConflict("El pago TropiPay ya tiene una evidencia de entrega");
  const webp = await sharp(file.buffer).rotate().webp({ quality: 82 }).toBuffer();
  const checksum = createHash("sha256").update(webp).digest("hex");
  const objectPath = `${orderId}/${Date.now()}-${checksum.slice(0, 12)}.webp`;
  const { error: uploadError } = await supabase.storage.from(DELIVERY_BUCKET).upload(objectPath, webp, { contentType: "image/webp", upsert: false });
  throwIfSupabaseError(uploadError, "No se pudo guardar la foto de entrega");
  const { data, error } = await supabase.from("delivery_confirmations").insert({ payment_transaction_id: payment.id, order_id: orderId, bucket_name: DELIVERY_BUCKET, object_path: objectPath, mime_type: "image/webp", file_size: webp.length, checksum, uploaded_by: uploadedBy || null, status: "pending" }).select().single();
  if (error) {
    await supabase.storage.from(DELIVERY_BUCKET).remove([objectPath]);
    throwIfSupabaseError(error, "No se pudo registrar la foto de entrega");
  }
  return { ...data, order_reference: order.order_reference };
}

export async function getDeliveryConfirmationUrl(orderId) {
  const { data, error } = await supabase.from("delivery_confirmations").select("*").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  throwIfSupabaseError(error, "No se pudo cargar la evidencia de entrega");
  if (!data) throw createNotFound("Esta orden no tiene evidencia de entrega");
  const { data: signed, error: signedError } = await supabase.storage.from(data.bucket_name).createSignedUrl(data.object_path, 600);
  throwIfSupabaseError(signedError, "No se pudo generar la URL de la evidencia");
  return { ...data, signed_url: signed.signedUrl };
}

export async function getPaymentDeliveryConfirmationUrl(paymentTransactionId) {
  if (!paymentTransactionId) throw createBadRequest("La transacción es requerida");
  const { data, error } = await supabase
    .from("delivery_confirmations")
    .select("*, payment_transactions!inner(id, order_id, provider, status)")
    .eq("payment_transaction_id", paymentTransactionId)
    .eq("payment_transactions.provider", "tropipay")
    .maybeSingle();
  throwIfSupabaseError(error, "No se pudo cargar la evidencia de entrega");
  if (!data) throw createNotFound("Esta transacción no tiene evidencia de entrega");
  const { data: signed, error: signedError } = await supabase.storage.from(data.bucket_name).createSignedUrl(data.object_path, 600);
  throwIfSupabaseError(signedError, "No se pudo generar la URL de la evidencia");
  return { ...data, signed_url: signed.signedUrl, signed_url_expires_in: 600 };
}

export async function updateDeliveryConfirmationStatus(orderId, status, notes = null) {
  if (!["pending", "delivered", "rejected"].includes(status)) throw createBadRequest("Estado de entrega no válido");
  const { data: current, error: currentError } = await supabase.from("delivery_confirmations").select("id").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  throwIfSupabaseError(currentError, "No se pudo cargar la evidencia de entrega");
  if (!current) throw createNotFound("Esta orden no tiene evidencia de entrega");
  const patch = { status, notes: notes || null, verified_at: status === "delivered" ? new Date().toISOString() : null };
  const { data, error } = await supabase.from("delivery_confirmations").update(patch).eq("id", current.id).select().single();
  throwIfSupabaseError(error, "No se pudo actualizar la evidencia de entrega");
  const { error: orderError } = await supabase.from("orders").update({ delivery_status: status }).eq("id", orderId);
  throwIfSupabaseError(orderError, "No se pudo actualizar el estado de entrega");
  return data;
}
