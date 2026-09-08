import crypto from "crypto";
import { compressImage } from "../../utils/image.js";
import { uploadImage } from "../storage/storage.service.js";
import { assertSupabaseServiceRole, supabase, supabaseKeyInfo } from "../../config/supabase.js";
import { sendPrintableOrderEmail } from "../email/resend.js";
import { notifyPaymentReceived, notifyPaymentApproved, notifyPaymentRejected } from "../telegram/telegram.service.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import { createBadRequest, createConflict, createNotFound, throwIfSupabaseError } from "../../utils/http-error.js";

const PAYMENT_METHODS = new Set(["Zelle", "TocoPay"]);

export async function processPayment(file, orderId, method, expectedAmount) {
  if (!file?.buffer) throw createBadRequest("Debes adjuntar una imagen del comprobante");
  if (!orderId) throw createBadRequest("La orden es requerida");

  // Normalizar método (trim y validar)
  const normalizedMethod = method?.trim();
  console.log("[payments:debug]", { method, normalizedMethod, valid: PAYMENT_METHODS.has(normalizedMethod) });

  if (!normalizedMethod || !PAYMENT_METHODS.has(normalizedMethod)) {
    throw createBadRequest(`Metodo de pago no valido. Metodos soportados: ${Array.from(PAYMENT_METHODS).join(", ")}`);
  }

  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    throw createBadRequest("El monto del pago debe ser un numero mayor que cero");
  }

  const order = await getOrderByIdSafe(orderId);
  if (!order) throw createNotFound("La orden indicada no existe");

  const orderTotal = Number(order.total);
  if (!Number.isFinite(orderTotal) || Math.abs(orderTotal - expectedAmount) > 0.01) {
    throw createBadRequest("El monto del pago no coincide con el total de la orden");
  }

  // 1. Comprimir imagen
  const compressed = await compressImage(file.buffer);

  // 2. Hash MD5 anti-duplicados
  const hash = crypto.createHash("md5").update(compressed).digest("hex");

  // 3. Verificar si ya existe un comprobante con el mismo hash
  const { data: existing, error: existingError } = await supabase
    .from("payments")
    .select("id")
    .eq("image_hash", hash)
    .maybeSingle();

  throwIfSupabaseError(existingError, "No se pudo verificar si el comprobante ya existe");

  if (existing) {
    throw createConflict("Este comprobante ya fue enviado anteriormente");
  }

  // 4. Subir imagen a Supabase Storage
  const path = await uploadImage(compressed, `${Date.now()}.jpg`);

  // 5 + 6. Insertar pago y actualizar orden en paralelo
  const [paymentResult, orderResult] = await Promise.all([
    supabase
      .from("payments")
      .insert({
        order_id: orderId,
        method: normalizedMethod,
        amount: expectedAmount,
        image_url: path,
        image_hash: hash,
        validation_status: "pending_review"
      })
      .select("id, order_id, method, amount, image_url, created_at")
      .single(),
    supabase
      .from("orders")
      .update({ status: "payment_review" })
      .eq("id", orderId)
  ]);

  throwIfSupabaseError(paymentResult.error, "No se pudo registrar el pago");
  throwIfSupabaseError(orderResult.error, "No se pudo actualizar la orden a revision de pago");

  // 7. Enviar notificación SSE al dashboard (APK admin) + Telegram
  const paymentId = paymentResult.data?.id;
  if (paymentId) {
    const paymentData = {
      id: paymentId,
      order_id: paymentResult.data.order_id,
      method: paymentResult.data.method,
      amount: paymentResult.data.amount,
      image_url: paymentResult.data.image_url,
      created_at: paymentResult.data.created_at,
      sender_name: order.sender_name || order.customer_name
    };
    NotificationManager.broadcastPaymentReceived(paymentData);
    notifyPaymentReceived(order, paymentResult.data).catch(err =>
      console.error("[telegram:payment_received]", err?.message || err)
    );
  }

  return {
    status: "pending_review",
    message: "Comprobante recibido, en revisión"
  };
}

export async function getPendingPayments() {
  assertSupabaseServiceRole();
  const { data, error } = await supabase
    .from("payments")
    .select(`
      id,
      order_id,
      method,
      amount,
      image_url,
      validation_status,
      created_at,
      orders (
        customer_name,
        customer_email,
        customer_phone,
        customer_address,
        sender_name,
        sender_phone,
        receiver_name,
        receiver_phone,
        delivery_notes,
        items,
        total,
        status,
        created_at
      )
    `)
    .eq("validation_status", "pending_review")
    .order("created_at", { ascending: false });

  throwIfSupabaseError(error, "No se pudieron cargar los pagos pendientes");
  await logPaymentDiagnosticsIfEmpty("pending_review", data);
  return (data ?? []).map(payment => ({
    ...payment,
    image_url: getPaymentImageUrl(payment.image_url)
  }));
}

