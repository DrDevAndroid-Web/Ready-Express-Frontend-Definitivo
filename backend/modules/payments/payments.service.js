import crypto, { randomUUID } from "crypto";
import { compressImage } from "../../utils/image.js";
import { uploadImage } from "../storage/storage.service.js";
import { assertSupabaseServiceRole, supabase, supabaseKeyInfo } from "../../config/supabase.js";
import { sendPrintableOrderEmail } from "../email/resend.js";
import { notifyPaymentReceived, notifyPaymentApproved, notifyPaymentRejected } from "../telegram/telegram.service.js";
import { NotificationManager } from "../notifications/notifications.service.js";
import { createBadRequest, createConflict, createNotFound, throwIfSupabaseError } from "../../utils/http-error.js";
import { assertOrderAccess } from "../orders/orders.service.js";
import { qualifyReferralForOrder } from "../referrals/referral.qualification.service.js";

// Estados en los que la orden acepta un comprobante (reintento tras un rechazo incluido)
const ORDER_STATUSES_ACCEPTING_PROOF = ["pending", "payment_rejected"];

// Métodos con subida de comprobante: los activos en la tabla payment_methods (el admin
// puede crear nuevos desde el dashboard). Si la tabla no responde, se usan los históricos.
const DEFAULT_PROOF_METHODS = ["Zelle", "TocoPay"];
const PROOF_METHODS_TTL_MS = 60_000;
let proofMethodsCache = { names: null, loadedAt: 0 };

export function proofMethodNames(rows) {
  const names = (rows || [])
    .filter(row => row?.is_active !== false)
    .filter(row => {
      const flow = row?.payment_flow || "proof_upload";
      return flow === "proof_upload" && !String(row?.method_name || "").toLowerCase().includes("tropipay");
    })
    .map(row => String(row.method_name || "").trim())
    .filter(Boolean);
  return names.length ? names : DEFAULT_PROOF_METHODS;
}

async function getAcceptedProofMethods() {
  if (proofMethodsCache.names && Date.now() - proofMethodsCache.loadedAt < PROOF_METHODS_TTL_MS) return proofMethodsCache.names;
  try {
    const { data, error } = await supabase.from("payment_methods").select("*").eq("is_active", true);
    if (error) throw error;
    proofMethodsCache = { names: proofMethodNames(data), loadedAt: Date.now() };
  } catch (err) {
    console.error("[payments] No se pudieron cargar los métodos de pago; se usan los predeterminados:", err.message);
    // También se cachea el fallo para no repetir una consulta lenta en cada subida
    proofMethodsCache = { names: proofMethodsCache.names || DEFAULT_PROOF_METHODS, loadedAt: Date.now() };
  }
  return proofMethodsCache.names;
}

export async function processPayment(file, orderId, method, expectedAmount, access = {}) {
  if (!file?.buffer) throw createBadRequest("Debes adjuntar una imagen del comprobante");
  if (!orderId) throw createBadRequest("La orden es requerida");

  // Normalizar método (trim y validar)
  const normalizedMethod = method?.trim();

  const acceptedMethods = await getAcceptedProofMethods();
  const canonicalMethod = acceptedMethods.find(name => name.toLowerCase() === String(normalizedMethod || "").toLowerCase());
  if (!canonicalMethod) {
    throw createBadRequest(`Metodo de pago no valido. Metodos soportados: ${acceptedMethods.join(", ")}`);
  }

  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    throw createBadRequest("El monto del pago debe ser un numero mayor que cero");
  }

  if (!access.checkoutToken && !access.customerId && !access.isAdmin) {
    throw createBadRequest("Falta el codigo de tu pedido (checkout_token). Abre el pago desde el mismo navegador donde creaste el pedido.");
  }

  const order = await getOrderByIdSafe(orderId);
  // 404 también cuando no es tuyo, para no revelar qué órdenes existen
  assertOrderAccess(order, access);
  if (!ORDER_STATUSES_ACCEPTING_PROOF.includes(order.status)) {
    throw createConflict("Esta orden ya no admite comprobantes: ya fue pagada, cancelada o esta en revision");
  }

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
  // Nombre aleatorio: los comprobantes no deben poder adivinarse
  const path = await uploadImage(compressed, `${randomUUID()}.jpg`);

  // 5 + 6. Insertar pago y actualizar orden en paralelo
  const [paymentResult, orderResult] = await Promise.all([
    supabase
      .from("payments")
      .insert({
        order_id: orderId,
        method: canonicalMethod,
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
      .in("status", ORDER_STATUSES_ACCEPTING_PROOF)
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
      image_url: await getPaymentImageUrl(paymentResult.data.image_url),
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

export async function getPendingPayments(limit = 100, offset = 0) {
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
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  throwIfSupabaseError(error, "No se pudieron cargar los pagos pendientes");
  await logPaymentDiagnosticsIfEmpty("pending_review", data);
  return withSignedPaymentImages(data);
}

// Solo una orden nueva, sin comprobantes enviados, puede abrirse automáticamente
// en la pantalla de subida. Una orden rechazada debe quedar visible en la cuenta,
// pero no debe secuestrar la entrada normal a la tienda.
export function isAutoResumableCustomerPayment(order, payments = []) {
  return String(order?.status || "").toLowerCase() === "pending" && payments.length === 0;
}

// Devuelve la orden manual más reciente que el cliente todavía puede completar.
// El checkout_token nunca sale de este endpoint: un cliente autenticado puede subir
// el comprobante usando su customer_id, incluso si cambió de dispositivo.
export async function getCustomerPendingPayment(customerId) {
  assertSupabaseServiceRole();
  if (!customerId) return null;

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, order_reference, items, total, status, created_at")
    .eq("customer_id", customerId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);

  throwIfSupabaseError(ordersError, "No se pudo consultar el comprobante pendiente");
  if (!orders?.length) return null;

  const orderIds = orders.map(order => order.id).filter(Boolean);
  const { data: payments, error: paymentsError } = await supabase
    .from("payments")
    .select("order_id, method, validation_status, created_at")
    .in("order_id", orderIds)
    .order("created_at", { ascending: false });

  throwIfSupabaseError(paymentsError, "No se pudo consultar el comprobante pendiente");

  const paymentsByOrder = new Map();
  for (const payment of payments ?? []) {
    const list = paymentsByOrder.get(payment.order_id) ?? [];
    list.push(payment);
    paymentsByOrder.set(payment.order_id, list);
  }

  for (const order of orders) {
    const orderPayments = paymentsByOrder.get(order.id) ?? [];
    if (!isAutoResumableCustomerPayment(order, orderPayments)) continue;

    const latestPayment = orderPayments[0];
    return {
      order_id: order.id,
      order_reference: order.order_reference,
      items: order.items ?? [],
      total: order.total,
      method: latestPayment?.method ?? "",
      status: order.status,
      created_at: order.created_at
    };
  }

  return null;
}

export async function getApprovedPayments(limit = 100, offset = 0, { includeImage = true } = {}) {
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
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  throwIfSupabaseError(error, "No se pudieron cargar los pagos aprobados");
  await logPaymentDiagnosticsIfEmpty("approved", data);
  return includeImage ? withSignedPaymentImages(data) : (data || []).map(({ image_url: _imageUrl, ...payment }) => payment);
}

export async function getApprovedPaymentImageUrl(paymentId) {
  assertSupabaseServiceRole();
  const { data, error } = await supabase
    .from("payments")
    .select("id, image_url, validation_status")
    .eq("id", paymentId)
    .maybeSingle();

  throwIfSupabaseError(error, "No se pudo localizar el comprobante aprobado");
  if (!data || data.validation_status !== "approved") throw createNotFound("No se encontro el comprobante aprobado");

  return {
    id: data.id,
    signed_url: await getPaymentImageUrl(data.image_url),
    signed_url_expires_in: PAYMENT_IMAGE_URL_TTL_SECONDS
  };
}

export async function deleteApprovedPayment(paymentId, confirmation) {
  assertSupabaseServiceRole();
  if (String(confirmation || "").trim().toUpperCase() !== "ELIMINAR") {
    throw createBadRequest("Debes escribir ELIMINAR para confirmar");
  }

  const { data: result, error } = await supabase.rpc("delete_approved_payment_and_order", {
    p_payment_id: paymentId,
    p_confirmation: confirmation,
  });

  throwIfSupabaseError(error, "No se pudo eliminar el comprobante y su pedido");
  if (!result?.deleted) throw createConflict("El comprobante ya fue eliminado o dejo de estar aprobado");

  const path = paymentImagePath(result.image_url);
  if (path) {
    const { error: storageError } = await supabase.storage.from(PAYMENTS_BUCKET).remove([path]);
    if (storageError) console.error("[payments:delete] no se pudo eliminar la imagen", storageError.message);
  }

  return { deleted: true, id: result.payment_id, order_id: result.order_id, order_deleted: true };
}

const PAYMENTS_BUCKET = "payments";
const PAYMENT_IMAGE_URL_TTL_SECONDS = 60 * 60;

// Ruta dentro del bucket. Las filas antiguas guardaban la URL pública completa
// (.../object/public/payments/<archivo>), que deja de funcionar con el bucket privado.
export function paymentImagePath(imageUrl) {
  if (!imageUrl) return null;
  const value = String(imageUrl);
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, "");
  const match = value.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/payments\/([^?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// URL firmada de 1 hora; una URL externa que no es del bucket se devuelve tal cual
export async function getPaymentImageUrl(imageUrl) {
  if (!imageUrl) return null;
  const path = paymentImagePath(imageUrl);
  if (!path) return /^https?:\/\//i.test(String(imageUrl)) ? imageUrl : null;

  const { data, error } = await supabase.storage
    .from(PAYMENTS_BUCKET)
    .createSignedUrl(path, PAYMENT_IMAGE_URL_TTL_SECONDS);

  if (error) {
    console.error("[payments] No se pudo firmar la imagen del comprobante:", error.message);
    return null;
  }
  return data?.signedUrl || null;
}

async function withSignedPaymentImages(payments) {
  return Promise.all((payments ?? []).map(async payment => ({
    ...payment,
    image_url: await getPaymentImageUrl(payment.image_url)
  })));
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

  // Transiciones permitidas: un pago aprobado ya se imprimió y no puede volver atrás.
  // Un rechazo por error sí puede aprobarse después.
  const allowedFrom = action === "approve" ? "pending_review,rejected" : "pending_review";

  // 1. Actualizar pago de forma condicional: si dos admins aprueban a la vez,
  //    solo una actualización coincide y solo esa envía la impresión.
  const { data: updated, error } = await supabase
    .from("payments")
    .update({ validation_status: validationStatus })
    .eq("id", paymentId)
    .or(`validation_status.is.null,validation_status.in.(${allowedFrom})`)
    .select("order_id");

  throwIfSupabaseError(error, "No se pudo actualizar el pago");
  const payment = updated?.[0];

  if (!payment) {
    const { data: currentPayment, error: currentError } = await supabase
      .from("payments")
      .select("order_id, validation_status")
      .eq("id", paymentId)
      .maybeSingle();

    throwIfSupabaseError(currentError, "No se pudo cargar el pago");
    if (!currentPayment) throw createNotFound("Pago no encontrado");

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

    throw createConflict("El pago ya fue aprobado y enviado a imprimir; no se puede rechazar");
  }

  if (!payment.order_id) throw createNotFound("No se encontro la orden asociada al pago");

  // 2. Actualizar orden
  const { data: updatedOrder, error: orderError } = await supabase
    .from("orders")
    .update({
      status: orderStatus,
      // Los comprobantes manuales también son una confirmación de pago.
      // La calificación de referidos depende de este estado, no solo de status=paid.
      payment_status: action === "approve" ? "successful" : "failed"
    })
    .eq("id", payment.order_id)
    .select("id")
    .maybeSingle();

  throwIfSupabaseError(orderError, "No se pudo actualizar el estado de la orden");
  if (!updatedOrder) throw createNotFound("No se encontro la orden asociada al pago");

  if (action === "approve") {
    await qualifyReferralForOrder(payment.order_id).catch(error => {
      // La aprobación del pago no se revierte por un fallo transitorio del ledger;
      // la operación queda registrada y puede reintentarse de forma idempotente.
      console.error("[payments:referral-qualification]", error?.message || error);
    });
  }

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
    .select("id,total,status,customer_name,sender_name,checkout_token,customer_id")
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