export async function getApprovedPayments() {
  assertSupabaseServiceRole();
  const { data, error } = await supabase
    .from("payments")
    .select(`
      id,
      order_id,
      method,
      amount,
      image_url,
      validation_status,
      created_at,
      orders (
        customer_name,
        customer_email,
        customer_phone,
        customer_address,
        sender_name,
        sender_phone,
        receiver_name,
        receiver_phone,
        delivery_notes,
        items,
        total,
        status,
        created_at
      )
    `)
    .eq("validation_status", "approved")
    .order("created_at", { ascending: false });

  throwIfSupabaseError(error, "No se pudieron cargar los pagos aprobados");
  await logPaymentDiagnosticsIfEmpty("approved", data);
  return (data ?? []).map(payment => ({
    ...payment,
    image_url: getPaymentImageUrl(payment.image_url)
  }));
}

export function getPaymentImageUrl(imageUrl) {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;

  const { data } = supabase.storage
    .from("payments")
    .getPublicUrl(imageUrl);

  return data.publicUrl;
}

async function logPaymentDiagnosticsIfEmpty(status, data) {
  if ((data ?? []).length) return;

  const { count: total, error: totalError } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true });

  const { data: statuses, error: statusesError } = await supabase
    .from("payments")
    .select("validation_status")
    .limit(50);

  const statusCounts = (statuses ?? []).reduce((acc, row) => {
    const key = row.validation_status || "null";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.warn("[payments:diagnostic:empty]", {
    requestedStatus: status,
    supabaseRef: supabaseKeyInfo.ref || "desconocido",
    keyRole: supabaseKeyInfo.role || "desconocido",
    serviceRole: supabaseKeyInfo.isServiceRole,
    totalPayments: total ?? null,
    statusCounts,
    totalError: totalError?.message || null,
    statusesError: statusesError?.message || null
  });
}

export async function verifyPayment(paymentId, action) {
  if (!paymentId) throw createBadRequest("El pago es requerido");
  if (!["approve", "reject"].includes(action)) {
    throw createBadRequest("Accion de verificacion no valida");
  }

  const validationStatus = action === "approve" ? "approved" : "rejected";
  const orderStatus = action === "approve" ? "paid" : "payment_rejected";

  const { data: currentPayment, error: currentError } = await supabase
    .from("payments")
    .select("order_id, validation_status")
    .eq("id", paymentId)
    .single();

  throwIfSupabaseError(currentError, "No se pudo cargar el pago");
  if (!currentPayment?.order_id) throw createNotFound("No se encontro la orden asociada al pago");

  if (currentPayment.validation_status === validationStatus) {
    return {
      status: validationStatus,
      message: action === "approve"
        ? "El pago ya estaba aprobado; no se envio otra impresion"
        : "El pago ya estaba rechazado",
      printEmailSent: false,
      printEmailError: null
    };
  }

  // 1. Actualizar pago
  const { data: payment, error } = await supabase
    .from("payments")
    .update({ validation_status: validationStatus })
    .eq("id", paymentId)
    .select("order_id")
    .single();

  throwIfSupabaseError(error, "No se pudo actualizar el pago");
  if (!payment?.order_id) throw createNotFound("No se encontro la orden asociada al pago");

  // 2. Actualizar orden
  const { error: orderError } = await supabase
    .from("orders")
    .update({ status: orderStatus })
    .eq("id", payment.order_id);

  throwIfSupabaseError(orderError, "No se pudo actualizar el estado de la orden");

  let printEmailSent = false;
  let printEmailError = null;

  if (action === "approve") {
    try {
      const order = await getOrderById(payment.order_id);
      await sendPrintableOrderEmail(order);
      printEmailSent = true;

      NotificationManager.broadcastPaymentApproved(paymentId, payment.order_id);
      notifyPaymentApproved(order).catch(err =>
        console.error("[telegram:payment_approved]", err?.message || err)
      );
    } catch (err) {
      printEmailError = err.message;
      console.error("Error enviando orden a impresora:", err);
    }
  } else {
    NotificationManager.broadcastPaymentRejected(paymentId, payment.order_id, "Comprobante rechazado por el administrador");
    getOrderById(payment.order_id)
      .then(order => notifyPaymentRejected(order))
      .catch(err => console.error("[telegram:payment_rejected]", err?.message || err));
  }

  return {
    status: validationStatus,
    message: getVerifyPaymentMessage(action, printEmailSent, printEmailError),
    printEmailSent,
    printEmailError
  };
}

async function getOrderById(orderId) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  throwIfSupabaseError(error, "No se pudo cargar la orden");
  return data;
}

async function getOrderByIdSafe(orderId) {
  const { data, error } = await supabase
    .from("orders")
    .select("id,total,status,customer_name,sender_name")
    .eq("id", orderId)
    .maybeSingle();

  throwIfSupabaseError(error, "No se pudo verificar la orden");
  return data;
}

function getVerifyPaymentMessage(action, printEmailSent, printEmailError) {
  if (action !== "approve") return "Pago rechazado";
  if (printEmailSent) return "Pago aprobado y orden enviada a imprimir";
  return `Pago aprobado, pero no se pudo enviar a imprimir: ${printEmailError || "error desconocido"}`;
}
